package main

// LiveLink from Blender: the "Harmonious LiveLink" add-on (desktop/addon) sends a corvette build here every time
// you save in Blender. The editor page, with LiveLink turned on for one corvette in Shipwright, picks it up, puts it
// on that corvette and writes the save (backed up first, like every write). The add-on waits for the page's answer
// so Blender can say what happened.
//
// The add-on finds the editor through live.json in the app folder (port and a token made for each run), so other
// programs and web pages can't send builds: /api/live/build needs that token, everything else needs the page's.

import (
	"crypto/subtle"
	_ "embed"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed addon/harmonious_live_link.py
var liveAddon []byte

var (
	liveToken string
	live      = struct {
		sync.Mutex
		armed     bool
		target    string
		kind      string          // "corvette" or "base"
		base      json.RawMessage // {name, address} of the base LiveLink is on for
		slot      int
		corvettes json.RawMessage // [{slot, name}] in the open save, for the add-on's corvette list
		seen      time.Time       // the page's last poll; a closed page stops being "armed"
		blender   time.Time       // the add-on's last check-in
		file      string          // the .blend it's working on
		next      chan liveBuild  // builds waiting for the page
		waiting   map[int]chan liveResult
		id        int
	}{next: make(chan liveBuild, 1), waiting: map[int]chan liveResult{}}
)

type liveBuild struct {
	ID   int             `json:"id"`
	Body json.RawMessage `json:"body"`
}

type liveResult struct {
	ID      int             `json:"id"`
	OK      bool            `json:"ok"`
	Message string          `json:"message"`
	Target  json.RawMessage `json:"target,omitempty"` // {slot, name}: the corvette this .blend goes to, for the add-on to keep
}

// writes live.json so the Blender add-on can find this run of the editor
func startLive(port string) {
	liveToken = randHex(24)
	p, _ := strconv.Atoi(port)
	b, _ := json.MarshalIndent(map[string]any{"port": p, "token": liveToken, "pid": os.Getpid()}, "", "  ")
	if err := os.WriteFile(filepath.Join(appDir, "live.json"), b, 0o600); err != nil {
		log.Printf("live link: could not write live.json: %v", err)
	}
}

func liveArmed() (bool, string) {
	live.Lock()
	defer live.Unlock()
	return live.armed && time.Since(live.seen) < 45*time.Second, live.target
}

// POST from the page: {armed, target}
func handleLiveArm(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Armed     bool            `json:"armed"`
		Target    string          `json:"target"`
		Kind      string          `json:"kind"`
		Base      json.RawMessage `json:"base"`
		Slot      int             `json:"slot"`
		Corvettes json.RawMessage `json:"corvettes"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&v); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	live.Lock()
	live.armed, live.target, live.slot, live.seen = v.Armed, v.Target, v.Slot, time.Now()
	live.kind, live.base = v.Kind, v.Base
	if live.kind == "" {
		live.kind = "corvette"
	}
	if len(v.Corvettes) > 0 {
		live.corvettes = v.Corvettes
	}
	live.Unlock()
	writeJSON(w, map[string]bool{"ok": true})
}

// GET from the page: waits up to 25 s for a build
func handleLiveNext(w http.ResponseWriter, r *http.Request) {
	live.Lock()
	live.seen = time.Now()
	live.Unlock()
	select {
	case b := <-live.next:
		writeJSON(w, b)
	case <-time.After(25 * time.Second):
		w.WriteHeader(http.StatusNoContent)
	case <-r.Context().Done():
	}
}

// GET from the page: is Blender's add-on checking in?
func handleLiveStatus(w http.ResponseWriter, r *http.Request) {
	live.Lock()
	defer live.Unlock()
	writeJSON(w, map[string]any{"blender": !live.blender.IsZero() && time.Since(live.blender) < 12*time.Second, "file": live.file})
}

// POST from the page: what happened to a build
func handleLiveResult(w http.ResponseWriter, r *http.Request) {
	var v liveResult
	if err := json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&v); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	live.Lock()
	ch := live.waiting[v.ID]
	live.Unlock()
	if ch != nil {
		select {
		case ch <- v:
		default:
		}
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// POST from Blender (X-Live-Token): {objects: [...], name, file}. Answers with the page's result.
func handleLiveBuild(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet { // the add-on's "is the editor there?" check, every few seconds while Blender runs
		live.Lock()
		live.blender, live.file = time.Now(), r.URL.Query().Get("file")
		live.Unlock()
		armed, target := liveArmed()
		live.Lock()
		slot, corvettes, kind, base := live.slot, live.corvettes, live.kind, live.base
		live.Unlock()
		if corvettes == nil {
			corvettes = json.RawMessage("[]")
		}
		if base == nil {
			base = json.RawMessage("null")
		}
		writeJSON(w, map[string]any{"ok": true, "armed": armed, "target": target, "slot": slot, "corvettes": corvettes, "kind": kind, "base": base, "version": appVersion})
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 128<<20))
	if err != nil || !json.Valid(body) {
		writeJSON(w, liveResult{Message: "The build didn't arrive as valid JSON."})
		return
	}
	armed, _ := liveArmed()
	if !armed {
		writeJSON(w, liveResult{Message: "LiveLink is off in the editor. Open a save and turn on LiveLink for the corvette (in Shipwright) or the base (on the Bases page) to update."})
		return
	}
	live.Lock()
	live.id++
	id := live.id
	ch := make(chan liveResult, 1)
	live.waiting[id] = ch
	live.Unlock()
	defer func() { live.Lock(); delete(live.waiting, id); live.Unlock() }()
	// a newer build replaces one the page hasn't picked up yet
	select {
	case <-live.next:
	default:
	}
	live.next <- liveBuild{ID: id, Body: body}
	select {
	case res := <-ch:
		writeJSON(w, res)
	case <-time.After(90 * time.Second):
		writeJSON(w, liveResult{ID: id, Message: "The editor didn't answer. Is its window still open?"})
	}
}

// the Blender add-on, to save and install in Blender
func handleLiveAddon(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/x-python; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="harmonious_live_link.py"`)
	w.Write(liveAddon)
}

