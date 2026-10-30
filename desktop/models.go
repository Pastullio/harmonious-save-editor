package main

// Real ship and multi-tool models, read from the owner's own game files and turned into a plain
// triangle mesh for the page to draw. Nothing from the game is bundled.
//
// A model is a scene tree (SCENE.MBIN). Mesh nodes point at vertex and index streams in the matching
// GEOMETRY.DATA.MBIN.PC; REFERENCE nodes pull in other scenes (a cockpit, a set of wings). Procedural
// models offer alternatives as sibling nodes named "_Group_Option" (_Cockpit_A, _Cockpit_B, ...); exactly
// one option per group is drawn. Which option the game picks for a given seed is decided by game code
// that isn't in the files, so the page either lets the owner choose or picks a stable guess from the seed.

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"math"
	"net/http"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// ------------------------------------------------------------------ the game's archives, opened once

var (
	gameMu    sync.Mutex
	gamePakAt string
	gamePaks  []*hgpak
)

func openGamePaks() ([]*hgpak, error) {
	gameMu.Lock()
	defer gameMu.Unlock()
	banks := gameBanks()
	if banks == "" {
		return nil, errors.New("No Man's Sky wasn't found")
	}
	if banks == gamePakAt && gamePaks != nil {
		return gamePaks, nil
	}
	for _, p := range gamePaks {
		p.Close()
	}
	gamePaks, gamePakAt = nil, banks
	names, _ := filepath.Glob(filepath.Join(banks, "*.pak"))
	sort.Strings(names)
	for _, n := range names {
		if p, err := openPak(n); err == nil {
			gamePaks = append(gamePaks, p)
		}
	}
	if len(gamePaks) == 0 {
		return nil, errors.New("the game's archives couldn't be read")
	}
	return gamePaks, nil
}

func gameFile(path string) ([]byte, error) {
	paks, err := openGamePaks()
	if err != nil {
		return nil, err
	}
	path = normGamePath(path)
	for _, p := range paks {
		if p.Has(path) {
			return p.Read(path)
		}
	}
	return nil, fmt.Errorf("%s isn't in the game's archives", path)
}

