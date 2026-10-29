package main

// Corvette cover renders: the page sends a corvette's parts, the app runs the owner's own Blender with
// Charon Forge's real part models in the background, and caches the PNG by a hash of the build, so a
// cover only re-renders when the build changes. No game assets are bundled; everything is read from
// the local Blender and Charon Forge installs.

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed render_cover.py
var renderScript []byte

var keyRe = regexp.MustCompile(`^[0-9a-f]{16,64}$`)

type renderSettings struct {
	Blender string `json:"blender"`
	Charon  string `json:"charon"` // folder that contains the charon_forge package
	Size    int    `json:"size"`
	Samples int    `json:"samples"`
	Shots   string `json:"shots"`            // optional folder of screenshots to pick covers from
	ItemDB  string `json:"itemdb,omitempty"` // NMSSaveEditor.jar for item names and icons
	Game    string `json:"game,omitempty"`   // No Man's Sky folder, when Steam can't find it
}

type renderJob struct {
	State string `json:"state"` // queued, running, done, error
	Error string `json:"error,omitempty"`
}

var (
	renderMu     sync.Mutex
	settings     renderSettings
	jobs         = map[string]*renderJob{}
	queue        = make(chan renderReq, 64)
	settingsOnce sync.Once
)

type renderReq struct{ key, jsonPath string }

func coversDir() string    { return filepath.Join(appDir, "covers") }
func settingsPath() string { return filepath.Join(appDir, "settings.json") }

func loadSettings() {
	b, err := os.ReadFile(settingsPath())
	if err == nil {
		_ = json.Unmarshal(b, &settings)
	}
	if settings.Size == 0 {
		settings.Size = 900
	}
	if settings.Samples == 0 {
		settings.Samples = 32
	}
}

func saveSettings() error {
	b, _ := json.MarshalIndent(settings, "", "  ")
	return os.WriteFile(settingsPath(), b, 0o644)
}

// resolve fills in Blender and Charon Forge locations that weren't set by hand.
func resolveTools() (blender, charon string) {
	renderMu.Lock()
	blender, charon = settings.Blender, settings.Charon
	renderMu.Unlock()
	if blender == "" || !fileExists(blender) {
		blender = findBlender()
	}
	if charon == "" || !fileExists(filepath.Join(charon, "charon_forge", "__init__.py")) {
		charon = findCharon()
	}
	return
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

// newestFirst sorts paths so the highest Blender version comes first ("5.0" > "4.5").
func newestFirst(paths []string) {
	sort.Slice(paths, func(i, j int) bool { return paths[i] > paths[j] })
}

func findCharon() string {
	var found []string
	for _, base := range blenderConfigDirs() {
		versions, _ := filepath.Glob(filepath.Join(base, "*"))
		for _, v := range versions {
			for _, sub := range []string{"extensions/user_default", "extensions/*", "scripts/addons"} {
				matches, _ := filepath.Glob(filepath.Join(v, filepath.FromSlash(sub), "charon_forge", "__init__.py"))
				for _, m := range matches {
					found = append(found, filepath.Dir(filepath.Dir(m)))
				}
			}
		}
	}
	newestFirst(found)
	if len(found) > 0 {
		return found[0]
	}
	return ""
}

func startRenderWorker() {
	settingsOnce.Do(func() {
		loadSettings()
		_ = os.MkdirAll(coversDir(), 0o755)
		go func() {
			for req := range queue {
				runRender(req)
			}
		}()
	})
}

func setJob(key, state, msg string) {
	renderMu.Lock()
	jobs[key] = &renderJob{State: state, Error: msg}
	renderMu.Unlock()
}

func runRender(req renderReq) {
	defer os.Remove(req.jsonPath)
	blender, charon := resolveTools()
	if blender == "" || charon == "" {
		setJob(req.key, "error", "Blender or Charon Forge wasn't found. Set their locations in the render settings.")
		return
	}
	setJob(req.key, "running", "")
	script := filepath.Join(appDir, "render_cover.py")
	if err := os.WriteFile(script, renderScript, 0o644); err != nil {
		setJob(req.key, "error", err.Error())
		return
	}
	renderMu.Lock()
	size, samples := settings.Size, settings.Samples
	renderMu.Unlock()
	out := filepath.Join(coversDir(), req.key+".png")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, blender, "-b", "--factory-startup", "--python", script, "--",
		charon, req.jsonPath, out, fmt.Sprint(size), fmt.Sprint(samples))
	hideWindow(cmd)
	logPath := filepath.Join(coversDir(), req.key+".log")
	lf, _ := os.Create(logPath)
	if lf != nil {
		cmd.Stdout, cmd.Stderr = lf, lf
	}
	start := time.Now()
	err := cmd.Run()
	if lf != nil {
		lf.Close()
	}
	if err != nil || !fileExists(out) {
		msg := "Blender stopped before the cover was made"
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			msg = "The render took longer than 10 minutes and was stopped"
		}
		setJob(req.key, "error", msg+". Details are in "+logPath)
		log.Printf("render %s failed: %v", req.key, err)
		return
	}
	os.Remove(logPath)
	log.Printf("rendered cover %s in %s", req.key, time.Since(start).Round(time.Second))
	setJob(req.key, "done", "")
}

