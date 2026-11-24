package main

import (
	"os"
	"reflect"
	"testing"
)

// HSE_TEST_MODULAR=<modularcustomisationdatatable.mbin> reads the real table (never committed).
func TestParseModularSlots(t *testing.T) {
	if got := parseModularSlots([]byte("not a table"), "STAFF_HEAD"); got != nil {
		t.Fatalf("junk gave %v", got)
	}
	// a made-up table in the same shape: a slot ID, its item list, one group per item
	raw := make([]byte, 0x400)
	copy(raw, []byte{0xCC, 0xCC, 0xCC, 0xCC})
	put := func(p int, s string) { copy(raw[p:], s) }
	list := func(p, to, n int) { raw[p] = byte(to - p); raw[p+1] = byte((to - p) >> 8); raw[p+8] = byte(n) }
	put(0x80, "UI_STAFF_INPUT_HEAD")
	put(0xC0, "STAFF_HEAD")
	list(0xD0, 0x200, 2)
	list(0x200, 0x300, 1)
	put(0x210, "STAFF_PART_C")
	list(0x240, 0x310, 1)
	put(0x250, "STAFF_HEAD1")
	put(0x300, "STAFF_HEAD_1")
	put(0x310, "STAFF_HEAD_2")
	want := []staffSlot{{ID: "STAFF_HEAD", Label: "UI_STAFF_INPUT_HEAD", Parts: []staffPart{{"STAFF_HEAD_1", "STAFF_PART_C"}, {"STAFF_HEAD_2", "STAFF_HEAD1"}}}}
	if got := parseModularSlots(raw, "STAFF_HEAD"); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v", got)
	}
	if got := parseModularSlots(raw, "STAFF_HEAD", "STAFF_CORE"); got != nil {
		t.Fatalf("a missing slot gave %v", got)
	}
	if f := os.Getenv("HSE_TEST_MODULAR"); f != "" {
		real, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		got := parseModularSlots(real, "STAFF_HEAD", "STAFF_CORE", "STAFF_POLE")
		if len(got) != 3 || len(got[0].Parts) != 7 || len(got[1].Parts) != 6 || len(got[2].Parts) != 6 {
			t.Fatalf("real table: %+v", got)
		}
		for _, s := range got {
			t.Logf("%s (%s): %v", s.ID, s.Label, s.Parts)
		}
		if got[0].Parts[4] != (staffPart{"STAFF_HEAD_5A", "STAFF_HEAD4B"}) {
			t.Fatalf("head 5: %+v", got[0].Parts[4])
		}
	}
}

func TestStaffNames(t *testing.T) {
	got := staffNames([]string{"^STAFF_HEAD_5A", "STAFF_CORE_5", " ^staff_pole_2 ", "^TORSO_VYK", "bad name"})
	want := []string{"_STAFFHEAD_5A", "_STAFFCORE_5", "_STAFFPOLE_2"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v", got)
	}
}

// HSE_TEST_MODULAR and HSE_TEST_PLAYERDATA (the folder with charactercustomisationdescriptorgroupsdata.mbin) read the
// real tables: every ship kind gets its three slots, and the owner's fabricator-built fighter resolves to nodes.
func TestShipSlots(t *testing.T) {
	groups := map[string][]string{"W_A": {"_SUB_1", "_HULL_A", "_WINGS_A"}, "W_B": {"_SUB_2", "_HULL_A", "_WINGS_A"}, "W_C": {"_HULL_A", "_WINGS_B"}}
	if got := groupNames(groups, []string{"^w_a", "bad name", "W_C"}); !reflect.DeepEqual(got, []string{"_SUB_1", "_HULL_A", "_WINGS_A", "_HULL_A", "_WINGS_B"}) {
		t.Fatalf("names: %v", got)
	}
	mf, pd := os.Getenv("HSE_TEST_MODULAR"), os.Getenv("HSE_TEST_PLAYERDATA")
	if mf == "" || pd == "" {
		t.Skip("set HSE_TEST_MODULAR and HSE_TEST_PLAYERDATA")
	}
	raw, err := os.ReadFile(mf)
	if err != nil {
		t.Fatal(err)
	}
	graw, err := os.ReadFile(pd + "/charactercustomisationdescriptorgroupsdata.mbin")
	if err != nil {
		t.Fatal(err)
	}
	tab, err := parseDescriptorGroups(graw)
	if err != nil {
		t.Fatal(err)
	}
	for name, k := range shipKinds {
		slots := shipSlotsFrom(raw, tab, k.Slots)
		if len(slots) != 3 {
			t.Fatalf("%s: %d slots", name, len(slots))
		}
		for _, s := range slots {
			t.Logf("%s %s (%s): %d parts, first %+v", name, s.ID, s.Label, len(s.Parts), s.Parts[0])
		}
	}
	if got := groupNames(tab, []string{"^FIGHT_COCKAB", "^FIGHT_WINGA", "^FIGHT_ENGIC"}); len(got) < 3 {
		t.Fatalf("the owner's fighter: %v", got)
	} else {
		t.Logf("the owner's fighter: %v", got)
	}
}

func TestSkipEngineJets(t *testing.T) {
	for m, want := range map[string]bool{"MODELS/COMMON/SPACECRAFT/FIGHTERS/ENGINE/ENGINE_B/ENGINEJET_MAT1.MATERIAL.MBIN": true, "squareengine4_enginejet_mat.material.mbin": true,
		"AFTERBURNMAT.MATERIAL.MBIN": true, "EJECTVFX3MAT.MATERIAL.MBIN": true, "HQTRIMSECONDARY_MAT.MATERIAL.MBIN": false, "JETPACK_MAT.MATERIAL.MBIN": false, "ENGINEMAT.MATERIAL.MBIN": false} {
		if got := skipMaterial(m); got != want {
			t.Errorf("%s: got %v", m, got)
		}
	}
}
