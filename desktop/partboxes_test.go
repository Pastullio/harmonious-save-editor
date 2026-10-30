package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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
