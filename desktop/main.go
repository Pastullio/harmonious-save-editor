// Harmonious Save Editor — desktop app.
//
// Serves the editor page on 127.0.0.1 and gives it a small, token-protected API that lists, reads and
// writes No Man's Sky save pairs directly on disk, so Chrome's block on AppData folders doesn't apply.
// It opens the page in an Edge/Chrome app window and exits shortly after that window closes.
//
// GPL-3.0 (format knowledge in the page is ported from libNOM.io / libNOM.map).
package main

import (
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync/atomic"
	"time"
)

//go:embed index.html
var indexHTML string

var (
	dataRe   = regexp.MustCompile(`(?i)^save\d*\.hg$`)
	anySave  = regexp.MustCompile(`(?i)^(mf_)?save\d*\.hg$`)
	acctRe   = regexp.MustCompile(`(?i)^(st_\d+|defaultuser)$`)
	token    string
	lastPing atomic.Int64 // unix ms of the page's last heartbeat
	byeAt    atomic.Int64 // unix ms the page said goodbye (0 = not)
	appDir   string
	backups  string
	roots    []string
)

func main() {
	rootFlag := flag.String("root", "", "folder to look for saves in (default: the game's save folder)")
	noWindow := flag.Bool("no-window", false, "don't open a window; print the address instead")
	port := flag.Int("port", 47821, "preferred local port")
	flag.Parse()

	appDir = appDataDir()
	backups = filepath.Join(appDir, "backups")
	_ = os.MkdirAll(backups, 0o755)
	if f, err := os.OpenFile(filepath.Join(appDir, "log.txt"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644); err == nil {
		log.SetOutput(io.MultiWriter(f, os.Stderr))
	}

	roots = defaultRoots()
	if *rootFlag != "" {
		roots = []string{*rootFlag}
	}
	token = randHex(24)

	// A fixed port keeps the page's origin stable, so the cached item database survives restarts.
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		fatal("Could not start the editor: " + err.Error())
	}
	addr := ln.Addr().String()
	url := "http://" + addr + "/"
	log.Printf("listening on %s, roots %v, backups in %s", url, roots, backups)

	mux := http.NewServeMux()
	mux.HandleFunc("/", handleIndex)
	mux.HandleFunc("/api/ping", func(w http.ResponseWriter, r *http.Request) { lastPing.Store(nowMs()); byeAt.Store(0) })
	mux.HandleFunc("/api/bye", func(w http.ResponseWriter, r *http.Request) { byeAt.Store(nowMs()) })
	mux.HandleFunc("/api/roots", handleRoots)
	mux.HandleFunc("/api/list", handleList)
	mux.HandleFunc("/api/read", handleRead)
	mux.HandleFunc("/api/write", handleWrite)
	mux.HandleFunc("/api/game-running", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, map[string]bool{"running": gameRunning()}) })
	mux.HandleFunc("/api/reveal", handleReveal)
	mux.HandleFunc("/api/render-setup", handleRenderSetup)
	mux.HandleFunc("/api/render", handleRender)
	mux.HandleFunc("/api/render-status", handleRenderStatus)
	mux.HandleFunc("/api/cover", handleCover)
	mux.HandleFunc("/api/screenshots", handleScreenshots)
	mux.HandleFunc("/api/screenshot", handleScreenshot)
	mux.HandleFunc("/api/itemdb", handleItemDB)
	mux.HandleFunc("/api/create", handleCreate)
	mux.HandleFunc("/api/backup-all", handleBackupAll)
	mux.HandleFunc("/api/itemdb/items.xml", handleItemXML)
	mux.HandleFunc("/api/itemdb/icon", handleItemIcon)

	srv := &http.Server{Handler: guard(addr, mux), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fatal("The editor stopped unexpectedly: " + err.Error())
		}
	}()

	if *noWindow {
		fmt.Println(url)
	} else if err := openWindow(url, filepath.Join(appDir, "window")); err != nil {
		fatal("Could not open a window: " + err.Error() + "\n\nOpen this address in your browser instead:\n" + url)
	}
	watchdog(*noWindow)
}