func normGamePath(p string) string { return strings.ToLower(strings.ReplaceAll(p, `\`, "/")) }

// ------------------------------------------------------------------ scenes

type sceneNode struct {
	Name, Type string
	T          [9]float32 // rotation (degrees), scale, translation
	Attrs      map[string]string
	Kids       []*sceneNode
}

var (
	sceneMu    sync.Mutex
	sceneCache = map[string]*sceneNode{}
	geomCache  = map[string]*geomStreams{}
)

func loadScene(path string) (*sceneNode, error) {
	path = normGamePath(path)
	sceneMu.Lock()
	if s, ok := sceneCache[path]; ok {
		sceneMu.Unlock()
		return s, nil
	}
	sceneMu.Unlock()
	raw, err := gameFile(path)
	if err != nil {
		return nil, err
	}
	m, err := openMbin(raw, 0xAD96A863591F02D8, filepath.Base(path))
	if err != nil {
		return nil, err
	}
	var walk func(p, depth int) *sceneNode
	walk = func(p, depth int) *sceneNode {
		n := &sceneNode{Name: m.vstr(p + 0x30), Type: m.fstr(p+0x40, 0x10), Attrs: map[string]string{}}
		for i := 0; i < 9; i++ {
			n.T[i] = math.Float32frombits(uint32(m.i32(p + 0x50 + 4*i)))
		}
		a, c := m.list(p)
		for i := 0; i < c; i++ {
			e := a + i*0x20
			n.Attrs[m.fstr(e, 0x10)] = m.vstr(e + 0x10)
		}
		if depth < 64 {
			a, c = m.list(p + 0x10)
			for i := 0; i < c; i++ {
				n.Kids = append(n.Kids, walk(a+i*0x80, depth+1))
			}
		}
		return n
	}
	root := walk(0x20, 0)
	sceneMu.Lock()
	sceneCache[path] = root
	sceneMu.Unlock()
	return root, nil
}

type meshStream struct {
	pos []float32 // x, y, z per vertex
	idx []uint32
}

type geomStreams struct{ byName, byHash map[string]*meshStream }

// loadGeometry reads every mesh stream of a model's GEOMETRY.DATA.MBIN.PC.
func loadGeometry(geomPath string) (*geomStreams, error) {
	base := strings.TrimSuffix(normGamePath(geomPath), ".pc")
	base = strings.TrimSuffix(base, ".geometry.mbin")
	sceneMu.Lock()
	if g, ok := geomCache[base]; ok {
		sceneMu.Unlock()
		return g, nil
	}
	sceneMu.Unlock()
	head, err := gameFile(base + ".geometry.mbin.pc")
	if err != nil {
		return nil, err
	}
	hm, err := openMbin(head, 0xDA1F6CA99ADEF6A6, filepath.Base(base)+".geometry")
	if err != nil {
		return nil, err
	}
	stride := int(hm.i32(0x20 + 0x1C))
	if stride < 8 {
		stride = 16
	}
	raw, err := gameFile(base + ".geometry.data.mbin.pc")
	if err != nil {
		return nil, err
	}
	m, err := openMbin(raw, 0xCCB46895A8B36313, filepath.Base(base)+".geometry.data")
	if err != nil {
		return nil, err
	}
	g := &geomStreams{byName: map[string]*meshStream{}, byHash: map[string]*meshStream{}}
	a, n := m.list(0x20)
	for i := 0; i < n; i++ {
		e := a + i*0x48
		da, _ := m.list(e + 0x10)
		pa, _ := m.list(e + 0x20)
		hash := binary.LittleEndian.Uint64(m.d[e+0x30:])
		isz, vsz, psz := int(m.i32(e+0x38)), int(m.i32(e+0x3C)), int(m.i32(e+0x40))
		if !m.ok(pa, psz) || !m.ok(da, vsz+isz) || stride <= 0 {
			continue
		}
		s := &meshStream{}
		nv := psz / stride
		s.pos = make([]float32, 0, nv*3)
		for v := 0; v < nv; v++ {
			o := pa + v*stride
			for c := 0; c < 3; c++ {
				s.pos = append(s.pos, half(binary.LittleEndian.Uint16(m.d[o+2*c:])))
			}
		}
		ib := m.d[da+vsz : da+vsz+isz]
		// The width is per mesh: 16-bit whenever the mesh fits, even in files whose header says 32
		// (checked on every fighter, multi-tool, freighter and exocraft mesh).
		if nv <= 65536 {
			for k := 0; k+1 < len(ib); k += 2 {
				s.idx = append(s.idx, uint32(binary.LittleEndian.Uint16(ib[k:])))
			}
		} else {
			for k := 0; k+3 < len(ib); k += 4 {
				s.idx = append(s.idx, binary.LittleEndian.Uint32(ib[k:]))
			}
		}
		g.byName[strings.ToUpper(m.vstr(e))] = s
		g.byHash[strconv.FormatUint(hash, 10)] = s
	}
	sceneMu.Lock()
	geomCache[base] = g
	sceneMu.Unlock()
	return g, nil
}

func half(h uint16) float32 {
	sign := uint32(h>>15) << 31
	exp := int(h>>10) & 0x1F
	frac := uint32(h & 0x3FF)
	switch exp {
	case 0:
		if frac == 0 {
			return math.Float32frombits(sign)
		}
		f := float32(frac) / 1024 * float32(math.Pow(2, -14))
		if sign != 0 {
			return -f
		}
		return f
	case 31:
		return math.Float32frombits(sign | 0x7F800000 | frac<<13)
	}
	return math.Float32frombits(sign | uint32(exp-15+127)<<23 | frac<<13)
}

// ------------------------------------------------------------------ choices

var lodRe = regexp.MustCompile(`(?i)LOD(\d)`)

// optionOf splits "_B3Top_6xRARE" into group "_B3Top" and option "6"; mesh pieces named
// "_Mag1Clip_1Shape" or "_LSA1W_Shape2" belong to option 1 and 2.
func optionGroup(name string) string { g, _ := optionOf(name); return g }

func optionOf(name string) (string, string) {
	if lodRe.MatchString(name) { // "_NoseA_BaseLOD0": a level of detail, not a choice
		return "", ""
	}
	n := strings.ReplaceAll(name, "xRARE", "")
	i := strings.LastIndex(n, "_")
	if i <= 0 {
		return n, ""
	}
	g, tok := n[:i], n[i+1:]
	switch {
	case strings.HasPrefix(tok, "Shape"):
		tok = tok[5:]
	case strings.HasSuffix(tok, "Shape"):
		tok = strings.TrimSuffix(tok, "Shape")
	}
	return g, tok
}

// effect meshes (engine glow, lights, shadow planes, decals, pulses) draw as solid slabs in a hologram
var effectMaterialRe = regexp.MustCompile(`SHADOW|HOVER_ENGINE|RADIALPULSE|GLOW|LIGHT|DECAL|SCROLLINGBAR|ENTRANCEMARKER|FLAME|BEAM`)

func skipMaterial(m string) bool {
	if i := strings.LastIndexAny(m, `\/`); i >= 0 {
		m = m[i+1:]
	}
	return effectMaterialRe.MatchString(strings.ToUpper(m))
}

func skipReference(path string) bool {
	p := strings.ToUpper(strings.ReplaceAll(path, `\`, "/"))
	return strings.Contains(p, "INTERIOR") || strings.Contains(p, "FLAME") || strings.Contains(p, "SHIELD") ||
		strings.Contains(p, "/EFFECTS/") || strings.Contains(p, "/DECALS/") || strings.Contains(p, "/ANIMS/") || strings.Contains(p, `\ANIMS\`)
}

type partGroup struct {
	Group   string       `json:"group"`
	Options []partOption `json:"options"`
}
type partOption struct {
	ID     string      `json:"id"`
	Groups []partGroup `json:"groups,omitempty"`
}

// groupsUnder lists the choices found below a node: in its own children, inside referenced scenes,
// and nested inside each option.
func groupsUnder(n *sceneNode, depth int) []partGroup {
	if depth > 12 {
		return nil
	}
	var out []partGroup
	var order []string
	byGroup := map[string]map[string][]*sceneNode{}
	for _, k := range n.Kids {
		if g, _ := optionOf(k.Name); strings.HasPrefix(k.Name, "_") && g != "" {
			g, o := optionOf(k.Name)
			if byGroup[g] == nil {
				byGroup[g] = map[string][]*sceneNode{}
				order = append(order, g)
			}
			byGroup[g][o] = append(byGroup[g][o], k)
		} else {
			out = append(out, groupsUnder(k, depth+1)...)
		}
	}
	if n.Type == "REFERENCE" && !skipReference(n.Attrs["SCENEGRAPH"]) {
		if s, err := loadScene(n.Attrs["SCENEGRAPH"]); err == nil {
			out = append(out, groupsUnder(s, depth+1)...)
		}
	}
	for _, g := range order {
		pg := partGroup{Group: g}
		ids := make([]string, 0, len(byGroup[g]))
		for o := range byGroup[g] {
			ids = append(ids, o)
		}
		sort.Strings(ids)
		for _, o := range ids {
			opt := partOption{ID: o}
			for _, k := range byGroup[g][o] {
				opt.Groups = append(opt.Groups, groupsUnder(k, depth+1)...)
			}
			pg.Options = append(pg.Options, opt)
		}
		out = append(out, pg)
	}
	return out
}

// pickFor returns the chosen option of a group: the owner's pick, or a stable guess from the seed.
func pickFor(group string, opts []string, picks map[string]string, seed string) string {
	// a group name can repeat at different depths (the multi-tool's _MultiTool holds another _MultiTool), so a pick
	// may hold one choice per depth, joined with "|": the one that's an option here applies
	if p, ok := picks[group]; ok {
		for _, want := range strings.Split(p, "|") {
			for _, o := range opts {
				if o == want {
					return want
				}
			}
		}
	}
	h := fnv.New32a()
	h.Write([]byte(seed + "|" + group))
	return opts[int(h.Sum32()%uint32(len(opts)))]
}

// ------------------------------------------------------------------ building a mesh

type mat4 [16]float64

func matMul(a, b mat4) mat4 {
	var r mat4
	for i := 0; i < 4; i++ {
		for j := 0; j < 4; j++ {
			for k := 0; k < 4; k++ {
				r[i*4+j] += a[i*4+k] * b[k*4+j]
			}
		}
	}
	return r
}

func identity() mat4 { return mat4{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1} }

func transformOf(t [9]float32) mat4 {
	rx, ry, rz := float64(t[0])*math.Pi/180, float64(t[1])*math.Pi/180, float64(t[2])*math.Pi/180
	cx, sx, cy, sy, cz, sz := math.Cos(rx), math.Sin(rx), math.Cos(ry), math.Sin(ry), math.Cos(rz), math.Sin(rz)
	// R = Rz * Ry * Rx, then scale
	r := [9]float64{
		cz * cy, cz*sy*sx - sz*cx, cz*sy*cx + sz*sx,
		sz * cy, sz*sy*sx + cz*cx, sz*sy*cx - cz*sx,
		-sy, cy * sx, cy * cx,
	}
	s := [3]float64{float64(t[3]), float64(t[4]), float64(t[5])}
	for i, v := range s {
		if v == 0 {
			s[i] = 1
		}
	}
	return mat4{
		r[0] * s[0], r[1] * s[1], r[2] * s[2], float64(t[6]),
		r[3] * s[0], r[4] * s[1], r[5] * s[2], float64(t[7]),
		r[6] * s[0], r[7] * s[1], r[8] * s[2], float64(t[8]),
		0, 0, 0, 1,
	}
}

type meshOut struct {
	pos []float32
	idx []uint32
	// only: when set, just the geometry under the chosen option of this group (a part's thumbnail)
	only      string
	onlyDepth int // which of the same-named groups along the path (1 = the outermost)
	inside    int
}

func (o *meshOut) add(s *meshStream, m mat4) {
	base := uint32(len(o.pos) / 3)
	for v := 0; v+2 < len(s.pos); v += 3 {
		x, y, z := float64(s.pos[v]), float64(s.pos[v+1]), float64(s.pos[v+2])
		o.pos = append(o.pos,
			float32(m[0]*x+m[1]*y+m[2]*z+m[3]),
			float32(m[4]*x+m[5]*y+m[6]*z+m[7]),
			float32(m[8]*x+m[9]*y+m[10]*z+m[11]))
	}
	nv := uint32(len(s.pos) / 3)
	for k := 0; k+2 < len(s.idx); k += 3 {
		a, b, c := s.idx[k], s.idx[k+1], s.idx[k+2]
		if a < nv && b < nv && c < nv {
			o.idx = append(o.idx, base+a, base+b, base+c)
		}
	}
}

func buildMesh(scenePath string, picks map[string]string, seed string, lod int, out *meshOut, parent mat4, depth int) error {
	if depth > 12 {
		return nil
	}
	root, err := loadScene(scenePath)
	if err != nil {
		return err
	}
	var geo *geomStreams
	// Meshes under a JOINT are skinned: their vertices are already in the model's space (their
	// AABB attributes say so), so they take the transform from above the skeleton, not the joints'.
	var walk func(n *sceneNode, m mat4, bind *mat4)
	walk = func(n *sceneNode, m mat4, bind *mat4) {
		if n.Type == "JOINT" && bind == nil {
			b := m
			bind = &b
		}
		m = matMul(m, transformOf(n.T))
		switch n.Type {
		case "MODEL":
			if g := n.Attrs["GEOMETRY"]; g != "" && geo == nil {
				geo, _ = loadGeometry(g)
			}
		case "COLLISION", "LIGHT":
			return
		case "MESH":
			if geo != nil {
				s := geo.byName[strings.ToUpper(n.Name)]
				if s == nil {
					s = geo.byHash[n.Attrs["HASH"]]
				}
				if s != nil && !skipMaterial(n.Attrs["MATERIAL"]) && (out.only == "" || out.inside >= out.onlyDepth) {
					if bind != nil {
						out.add(s, *bind)
					} else {
						out.add(s, m)
					}
				}
			}
		case "REFERENCE":
			if ref := n.Attrs["SCENEGRAPH"]; ref != "" && !skipReference(ref) {
				_ = buildMesh(ref, picks, seed, lod, out, m, depth+1)
			}
		}
		// pick one option per group, and one level of detail per mesh family
		opts := map[string][]string{}
		for _, k := range n.Kids {
			if g, _ := optionOf(k.Name); strings.HasPrefix(k.Name, "_") && g != "" {
				g, o := optionOf(k.Name)
				found := false
				for _, x := range opts[g] {
					found = found || x == o
				}
				if !found {
					opts[g] = append(opts[g], o)
				}
			}
		}
		chosen := map[string]string{}
		for g, o := range opts {
			sort.Strings(o)
			chosen[g] = pickFor(g, o, picks, seed)
		}
		maxLod := map[string]int{}
		for _, k := range n.Kids {
			if k.Type == "MESH" {
				if mm := lodRe.FindStringSubmatch(k.Name); mm != nil {
					fam := lodRe.ReplaceAllString(k.Name, "")
					if d := int(mm[1][0] - '0'); d > maxLod[fam] {
						maxLod[fam] = d
					}
				}
			}
		}
		for _, k := range n.Kids {
			if g, o := optionOf(k.Name); strings.HasPrefix(k.Name, "_") && g != "" && chosen[g] != o {
				continue
			}
			if k.Type == "MESH" {
				if mm := lodRe.FindStringSubmatch(k.Name); mm != nil {
					want := lod
					if ml := maxLod[lodRe.ReplaceAllString(k.Name, "")]; want > ml {
						want = ml
					}
					if int(mm[1][0]-'0') != want {
						continue
					}
				}
			}
			in := out.only != "" && strings.HasPrefix(k.Name, "_") && optionGroup(k.Name) == out.only
			if in {
				out.inside++
			}
			walk(k, m, bind)
			if in {
				out.inside--
			}
		}
	}
	walk(root, parent, nil)
	return nil
}

// ------------------------------------------------------------------ handlers

var scenePathRe = regexp.MustCompile(`^models/[a-z0-9_/\-.]+\.scene\.mbin$`)

func sceneParam(r *http.Request) (string, error) {
	p := normGamePath(r.URL.Query().Get("scene"))
	if !scenePathRe.MatchString(p) || strings.Contains(p, "..") {
		return "", errors.New("not a model path")
	}
	return p, nil
}

// GET /api/model/parts?scene=… : the choices a model offers, as a tree.
func handleModelParts(w http.ResponseWriter, r *http.Request) {
	p, err := sceneParam(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	root, err := loadScene(p)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	groups := groupsUnder(root, 0)
	if groups == nil {
		groups = []partGroup{}
	}
	writeJSON(w, map[string]any{"scene": p, "groups": groups})
}

// GET /api/model/mesh?scene=…&seed=…&lod=…&picks={json} : the model as one triangle mesh.
// Binary: "HSEM", u32 vertex count, u32 index count, float32 xyz per vertex, uint32 indices.
func handleModelMesh(w http.ResponseWriter, r *http.Request) {
	p, err := sceneParam(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	picks := map[string]string{}
	if s := r.URL.Query().Get("picks"); s != "" {
		_ = json.Unmarshal([]byte(s), &picks)
	}
	lod, _ := strconv.Atoi(r.URL.Query().Get("lod"))
	out := &meshOut{only: r.URL.Query().Get("only"), onlyDepth: 1}
	if d, err := strconv.Atoi(r.URL.Query().Get("depth")); err == nil && d > 1 {
		out.onlyDepth = d
	}
	if err := buildMesh(p, picks, r.URL.Query().Get("seed"), lod, out, identity(), 0); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	if len(out.idx) == 0 {
		http.Error(w, "the model has no geometry", http.StatusNotFound)
		return
	}
	buf := make([]byte, 12+4*len(out.pos)+4*len(out.idx))
	copy(buf, "HSEM")
	binary.LittleEndian.PutUint32(buf[4:], uint32(len(out.pos)/3))
	binary.LittleEndian.PutUint32(buf[8:], uint32(len(out.idx)))
	o := 12
	for _, f := range out.pos {
		binary.LittleEndian.PutUint32(buf[o:], math.Float32bits(f))
		o += 4
	}
	for _, i := range out.idx {
		binary.LittleEndian.PutUint32(buf[o:], i)
		o += 4
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Write(buf)
}
