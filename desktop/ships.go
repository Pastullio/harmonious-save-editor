package main

// Dock Yard (the ship library): one place for every ship the owner keeps.
//
//   Documents\Harmonious Save Editor\Dock Yard\Ship storage   ships imported or pulled out of a save
//   Documents\Harmonious Save Editor\Dock Yard\Garage         every ship seen in any opened save, captured automatically
//   Documents\Harmonious Save Editor\Dock Yard\Deleted        where deleted files go (nothing is erased)
//   Documents\Harmonious Save Editor\Dock Yard\library.json   tags, favourites, links and notes, plus cached summaries
//
// Before it was called Dock Yard this was Ships\Library; migrateShips moves an existing one across once.
//
// Linked folders are folders the owner already keeps ships in. They are listed alongside the library
// but only ever read: the app never writes, moves or deletes anything in them.

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var shipExts = map[string]bool{".json": true, ".txt": true, ".nmsship": true, ".so": true}

const maxShipFiles = 10000

const storageDir = "Ship storage" // the page calls this source "library"

var migrateOnce sync.Once

func shipsRoot() string {
	renderMu.Lock()
	custom := settings.Ships
	renderMu.Unlock()
	root := custom
	if root == "" {
		root = filepath.Join(filepath.Dir(fullBackupDir()), "Harmonious Save Editor", "Dock Yard")
	}
	migrateOnce.Do(func() { migrateShips(root, custom == "") })
	return root
}

// migrateShips renames the old Ships folder to Dock Yard and Library to Ship storage. If anything is
// in the way it leaves both alone (and logs why), so no file is ever overwritten.
func migrateShips(root string, renameRoot bool) {
	if old := filepath.Join(filepath.Dir(root), "Ships"); renameRoot && fileExists(old) && !fileExists(root) {
		if err := os.Rename(old, root); err != nil {
			log.Printf("dock yard: couldn't rename %s: %v", old, err)
		}
	}
	if old, nw := filepath.Join(root, "Library"), filepath.Join(root, storageDir); fileExists(old) && !fileExists(nw) {
		if err := os.Rename(old, nw); err != nil {
			log.Printf("dock yard: couldn't rename %s: %v", old, err)
		}
	}
}

func shipFolders() []string {
	renderMu.Lock()
	defer renderMu.Unlock()
	return append([]string(nil), settings.ShipFolders...)
}

type shipFile struct {
	Src   string `json:"src"`  // library, garage or linked
	Root  string `json:"root"` // the linked folder (linked only)
	Path  string `json:"path"` // relative, forward slashes
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"`
}

type shipFolder struct {
	Dir    string `json:"dir"`
	Exists bool   `json:"exists"`
}

func scanShips(dir, src, root string, out *[]shipFile) {
	if !fileExists(dir) {
		return
	}
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(dir, p)
		if d.IsDir() {
			// stay shallow and skip our own trash and hidden folders
			if rel != "." && (strings.Count(rel, string(filepath.Separator)) >= 5 || strings.HasPrefix(d.Name(), ".") || (src != "linked" && rel == "Deleted")) {
				return filepath.SkipDir
			}
			return nil
		}
		if len(*out) >= maxShipFiles || !shipExts[strings.ToLower(filepath.Ext(p))] {
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() > 64<<20 {
			return nil
		}
		*out = append(*out, shipFile{Src: src, Root: root, Path: filepath.ToSlash(rel), Size: info.Size(), Mtime: info.ModTime().UnixMilli()})
		return nil
	})
}

// shipPath turns a (src, root, path) triple from the page into a real path, refusing anything outside
// the library, the garage or a linked folder.
func shipPath(src, root, rel string, forWrite bool) (string, error) {
	var base string
	switch src {
	case "library":
		base = filepath.Join(shipsRoot(), storageDir)
	case "garage":
		base = filepath.Join(shipsRoot(), "Garage")
	case "linked":
		if forWrite {
			return "", errors.New("linked folders are read only")
		}
		ok := false
		for _, f := range shipFolders() {
			if filepath.Clean(f) == filepath.Clean(root) {
				ok = true
			}
		}
		if !ok {
			return "", errors.New("not a linked folder")
		}
		base = filepath.Clean(root)
	default:
		return "", errors.New("unknown ship source")
	}
	if rel == "" || strings.Contains(rel, "\x00") {
		return "", errors.New("no file given")
	}
	p := filepath.Join(base, filepath.FromSlash(rel))
	r, err := filepath.Rel(base, p)
	if err != nil || r == "." || strings.HasPrefix(r, "..") || filepath.IsAbs(r) {
		return "", errors.New("bad ship path")
	}
	if !shipExts[strings.ToLower(filepath.Ext(p))] {
		return "", errors.New("not a ship file")
	}
	return p, nil
}