// watchdog exits once the editor page is gone: soon after it says goodbye (unless it reloads),
// or after a long silence (hidden windows may throttle the heartbeat to about once a minute).
func watchdog(noWindow bool) {
	start := nowMs()
	for range time.Tick(2 * time.Second) {
		now, ping, bye := nowMs(), lastPing.Load(), byeAt.Load()
		switch {
		case bye > 0 && now-bye > 8000:
			log.Print("window closed, exiting")
			os.Exit(0)
		case ping > 0 && now-ping > 3*60*1000:
			log.Print("no heartbeat for 3 minutes, exiting")
			os.Exit(0)
		case ping == 0 && !noWindow && now-start > 3*60*1000:
			log.Print("page never connected, exiting")
			os.Exit(0)
		}
	}
}

// guard rejects requests that don't come to our exact host (blocks DNS rebinding) and API calls
// without this run's token (blocks other web pages from talking to the app).
func guard(addr string, next http.Handler) http.Handler {
	_, port, _ := net.SplitHostPort(addr)
	okHosts := map[string]bool{"127.0.0.1:" + port: true, "localhost:" + port: true}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !okHosts[r.Host] {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			t := r.Header.Get("X-Token")
			if t == "" {
				t = r.URL.Query().Get("t")
			}
			if subtle.ConstantTimeCompare([]byte(t), []byte(token)) != 1 {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store") // /api/cover overrides this once it has an image to send
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	inject := fmt.Sprintf(`<script>window.NMS_APP = {token: %q, version: "1"};</script>`, token)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	io.WriteString(w, strings.Replace(indexHTML, "<!--@@APP@@-->", inject, 1))
}

type account struct {
	Name   string `json:"name"`
	Label  string `json:"label"`
	Path   string `json:"path"`
	Saves  int    `json:"saves"`
	Newest int64  `json:"newest"`
}
type root struct {
	Path     string    `json:"path"`
	Exists   bool      `json:"exists"`
	Accounts []account `json:"accounts"`
}

func handleRoots(w http.ResponseWriter, r *http.Request) {
	out := []root{}
	for _, rp := range roots {
		ro := root{Path: rp, Accounts: []account{}}
		if st, err := os.Stat(rp); err == nil && st.IsDir() {
			ro.Exists = true
			if a, ok := scanAccount(rp); ok { // saves directly in the root
				ro.Accounts = append(ro.Accounts, a)
			}
			entries, _ := os.ReadDir(rp)
			for _, e := range entries {
				// st_<id> (Steam) and DefaultUser (GOG), plus any other subfolder holding saves, but not backups
				if e.IsDir() && (acctRe.MatchString(e.Name()) || !strings.HasPrefix(e.Name(), "_")) {
					if a, ok := scanAccount(filepath.Join(rp, e.Name())); ok {
						ro.Accounts = append(ro.Accounts, a)
					}
				}
			}
		}
		sort.Slice(ro.Accounts, func(i, j int) bool { return ro.Accounts[i].Newest > ro.Accounts[j].Newest })
		out = append(out, ro)
	}
	writeJSON(w, map[string]any{"roots": out, "backups": backups})
}

func scanAccount(dir string) (account, bool) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return account{}, false
	}
	a := account{Name: filepath.Base(dir), Path: dir}
	for _, e := range entries {
		if !e.IsDir() && dataRe.MatchString(e.Name()) {
			a.Saves++
			if info, err := e.Info(); err == nil && info.ModTime().UnixMilli() > a.Newest {
				a.Newest = info.ModTime().UnixMilli()
			}
		}
	}
	switch {
	case strings.HasPrefix(strings.ToLower(a.Name), "st_"):
		a.Label = "Steam account " + strings.TrimPrefix(strings.ToLower(a.Name), "st_")
	case strings.EqualFold(a.Name, "DefaultUser"):
		a.Label = "GOG"
	default:
		a.Label = a.Name
	}
	return a, a.Saves > 0
}

