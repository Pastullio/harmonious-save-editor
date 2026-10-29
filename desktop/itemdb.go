package main

// Item names and icons, read straight from the owner's own copy of Goatfungus's NMSSaveEditor.jar
// (its item database and icon pictures). Nothing is copied or bundled: the app finds the jar on the
// PC, remembers where it is, and serves items.xml and single icons from inside it on request.

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const jarName = "nmssaveeditor.jar"
const jarItems = "nomanssave/db/items.xml"
const jarIcons = "nomanssave/icons/"

var iconNameRe = regexp.MustCompile(`(?i)^[a-z0-9_\-.]+\.png$`)

var (
	dbMu    sync.Mutex
	dbPath  string
	dbZip   *zip.ReadCloser
	dbIcons map[string]*zip.File // upper-case name -> entry
	dbXML   []byte
)

// openJar opens a jar and checks it holds the item database.
func openJar(p string) error {
	z, err := zip.OpenReader(p)
	if err != nil {
		return err
	}
	icons := map[string]*zip.File{}
	var items *zip.File
	for _, f := range z.File {
		if f.Name == jarItems {
			items = f
		} else if strings.HasPrefix(f.Name, jarIcons) {
			icons[strings.ToUpper(strings.TrimPrefix(f.Name, jarIcons))] = f
		}
	}
	if items == nil {
		z.Close()
		return errors.New("that file has no item database inside (is it NMSSaveEditor.jar?)")
	}
	rc, err := items.Open()
	if err != nil {
		z.Close()
		return err
	}
	xml, err := io.ReadAll(io.LimitReader(rc, 64<<20))
	rc.Close()
	if err != nil {
		z.Close()
		return err
	}
	if dbZip != nil {
		dbZip.Close()
	}
	dbZip, dbIcons, dbXML, dbPath = z, icons, xml, p
	return nil
}

// jarSearchRoots lists where people usually keep the editor, most likely first.
func jarSearchRoots() []string {
	home, _ := os.UserHomeDir()
	var roots []string
	if home != "" {
		for _, d := range []string{"Desktop", "Downloads", "Documents", "OneDrive/Desktop", "OneDrive/Documents", "OneDrive/Downloads", ""} {
			roots = append(roots, filepath.Join(home, filepath.FromSlash(d)))
		}
	}
	for _, env := range []string{"ProgramFiles", "ProgramFiles(x86)"} {
		if v := os.Getenv(env); v != "" {
			roots = append(roots, v)
		}
	}
	for _, d := range []string{`C:\Games`, `D:\`, `E:\`} {
		if fileExists(d) {
			roots = append(roots, d)
		}
	}
	return roots
}

var skipDirs = map[string]bool{"appdata": true, ".git": true, "node_modules": true, "$recycle.bin": true, "windows": true,
	"system volume information": true, "steamapps": true, ".cache": true}

// findJar walks the usual folders a few levels deep, for a few seconds at most.
func findJar() string {
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	seen := map[string]bool{}
	for _, root := range jarSearchRoots() {
		if seen[strings.ToLower(root)] {
			continue
		}
		seen[strings.ToLower(root)] = true
		depth := 4
		if filepath.Dir(root) == root || strings.HasSuffix(root, `:\`) {
			depth = 3 // whole drives: stay shallow
		}
		base := strings.Count(filepath.Clean(root), string(filepath.Separator))
		found := ""
		_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if ctx.Err() != nil {
				return filepath.SkipAll
			}
			if err != nil {
				if d != nil && d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if d.IsDir() {
				if p != root && (skipDirs[strings.ToLower(d.Name())] || strings.Count(p, string(filepath.Separator))-base >= depth) {
					return filepath.SkipDir
				}
				return nil
			}
			if strings.EqualFold(d.Name(), jarName) {
				found = p
				return filepath.SkipAll
			}
			return nil
		})
		if found != "" {
			return found
		}
		if ctx.Err() != nil {
			break
		}
	}
	return ""
}

// ensureItemDB opens the remembered jar, or looks for one if none is open yet.
func ensureItemDB(search bool) {
	startRenderWorker() // loads settings
	dbMu.Lock()
	defer dbMu.Unlock()
	if dbZip != nil {
		return
	}
	renderMu.Lock()
	p := settings.ItemDB
	renderMu.Unlock()
	if p == "off" { // the owner chose to stop using it; only "Search again" or a path turns it back on
		return
	}
	if p != "" && fileExists(p) && openJar(p) == nil {
		return
	}
	if !search {
		return
	}
	if p = findJar(); p != "" && openJar(p) == nil {
		renderMu.Lock()
		settings.ItemDB = p
		_ = saveSettings()
		renderMu.Unlock()
	}
}

func itemDBInfo() map[string]any {
	return map[string]any{"path": dbPath, "ready": dbZip != nil, "icons": len(dbIcons)}
}

// GET: where the database is (searching once if needed). POST {"path": ...}: use that jar;
// POST {"search": true}: look again; POST {"path": ""}: stop using it (and stop looking).
func handleItemDB(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var in struct {
			Path   *string `json:"path"`
			Search bool    `json:"search"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		startRenderWorker()
		dbMu.Lock()
		if in.Search || in.Path != nil {
			if dbZip != nil {
				dbZip.Close()
			}
			dbZip, dbIcons, dbXML, dbPath = nil, nil, nil, ""
		}
		var err error
		newPath := ""
		if in.Path != nil && *in.Path != "" {
			p := strings.Trim(*in.Path, `" `)
			if st, e := os.Stat(p); e == nil && st.IsDir() {
				p = filepath.Join(p, "NMSSaveEditor.jar")
			}
			if err = openJar(p); err == nil {
				newPath = p
			}
		} else if in.Search {
			if p := findJar(); p != "" {
				if err = openJar(p); err == nil {
					newPath = p
				}
			}
		}
		if err == nil {
			if newPath == "" && !in.Search {
				newPath = "off"
			}
			renderMu.Lock()
			settings.ItemDB = newPath
			_ = saveSettings()
			renderMu.Unlock()
		}
		info := itemDBInfo()
		dbMu.Unlock()
		if err != nil {
			info["error"] = err.Error()
		}
		writeJSON(w, info)
		return
	}
	ensureItemDB(true)
	dbMu.Lock()
	info := itemDBInfo()
	dbMu.Unlock()
	writeJSON(w, info)
}

func handleItemXML(w http.ResponseWriter, r *http.Request) {
	ensureItemDB(false)
	dbMu.Lock()
	xml := dbXML
	dbMu.Unlock()
	if xml == nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(xml)
}

func handleItemIcon(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if !iconNameRe.MatchString(name) {
		http.Error(w, "bad icon name", http.StatusBadRequest)
		return
	}
	ensureItemDB(false)
	dbMu.Lock()
	f := dbIcons[strings.ToUpper(name)]
	var b []byte
	var err error
	if f != nil {
		var rc io.ReadCloser
		if rc, err = f.Open(); err == nil {
			b, err = io.ReadAll(io.LimitReader(rc, 8<<20))
			rc.Close()
		}
	}
	dbMu.Unlock()
	if f == nil || err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, max-age=604800")
	w.Write(b)
}