func handleShips(w http.ResponseWriter, r *http.Request) {
	root := shipsRoot()
	_ = os.MkdirAll(filepath.Join(root, storageDir), 0o755)
	_ = os.MkdirAll(filepath.Join(root, "Garage"), 0o755)
	files := []shipFile{}
	scanShips(filepath.Join(root, storageDir), "library", "", &files)
	scanShips(filepath.Join(root, "Garage"), "garage", "", &files)
	folders := []shipFolder{}
	for _, f := range shipFolders() {
		folders = append(folders, shipFolder{f, fileExists(f)})
		scanShips(f, "linked", f, &files)
	}
	writeJSON(w, map[string]any{"root": root, "folders": folders, "files": files, "truncated": len(files) >= maxShipFiles})
}

func handleShipFile(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	p, err := shipPath(q.Get("src"), q.Get("root"), q.Get("path"), r.Method != http.MethodGet)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodGet:
		if q.Get("reveal") == "1" {
			_ = revealFile(p)
			writeJSON(w, map[string]string{"path": p})
			return
		}
		b, err := os.ReadFile(p)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(b)
	case http.MethodPost:
		b, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if q.Get("new") == "1" && fileExists(p) {
			http.Error(w, "a file with that name already exists", http.StatusConflict)
			return
		}
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		if err := atomicWrite(p, b); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"path": p})
	case http.MethodDelete:
		// deleting moves the file into Dock Yard\Deleted, so it can always be brought back
		trash := filepath.Join(shipsRoot(), "Deleted", time.Now().Format("2006-01-02"))
		_ = os.MkdirAll(trash, 0o755)
		dst := filepath.Join(trash, filepath.Base(p))
		for i := 2; fileExists(dst); i++ {
			ext := filepath.Ext(p)
			dst = filepath.Join(trash, strings.TrimSuffix(filepath.Base(p), ext)+" ("+itoa(i)+")"+ext)
		}
		if err := os.Rename(p, dst); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"moved": dst})
	default:
		http.Error(w, "GET, POST or DELETE", http.StatusMethodNotAllowed)
	}
}

// library.json: whatever the page keeps about each ship (tags, favourite, links, notes, cached summary)
func handleShipIndex(w http.ResponseWriter, r *http.Request) {
	p := filepath.Join(shipsRoot(), "library.json")
	switch r.Method {
	case http.MethodGet:
		b, err := os.ReadFile(p)
		if err != nil || !json.Valid(b) {
			b = []byte("{}")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(b)
	case http.MethodPost:
		b, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
		if err != nil || !json.Valid(b) {
			http.Error(w, "not valid JSON", http.StatusBadRequest)
			return
		}
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		if err := atomicWrite(p, b); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	default:
		http.Error(w, "GET or POST", http.StatusMethodNotAllowed)
	}
}

// linked folders: {add: dir} or {remove: dir}, or {pick: true} to choose one with the Windows folder dialog
func handleShipFolders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		if r.URL.Query().Get("reveal") == "1" {
			_ = reveal(shipsRoot())
		}
		writeJSON(w, map[string]any{"root": shipsRoot(), "folders": shipFolders()})
		return
	}
	var req struct {
		Add, Remove string
		Pick        bool
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if req.Pick {
		dir, err := pickFolder("Choose a folder with your ship files")
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotImplemented)
			return
		}
		if dir == "" {
			writeJSON(w, map[string]any{"folders": shipFolders(), "cancelled": true})
			return
		}
		req.Add = dir
	}
	renderMu.Lock()
	switch {
	case req.Add != "":
		dir, err := cleanDir(req.Add)
		if err != nil {
			renderMu.Unlock()
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		dup := false
		for _, f := range settings.ShipFolders {
			dup = dup || strings.EqualFold(filepath.Clean(f), dir)
		}
		if !dup {
			settings.ShipFolders = append(settings.ShipFolders, dir)
			sort.Strings(settings.ShipFolders)
		}
	case req.Remove != "":
		keep := settings.ShipFolders[:0]
		for _, f := range settings.ShipFolders {
			if !strings.EqualFold(filepath.Clean(f), filepath.Clean(req.Remove)) {
				keep = append(keep, f)
			}
		}
		settings.ShipFolders = keep
	}
	err := saveSettings()
	renderMu.Unlock()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"folders": shipFolders()})
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	s := ""
	for ; i > 0; i /= 10 {
		s = string(rune('0'+i%10)) + s
	}
	return s
}
