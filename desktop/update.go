package main

// Updates: the page asks /api/update whether a newer build is published, and /api/update/install
// downloads it, checks its size and SHA-256 against version.json, swaps it in for the running exe
// (Windows lets a running exe be renamed, not overwritten) and starts it. The old exe is left as
// "<name>.old" and removed on the next start.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// set at build time: -ldflags "-X main.appVersion=2026.10.30.1215"
var appVersion = "dev"

// where the published version.json lives; HSE_UPDATE_URL overrides it (tests, or another host)
const defaultUpdateURL = "https://raw.githubusercontent.com/Pastullio/harmonious-save-editor/main/dist/version.json"

type releaseInfo struct {
	Version string `json:"version"`
	URL     string `json:"url"`
	Size    int64  `json:"size"`
	SHA256  string `json:"sha256"`
	Notes   string `json:"notes"`
	Date    string `json:"date"`
}

func updateURL() string {
	if u := os.Getenv("HSE_UPDATE_URL"); u != "" {
		return u
	}
	return defaultUpdateURL
}

func latestRelease() (*releaseInfo, error) {
	c := &http.Client{Timeout: 10 * time.Second}
	res, err := c.Get(updateURL())
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("the update address answered %s", res.Status)
	}
	var r releaseInfo
	if err := json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&r); err != nil {
		return nil, err
	}
	if r.Version == "" || r.URL == "" {
		return nil, errors.New("version.json is missing its version or download address")
	}
	return &r, nil
}

// versions are dates with dots (2026.10.30.1215): compare them number by number
func newerVersion(a, b string) bool {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			fmt.Sscan(pa[i], &x)
		}
		if i < len(pb) {
			fmt.Sscan(pb[i], &y)
		}
		if x != y {
			return x > y
		}
	}
	return false
}

func handleUpdate(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"current": appVersion}
	if appVersion == "dev" && os.Getenv("HSE_UPDATE_URL") == "" {
		out["dev"] = true
		writeJSON(w, out)
		return
	}
	rel, err := latestRelease()
	if err != nil {
		out["error"] = err.Error()
		writeJSON(w, out)
		return
	}
	out["latest"] = rel.Version
	out["notes"] = rel.Notes
	out["date"] = rel.Date
	out["newer"] = newerVersion(rel.Version, appVersion)
	writeJSON(w, out)
}

func handleUpdateInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	rel, err := latestRelease()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	exe, err := os.Executable()
	if err == nil {
		exe, err = filepath.EvalSymlinks(exe)
	}
	if err != nil {
		http.Error(w, "could not find the running program: "+err.Error(), http.StatusInternalServerError)
		return
	}
	newPath, oldPath := exe+".new", exe+".old"
	if err := download(rel, newPath); err != nil {
		os.Remove(newPath)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	os.Remove(oldPath)
	if err := os.Rename(exe, oldPath); err != nil {
		os.Remove(newPath)
		http.Error(w, "could not move the old version aside: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := os.Rename(newPath, exe); err != nil {
		os.Rename(oldPath, exe) // put the old one back
		http.Error(w, "could not put the new version in place: "+err.Error(), http.StatusInternalServerError)
		return
	}
	log.Printf("updated %s -> %s", appVersion, rel.Version)
	writeJSON(w, map[string]string{"version": rel.Version})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	// let the answer reach the page, free the port, then start the new version and leave
	go func() {
		time.Sleep(700 * time.Millisecond)
		if srvRef != nil {
			srvRef.Close()
		}
		cmd := exec.Command(exe, os.Args[1:]...)
		if err := cmd.Start(); err != nil {
			log.Printf("could not start the new version: %v", err)
		}
		os.Exit(0)
	}()
}

func download(rel *releaseInfo, dest string) error {
	c := &http.Client{Timeout: 5 * time.Minute}
	res, err := c.Get(rel.URL)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("the download answered %s", res.Status)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(res.Body, 512<<20))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	if rel.Size > 0 && n != rel.Size {
		return fmt.Errorf("the download was %d bytes, expected %d", n, rel.Size)
	}
	if rel.SHA256 != "" && !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), rel.SHA256) {
		return errors.New("the download doesn't match its checksum, so it wasn't installed")
	}
	if n < 1<<20 {
		return errors.New("the download is too small to be the editor")
	}
	return os.Chmod(dest, 0o755)
}

// removes the previous version left behind by an update
func cleanOldVersion() {
	if exe, err := os.Executable(); err == nil {
		os.Remove(exe + ".old")
	}
}