type fileInfo struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"`
}

func handleList(w http.ResponseWriter, r *http.Request) {
	dir, err := cleanDir(r.URL.Query().Get("dir"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	out := []fileInfo{}
	for _, e := range entries {
		if e.IsDir() || !anySave.MatchString(e.Name()) {
			continue
		}
		if info, err := e.Info(); err == nil {
			out = append(out, fileInfo{e.Name(), info.Size(), info.ModTime().UnixMilli()})
		}
	}
	writeJSON(w, out)
}

func handleRead(w http.ResponseWriter, r *http.Request) {
	dir, err := cleanDir(r.URL.Query().Get("dir"))
	name := r.URL.Query().Get("name")
	if err != nil || !anySave.MatchString(name) || filepath.Base(name) != name {
		http.Error(w, "only save files can be read", http.StatusBadRequest)
		return
	}
	b, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Write(b)
}

// handleWrite backs up the current save pair, then replaces it with the uploaded one.
// Only an existing saveN.hg / mf_saveN.hg pair can be replaced; nothing else is ever written.
func handleWrite(w http.ResponseWriter, r *http.Request) {
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
		if _, err := os.Stat(p); err != nil {
			http.Error(w, "the original "+filepath.Base(p)+" is missing, so it was not replaced", http.StatusConflict)
			return
		}
	}

	stamp := time.Now().Format("20060102-150405")
	bakName := filepath.Join(filepath.Base(dir), stamp+"_"+strings.TrimSuffix(dataName, filepath.Ext(dataName)))
	bakDir := filepath.Join(backups, bakName)
	if err := os.MkdirAll(bakDir, 0o755); err != nil {
		http.Error(w, "could not create backup folder: "+err.Error(), http.StatusInternalServerError)
		return
	}
	for _, p := range []string{dataPath, metaPath} {
		if err := copyFile(p, filepath.Join(bakDir, filepath.Base(p))); err != nil {
			http.Error(w, "backup failed, nothing was changed: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}
	// meta first, then data (same order as the game and libNOM)
	if err := atomicWrite(metaPath, meta); err != nil {
		http.Error(w, "could not write "+metaName+": "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := atomicWrite(dataPath, data); err != nil {
		_ = copyFile(filepath.Join(bakDir, filepath.Base(metaPath)), metaPath) // put the old meta back
		http.Error(w, "could not write "+dataName+": "+err.Error(), http.StatusInternalServerError)
		return
	}
	log.Printf("wrote %s (%d bytes) and %s (%d bytes), backup %s", dataPath, len(data), metaPath, len(meta), bakDir)
	writeJSON(w, map[string]string{"backup": bakDir, "backupName": bakName})
}

func handleReveal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	if err := reveal(backups); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// ------------------------------------------------------------------ helpers

func cleanDir(p string) (string, error) {
	if p == "" {
		return "", errors.New("no folder given")
	}
	p = filepath.Clean(p)
	if !filepath.IsAbs(p) {
		return "", errors.New("folder must be a full path")
	}
	st, err := os.Stat(p)
	if err != nil {
		return "", errors.New("folder not found: " + p)
	}
	if !st.IsDir() {
		return "", errors.New("not a folder: " + p)
	}
	return p, nil
}

func formFile(r *http.Request, field string) ([]byte, error) {
	f, _, err := r.FormFile(field)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(f)
}

func atomicWrite(path string, b []byte) error {
	tmp := path + ".hse-tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

func copyFile(src, dst string) error {
	b, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.WriteFile(dst, b, 0o644); err != nil {
		return err
	}
	if st, err := os.Stat(src); err == nil {
		_ = os.Chtimes(dst, st.ModTime(), st.ModTime())
	}
	return nil
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func nowMs() int64 { return time.Now().UnixMilli() }
