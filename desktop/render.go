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
	Blender     string   `json:"blender"`
	Charon      string   `json:"charon"` // folder that contains the charon_forge package
	Size        int      `json:"size"`
	Samples     int      `json:"samples"`
	Shots       string   `json:"shots"`                    // optional folder of screenshots to pick covers from
	ItemDB      string   `json:"itemdb,omitempty"`         // NMSSaveEditor.jar for item names and icons
	Game        string   `json:"game,omitempty"`           // No Man's Sky folder, when Steam can't find it
	Ships       string   `json:"ships,omitempty"`          // ship library folder, when not the default in Documents
	ShipFolders []string `json:"shipFolders,omitempty"`    // folders the owner already keeps ships in (read only)
	AutoRender  *bool    `json:"autoRender,omitempty"`     // render corvettes without a cover on their own (default on)
	Patreon     string   `json:"patreonService,omitempty"` // where the Patreon check runs, when not the default
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

type renderReq struct {
	key, jsonPath string
	views         bool // the extra camera angles instead of the main cover (job key: <key>-views)
	model         bool // the corvette as a 3D model, <key>.glb, for the Traveller page to turn (job key: <key>-3d)
	// one angle the owner turned the 3D model to on the Traveller page (owner 2026-11-12: find the pose, then
	// render it with textures): <key>-<angle>.png, job <key>-<angle>
	angle      string
	azim, elev float64
}

// a turned angle's name: a<turn>_<tilt> in whole degrees
var angleRe = regexp.MustCompile(`^a-?\d{1,3}_-?\d{1,2}$`)

// what a request makes: its job name and whether it's there already
func jobName(key string, views, model bool, angle string) string {
	if angle != "" {
		return key + "-" + angle
	}
	if model {
		return key + "-3d"
	}
	if views {
		return key + "-views"
	}
	return key
}

func modelPath(key string) string { return filepath.Join(coversDir(), key+".glb") }

func outputDone(key string, views, model bool, angle string) bool {
	if angle != "" {
		return fileExists(filepath.Join(coversDir(), key+"-"+angle+".png"))
	}
	if model {
		return fileExists(modelPath(key))
	}
	if views {
		return viewsDone(key)
	}
	return fileExists(filepath.Join(coversDir(), key+".png"))
}

// the extra camera angles, rendered together in one Blender run after the main cover: name, azimuth, elevation
var coverViews = []struct {
	Name       string
	Azim, Elev float64
}{{"front", 0, 8}, {"side", 90, 6}, {"back", 180, 14}, {"top", 0, 80}}

func viewSpec() string {
	parts := make([]string, len(coverViews))
	for i, v := range coverViews {
		parts[i] = fmt.Sprintf("%s:%g:%g", v.Name, v.Azim, v.Elev)
	}
	return strings.Join(parts, ",")
}

