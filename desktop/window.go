package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
)

// forgetWindowPlacement drops the window position Edge/Chrome saved for app windows in the editor's own
// profile, so the window opens where windowPlacement puts it. Numbers are kept exactly (UseNumber).
func forgetWindowPlacement(profile string) {
	p := filepath.Join(profile, "Default", "Preferences")
	b, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var prefs map[string]any
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	if dec.Decode(&prefs) != nil {
		return
	}
	br, ok := prefs["browser"].(map[string]any)
	if !ok {
		return
	}
	changed := false
	for _, k := range []string{"app_window_placement", "window_placement"} {
		if _, ok := br[k]; ok {
			delete(br, k)
			changed = true
		}
	}
	if !changed {
		return
	}
	if out, err := json.Marshal(prefs); err == nil {
		_ = atomicWrite(p, out)
	}
}
