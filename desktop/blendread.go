package main

// Reading a build out of a .blend: the page asks for a base's (or corvette's) parts from a Blender file, and the app
// runs the owner's own Blender in the background with blend_read.py, which reads the parts the same way the LiveLink
// add-on does. Used by the Bases page's "Load from a .blend".

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed blend_read.py
var blendReadScript []byte

var blendReadMu sync.Mutex // one Blender at a time

// POST {file}: {ok, objects, base: {name, address} | null, file} or {ok: false, error}
func handleBlendRead(w http.ResponseWriter, r *http.Request) {
	var v struct{ File string }
	if err := json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&v); err != nil || v.File == "" {
		http.Error(w, "a .blend file is needed", http.StatusBadRequest)
		return
	}
	ext := strings.ToLower(filepath.Ext(v.File))
	if (ext != ".blend" && ext != ".blend1") || !fileExists(v.File) {
		http.Error(w, "That isn't a Blender file the editor can find: "+v.File, http.StatusNotFound)
		return
	}
	startRenderWorker() // loads the settings that say where Blender is
	blender, charon := resolveTools()
	if blender == "" {
		http.Error(w, "Blender wasn't found. Set where it is in Cover settings.", http.StatusNotFound)
		return
	}
	res, err := readBlend(blender, charon, v.File)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	res["file"] = v.File
	writeJSON(w, res)
}

func readBlend(blender, charon, file string) (map[string]any, error) {
	blendReadMu.Lock()
	defer blendReadMu.Unlock()
	dir, err := os.MkdirTemp("", "hse-blend")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	script, out := filepath.Join(dir, "blend_read.py"), filepath.Join(dir, "out.json")
	if err := os.WriteFile(script, blendReadScript, 0o644); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, "harmonious_live_link.py"), liveAddon, 0o644); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	args := []string{"-b", "--factory-startup", "--python", script, "--", file, out, dir}
	if charon != "" {
		args = append(args, charon)
	}
	cmd := exec.CommandContext(ctx, blender, args...)
	hideWindow(cmd)
	logb, runErr := cmd.CombinedOutput()
	b, err := os.ReadFile(out)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, errors.New("Blender took longer than 4 minutes to read the file")
		}
		msg := strings.TrimSpace(string(logb))
		if len(msg) > 400 {
			msg = msg[len(msg)-400:]
		}
		return nil, errors.New("Blender couldn't read the file (" + errString(runErr) + "): " + msg)
	}
	var res map[string]any
	if err := json.Unmarshal(b, &res); err != nil {
		return nil, err
	}
	if ok, _ := res["ok"].(bool); !ok {
		e, _ := res["error"].(string)
		return nil, errors.New("Blender couldn't read the file: " + e)
	}
	return res, nil
}

func errString(err error) string {
	if err == nil {
		return "no error"
	}
	return err.Error()
}
