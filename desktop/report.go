package main

// "Save a report for the developer" (owner 2026-11-24, for the Mac test build: "make sure it has everything it needs
// to find all those files"): one zip that says what this computer looks like to DryDock: which folders it looked in
// for saves, the game, Steam, Blender and Charon Forge and what it found there, how each of the game's archives is
// packed and whether it could be read, which kinds of file the game holds, whether the tables and pictures DryDock
// reads could be read, and a few small sample files (table headers, two pictures) so a format this DryDock doesn't
// know can be worked out. No save contents go in it. Nothing leaves the computer; the person sends the zip.

import (
	"archive/zip"
	"bytes"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

type reportOut struct {
	lines   []string
	samples map[string][]byte
}

func (o *reportOut) say(f string, a ...any) { o.lines = append(o.lines, fmt.Sprintf(f, a...)) }
func (o *reportOut) head(s string)          { o.lines = append(o.lines, "", "== "+s) }

// tree lists a folder's entries (names, and sizes of files), going `depth` levels down, at most `max` lines
func (o *reportOut) tree(dir string, depth, max int) {
	n := 0
	var walk func(d, indent string, left int)
	walk = func(d, indent string, left int) {
		es, err := os.ReadDir(d)
		if err != nil {
			o.say("%s(can't be read: %v)", indent, err)
			return
		}
		for _, e := range es {
			if n >= max {
				return
			}
			n++
			if e.IsDir() {
				o.say("%s%s/", indent, e.Name())
				if left > 1 {
					walk(filepath.Join(d, e.Name()), indent+"  ", left-1)
				}
			} else if fi, err := e.Info(); err == nil {
				o.say("%s%s  %d", indent, e.Name(), fi.Size())
			}
		}
	}
	walk(dir, "  ", depth)
	if n >= max {
		o.say("  … (more)")
	}
}

func there(p string) string {
	st, err := os.Stat(p)
	switch {
	case err == nil && st.IsDir():
		return "folder"
	case err == nil:
		return "file"
	case os.IsNotExist(err):
		return "not there"
	}
	return "can't be read: " + err.Error()
}

func runOut(name string, args ...string) string {
	cmd := exec.Command(name, args...)
	hideWindow(cmd)
	done := make(chan []byte, 1)
	go func() { b, _ := cmd.CombinedOutput(); done <- b }()
	select {
	case b := <-done:
		return strings.TrimSpace(string(b))
	case <-time.After(15 * time.Second):
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		return "(no answer in 15 s)"
	}
}

func buildReport() *reportOut {
	o := &reportOut{samples: map[string][]byte{}}
	home, _ := os.UserHomeDir()
	o.say("Harmonious DryDock report, %s", time.Now().Format("2006-01-02 15:04 MST"))
	o.say("Version %s on %s/%s", appVersion, runtime.GOOS, runtime.GOARCH)
	if runtime.GOOS == "darwin" {
		o.say("macOS: %s", strings.ReplaceAll(runOut("sw_vers"), "\n", ", "))
		o.say("Processor: %s", runOut("sysctl", "-n", "machdep.cpu.brand_string"))
	}
	exe, _ := os.Executable()
	o.say("Program: %s", exe)
	o.say("Home: %s", home)
	o.say("DryDock's own folder: %s (%s)", appDir, there(appDir))
	o.say("Exports: %s (%s)", exportsDir(), there(exportsDir()))
	o.say("Dock Yard: %s (%s)", shipsRoot(), there(shipsRoot()))

	o.head("Saves")
	for _, r := range roots {
		o.say("%s (%s)", r, there(r))
		es, _ := os.ReadDir(r)
		for _, e := range es {
			if !e.IsDir() {
				continue
			}
			fs, _ := os.ReadDir(filepath.Join(r, e.Name()))
			saves, other := 0, 0
			for _, f := range fs {
				if anySave.MatchString(f.Name()) || acctFile.MatchString(f.Name()) {
					saves++
				} else {
					other++
				}
			}
			o.say("  %s/: %d save files, %d other entries%s", e.Name(), saves, other, map[bool]string{true: "  <- an account DryDock lists", false: ""}[acctRe.MatchString(e.Name())])
		}
	}
	if runtime.GOOS == "darwin" { // where else a Mac might keep them
		for _, d := range []string{filepath.Join(home, "Library", "Application Support", "HelloGames"), filepath.Join(home, "Library", "Application Support", "Steam", "userdata")} {
			o.say("%s (%s)", d, there(d))
			if d != "" && there(d) == "folder" && strings.HasSuffix(d, "HelloGames") {
				o.tree(d, 3, 60)
			}
		}
		boxes, _ := filepath.Glob(filepath.Join(home, "Library", "Containers", "*", "Data", "Library", "Application Support", "HelloGames"))
		o.say("App Store containers with a HelloGames folder: %d %v", len(boxes), boxes)
		named, _ := filepath.Glob(filepath.Join(home, "Library", "Containers", "*[Nn]o*[Mm]an*"))
		more, _ := filepath.Glob(filepath.Join(home, "Library", "Containers", "*[Hh]ello[Gg]ames*"))
		o.say("Containers named like the game: %v", append(named, more...))
	}

	o.head("Steam")
	for _, r := range steamRoots() {
		o.say("Steam folder: %s (%s)", r, there(r))
	}
	for _, lib := range steamLibraries() {
		g := filepath.Join(lib, "steamapps", "common", "No Man's Sky")
		o.say("Library: %s (%s); the game in it: %s", lib, there(lib), there(g))
		if there(g) == "folder" {
			o.tree(g, 2, 40)
		}
	}

	o.head("The game")
	renderMu.Lock()
	custom := settings.Game
	renderMu.Unlock()
	o.say("Set by hand in Settings: %q; HSE_GAME: %q", custom, os.Getenv("HSE_GAME"))
	for _, d := range gameFolders() {
		o.say("Looked in: %s (%s) -> %s", d, there(d), orNone(banksUnder(d)))
	}
	if runtime.GOOS == "darwin" {
		o.say("Spotlight (mdfind) for the app: %s", strings.ReplaceAll(runOut("mdfind", "kMDItemFSName == \"No Man's Sky.app\""), "\n", " | "))
	}
	banks := gameBanks()
	o.say("Archives folder used: %s", orNone(banks))
	if banks != "" {
		o.tree(filepath.Dir(banks), 1, 40)
		reportBanks(o, banks)
	}
	libMu.Lock()
	ls := libState
	libMu.Unlock()
	o.say("")
	o.say("Item library: %s %s %s", ls.State, ls.Phase, ls.Error)

	o.head("Blender")
	renderMu.Lock()
	sb, sc := settings.Blender, settings.Charon
	renderMu.Unlock()
	o.say("Set by hand: Blender %q, Charon Forge %q", sb, sc)
	bl := findBlender()
	o.say("Blender found: %s", orNone(bl))
	if bl != "" {
		o.say("  it says: %s", strings.SplitN(runOut(bl, "--version"), "\n", 2)[0])
	}
	for _, d := range blenderConfigDirs() {
		o.say("Blender's settings folder: %s (%s)", d, there(d))
		if there(d) == "folder" {
			o.tree(d, 1, 20)
		}
	}
	o.say("Charon Forge found: %s", orNone(findCharon()))

	o.head("Window")
	if runtime.GOOS == "darwin" {
		for _, b := range macBrowsers() {
			o.say("%s (%s)", b, there(b))
		}
	}
	return o
}

func orNone(s string) string {
	if s == "" {
		return "(nothing)"
	}
	return s
}

// reportBanks opens every archive itself (not through the app's cache), so one that can't be read is named with why.
func reportBanks(o *reportOut, banks string) {
	names, _ := filepath.Glob(filepath.Join(banks, "*.pak"))
	sort.Strings(names)
	exts := map[string]int{}
	var paks []*hgpak
	total := 0
	for _, n := range names {
		st, _ := os.Stat(n)
		var size int64
		if st != nil {
			size = st.Size()
		}
		p, err := openPak(n)
		if err != nil {
			head := make([]byte, 64)
			if f, e2 := os.Open(n); e2 == nil {
				k, _ := f.Read(head)
				head = head[:k]
				f.Close()
			}
			o.say("  %s  %d bytes  CAN'T BE READ: %v  (starts %s)", filepath.Base(n), size, err, hex.EncodeToString(head))
			continue
		}
		paks = append(paks, p)
		kind := "not packed"
		if p.compressed {
			kind = "zstd, PC"
			if p.lz4 {
				kind = "LZ4, Mac"
			}
			kind += fmt.Sprintf(", %d chunks", len(p.chunkSize))
		}
		o.say("  %s  %d bytes  %d files  %s", filepath.Base(n), size, len(p.files), kind)
		total += len(p.files)
		for f := range p.files {
			e := f
			if i := strings.Index(filepath.Base(f), "."); i >= 0 {
				e = filepath.Base(f)[i:]
			}
			exts[e]++
		}
	}
	defer func() {
		for _, p := range paks {
			p.Close()
		}
	}()
	o.say("%d archives, %d read, %d files in all", len(names), len(paks), total)
	type kv struct {
		k string
		n int
	}
	var list []kv
	for k, n := range exts {
		list = append(list, kv{k, n})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].n > list[j].n || list[i].n == list[j].n && list[i].k < list[j].k })
	o.say("")
	o.say("Kinds of file (by ending):")
	for i, e := range list {
		if i >= 60 {
			o.say("  … and %d more endings", len(list)-i)
			break
		}
		o.say("  %-28s %d", e.k, e.n)
	}
	read := func(name string) ([]byte, error) {
		for _, p := range paks {
			if p.Has(name) {
				return p.Read(name)
			}
		}
		return nil, os.ErrNotExist
	}
	find := func(ok func(string) bool) string {
		best := ""
		for _, p := range paks {
			for f := range p.files {
				if ok(f) && (best == "" || f < best) {
					best = f
				}
			}
		}
		return best
	}
	// the files DryDock leans on: can each be read, and does it start the way a table should?
	o.say("")
	o.say("Files DryDock reads:")
	for _, want := range []string{"metadata/reality/tables/nms_reality_gcproducttable.mbin", "metadata/reality/tables/nms_reality_gctechnologytable.mbin", "metadata/reality/tables/nms_reality_gcsubstancetable.mbin",
		"metadata/reality/tables/basebuildingobjectstable.mbin", "metadata/gamestate/playerdata/modularcustomisationdatatable.mbin", "metadata/gamestate/playerdata/charactercustomisationdescriptorgroupsdata.mbin",
		"models/common/spacecraft/fighters/fighter_proc.scene.mbin", "models/common/player/playercharacter/playercharacter.scene.mbin"} {
		b, err := read(want)
		if err != nil {
			alt := find(func(f string) bool { return strings.HasSuffix(f, "/"+filepath.Base(want)) })
			o.say("  %s: NOT READ (%v)%s", want, err, map[bool]string{true: "; found as " + alt, false: ""}[alt != ""])
			continue
		}
		n := len(b)
		if n > 0x60 {
			n = 0x60
		}
		o.say("  %s: %d bytes, starts %s", want, len(b), hex.EncodeToString(b[:n]))
	}
	// the English text, by any name it goes under
	lang := find(func(f string) bool { return strings.HasPrefix(f, "language/") && strings.Contains(f, "english") })
	o.say("  English text: %s", orNone(lang))
	// geometry and pictures: what the first of each looks like, and whether DryDock's reader takes it
	for _, kind := range []struct {
		what  string
		data  bool
		under string
	}{{"Geometry", false, "models/common/spacecraft/fighters/"}, {"Geometry data", true, "models/common/spacecraft/fighters/"}} {
		f := find(func(f string) bool {
			return strings.HasPrefix(f, kind.under) && strings.Contains(f, ".geometry.") && strings.Contains(f, ".geometry.data.") == kind.data
		})
		if f == "" {
			o.say("  %s: none found under %s", kind.what, kind.under)
			continue
		}
		b, err := read(f)
		n := len(b)
		if n > 0x180 {
			n = 0x180
		}
		o.say("  %s: %s, %d bytes, %v, starts %s", kind.what, f, len(b), err, hex.EncodeToString(b[:n]))
		if !kind.data {
			if g, err := loadGeometry(f); err != nil {
				o.say("  Model reader: does NOT take it (%v)", err)
			} else {
				o.say("  Model reader: takes it (%d meshes)", len(g.byName)+len(g.byHash))
			}
		}
	}
	// one whole ship, the way a cover is drawn
	if _, err := loadScene("models/common/spacecraft/fighters/fighter_proc.scene.mbin"); err != nil {
		o.say("  Fighter scene: NOT READ (%v)", err)
	} else {
		o.say("  Fighter scene: read")
	}
	libMu.Lock()
	lib := libLoaded
	libMu.Unlock()
	if lib != nil && len(lib.Missing) > 0 {
		o.say("  Icons that couldn't be read: %s", strings.Join(lib.Missing, ", "))
	}
	pics := 0
	for _, under := range []string{"textures/ui/frontend/icons/", "textures/common/spacecraft/fighters/", "textures/common/player/"} {
		f := find(func(f string) bool {
			return strings.HasPrefix(f, under) && !strings.HasSuffix(f, ".mbin") && !strings.Contains(f, ".texture.")
		})
		if f == "" {
			o.say("  Pictures under %s: none found", under)
			continue
		}
		b, err := read(f)
		if err != nil {
			o.say("  Picture %s: NOT READ (%v)", f, err)
			continue
		}
		n := len(b)
		if n > 0xA0 {
			n = 0xA0
		}
		verdict := "DryDock reads it"
		if img, derr := decodeDDS(b); derr != nil {
			verdict = "DRYDOCK CAN'T READ IT: " + derr.Error()
		} else {
			verdict += fmt.Sprintf(" (%d x %d)", img.Bounds().Dx(), img.Bounds().Dy())
		}
		o.say("  Picture %s: %d bytes, %s, starts %s", f, len(b), verdict, hex.EncodeToString(b[:n]))
		if len(b) <= 3<<20 && pics < 3 { // a sample, so an unknown picture format can be worked out
			o.samples["samples/"+strings.ReplaceAll(f, "/", "__")] = b
			pics++
		}
	}
}

