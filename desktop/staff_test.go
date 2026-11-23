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
