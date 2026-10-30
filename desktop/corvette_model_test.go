package main

import (
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPartMatrix(t *testing.T) {
	// Up (0,2,0) = scale 2, At along +Z: Right is +X, and the part's +Z lands on At
	m, ok := partMatrix(buildPart{Position: []float64{1, 2, 3}, Up: []float64{0, 2, 0}, At: []float64{0, 0, 1}})
	if !ok {
		t.Fatal("no matrix")
	}
	want := mat4{2, 0, 0, 1, 0, 2, 0, 2, 0, 0, 2, 3, 0, 0, 0, 1}
	for i := range m {
		if math.Abs(m[i]-want[i]) > 1e-9 {
			t.Fatalf("got %v, want %v", m, want)
		}
	}
	if _, ok := partMatrix(buildPart{Position: []float64{0, 0, 0}, Up: []float64{0, 1, 0}, At: []float64{0, 1, 0}}); ok {
		t.Fatal("parallel Up and At should be refused")
	}
}

// HSE_TEST_TABLES=<folder with basebuildingobjectstable.mbin and basebuildingpartstable.mbin> reads the real tables
func TestParsePartScenes(t *testing.T) {
	dir := os.Getenv("HSE_TEST_TABLES")
	if dir == "" {
		t.Skip("HSE_TEST_TABLES not set")
	}
	obj, err := os.ReadFile(filepath.Join(dir, "basebuildingobjectstable.mbin"))
	if err != nil {
		t.Fatal(err)
	}
	parts, _ := os.ReadFile(filepath.Join(dir, "basebuildingpartstable.mbin"))
	m, err := parsePartScenes(obj, parts)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%d parts with a scene", len(m))
	if !strings.Contains(m["B_COK_D"], "BIGGS/MODULES/COCKPIT_D") || !strings.Contains(m["B_WALL"], "BASIC_WALL_PLACEMENT") || !strings.Contains(m["CONT_S"], ".SCENE.MBIN") {
		t.Fatalf("unexpected: B_COK_D=%q B_WALL=%q CONT_S=%q", m["B_COK_D"], m["B_WALL"], m["CONT_S"])
	}
}
