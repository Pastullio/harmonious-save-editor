package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
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

// GET /api/exports/pictures -> the pose pictures ("<name> pose <date>.png") and 3D poses ("<name> 3D pose <date>.glb")
// Blender saved in Exports, newest first,
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
			if ext := strings.ToLower(filepath.Ext(n)); e.IsDir() || (ext != ".png" && ext != ".glb") || !strings.Contains(strings.ToLower(n), " pose ") {
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
	ext := strings.ToLower(filepath.Ext(name))
	if name == "" || name == "." || strings.ContainsAny(name, `/\`) || (ext != ".png" && ext != ".glb") {
		http.Error(w, "not a picture", http.StatusBadRequest)
		return
	}
	p := filepath.Join(exportsDir(), name)
	if !fileExists(p) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if ext == ".glb" {
		w.Header().Set("Content-Type", "model/gltf-binary")
	} else {
		w.Header().Set("Content-Type", "image/png")
	}
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, p)
}

// POST /api/live/pose?name=Pastullio (from the LiveLink add-on, a .glb of the posed traveller, textured, the pose
// baked into the mesh) -> saved in Exports as "<name> 3D pose <date>.glb" for the Traveller page to turn and place.
func handleLivePose(w http.ResponseWriter, r *http.Request) {
	saveLiveGLB(w, r, " 3D pose ", "Traveller")
}

// POST /api/live/ship?name=<corvette> (the live token may do this): a corvette Blender sent in 3D, saved as
// "<corvette> 3D ship <date>.glb" in Exports for the Traveller page (owner, 2026-11-12)
func handleLiveShip(w http.ResponseWriter, r *http.Request) {
	saveLiveGLB(w, r, " 3D ship ", "Corvette")
}

// GET /api/exports/ships -> the corvettes sent in 3D, newest first
func handleExportShips(w http.ResponseWriter, r *http.Request) {
	type ship struct {
		Name  string `json:"name"`
		MTime int64  `json:"mtime"`
	}
	out := []ship{}
	if es, err := os.ReadDir(exportsDir()); err == nil {
		for _, e := range es {
			n := e.Name()
			if e.IsDir() || strings.ToLower(filepath.Ext(n)) != ".glb" || !strings.Contains(strings.ToLower(n), " 3d ship ") {
				continue
			}
			if fi, err := e.Info(); err == nil {
				out = append(out, ship{n, fi.ModTime().UnixMilli()})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].MTime > out[j].MTime })
	writeJSON(w, map[string]any{"ships": out})
}

func saveLiveGLB(w http.ResponseWriter, r *http.Request, kind, fallback string) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 200<<20))
	if err != nil || len(b) < 12 || string(b[:4]) != "glTF" {
		http.Error(w, "that isn't a .glb", http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(exportBad.ReplaceAllString(r.URL.Query().Get("name"), "_"))
	if name == "" || strings.HasPrefix(name, ".") {
		name = fallback
	}
	dir := exportsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	stem := name + kind + time.Now().Format("2006-01-02 150405")
	p := filepath.Join(dir, stem+".glb")
	for n := 2; fileExists(p); n++ {
		p = filepath.Join(dir, stem+" ("+strconv.Itoa(n)+").glb")
	}
	if err := atomicWrite(p, b); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"path": p, "name": filepath.Base(p)})
}
