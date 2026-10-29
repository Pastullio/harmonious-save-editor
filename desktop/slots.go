package main

// Save slots: copy a save into an empty slot, and back up a whole account folder as one zip.

import (
	"archive/zip"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// handleCreate writes a save pair into a slot that is empty. It never replaces anything: if either
// file already exists the request is refused.
func handleCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseMultipartForm(256 << 20); err != nil {
		http.Error(w, "bad upload: "+err.Error(), http.StatusBadRequest)
		return
	}
	dir, err := cleanDir(r.FormValue("dir"))
	dataName, metaName := r.FormValue("dataName"), r.FormValue("metaName")
	if err != nil || !dataRe.MatchString(dataName) || !strings.EqualFold(metaName, "mf_"+dataName) ||
		filepath.Base(dataName) != dataName || filepath.Base(metaName) != metaName {
		http.Error(w, "not a save pair", http.StatusBadRequest)
		return
	}
	data, err1 := formFile(r, "data")
	meta, err2 := formFile(r, "meta")
	if err1 != nil || err2 != nil || len(data) < 16 || len(meta) < 104 {
		http.Error(w, "missing or empty file in upload", http.StatusBadRequest)
		return
	}
	dataPath, metaPath := filepath.Join(dir, dataName), filepath.Join(dir, metaName)
	for _, p := range []string{dataPath, metaPath} {
		if fileExists(p) {
			http.Error(w, filepath.Base(p)+" already exists, so nothing was written", http.StatusConflict)
			return
		}
	}
	if err := atomicWrite(metaPath, meta); err != nil {
		http.Error(w, "could not write "+metaName+": "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := atomicWrite(dataPath, data); err != nil {
		os.Remove(metaPath)
		http.Error(w, "could not write "+dataName+": "+err.Error(), http.StatusInternalServerError)
		return
	}
	log.Printf("created %s and %s", dataPath, metaPath)
	writeJSON(w, map[string]string{"ok": "1"})
}

// fullBackupDir is where whole-folder backups go: Documents\Harmonious Save Editor backups, so they
// are easy to find (and get picked up by OneDrive if the owner uses it). Falls back to the app folder.
func fullBackupDir() string {
	home, _ := os.UserHomeDir()
	for _, d := range []string{"OneDrive/Documents", "Documents"} {
		p := filepath.Join(home, filepath.FromSlash(d))
		if home != "" && fileExists(p) {
			return filepath.Join(p, "Harmonious Save Editor backups")
		}
	}
	return filepath.Join(appDir, "full-backups")
}

// handleBackupAll zips every file in an account folder (all slots, meta files, accountdata).
func handleBackupAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	dir, err := cleanDir(r.URL.Query().Get("dir"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	out := fullBackupDir()
	if err := os.MkdirAll(out, 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	zipPath := filepath.Join(out, filepath.Base(dir)+"_"+time.Now().Format("2006-01-02_150405")+".zip")
	f, err := os.Create(zipPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	zw := zip.NewWriter(f)
	n := 0
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".hg") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		hdr, _ := zip.FileInfoHeader(info)
		hdr.Name = filepath.Base(dir) + "/" + e.Name()
		hdr.Method = zip.Deflate
		dst, err := zw.CreateHeader(hdr)
		if err == nil {
			var src *os.File
			if src, err = os.Open(filepath.Join(dir, e.Name())); err == nil {
				_, err = io.Copy(dst, src)
				src.Close()
			}
		}
		if err != nil {
			zw.Close()
			f.Close()
			os.Remove(zipPath)
			http.Error(w, "backup failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		n++
	}
	if err := zw.Close(); err == nil {
		err = f.Close()
	} else {
		f.Close()
	}
	if n == 0 {
		os.Remove(zipPath)
		http.Error(w, "no save files in that folder", http.StatusNotFound)
		return
	}
	log.Printf("backed up %d files from %s to %s", n, dir, zipPath)
	if r.URL.Query().Get("reveal") == "1" {
		_ = reveal(out)
	}
	writeJSON(w, map[string]any{"path": zipPath, "files": n})
}
