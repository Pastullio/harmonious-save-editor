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
	var v struct {
		Tools json.RawMessage `json:"tools"`
		Save  json.RawMessage `json:"save"`
	}
	if !sampleBody(w, r, &v) {
		return
	}
	writeSampleZip(w, "Multi-tool files for the developer", "the staff builder, and how the game picks a multi-tool's parts from its seed", toolSampleWants,
		map[string]json.RawMessage{"my-tools.json": v.Tools, "save-multitools.json": v.Save})
}

// shipSampleWants: is this game file one the ship builder needs? (owner 2026-11-24: build a ship like a multi-tool.)
// Scenes, descriptor lists and materials of the starships (not corvette parts, freighters or frigates: many, and
// not built this way), the layered-texture lists that say which palette colours a ship shows, and the same tables
// as the multi-tool zip (the game's ship builder slots and parts are in modularcustomisationdatatable).
func shipSampleWants(n string) bool {
	n = normGamePath(n)
	switch {
	case strings.HasPrefix(n, "models/common/spacecraft/"):
		if strings.Contains(n, "/biggs/") || strings.Contains(n, "/industrial/") || strings.Contains(n, "/frigates/") || strings.Contains(n, "/commonparts/") {
			return false
		}
		return strings.HasSuffix(n, ".scene.mbin") || strings.HasSuffix(n, ".descriptor.mbin") || strings.HasSuffix(n, ".material.mbin")
	case strings.HasSuffix(n, ".texture.mbin"):
		return strings.Contains(n, "/spacecraft/") && !strings.Contains(n, "/biggs/") && !strings.Contains(n, "/industrial/") && !strings.Contains(n, "/frigates/")
	case strings.HasPrefix(n, "metadata/gamestate/playerdata/"):
		return strings.HasSuffix(n, ".mbin")
	case strings.HasPrefix(n, "metadata/reality/tables/"):
		base := filepath.Base(n)
		return strings.Contains(base, "modular") || strings.Contains(base, "customis") || strings.Contains(base, "ship")
	}
	return false
}

func handleShipSample(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Ships json.RawMessage `json:"ships"`
		Save  json.RawMessage `json:"save"`
	}
	if !sampleBody(w, r, &v) {
		return
	}
	writeSampleZip(w, "Ship files for the developer", "the ship builder: which parts a ship can have and how a save records them", shipSampleWants,
		map[string]json.RawMessage{"my-ships.json": v.Ships, "save-ships.json": v.Save})
}

func sampleBody(w http.ResponseWriter, r *http.Request, v any) bool {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return false
	}
	if _, err := openGamePaks(); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return false
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<20)).Decode(v); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return false
	}
	return true
}

func writeSampleZip(w http.ResponseWriter, title, what string, wants func(string) bool, extra map[string]json.RawMessage) {
	var list []string
	for _, n := range allGameFiles() {
		if wants(n) {
			list = append(list, n)
		}
	}
	sort.Strings(list)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	report := []string{"Editor version: " + appVersion, "For: " + what, "", "Game files:"}
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
	for name, raw := range extra {
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
	p := filepath.Join(dir, title+" "+time.Now().Format("2006-01-02 1504")+".zip")
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
