package main

import (
	"encoding/binary"
	"math"
	"os"
	"testing"
)

// A made-up table in the game's layout reads back as written; a real one is checked when HSE_TEST_BIOMES points at it.
func TestParseBiomes(t *testing.T) {
	raw := make([]byte, 0x20+0x3E0)
	binary.LittleEndian.PutUint32(raw, 0xCCCCCCCC)
	binary.LittleEndian.PutUint64(raw[0x10:], 0x816993EB69267DD2)
	put := func(at int, v float32) { binary.LittleEndian.PutUint32(raw[0x20+at:], math.Float32bits(v)) }
	for s := 0; s < 5; s++ {
		for k := 0; k < 17; k++ {
			put(s*0x88+k*4, float32(s*100+k))
			put(s*0x88+0x44+k*4, float32(k))
		}
	}
	put(0x2A8, 1)
	put(0x330+4, 2)
	bi, err := parseBiomes(raw)
	if err != nil {
		t.Fatal(err)
	}
	if bi.Star[2][5] != 205 || bi.StarPrime[4][16] != 16 || bi.AbandonedYellow[0] != 1 || bi.LushYellow[1] != 2 {
		t.Fatalf("read back wrong: %v %v", bi.Star[2], bi.LushYellow)
	}
	if f := os.Getenv("HSE_TEST_BIOMES"); f != "" {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		bi, err := parseBiomes(raw)
		if err != nil {
			t.Fatal(err)
		}
		for s, l := range bi.Star {
			t.Logf("star %d: %v", s, l)
		}
		// the owner's file (2026-10-30): yellow Lush 2 and Dead 2, lush galaxies Lush 4, empty galaxies Dead 4,
		// purple stars the only ones with Marsh, Volcanic and Ocean
		if bi.Star[0][0] != 2 || bi.LushYellow[0] != 4 || bi.AbandonedYellow[6] != 4 || bi.Star[4][14] <= 0 || bi.Star[0][14] != 0 || bi.DeadToWeird != 0.5 {
			t.Fatalf("the real table doesn't read as expected: %v / %v / %v", bi.Star, bi.LushYellow, bi.AbandonedYellow)
		}
	}
}