func handleReport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	o := buildReport()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	if f, err := zw.Create("report.txt"); err == nil {
		f.Write([]byte(strings.Join(o.lines, "\r\n") + "\r\n"))
	}
	for n, b := range o.samples {
		if f, err := zw.Create(n); err == nil {
			f.Write(b)
		}
	}
	zw.Close()
	// Exports first; if that folder can't be made (a Mac may refuse Documents), DryDock's own folder
	name := "DryDock report " + time.Now().Format("2006-01-02 1504") + ".zip"
	var p string
	var err error
	for _, dir := range []string{exportsDir(), appDir, os.TempDir()} {
		if err = os.MkdirAll(dir, 0o755); err != nil {
			continue
		}
		p = filepath.Join(dir, name)
		for n := 2; fileExists(p); n++ {
			p = filepath.Join(dir, strings.TrimSuffix(name, ".zip")+" ("+strconv.Itoa(n)+").zip")
		}
		if err = atomicWrite(p, buf.Bytes()); err == nil {
			break
		}
	}
	if err != nil {
		http.Error(w, "the report couldn't be saved: "+err.Error(), http.StatusInternalServerError)
		return
	}
	_ = revealFile(p)
	writeJSON(w, map[string]any{"path": p, "size": buf.Len(), "text": strings.Join(o.lines, "\n")})
}
