package main

import (
	"encoding/binary"
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
