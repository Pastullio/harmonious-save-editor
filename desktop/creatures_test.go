package main

import (
	"encoding/binary"
	"os"
	"testing"
)

// an entry: ID as a fixed string, then a variable string pointing at the model's filename
func TestSceneInTable(t *testing.T) {
	raw := make([]byte, 0x200)
	copy(raw[0x40:], "QUAD_PET")
	copy(raw[0x80:], "PET")       // a shorter ID inside another entry's name mustn't match QUAD_PET's model
	copy(raw[0x60:], "XQUAD_PET") // nor a longer name ending the same
	field, str := 0xA0, 0x180
	binary.LittleEndian.PutUint64(raw[field:], uint64(str-field))
	s := "MODELS/PLANETS/CREATURES/PETS/QUADRUPED.SCENE.MBIN"
	binary.LittleEndian.PutUint32(raw[field+8:], uint32(len(s)))
	binary.LittleEndian.PutUint32(raw[field+12:], 0xAAAAAA01)
	copy(raw[str:], s)
	raw = append(raw, make([]byte, 64)...)
	if got := sceneInTable(raw, "QUAD_PET"); got != "models/planets/creatures/pets/quadruped.scene.mbin" {
		t.Fatalf("got %q", got)
	}
	if got := sceneInTable(raw, "FLYINGSNAKE"); got != "" {
		t.Fatalf("unknown ID found %q", got)
	}
}

// HSE_TEST_CREATURES=<creaturefilenametable.mbin> reads a real one
func TestCreatureFilenames(t *testing.T) {
	p := os.Getenv("HSE_TEST_CREATURES")
	if p == "" {
		t.Skip("HSE_TEST_CREATURES not set")
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]string{
		"PROTOFLYER": "models/planets/creatures/weird/floatercreature.scene.mbin", "QUAD_PET": "models/common/robots/quadrupedpet.scene.mbin",
		"FISHBOWL_PET3": "models/common/robots/walking_building_oceanus.scene.mbin", "DIPLO_PET": "models/planets/creatures/diplorig/diplo.scene.mbin",
	} {
		if got := sceneInFilenameTable(raw, id); got != want {
			t.Errorf("%s: got %q, want %q", id, got, want)
		}
	}
}

// the forced battle types: HSE_TEST_CREATURES=<creaturedatatable.mbin> also reads a real table
func TestCreatureTypes(t *testing.T) {
	raw := make([]byte, 0x30+2*0xD0)
	binary.LittleEndian.PutUint32(raw, 0xCCCCCCCC)
	binary.LittleEndian.PutUint64(raw[0x10:], 0x37D55099B13B9F9C)
	binary.LittleEndian.PutUint64(raw[0x20:], 0x10)
	binary.LittleEndian.PutUint32(raw[0x28:], 2)
	copy(raw[0x30+0x30:], "ROBO_PET")
	raw[0x30+0xCC] = 8
	copy(raw[0x30+0xD0+0x30:], "QUAD_PET")
	got, err := creatureTypes(raw)
	if err != nil || len(got) != 1 || got["ROBO_PET"] != "Mech" {
		t.Fatalf("got %v, %v", got, err)
	}
	if f := os.Getenv("HSE_TEST_CREATURES"); f != "" {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		real, err := creatureTypes(b)
		if err != nil || real["ROBO_PET"] != "Mech" || real["FLYINGSNAKE"] != "Barren" || len(real) != 19 {
			t.Fatalf("real table: %v, %v", real, err)
		}
	}
}
