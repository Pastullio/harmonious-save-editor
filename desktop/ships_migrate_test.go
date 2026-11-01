package main

import (
	"os"
	"path/filepath"
	"testing"
)

// the automatic copies moved from Dock Yard\Garage to Dock Yard\Hangar (2026-11-01): the folder is renamed once, and
// read in place if it couldn't be
func TestGarageBecomesHangar(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "Garage")
	os.MkdirAll(old, 0o755)
	os.WriteFile(filepath.Join(old, "Ship 123.ship.json"), []byte("{}"), 0o644)
	if hangarFolder(root) != old {
		t.Fatal("before the rename the old folder should be read")
	}
	migrateShips(root, false)
	if _, err := os.Stat(filepath.Join(root, "Hangar", "Ship 123.ship.json")); err != nil {
		t.Fatal("ship not moved to the Hangar:", err)
	}
	if fileExists(old) || hangarFolder(root) != filepath.Join(root, "Hangar") {
		t.Fatal("the Garage folder should be gone and the Hangar used")
	}
}
