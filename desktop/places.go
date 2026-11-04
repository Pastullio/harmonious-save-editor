package main

// Favourite places (owner, 2026-11-04: the game's own portal favourites don't always keep a place): bases, space
// stations, settlements and systems the owner stars in the editor, kept outside any save so every save can warp there.
//
//   Documents\Harmonious Save Editor\Favourite places.json   {"places": [...]}, written whole by the page
//
// The page owns the shape of each place (name, kind, portal code, galaxy, note, and for a base its spot on the
// planet); the app only keeps the file, and the old copy as .bak before each write.

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

func placesFile() string {
	return filepath.Join(filepath.Dir(exportsDir()), "Favourite places.json")
}

// GET: the file's contents ({"places": []} when there's none yet). PUT: replace it.
func handlePlaces(w http.ResponseWriter, r *http.Request) {
	p := placesFile()
	switch r.Method {
	case http.MethodGet:
		b, err := os.ReadFile(p)
		if err != nil {
			b = []byte(`{"places":[]}`)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(b)
	case http.MethodPut, http.MethodPost:
		b, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		var v struct {
			Places []json.RawMessage `json:"places"`
		}
		if json.Unmarshal(b, &v) != nil || v.Places == nil {
			http.Error(w, "not a list of places", http.StatusBadRequest)
			return
		}
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if old, err := os.ReadFile(p); err == nil {
			_ = atomicWrite(p+".bak", old)
		}
		if err := atomicWrite(p, b); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"ok": true, "count": len(v.Places), "path": p})
	default:
		http.Error(w, "GET or PUT", http.StatusMethodNotAllowed)
	}
}
