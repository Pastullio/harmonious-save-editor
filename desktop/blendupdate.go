package main

// Keeping a corvette's .blend and the save in step (owner 2026-11-23): a change made in the game is in the save but
// not in the .blend, so opening the .blend from LiveLink and saving it put the older build back. Before the page
// opens a corvette's .blend it compares the build in the save with the build in the file, and when they differ it
// asks: open the file as it is, or update it with the save's build.
//
//   - /api/live/sent: what each .blend held the last time the page saw it (a build the add-on sent after a save, or
//     a read of the file), with the file's size and time. While the file hasn't changed since, the page compares
//     against that at once; otherwise it reads the file through Blender (/api/blend/read).
//   - /api/live/update: copies the .blend to "Blender backups" (next to Exports), then starts the owner's Blender
//     with the file and blend_update.py, which changes only what differs and leaves the file unsaved to look over.

import (
	"crypto/sha1"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed blend_update.py
var blendUpdateScript []byte

const blendBackupsKept = 5 // per .blend

var sentMu sync.Mutex

type sentBuild struct {
	File  string          `json:"file"`
	Size  int64           `json:"size"`
	Mtime int64           `json:"mtime"` // unix ns
	Time  int64           `json:"time"`  // unix ms, when it was noted
	Parts json.RawMessage `json:"parts"`
}

func sentPath(file string) string {
	sum := sha1.Sum([]byte(strings.ToLower(filepath.Clean(file))))
	return filepath.Join(appDir, "live-sent", hex.EncodeToString(sum[:])+".json")
}

// basePath: where the build Blender last put on one corvette of one save is kept (owner 2026-11-24: decals added in
// the game were lost when Blender, open all along with the older build, sent it again). `who` names the save and the
// corvette; the note is what the save's corvette is compared with when the next build arrives: if the save has moved
// on from it, the game (or the editor) changed the corvette and Blender doesn't have that.
func basePath(file, who string) string {
	sum := sha1.Sum([]byte(strings.ToLower(filepath.Clean(file)) + "\n" + who))
	return filepath.Join(appDir, "live-sent", "base-"+hex.EncodeToString(sum[:])+".json")
}

func blendBackupsDir() string {
	return filepath.Join(filepath.Dir(exportsDir()), "Blender backups")
}

// GET ?file=: {found, fresh, time, parts}; fresh means the .blend hasn't changed since the parts were noted.
// POST {file, parts}: note what the file holds now.
func handleLiveSent(w http.ResponseWriter, r *http.Request) {
	sentMu.Lock()
	defer sentMu.Unlock()
	if r.Method == http.MethodPost {
		var v struct {
			File  string          `json:"file"`
			Parts json.RawMessage `json:"parts"`
			For   string          `json:"for"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 64<<20)).Decode(&v); err != nil || v.File == "" || len(v.Parts) == 0 {
			http.Error(w, "a file and its parts are needed", http.StatusBadRequest)
			return
		}
		if v.For != "" { // the build last put on that corvette from this file, whatever the file holds now
			b, _ := json.Marshal(sentBuild{File: v.File, Time: time.Now().UnixMilli(), Parts: v.Parts})
			p := basePath(v.File, v.For)
			_ = os.MkdirAll(filepath.Dir(p), 0o755)
			if err := os.WriteFile(p, b, 0o644); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			writeJSON(w, map[string]bool{"ok": true})
			return
		}
		st, err := os.Stat(v.File)
		if err != nil {
			http.Error(w, "That Blender file isn't there: "+v.File, http.StatusNotFound)
			return
		}
		b, _ := json.Marshal(sentBuild{File: v.File, Size: st.Size(), Mtime: st.ModTime().UnixNano(), Time: time.Now().UnixMilli(), Parts: v.Parts})
		p := sentPath(v.File)
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, b, 0o644); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
		return
	}
	file := r.URL.Query().Get("file")
	var s sentBuild
	if who := r.URL.Query().Get("for"); who != "" {
		b, err := os.ReadFile(basePath(file, who))
		if err != nil || json.Unmarshal(b, &s) != nil || len(s.Parts) == 0 {
			writeJSON(w, map[string]any{"found": false})
			return
		}
		writeJSON(w, map[string]any{"found": true, "time": s.Time, "parts": s.Parts})
		return
	}
	b, err := os.ReadFile(sentPath(file))
	if err != nil || json.Unmarshal(b, &s) != nil || len(s.Parts) == 0 {
		writeJSON(w, map[string]any{"found": false, "fresh": false})
		return
	}
	st, err := os.Stat(file)
	fresh := err == nil && st.Size() == s.Size && st.ModTime().UnixNano() == s.Mtime
	writeJSON(w, map[string]any{"found": true, "fresh": fresh, "time": s.Time, "parts": s.Parts})
}

// backupBlend copies the .blend into "Blender backups" as "<name> <date time>.blend" and keeps the newest few of that name.
func backupBlend(file string) (string, error) {
	dir := blendBackupsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	stem := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
	dst := filepath.Join(dir, stem+" "+time.Now().Format("2006-01-02 150405")+".blend")
	if err := copyFile(file, dst); err != nil {
		os.Remove(dst)
		return "", err
	}
	old, _ := filepath.Glob(filepath.Join(dir, stem+" ????-??-?? ??????.blend"))
	sort.Strings(old) // the date in the name sorts oldest first
	for len(old) > blendBackupsKept {
		os.Remove(old[0])
		old = old[1:]
	}
	return dst, nil
}

// POST {file, objects}: back the .blend up, then open it in Blender with the save's build put in (not saved)
func handleLiveUpdate(w http.ResponseWriter, r *http.Request) {
	var v struct {
		File    string          `json:"file"`
		Objects json.RawMessage `json:"objects"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 128<<20)).Decode(&v); err != nil || v.File == "" {
		http.Error(w, "a .blend file and the build are needed", http.StatusBadRequest)
		return
	}
	var parts []json.RawMessage
	if json.Unmarshal(v.Objects, &parts) != nil || len(parts) == 0 {
		http.Error(w, "The build has no parts, so the Blender file was left alone.", http.StatusBadRequest)
		return
	}
	if !strings.EqualFold(filepath.Ext(v.File), ".blend") || !fileExists(v.File) {
		http.Error(w, "That Blender file isn't there any more: "+v.File, http.StatusNotFound)
		return
	}
	blender, _ := resolveTools()
	if blender == "" {
		http.Error(w, "Blender wasn't found. Set where it is in Cover settings.", http.StatusNotFound)
		return
	}
	backup, err := backupBlend(v.File)
	if err != nil {
		http.Error(w, "Couldn't make a backup of the Blender file, so it was left alone: "+err.Error(), http.StatusInternalServerError)
		return
	}
	// the script and the build stay in a temp folder while Blender runs; yesterday's are cleared here
	if old, _ := filepath.Glob(filepath.Join(os.TempDir(), "hse-update*")); len(old) > 0 {
		for _, d := range old {
			if st, err := os.Stat(d); err == nil && time.Since(st.ModTime()) > 24*time.Hour {
				os.RemoveAll(d)
			}
		}
	}
	dir, err := os.MkdirTemp("", "hse-update")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	script, build, whole := filepath.Join(dir, "blend_update.py"), filepath.Join(dir, "build.json"), filepath.Join(dir, "build from save.json")
	doc, _ := json.Marshal(map[string]any{"objects": v.Objects, "backup": backup, "build_file": whole})
	wholeDoc, _ := json.Marshal(map[string]any{"Objects": v.Objects}) // for Charon Forge's own import, when the scene has groups
	for p, b := range map[string][]byte{script: blendUpdateScript, build: doc, whole: wholeDoc} {
		if err := os.WriteFile(p, b, 0o644); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	cmd := exec.Command(blender, v.File, "--python", script, "--", build, filepath.Join(dir, "report.json"))
	cmd.Dir = filepath.Dir(v.File)
	if err := cmd.Start(); err != nil {
		http.Error(w, "Couldn't start Blender: "+err.Error(), http.StatusInternalServerError)
		return
	}
	go cmd.Wait()
	writeJSON(w, map[string]any{"ok": true, "backup": backup, "parts": len(parts)})
}
