package main

// "Save multi-tool files for the developer" (owner 2026-11-23, for the staff builder and for working out how the game
// picks a multi-tool's parts from its seed): one zip in Exports with the game's multi-tool scenes and descriptor
// lists (which parts a model can have and how often), the player-data tables (the game's table of parts you assemble
// things from is among them), and what the page sends: this save's multi-tools and customisation entries, and the
// owner's own part picks per tool (known pairs of seed and parts). Geometry and textures are left out: they are big
// and the app already reads them. Nothing leaves the PC; the owner sends the zip.

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// toolSampleWants: is this game file one the multi-tool research needs?
func toolSampleWants(n string) bool {
	n = normGamePath(n)
	switch {
	case strings.HasPrefix(n, "models/common/weapons/multitool/"):
		// materials too (small): they name the layered textures that say which palette colours a staff shows
		return strings.HasSuffix(n, ".scene.mbin") || strings.HasSuffix(n, ".descriptor.mbin") || strings.HasSuffix(n, ".material.mbin")
	case strings.HasSuffix(n, ".texture.mbin"):
		return strings.Contains(n, "multitool") || strings.Contains(n, "staff") || strings.Contains(n, "/weapons/")
	case strings.HasPrefix(n, "metadata/gamestate/playerdata/"):
		return strings.HasSuffix(n, ".mbin")
	case strings.HasPrefix(n, "metadata/reality/tables/"):
		base := filepath.Base(n)
		return strings.Contains(base, "modular") || strings.Contains(base, "weapon") || strings.Contains(base, "customis")
	}
	return false
}

func handleToolSample(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	if _, err := openGamePaks(); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	var v struct {
		Tools json.RawMessage `json:"tools"`
		Save  json.RawMessage `json:"save"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<20)).Decode(&v); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var list []string
	for _, n := range allGameFiles() {
		if toolSampleWants(n) {
			list = append(list, n)
		}
	}
	sort.Strings(list)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	report := []string{"Editor version: " + appVersion, "For: the staff builder, and how the game picks a multi-tool's parts from its seed", "", "Game files:"}
	kept := 0
	for _, n := range list {
		b, err := gameFile(n)
		if err != nil {
			report = append(report, n+": "+err.Error())
			continue
		}
		if f, err := zw.Create(n); err == nil {
			f.Write(b)
			kept++
			report = append(report, n)
		}
	}
	for name, raw := range map[string]json.RawMessage{"my-tools.json": v.Tools, "save-multitools.json": v.Save} {
		if len(raw) > 0 {
			if f, err := zw.Create(name); err == nil {
				f.Write(raw)
			}
		}
	}
	if f, err := zw.Create("about.txt"); err == nil {
		f.Write([]byte(strings.Join(report, "\r\n")))
	}
	zw.Close()
	dir := exportsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	p := filepath.Join(dir, "Multi-tool files for the developer "+time.Now().Format("2006-01-02 1504")+".zip")
	for n := 2; fileExists(p); n++ {
		p = strings.TrimSuffix(p, ".zip") + " (" + strconv.Itoa(n) + ").zip"
	}
	if err := atomicWrite(p, buf.Bytes()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = revealFile(p)
	writeJSON(w, map[string]any{"path": p, "files": kept, "size": buf.Len()})
}