// ------------------------------------------------------------------ handlers

func handleRenderSetup(w http.ResponseWriter, r *http.Request) {
	startRenderWorker()
	if r.Method == http.MethodPost {
		var in renderSettings
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			http.Error(w, "bad settings", http.StatusBadRequest)
			return
		}
		in.Blender, in.Charon, in.Shots = strings.Trim(in.Blender, `" `), strings.Trim(in.Charon, `" `), strings.Trim(in.Shots, `" `)
		// accept the charon_forge folder itself as well as its parent
		if strings.EqualFold(filepath.Base(in.Charon), "charon_forge") {
			in.Charon = filepath.Dir(in.Charon)
		}
		renderMu.Lock()
		settings.Blender, settings.Charon, settings.Shots = in.Blender, in.Charon, in.Shots
		if in.Size >= 256 && in.Size <= 2048 {
			settings.Size = in.Size
		}
		if in.Samples >= 4 && in.Samples <= 512 {
			settings.Samples = in.Samples
		}
		err := saveSettings()
		renderMu.Unlock()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	blender, charon := resolveTools()
	renderMu.Lock()
	s := settings
	renderMu.Unlock()
	writeJSON(w, map[string]any{
		"blender": blender, "charon": charon, "ready": blender != "" && charon != "",
		"blenderSet": s.Blender, "charonSet": s.Charon, "size": s.Size, "samples": s.Samples, "shots": s.Shots,
	})
}

func handleRender(w http.ResponseWriter, r *http.Request) {
	startRenderWorker()
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	key := r.URL.Query().Get("key")
	force := r.URL.Query().Get("force") == "1"
	if !keyRe.MatchString(key) {
		http.Error(w, "bad key", http.StatusBadRequest)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
	if err != nil || !json.Valid(body) {
		http.Error(w, "the build isn't valid JSON", http.StatusBadRequest)
		return
	}
	if !force && fileExists(filepath.Join(coversDir(), key+".png")) {
		setJob(key, "done", "")
		writeJSON(w, map[string]string{"state": "done"})
		return
	}
	renderMu.Lock()
	if j, ok := jobs[key]; ok && (j.State == "queued" || j.State == "running") {
		renderMu.Unlock()
		writeJSON(w, j)
		return
	}
	renderMu.Unlock()
	f, err := os.CreateTemp("", "hse-build-*.json")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	f.Write(body)
	f.Close()
	setJob(key, "queued", "")
	select {
	case queue <- renderReq{key, f.Name()}:
	default:
		os.Remove(f.Name())
		setJob(key, "error", "Too many renders waiting; try again in a moment")
	}
	renderMu.Lock()
	j := jobs[key]
	renderMu.Unlock()
	writeJSON(w, j)
}

func handleRenderStatus(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if !keyRe.MatchString(key) {
		http.Error(w, "bad key", http.StatusBadRequest)
		return
	}
	renderMu.Lock()
	j, ok := jobs[key]
	renderMu.Unlock()
	if !ok {
		if fileExists(filepath.Join(coversDir(), key+".png")) {
			writeJSON(w, renderJob{State: "done"})
		} else {
			writeJSON(w, renderJob{State: "none"})
		}
		return
	}
	writeJSON(w, j)
}

func handleCover(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if !keyRe.MatchString(key) {
		http.Error(w, "bad key", http.StatusBadRequest)
		return
	}
	p := filepath.Join(coversDir(), key+".png")
	if !fileExists(p) {
		http.NotFound(w, r)
		return
	}
	// covers are named by a hash of the build, so a found image never changes and can be cached for good
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("Content-Type", "image/png")
	http.ServeFile(w, r, p)
}
