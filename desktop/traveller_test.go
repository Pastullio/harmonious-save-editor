package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// a GcCustomisationDescriptorGroups with one set of two groups
func TestParseDescriptorGroups(t *testing.T) {
	raw := make([]byte, 0x20+0x50+0x38+2*0x108+3*0x20)
	binary.LittleEndian.PutUint32(raw, 0xCCCCCCCC)
	binary.LittleEndian.PutUint64(raw[0x10:], 0x6E1D4A06924711BB)
	list := func(at, to, n int) {
		binary.LittleEndian.PutUint64(raw[at:], uint64(to-at))
		binary.LittleEndian.PutUint32(raw[at+8:], uint32(n))
	}
	set := 0x20 + 0x50
	grp := set + 0x38
	names := grp + 2*0x108
	list(0x20+0x30, set, 1)
	list(set, grp, 2)
	copy(raw[grp+0x50:], "TORSO_VYK")
	list(grp+0x40, names, 2)
	copy(raw[names:], "_Torso_Vykeen")
	copy(raw[names+0x20:], "_VykNeck_XV")
	copy(raw[grp+0x108+0x50:], "CAPE_NULL")
	list(grp+0x108+0x40, names+0x40, 1)
	copy(raw[names+0x40:], "_CAPE_NULL")
	got, err := parseDescriptorGroups(raw)
	if err != nil || strings.Join(got["TORSO_VYK"], ",") != "_Torso_Vykeen,_VykNeck_XV" || strings.Join(got["CAPE_NULL"], ",") != "_CAPE_NULL" {
		t.Fatalf("got %v, %v", got, err)
	}
	if f := os.Getenv("HSE_TEST_PLAYERDATA"); f != "" { // the owner's table
		b, err := os.ReadFile(filepath.Join(f, "charactercustomisationdescriptorgroupsdata.mbin"))
		if err != nil {
			t.Fatal(err)
		}
		real, err := parseDescriptorGroups(b)
		if err != nil || len(real) < 900 || strings.Join(real["ARMOUR_BUI3"], ",") != "_Chest_Builders3" {
			t.Fatalf("real table: %d groups, %v", len(real), err)
		}
	}
}

// a two-joint skeleton and one skinned triangle make a glTF that says what it holds
func TestWriteGLB(t *testing.T) {
	geo := &geomStreams{skinLayout: []int32{2, 3}}
	s := &meshStream{pos: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0}, idx: []uint32{0, 1, 2}, uv: make([]float32, 6),
		bones: []uint8{0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0}, weights: []float32{1, 0, 0, 0, 1, 0, 0, 0, .5, .5, 0, 0}}
	parts := []meshPart{{name: "Tri", material: `MODELS\X\TRI.MATERIAL.MBIN`, s: s, geo: geo, m: identity(), skinned: true}}
	j1 := tJoint{name: "player01_ROOTSHJnt", index: 2, parent: -1, world: identity(), local: identity()}
	w2 := identity()
	w2[7] = 1
	j2 := tJoint{name: "player01_NeckSHJnt", index: 3, parent: 0, world: w2, local: w2}
	b, err := writeGLB("Tester", parts, []tJoint{j1, j2}, map[int]int{2: 0, 3: 1})
	if err != nil {
		t.Fatal(err)
	}
	if string(b[:4]) != "glTF" || int(binary.LittleEndian.Uint32(b[8:])) != len(b) {
		t.Fatal("not a glb")
	}
	jl := int(binary.LittleEndian.Uint32(b[12:]))
	var doc struct {
		Nodes []struct {
			Name     string
			Children []int
		}
		Skins []struct {
			Joints []int
		}
		Meshes []struct {
			Primitives []struct {
				Attributes map[string]int
			}
		}
		Materials []struct{ Name string }
	}
	if err := json.Unmarshal(bytes.TrimRight(b[20:20+jl], " "), &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Skins) != 1 || len(doc.Skins[0].Joints) != 2 || doc.Nodes[doc.Skins[0].Joints[0]].Name != "ROOT" || doc.Nodes[doc.Skins[0].Joints[1]].Name != "Neck" {
		t.Fatalf("skin %+v nodes %+v", doc.Skins, doc.Nodes)
	}
	a := doc.Meshes[0].Primitives[0].Attributes
	if _, ok := a["JOINTS_0"]; !ok || doc.Materials[0].Name != "tri" {
		t.Fatalf("primitive %+v materials %+v", a, doc.Materials)
	}
}

func TestShrinkDDS(t *testing.T) {
	// a 2048 px BC7 texture with 12 mips (DX10 header): shrunk to 1024 px it drops exactly the top level
	mk := func() []byte {
		b := make([]byte, 148)
		copy(b, "DDS ")
		le := binary.LittleEndian
		le.PutUint32(b[12:], 2048)
		le.PutUint32(b[16:], 2048)
		le.PutUint32(b[28:], 12)
		copy(b[84:], "DX10")
		le.PutUint32(b[128:], 98)
		le.PutUint32(b[140:], 1)
		for w, lvl := 2048, 0; lvl < 12; w, lvl = w/2, lvl+1 {
			n := ((w + 3) / 4) * ((w + 3) / 4) * 16
			b = append(b, bytes.Repeat([]byte{byte(lvl)}, n)...)
		}
		return b
	}
	b := mk()
	s := shrinkDDS(b, 1024)
	le := binary.LittleEndian
	if le.Uint32(s[16:]) != 1024 || le.Uint32(s[12:]) != 1024 || le.Uint32(s[28:]) != 11 || s[148] != 1 || len(s) != len(b)-512*512*16 {
		t.Fatalf("w %d h %d mips %d first byte %d size %d", le.Uint32(s[16:]), le.Uint32(s[12:]), le.Uint32(s[28:]), s[148], len(s))
	}
	if _, err := decodeDDS(s); err != nil {
		t.Fatal(err)
	}
	if small := shrinkDDS(s, 1024); len(small) != len(s) {
		t.Fatal("a texture already small enough changed")
	}
}
