package main

// Companions drawn from the owner's own game files. A pet in the save has a CreatureID (FLYINGSNAKE, QUAD_PET…)
// and Descriptors: the scene's option nodes it was born with (_HEAD_4, _WINGS_1…), which are the same
// "_Group_Option" alternatives ships use, so buildMesh draws it once the creature's scene is known.
//
// The scene comes from the creature table (creaturedatatable.mbin): each entry holds the ID as a fixed string
// and, a little after it, the model's filename as a variable string. The table's exact layout isn't pinned
// here, so the first scene filename after the ID is taken; failing that, a scene whose file or folder is named
// like the ID. /api/model/creature/sample zips what's needed to check and improve this, for the developer.

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	creatureMu    sync.Mutex
	creatureCache = map[string][2]string{} // id -> scene, how it was found
)

func allGameFiles() []string {
	paks, err := openGamePaks()
	if err != nil {
		return nil
	}
	var out []string
	for _, p := range paks {
		for n := range p.files {
			out = append(out, n)
		}
	}
	sort.Strings(out)
	return out
}

func findGameFile(suffix string) string {
	for _, n := range allGameFiles() {
		if strings.HasSuffix(n, suffix) {
			return n
		}
	}
	return ""
}

// scenesInTable finds, for the ID, the first variable string ending in .scene.mbin after it (within one entry's reach)
func sceneInTable(raw []byte, id string) string {
	m := &mbin{raw}
	needle := append([]byte(id), 0)
	for from := 0; ; {
		i := bytes.Index(raw[from:], needle)
		if i < 0 {
			return ""
		}
		a := from + i
		from = a + 1
		if a > 0 && raw[a-1] != 0 { // part of a longer name (PET in QUAD_PET)
			continue
		}
		for q := (a + len(needle) + 3) &^ 3; q < a+0x800 && q+16 <= len(raw); q += 4 {
			if binary.LittleEndian.Uint32(raw[q+12:]) != 0xAAAAAA01 {
				continue
			}
			if s := strings.ToLower(m.vstr(q)); strings.HasSuffix(s, ".scene.mbin") && strings.HasPrefix(s, "models/") {
				return s
			}
		}
	}
}

// creaturefilenametable.mbin (checked 2026-11-01 on the owner's game: 89 entries, every companion found): a list at
// 0x20 of 0x30-byte entries, {ExtraFilename (variable string), Filename (variable string), ID (fixed 0x10)}
const creatureFilenamesGUID = 0x797D2513BE1226DC

func sceneInFilenameTable(raw []byte, id string) string {
	if len(raw) < 0x30 || binary.LittleEndian.Uint64(raw[0x10:]) != creatureFilenamesGUID {
		return ""
	}
	m := &mbin{raw}
	a, n := m.list(0x20)
	for i := 0; i < n; i++ {
		e := a + i*0x30
		if strings.EqualFold(m.fstr(e+0x20, 0x10), id) {
			return normGamePath(m.vstr(e + 0x10))
		}
	}
	return ""
}

var nonAlnum = regexp.MustCompile(`[^a-z0-9]`)

func creatureScene(id string) (string, string, error) {
	id = strings.ToUpper(strings.TrimPrefix(strings.TrimSpace(id), "^"))
	if id == "" {
		return "", "", fmt.Errorf("no creature")
	}
	creatureMu.Lock()
	if c, ok := creatureCache[id]; ok {
		creatureMu.Unlock()
		return c[0], c[1], nil
	}
	creatureMu.Unlock()
	if _, err := openGamePaks(); err != nil {
		return "", "", err
	}
	scene, how := "", ""
	if raw, err := gameFile("metadata/simulation/ecosystem/creaturefilenametable.mbin"); err == nil {
		if s := sceneInFilenameTable(raw, id); s != "" {
			if _, err := gameFile(s); err == nil {
				scene, how = s, "filenames"
			}
		}
	}
	if t := findGameFile("/creaturedatatable.mbin"); t != "" && scene == "" {
		if raw, err := gameFile(t); err == nil {
			if s := sceneInTable(raw, id); s != "" {
				if _, err := gameFile(s); err == nil {
					scene, how = s, "table"
				}
			}
		}
	}
	if scene == "" { // by name: the file, then the folder
		want := nonAlnum.ReplaceAllString(strings.ToLower(id), "")
		best, score := "", 0
		for _, n := range allGameFiles() {
			if !strings.HasPrefix(n, "models/") || !strings.HasSuffix(n, ".scene.mbin") || strings.Contains(n, "/anims/") {
				continue
			}
			base := nonAlnum.ReplaceAllString(strings.TrimSuffix(filepath.Base(n), ".scene.mbin"), "")
			dir := nonAlnum.ReplaceAllString(filepath.Base(filepath.Dir(n)), "")
			sc := 0
			switch {
			case base == want:
				sc = 3
			case dir == want:
				sc = 2
			}
			if sc > 0 && strings.Contains(n, "creature") {
				sc += 2
			}
			if sc > score || (sc == score && sc > 0 && len(n) < len(best)) {
				best, score = n, sc
			}
		}
		if best != "" {
			scene, how = best, "name"
		}
	}
	if scene == "" {
		return "", "", fmt.Errorf("no model found for %s", id)
	}
	creatureMu.Lock()
	creatureCache[id] = [2]string{scene, how}
	creatureMu.Unlock()
	return scene, how, nil
}

