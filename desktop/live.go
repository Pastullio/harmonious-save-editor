package main

// Live link from Blender: the "Harmonious Live Link" add-on (desktop/addon) sends a corvette build here every time
// you save in Blender. The editor page, with Live link turned on for one corvette in Shipwright, picks it up, puts it
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
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

//go:embed addon/harmonious_live_link.py
var liveAddon []byte

var (
	liveToken string
	live      = struct {
		sync.Mutex
		armed   bool
		target  string
		seen    time.Time        // the page's last poll; a closed page stops being "armed"
		next    chan liveBuild   // builds waiting for the page
		waiting map[int]chan liveResult
		id      int
	}{next: make(chan liveBuild, 1), waiting: map[int]chan liveResult{}}
)

type liveBuild struct {
	ID   int             `json:"id"`
	Body json.RawMessage `json:"body"`
}

type liveResult struct {
	ID      int    `json:"id"`
	OK      bool   `json:"ok"`
	Message string `json:"message"`
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
		Armed  bool   `json:"armed"`
		Target string `json:"target"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&v); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	live.Lock()
	live.armed, live.target, live.seen = v.Armed, v.Target, time.Now()
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
	if r.Method == http.MethodGet { // the add-on's "is the editor there?" check
		armed, target := liveArmed()
		writeJSON(w, map[string]any{"ok": true, "armed": armed, "target": target, "version": appVersion})
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
		writeJSON(w, liveResult{Message: "Live link is off in the editor. Open a save, go to Shipwright and turn on Live link for the corvette to update."})
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