func liveTokenOK(r *http.Request) bool {
	return liveToken != "" && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Live-Token")), []byte(liveToken)) == 1
}

// ---- which .blend each corvette's build comes from, and opening it in Blender
// live-files.json: page key (account folder|slot|corvette name) -> the .blend it was last sent from or linked to

type liveFile struct {
	File string `json:"file"`
	Time int64  `json:"time"` // unix ms
}

var liveFilesMu sync.Mutex

func liveFilesPath() string { return filepath.Join(appDir, "live-files.json") }

func readLiveFiles() map[string]liveFile {
	m := map[string]liveFile{}
	if b, err := os.ReadFile(liveFilesPath()); err == nil {
		_ = json.Unmarshal(b, &m)
	}
	return m
}

// GET: the whole map; POST {key, file}: remember a file ("" forgets it)
func handleLiveFiles(w http.ResponseWriter, r *http.Request) {
	liveFilesMu.Lock()
	defer liveFilesMu.Unlock()
	m := readLiveFiles()
	if r.Method == http.MethodPost {
		var v struct{ Key, File string }
		if err := json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&v); err != nil || v.Key == "" {
			http.Error(w, "a key is needed", http.StatusBadRequest)
			return
		}
		if v.File == "" {
			delete(m, v.Key)
		} else {
			m[v.Key] = liveFile{File: v.File, Time: time.Now().UnixMilli()}
		}
		b, _ := json.MarshalIndent(m, "", "  ")
		if err := os.WriteFile(liveFilesPath(), b, 0o644); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	writeJSON(w, m)
}

// POST: the Windows file dialog for a .blend; {file} or {file: ""} when cancelled
func handleLivePick(w http.ResponseWriter, r *http.Request) {
	start := r.URL.Query().Get("dir")
	f, err := pickFile("Choose the Blender file", "Blender files (*.blend)|*.blend", start)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotImplemented)
		return
	}
	writeJSON(w, map[string]string{"file": f})
}

// POST {file}: opens Blender, with that .blend when given
func handleLiveOpen(w http.ResponseWriter, r *http.Request) {
	var v struct{ File string }
	_ = json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&v)
	if v.File != "" && (!strings.EqualFold(filepath.Ext(v.File), ".blend") || !fileExists(v.File)) {
		http.Error(w, "That Blender file isn't there any more: "+v.File, http.StatusNotFound)
		return
	}
	blender, _ := resolveTools()
	if blender == "" {
		http.Error(w, "Blender wasn't found. Set where it is in Cover settings.", http.StatusNotFound)
		return
	}
	args := []string{}
	if v.File != "" {
		args = append(args, v.File)
	}
	cmd := exec.Command(blender, args...)
	if v.File != "" {
		cmd.Dir = filepath.Dir(v.File)
	}
	if err := cmd.Start(); err != nil {
		http.Error(w, "Couldn't start Blender: "+err.Error(), http.StatusInternalServerError)
		return
	}
	go cmd.Wait() // don't leave a zombie behind on Linux; Blender keeps running after the editor closes
	writeJSON(w, map[string]bool{"ok": true})
}

// the link ends with the editor: live.json goes, so the add-on shows the editor isn't running
func liveShutdown() { os.Remove(filepath.Join(appDir, "live.json")) }
