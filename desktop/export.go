package main

import (
	"io"
	"sort"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Exports (ship, multi-tool, freighter and build files) go to Documents\Harmonious Save Editor\Exports and are shown in
// Explorer. A browser download from the app window lands in Downloads without anything on screen, so it looked like
// nothing happened (owner, 2026-11-01).
var exportExts = map[string]bool{".json": true, ".nmsship": true, ".so": true, ".png": true, ".txt": true, ".glb": true, ".py": true}
var exportBad = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`)

func exportsDir() string {
	return filepath.Join(filepath.Dir(fullBackupDir()), "Harmonious Save Editor", "Exports")
}

func handleExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimSpace(exportBad.ReplaceAllString(filepath.Base(r.URL.Query().Get("name")), "_"))
	ext := strings.ToLower(filepath.Ext(name))
	if strings.HasSuffix(strings.ToLower(name), ".ship.json") {
		ext = ".ship.json"
	}
	if name == "" || strings.HasPrefix(name, ".") || !exportExts[strings.ToLower(filepath.Ext(name))] {
		http.Error(w, "not an export file name", http.StatusBadRequest)
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	dir := exportsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	stem := name[:len(name)-len(ext)]
	p := filepath.Join(dir, name)
	for n := 2; fileExists(p); n++ {
		p = filepath.Join(dir, stem+" ("+strconv.Itoa(n)+")"+ext)
	}
	if err := atomicWrite(p, b); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if r.URL.Query().Get("reveal") == "1" {
		_ = revealFile(p)
	}
	writeJSON(w, map[string]string{"path": p, "name": filepath.Base(p)})
}

// GET /api/exports/pictures -> the pose pictures Blender saved in Exports ("<name> pose <date>.png"), newest first,
// for the Traveller page (owner, 2026-11-10).
func handleExportPictures(w http.ResponseWriter, r *http.Request) {
	type pic struct {
		Name  string `json:"name"`
		MTime int64  `json:"mtime"`
		Size  int64  `json:"size"`
	}
	out := []pic{}
	if es, err := os.ReadDir(exportsDir()); err == nil {
		for _, e := range es {
			n := e.Name()
			if e.IsDir() || !strings.EqualFold(filepath.Ext(n), ".png") || !strings.Contains(strings.ToLower(n), " pose ") {
				continue
			}
			if fi, err := e.Info(); err == nil {
				out = append(out, pic{n, fi.ModTime().UnixMilli(), fi.Size()})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].MTime > out[j].MTime })
	writeJSON(w, map[string]any{"pictures": out, "dir": exportsDir()})
}

// GET /api/exports/file?name=… -> one PNG from the Exports folder (no other folders, no other kinds of file).
func handleExportFile(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.URL.Query().Get("name"))
	if name == "" || name == "." || strings.ContainsAny(name, `/\`) || !strings.EqualFold(filepath.Ext(name), ".png") {
		http.Error(w, "not a picture", http.StatusBadRequest)
		return
	}
	p := filepath.Join(exportsDir(), name)
	if !fileExists(p) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, p)
}