// GET /api/model/creature?id=FLYINGSNAKE : {scene, how}
func handleCreature(w http.ResponseWriter, r *http.Request) {
	s, how, err := creatureScene(r.URL.Query().Get("id"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	writeJSON(w, map[string]string{"scene": s, "how": how})
}

// POST /api/model/creature/sample?ids=A,B : a zip in Exports with the creature table, the companions' scenes
// (and the scenes they reference), descriptors and geometry, plus a list of every creature scene, so the
// developer can check the reader against real files. Never shared by the app itself.
func handleCreatureSample(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	if _, err := openGamePaks(); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	files := map[string]bool{}
	var report []string
	for _, n := range allGameFiles() {
		if strings.Contains(n, "/ecosystem/") && strings.HasSuffix(n, ".mbin") || strings.HasSuffix(n, "creaturedatatable.mbin") {
			files[n] = true
		}
	}
	var add func(scene string, depth int)
	add = func(scene string, depth int) {
		scene = normGamePath(scene)
		if files[scene] || depth > 8 {
			return
		}
		files[scene] = true
		stem := strings.TrimSuffix(scene, ".scene.mbin")
		for _, ext := range []string{".descriptor.mbin", ".geometry.mbin.pc", ".geometry.data.mbin.pc"} {
			if _, err := gameFile(stem + ext); err == nil {
				files[stem+ext] = true
			}
		}
		root, err := loadScene(scene)
		if err != nil {
			return
		}
		var walk func(n *sceneNode)
		walk = func(n *sceneNode) {
			if n.Type == "MODEL" && n.Attrs["GEOMETRY"] != "" {
				g := strings.TrimSuffix(strings.TrimSuffix(normGamePath(n.Attrs["GEOMETRY"]), ".pc"), ".geometry.mbin")
				for _, ext := range []string{".geometry.mbin.pc", ".geometry.data.mbin.pc"} {
					if _, err := gameFile(g + ext); err == nil {
						files[g+ext] = true
					}
				}
			}
			if n.Type == "REFERENCE" && n.Attrs["SCENEGRAPH"] != "" && !strings.Contains(strings.ToUpper(n.Attrs["SCENEGRAPH"]), "ANIMS") {
				add(n.Attrs["SCENEGRAPH"], depth+1)
			}
			for _, k := range n.Kids {
				walk(k)
			}
		}
		walk(root)
	}
	for _, id := range strings.Split(r.URL.Query().Get("ids"), ",") {
		if id = strings.TrimSpace(id); id == "" {
			continue
		}
		s, how, err := creatureScene(id)
		if err != nil {
			report = append(report, id+": "+err.Error())
			continue
		}
		report = append(report, id+": "+s+" ("+how+")")
		add(s, 0)
	}
	report = append(report, "", "Creature scenes in the game:")
	for _, n := range allGameFiles() {
		if strings.HasSuffix(n, ".scene.mbin") && (strings.Contains(n, "creature") || strings.Contains(n, "pet")) {
			report = append(report, n)
		}
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		b, err := gameFile(n)
		if err != nil {
			continue
		}
		if f, err := zw.Create(n); err == nil {
			f.Write(b)
		}
	}
	if f, err := zw.Create("about.txt"); err == nil {
		f.Write([]byte(strings.Join(report, "\r\n")))
	}
	zw.Close()
	dir := exportsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	p := filepath.Join(dir, "Creature files for the developer "+time.Now().Format("2006-01-02 1504")+".zip")
	for n := 2; fileExists(p); n++ {
		p = strings.TrimSuffix(p, ".zip") + " (" + strconv.Itoa(n) + ").zip"
	}
	if err := atomicWrite(p, buf.Bytes()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = revealFile(p)
	writeJSON(w, map[string]any{"path": p, "files": len(names), "size": buf.Len()})
}

// Battle types the game fixes per species (owner, 2026-11-09, a tester's request: change a companion's type where
// the game allows it). Other companions take their type from the biome they came from (the pet's Biome field);
// a species with a forced type (robots are all Mechanical) ignores it. GcCreatureDataTable (template
// 0x37D55099B13B9F9C, libMBIN 2026-11): a list at 0x20 of 0xD0-byte GcCreatureData entries, Id at 0x30 (fixed
// 0x10), PetBattlerForcedAffinity at 0xCC (a byte, GcPetBattlerAffinity: 0 Normal = not forced). Checked on the
// owner's table: 86 entries, 19 forced (8 Mech).
var petAffinities = []string{"Normal", "Lush", "Cold", "Fire", "Toxic", "Barren", "Radioactive", "Weird", "Mech"}

func creatureTypes(raw []byte) (map[string]string, error) {
	m, err := openMbin(raw, 0x37D55099B13B9F9C, "creaturedatatable.mbin")
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	a, n := m.list(0x20)
	for i := 0; i < n; i++ {
		e := a + i*0xD0
		if !m.ok(e, 0xD0) {
			break
		}
		id, f := m.fstr(e+0x30, 0x10), int(m.d[e+0xCC])
		if id != "" && f > 0 && f < len(petAffinities) {
			out[id] = petAffinities[f]
		}
	}
	return out, nil
}

func handleCreatureTypes(w http.ResponseWriter, r *http.Request) {
	t := findGameFile("/creaturedatatable.mbin")
	if t == "" {
		writeJSON(w, map[string]any{"types": nil, "error": "the creature table wasn't found in the game files"})
		return
	}
	raw, err := gameFile(t)
	if err == nil {
		var types map[string]string
		if types, err = creatureTypes(raw); err == nil {
			writeJSON(w, map[string]any{"types": types})
			return
		}
	}
	writeJSON(w, map[string]any{"types": nil, "error": err.Error()})
}
