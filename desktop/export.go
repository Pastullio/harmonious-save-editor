package main

import (
	"io"
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
var exportExts = map[string]bool{".json": true, ".nmsship": true, ".so": true, ".png": true, ".txt": true, ".glb": true}
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
