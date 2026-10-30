package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestForgetWindowPlacement(t *testing.T) {
	dir := t.TempDir()
	_ = os.MkdirAll(filepath.Join(dir, "Default"), 0o755)
	p := filepath.Join(dir, "Default", "Preferences")
	in := `{"browser":{"app_window_placement":{"_crx_x":{"left":0,"top":0}},"has_seen_welcome_page":true},"big":12345678901234567890,"profile":{"name":"x"}}`
	_ = os.WriteFile(p, []byte(in), 0o644)
	forgetWindowPlacement(dir)
	out, _ := os.ReadFile(p)
	s := string(out)
	if strings.Contains(s, "app_window_placement") || !strings.Contains(s, "has_seen_welcome_page") || !strings.Contains(s, "12345678901234567890") || !strings.Contains(s, `"name":"x"`) {
		t.Fatalf("got %s", s)
	}
	forgetWindowPlacement(filepath.Join(dir, "missing")) // no profile yet: nothing happens
}
