package main

// No Man's Sky screenshots from Steam, so a ship or multi-tool can take one as its cover.
// Steam keeps them in <Steam>\userdata\<SteamID32>\760\remote\275850\screenshots (with a
// thumbnails subfolder); the owner can also point the app at a folder of their own.

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const nmsAppID = "275850"
const steamID64Base = 76561197960265728

var shotNameRe = regexp.MustCompile(`(?i)^[\w\-. ()]+\.(jpe?g|png)$`)

// shotDirs lists the folders to look in: the owner's own folder first, then Steam's.
func shotDirs(steamID64 string) []string {
	var dirs []string
	renderMu.Lock()
	custom := settings.Shots
	renderMu.Unlock()
	if custom != "" {
		dirs = append(dirs, custom)
	}
	account := "*"
	if id, err := strconv.ParseUint(steamID64, 10, 64); err == nil && id > steamID64Base {
		account = strconv.FormatUint(id-steamID64Base, 10)
	}
	for _, root := range steamRoots() {
		m, _ := filepath.Glob(filepath.Join(root, "userdata", account, "760", "remote", nmsAppID, "screenshots"))
		dirs = append(dirs, m...)
	}
	seen, out := map[string]bool{}, []string{}
	for _, d := range dirs {
		if st, err := os.Stat(d); err == nil && st.IsDir() && !seen[strings.ToLower(d)] {
			seen[strings.ToLower(d)] = true
			out = append(out, d)
		}
	}
	return out
}

type shot struct {
	Dir   int    `json:"d"`
	Name  string `json:"name"`
	Mtime int64  `json:"mtime"`
	Thumb bool   `json:"thumb"`
}

func handleScreenshots(w http.ResponseWriter, r *http.Request) {
	startRenderWorker() // loads settings
	dirs := shotDirs(r.URL.Query().Get("account"))
	var shots []shot
	for i, d := range dirs {
		entries, _ := os.ReadDir(d)
		for _, e := range entries {
			if e.IsDir() || !shotNameRe.MatchString(e.Name()) {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			shots = append(shots, shot{i, e.Name(), info.ModTime().UnixMilli(), fileExists(filepath.Join(d, "thumbnails", e.Name()))})
		}
	}
	sort.Slice(shots, func(a, b int) bool { return shots[a].Mtime > shots[b].Mtime })
	if len(shots) > 600 {
		shots = shots[:600]
	}
	if shots == nil {
		shots = []shot{}
	}
	writeJSON(w, map[string]any{"dirs": dirs, "shots": shots})
}

func handleScreenshot(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	dirs := shotDirs(q.Get("account"))
	d, err := strconv.Atoi(q.Get("d"))
	name := q.Get("name")
	if err != nil || d < 0 || d >= len(dirs) || !shotNameRe.MatchString(name) || filepath.Base(name) != name {
		http.Error(w, "not a screenshot", http.StatusBadRequest)
		return
	}
	p := filepath.Join(dirs[d], name)
	if q.Get("thumb") == "1" {
		if t := filepath.Join(dirs[d], "thumbnails", name); fileExists(t) {
			p = t
		}
	}
	if !fileExists(p) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, p)
}
