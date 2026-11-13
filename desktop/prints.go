package main

// The 3D print library (owner 2026-11-13, LiveLink page): the STL files the LiveLink add-on wrote to Exports,
// listed with their size, and a light preview of each for the page to turn (a print runs to 7 million triangles,
// far too many for the page, so the app thins it by vertex clustering and caches the result).
//
//   GET    /api/exports/prints                -> {prints: [{name, mtime, size, triangles, mm: [w, d, h]}], dir}
//   GET    /api/exports/print?name=&preview=1 -> a grey .glb preview (Y up, millimetres)
//   POST   /api/exports/print?name=&reveal=1  -> shows it in Explorer
//   DELETE /api/exports/print?name=           -> moves it to Exports\Deleted (nothing is erased)
//   POST   /api/exports/print?folder=1        -> opens the Exports folder

import (
	"bufio"
	"bytes"
	"crypto/sha1"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const printPreviewCells = 150 // cells along the longest side: about 100-300 thousand triangles

var printMu sync.Mutex // one preview at a time (each reads a file of up to a few hundred MB)

func printPath(name string) (string, error) {
	name = filepath.Base(name)
	if name == "" || name == "." || strings.ContainsAny(name, `/\`) || strings.ToLower(filepath.Ext(name)) != ".stl" {
		return "", errors.New("not an STL file")
	}
	p := filepath.Join(exportsDir(), name)
	if !fileExists(p) {
		return "", os.ErrNotExist
	}
	return p, nil
}

type stlInfo struct {
	Name      string     `json:"name"`
	MTime     int64      `json:"mtime"`
	Size      int64      `json:"size"`
	Triangles int        `json:"triangles"`
	MM        [3]float32 `json:"mm"`
}

var stlInfoCache = map[string]stlInfo{}

// stlBounds reads a binary STL's triangle count and its size (the file is in millimetres).
func stlBounds(p string, fi os.FileInfo) (stlInfo, error) {
	key := fmt.Sprintf("%s|%d|%d", p, fi.Size(), fi.ModTime().UnixNano())
	printMu.Lock()
	if v, ok := stlInfoCache[key]; ok {
		printMu.Unlock()
		return v, nil
	}
	printMu.Unlock()
	info := stlInfo{Name: filepath.Base(p), MTime: fi.ModTime().UnixMilli(), Size: fi.Size()}
	f, err := os.Open(p)
	if err != nil {
		return info, err
	}
	defer f.Close()
	br := bufio.NewReaderSize(f, 1<<20)
	head := make([]byte, 84)
	if _, err := io.ReadFull(br, head); err != nil {
		return info, err
	}
	n := int(binary.LittleEndian.Uint32(head[80:]))
	if int64(84+n*50) != fi.Size() {
		return info, errors.New("not a binary STL")
	}
	info.Triangles = n
	lo := [3]float32{math.MaxFloat32, math.MaxFloat32, math.MaxFloat32}
	hi := [3]float32{-math.MaxFloat32, -math.MaxFloat32, -math.MaxFloat32}
	rec := make([]byte, 50)
	for i := 0; i < n; i++ {
		if _, err := io.ReadFull(br, rec); err != nil {
			return info, err
		}
		for v := 0; v < 3; v++ {
			for k := 0; k < 3; k++ {
				x := math.Float32frombits(binary.LittleEndian.Uint32(rec[12+v*12+k*4:]))
				if x < lo[k] {
					lo[k] = x
				}
				if x > hi[k] {
					hi[k] = x
				}
			}
		}
	}
	if n > 0 {
		for k := 0; k < 3; k++ {
			info.MM[k] = hi[k] - lo[k]
		}
	}
	printMu.Lock()
	stlInfoCache[key] = info
	printMu.Unlock()
	return info, nil
}

func handleExportPrints(w http.ResponseWriter, r *http.Request) {
	out := []stlInfo{}
	if es, err := os.ReadDir(exportsDir()); err == nil {
		for _, e := range es {
			if e.IsDir() || strings.ToLower(filepath.Ext(e.Name())) != ".stl" {
				continue
			}
			fi, err := e.Info()
			if err != nil {
				continue
			}
			if info, err := stlBounds(filepath.Join(exportsDir(), e.Name()), fi); err == nil {
				out = append(out, info)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].MTime > out[j].MTime })
	writeJSON(w, map[string]any{"prints": out, "dir": exportsDir()})
}

func handleExportPrint(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("folder") == "1" { // POST ?folder=1: open the Exports folder
		_ = os.MkdirAll(exportsDir(), 0o755)
		_ = reveal(exportsDir())
		writeJSON(w, map[string]any{"ok": true, "dir": exportsDir()})
		return
	}
	p, err := printPath(r.URL.Query().Get("name"))
	if err != nil {
		code := http.StatusBadRequest
		if errors.Is(err, os.ErrNotExist) {
			code = http.StatusNotFound
		}
		http.Error(w, err.Error(), code)
		return
	}
	switch {
	case r.Method == http.MethodDelete:
		dir := filepath.Join(exportsDir(), "Deleted")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		to := filepath.Join(dir, filepath.Base(p))
		for i := 2; fileExists(to); i++ {
			ext := filepath.Ext(p)
			to = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", strings.TrimSuffix(filepath.Base(p), ext), i, ext))
		}
		if err := os.Rename(p, to); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"ok": true, "moved": to})
	case r.URL.Query().Get("reveal") == "1":
		_ = revealFile(p)
		writeJSON(w, map[string]any{"ok": true})
	case r.URL.Query().Get("preview") == "1":
		b, err := printPreview(p)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "model/gltf-binary")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(b)
	default:
		http.Error(w, "nothing asked", http.StatusBadRequest)
	}
}

// printPreview: the STL thinned by vertex clustering (every vertex snaps to the centre of its cell's vertices,
// triangles that collapse are dropped), as a grey glTF, cached in the app folder by file, size and time.
func printPreview(p string) ([]byte, error) {
	fi, err := os.Stat(p)
	if err != nil {
		return nil, err
	}
	h := sha1.Sum([]byte(fmt.Sprintf("%s|%d|%d|%d", filepath.Base(p), fi.Size(), fi.ModTime().UnixNano(), printPreviewCells)))
	cache := filepath.Join(appDir, "prints", hex.EncodeToString(h[:10])+".glb")
	if b, err := os.ReadFile(cache); err == nil {
		return b, nil
	}
	info, err := stlBounds(p, fi)
	if err != nil {
		return nil, err
	}
	printMu.Lock()
	defer printMu.Unlock()
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	br := bufio.NewReaderSize(f, 1<<20)
	if _, err := br.Discard(84); err != nil {
		return nil, err
	}
	// the cell size from the size the list already measured; the grid starts at the first vertex's cell
	longest := float64(max(info.MM[0], info.MM[1], info.MM[2]))
	cell := math.Max(longest/printPreviewCells, 1e-4)
	type acc struct {
		x, y, z float64
		n       int32
		idx     int32
	}
	cells := map[[3]int32]*acc{}
	var order []*acc
	seen := map[[3]int32]struct{}{}
	var tris [][3]int32
	rec := make([]byte, 50)
	at := func(off int) (float32, float32, float32) {
		return math.Float32frombits(binary.LittleEndian.Uint32(rec[off:])), math.Float32frombits(binary.LittleEndian.Uint32(rec[off+4:])), math.Float32frombits(binary.LittleEndian.Uint32(rec[off+8:]))
	}
	for i := 0; i < info.Triangles; i++ {
		if _, err := io.ReadFull(br, rec); err != nil {
			return nil, err
		}
		var t [3]int32
		for v := 0; v < 3; v++ {
			x, y, z := at(12 + v*12)
			k := [3]int32{int32(math.Floor(float64(x) / cell)), int32(math.Floor(float64(y) / cell)), int32(math.Floor(float64(z) / cell))}
			a := cells[k]
			if a == nil {
				a = &acc{idx: int32(len(order))}
				cells[k] = a
				order = append(order, a)
			}
			a.x, a.y, a.z, a.n = a.x+float64(x), a.y+float64(y), a.z+float64(z), a.n+1
			t[v] = a.idx
		}
		if t[0] == t[1] || t[1] == t[2] || t[0] == t[2] {
			continue
		}
		s := t
		sort.Slice(s[:], func(a, b int) bool { return s[a] < s[b] })
		if _, dup := seen[s]; dup {
			continue
		}
		seen[s] = struct{}{}
		tris = append(tris, t)
	}
	// STL is Z up; glTF is Y up (x, z, -y)
	pos := make([]float32, len(order)*3)
	for i, a := range order {
		n := float64(a.n)
		pos[i*3], pos[i*3+1], pos[i*3+2] = float32(a.x/n), float32(a.z/n), float32(-a.y/n)
	}
	nrm := make([]float32, len(pos))
	for _, t := range tris {
		var p [3][3]float32
		for v := 0; v < 3; v++ {
			copy(p[v][:], pos[t[v]*3:t[v]*3+3])
		}
		ux, uy, uz := p[1][0]-p[0][0], p[1][1]-p[0][1], p[1][2]-p[0][2]
		vx, vy, vz := p[2][0]-p[0][0], p[2][1]-p[0][1], p[2][2]-p[0][2]
		cx, cy, cz := uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
		for v := 0; v < 3; v++ {
			nrm[t[v]*3] += cx
			nrm[t[v]*3+1] += cy
			nrm[t[v]*3+2] += cz
		}
	}
	for i := 0; i < len(nrm); i += 3 {
		l := float32(math.Sqrt(float64(nrm[i]*nrm[i] + nrm[i+1]*nrm[i+1] + nrm[i+2]*nrm[i+2])))
		if l > 0 {
			nrm[i], nrm[i+1], nrm[i+2] = nrm[i]/l, nrm[i+1]/l, nrm[i+2]/l
		} else {
			nrm[i+1] = 1
		}
	}
	idx := make([]uint32, 0, len(tris)*3)
	for _, t := range tris {
		idx = append(idx, uint32(t[0]), uint32(t[1]), uint32(t[2]))
	}
	b, err := greyGLB(pos, nrm, idx)
	if err != nil {
		return nil, err
	}
	if os.MkdirAll(filepath.Dir(cache), 0o755) == nil {
		_ = os.WriteFile(cache, b, 0o644)
	}
	return b, nil
}

// greyGLB: one mesh in a plain grey like a print before it's painted.
func greyGLB(pos, nrm []float32, idx []uint32) ([]byte, error) {
	if len(idx) == 0 {
		return nil, errors.New("the print has no triangles")
	}
	var bin bytes.Buffer
	binary.Write(&bin, binary.LittleEndian, pos)
	binary.Write(&bin, binary.LittleEndian, nrm)
	binary.Write(&bin, binary.LittleEndian, idx)
	lo := []float32{math.MaxFloat32, math.MaxFloat32, math.MaxFloat32}
	hi := []float32{-math.MaxFloat32, -math.MaxFloat32, -math.MaxFloat32}
	for i := 0; i < len(pos); i += 3 {
		for k := 0; k < 3; k++ {
			lo[k], hi[k] = min(lo[k], pos[i+k]), max(hi[k], pos[i+k])
		}
	}
	nv, pl := len(pos)/3, len(pos)*4
	doc := map[string]any{
		"asset":     map[string]any{"version": "2.0", "generator": appTitle + " print preview"},
		"scene":     0,
		"scenes":    []any{map[string]any{"nodes": []int{0}}},
		"nodes":     []any{map[string]any{"mesh": 0}},
		"meshes":    []any{map[string]any{"primitives": []any{map[string]any{"attributes": map[string]int{"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}}}},
		"materials": []any{map[string]any{"name": "Print grey", "pbrMetallicRoughness": map[string]any{"baseColorFactor": []float32{0.62, 0.63, 0.65, 1}, "metallicFactor": 0, "roughnessFactor": 0.6}}},
		"buffers":   []any{map[string]any{"byteLength": bin.Len()}},
		"bufferViews": []any{
			map[string]any{"buffer": 0, "byteOffset": 0, "byteLength": pl, "target": 34962},
			map[string]any{"buffer": 0, "byteOffset": pl, "byteLength": pl, "target": 34962},
			map[string]any{"buffer": 0, "byteOffset": 2 * pl, "byteLength": len(idx) * 4, "target": 34963},
		},
		"accessors": []any{
			map[string]any{"bufferView": 0, "componentType": 5126, "count": nv, "type": "VEC3", "min": lo, "max": hi},
			map[string]any{"bufferView": 1, "componentType": 5126, "count": nv, "type": "VEC3"},
			map[string]any{"bufferView": 2, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
		},
	}
	js, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	for len(js)%4 != 0 {
		js = append(js, ' ')
	}
	for bin.Len()%4 != 0 {
		bin.WriteByte(0)
	}
	var out bytes.Buffer
	total := 12 + 8 + len(js) + 8 + bin.Len()
	binary.Write(&out, binary.LittleEndian, []uint32{0x46546C67, 2, uint32(total), uint32(len(js)), 0x4E4F534A})
	out.Write(js)
	binary.Write(&out, binary.LittleEndian, []uint32{uint32(bin.Len()), 0x004E4942})
	out.Write(bin.Bytes())
	return out.Bytes(), nil
}
