package main

// Loadout profiles: small JSON files in %LOCALAPPDATA%\HarmoniousSaveEditor\profiles, one per profile,
// so they can be backed up, shared and dropped in by hand. The page builds and applies them; the app
// only lists, stores and deletes the files.

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var profileNameRe = regexp.MustCompile(`^[\w\- ().,'&+]{1,80}\.json$`)

func profilesDir() string { return filepath.Join(appDir, "profiles") }

type profileFile struct {
	File  string `json:"file"`
	Mtime int64  `json:"mtime"`
	Data  string `json:"data"` // the file as written, so the page can parse it losslessly
}

func handleProfiles(w http.ResponseWriter, r *http.Request) {
	dir := profilesDir()
	_ = os.MkdirAll(dir, 0o755)
	name := r.URL.Query().Get("file")
	if name != "" && (!profileNameRe.MatchString(name) || filepath.Base(name) != name) {
		http.Error(w, "bad profile file name", http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodGet:
		if r.URL.Query().Get("reveal") == "1" {
			_ = reveal(dir)
			writeJSON(w, map[string]string{"dir": dir})
			return
		}
		entries, _ := os.ReadDir(dir)
		out := []profileFile{}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".json") {
				continue
			}
			b, err := os.ReadFile(filepath.Join(dir, e.Name()))
			if err != nil || !json.Valid(b) {
				continue
			}
			info, _ := e.Info()
			out = append(out, profileFile{e.Name(), info.ModTime().UnixMilli(), string(b)})
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Mtime > out[j].Mtime })
		writeJSON(w, out)
	case http.MethodPost:
		if name == "" {
			http.Error(w, "no file name", http.StatusBadRequest)
			return
		}
		b, err := io.ReadAll(io.LimitReader(r.Body, 16<<20))
		if err != nil || !json.Valid(b) {
			http.Error(w, "the profile isn't valid JSON", http.StatusBadRequest)
			return
		}
		if err := atomicWrite(filepath.Join(dir, name), b); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"file": name})
	case http.MethodDelete:
		if name == "" {
			http.Error(w, "no file name", http.StatusBadRequest)
			return
		}
		if err := os.Remove(filepath.Join(dir, name)); err != nil && !os.IsNotExist(err) {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"deleted": name})
	default:
		http.Error(w, "GET, POST or DELETE", http.StatusMethodNotAllowed)
	}
}