func viewsDone(key string) bool {
	for _, v := range coverViews {
		if !fileExists(filepath.Join(coversDir(), key+"-"+v.Name+".png")) {
			return false
		}
	}
	return true
}

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
	job := jobName(req.key, req.views, req.model, req.angle)
	setJob(job, "running", "")
	script := filepath.Join(appDir, "render_cover.py")
	if err := os.WriteFile(script, renderScript, 0o644); err != nil {
		setJob(job, "error", err.Error())
		return
	}
	renderMu.Lock()
	size, samples := settings.Size, settings.Samples
	renderMu.Unlock()
	if req.angle != "" {   // a picture for the card, often shown large: twice the cover size
		size = min(size*2, 2048)
	}
	out := filepath.Join(coversDir(), req.key+".png")
	if req.model {
		out = modelPath(req.key)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	args := []string{"-b", "--factory-startup", "--python", script, "--", charon, req.jsonPath, out, fmt.Sprint(size), fmt.Sprint(samples)}
	if req.views {
		args = append(args, "-35", "22", viewSpec())
	} else if req.angle != "" {   // one view, named after the angle: render_cover writes <out>-<angle>.png
		args = append(args, "-35", "22", fmt.Sprintf("%s:%g:%g", req.angle, req.azim, req.elev))
	}
	cmd := exec.CommandContext(ctx, blender, args...)
	hideWindow(cmd)
	logPath := filepath.Join(coversDir(), job+".log")
	lf, _ := os.Create(logPath)
	if lf != nil {
		cmd.Stdout, cmd.Stderr = lf, lf
	}
	start := time.Now()
	err := cmd.Run()
	if lf != nil {
		lf.Close()
	}
	made := outputDone(req.key, req.views, req.model, req.angle)
	if err != nil || !made {
		msg := "Blender stopped before the cover was made"
		if req.model {
			msg = "Blender stopped before the 3D model was made"
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			msg = "The render took longer than 10 minutes and was stopped"
		}
		setJob(job, "error", msg+". Details are in "+logPath)
		log.Printf("render %s failed: %v", req.key, err)
		return
	}
	os.Remove(logPath)
	log.Printf("rendered %s in %s", job, time.Since(start).Round(time.Second))
	setJob(job, "done", "")
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
		if in.AutoRender != nil {
			settings.AutoRender = in.AutoRender
		}
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
		"autoRender": s.AutoRender == nil || *s.AutoRender,
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
	views := r.URL.Query().Get("views") == "1"
	model := r.URL.Query().Get("model") == "1"
	angle := r.URL.Query().Get("angle")
	var azim, elev float64
	if !keyRe.MatchString(key) || (angle != "" && !angleRe.MatchString(angle)) {
		http.Error(w, "bad key", http.StatusBadRequest)
		return
	}
	if angle != "" {
		fmt.Sscanf(r.URL.Query().Get("azim"), "%g", &azim)
		fmt.Sscanf(r.URL.Query().Get("elev"), "%g", &elev)
	}
	job := jobName(key, views, model, angle)
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
	if err != nil || !json.Valid(body) {
		http.Error(w, "the build isn't valid JSON", http.StatusBadRequest)
		return
	}
	if !force && outputDone(key, views, model, angle) {
		setJob(job, "done", "")
		writeJSON(w, map[string]string{"state": "done"})
		return
	}
	renderMu.Lock()
	if j, ok := jobs[job]; ok && (j.State == "queued" || j.State == "running") {
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
	setJob(job, "queued", "")
	select {
	case queue <- renderReq{key: key, jsonPath: f.Name(), views: views, model: model, angle: angle, azim: azim, elev: elev}:
	default:
		os.Remove(f.Name())
		setJob(job, "error", "Too many renders waiting; try again in a moment")
	}
	renderMu.Lock()
	j := jobs[job]
	renderMu.Unlock()
	writeJSON(w, j)
}

func handleRenderStatus(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if !keyRe.MatchString(key) {
		http.Error(w, "bad key", http.StatusBadRequest)
		return
	}
	views := r.URL.Query().Get("views") == "1"
	model := r.URL.Query().Get("model") == "1"
	angle := r.URL.Query().Get("angle")
	if angle != "" && !angleRe.MatchString(angle) {
		http.Error(w, "bad angle", http.StatusBadRequest)
		return
	}
	job := jobName(key, views, model, angle)
	renderMu.Lock()
	j, ok := jobs[job]
	renderMu.Unlock()
	if !ok {
		if outputDone(key, views, model, angle) {
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
	if r.URL.Query().Get("model") == "1" {   // the corvette in 3D (GET /api/cover?key=…&model=1)
		if !fileExists(modelPath(key)) {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
		w.Header().Set("Content-Type", "model/gltf-binary")
		http.ServeFile(w, r, modelPath(key))
		return
	}
	if v := r.URL.Query().Get("view"); v != "" && v != "hero" {
		ok := angleRe.MatchString(v)
		for _, cv := range coverViews {
			ok = ok || cv.Name == v
		}
		if !ok {
			http.Error(w, "bad view", http.StatusBadRequest)
			return
		}
		p = filepath.Join(coversDir(), key+"-"+v+".png")
	}
	if !fileExists(p) {
		http.NotFound(w, r)
		return
	}
	// covers are named by a hash of the build, so a found image never changes and can be cached for good
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("Content-Type", "image/png")
	http.ServeFile(w, r, p)
}

// POST /api/cover/alias?from=<old key>&to=<new key>: renders were once named after the whole build (part timestamps
// included); they're now named after its shape. The page asks for an old render to be copied to the new name, with
// its extra angles, so nothing has to be rendered again.
func handleCoverAlias(w http.ResponseWriter, r *http.Request) {
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if r.Method != http.MethodPost || !keyRe.MatchString(from) || !keyRe.MatchString(to) {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	n := 0
	names, _ := filepath.Glob(filepath.Join(coversDir(), from+"*.png"))
	names = append(names, filepath.Join(coversDir(), from+".glb"))   // the 3D model too
	for _, src := range names {
		rest := strings.TrimPrefix(filepath.Base(src), from)
		if rest != ".png" && rest != ".glb" && !strings.HasPrefix(rest, "-") {
			continue
		}
		dst := filepath.Join(coversDir(), to+rest)
		if fileExists(dst) {
			continue
		}
		if b, err := os.ReadFile(src); err == nil && atomicWrite(dst, b) == nil {
			n++
		}
	}
	writeJSON(w, map[string]int{"copied": n})
}
