package main

// Custom cover pictures (screenshots or images the owner picks for a ship, multi-tool or the traveller) live with the
// Dock Yard on disk, so they survive a browser-profile reset and can be backed up with the ships:
//   Documents\Harmonious Save Editor\Dock Yard\Covers\<sha1 of the cover key>.<png|jpg|webp|gif>
//   Documents\Harmonious Save Editor\Dock Yard\Covers\covers.json   cover key -> file name, for anyone looking

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

var coverMu sync.Mutex

func customCoverDir() string { return filepath.Join(shipsRoot(), "Covers") }

var coverExts = map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}

func coverIndex() map[string]string {
	idx := map[string]string{}
	if b, err := os.ReadFile(filepath.Join(customCoverDir(), "covers.json")); err == nil {
		_ = json.Unmarshal(b, &idx)
	}
	return idx
}

// GET ?key=: the picture (404 if none). POST ?key= with the image as the body: store it. DELETE ?key=: remove it.
// GET ?list=1: every key that has a picture.
func handleCustomCover(w http.ResponseWriter, r *http.Request) {
	coverMu.Lock()
	defer coverMu.Unlock()
	idx := coverIndex()
	if r.URL.Query().Get("list") == "1" {
		keys := []string{}
		for k := range idx {
			keys = append(keys, k)
		}
		writeJSON(w, keys)
		return
	}
	key := r.URL.Query().Get("key")
	if key == "" || len(key) > 2000 {
		http.Error(w, "no cover key", http.StatusBadRequest)
		return
	}
	sum := sha1.Sum([]byte(key))
	base := hex.EncodeToString(sum[:])
	saveIdx := func() error {
		b, _ := json.MarshalIndent(idx, "", "  ")
		return atomicWrite(filepath.Join(customCoverDir(), "covers.json"), b)
	}
	switch r.Method {
	case http.MethodGet:
		name, ok := idx[key]
		if !ok || filepath.Base(name) != name {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, filepath.Join(customCoverDir(), name))
	case http.MethodPost:
		ext, ok := coverExts[r.Header.Get("Content-Type")]
		if !ok {
			http.Error(w, "not a PNG, JPEG, WebP or GIF image", http.StatusBadRequest)
			return
		}
		b, err := io.ReadAll(io.LimitReader(r.Body, 32<<20))
		if err != nil || len(b) == 0 {
			http.Error(w, "no image", http.StatusBadRequest)
			return
		}
		_ = os.MkdirAll(customCoverDir(), 0o755)
		if old, ok := idx[key]; ok && old != base+ext {
			_ = os.Remove(filepath.Join(customCoverDir(), old))
		}
		if err := atomicWrite(filepath.Join(customCoverDir(), base+ext), b); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		idx[key] = base + ext
		if err := saveIdx(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	case http.MethodDelete:
		if name, ok := idx[key]; ok {
			_ = os.Remove(filepath.Join(customCoverDir(), filepath.Base(name)))
			delete(idx, key)
			_ = saveIdx()
		}
		writeJSON(w, map[string]bool{"ok": true})
	default:
		http.Error(w, "GET, POST or DELETE", http.StatusMethodNotAllowed)
	}
}
