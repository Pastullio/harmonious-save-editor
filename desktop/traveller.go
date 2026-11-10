package main

// Your traveller (owner, 2026-11-10: "import their character's model into Blender to pose them"). The save lists the
// player's look as descriptor groups (CharacterCustomisationData[0].CustomData.DescriptorGroups: ^HEAD_ASTBOT2,
// ^TORSO_VYK…); the game's descriptor group table turns each into the option nodes of the player character scene
// (^TORSO_VYK -> _Torso_Vykeen, _VykNeck_XV…), which buildMesh picks the way it does a companion's Descriptors.
//
//   metadata/gamestate/playerdata/charactercustomisationdescriptorgroupsdata.mbin  GcCustomisationDescriptorGroups,
//     template 0x6E1D4A06924711BB: DescriptorGroupSets at 0x30 (0x38-byte sets, DescriptorGroups at 0x00), each
//     group 0x108 bytes: Descriptors (0x20-byte names) at 0x40, GroupID at 0x50. Checked 2026-11-10 on the owner's
//     table: 63 sets, 1002 groups.
//
// The .glb export carries the skeleton: the scene's JOINT nodes (287 in the player character) as glTF nodes, with
// inverse bind matrices from their rest pose, and each skinned mesh's 4 bone slots per vertex (blend indices and
// weights in the vertex stream) mapped through the geometry's SkinMatrixLayout from the mesh's FIRSTSKINMAT. Meshes
// under a JOINT are already in model space at the rest pose, so the rest pose is the bind pose. Blender imports it
// with File > Import > glTF, bones ready to pose.

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"math"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const travellerScene = "models/common/player/playercharacter/playercharacter.scene.mbin"

var (
	descGroupsOnce sync.Once
	descGroups     map[string][]string
	descGroupsErr  error
)

// travellerGroups: group ID (no ^) -> the option node names it stands for.
func travellerGroups() (map[string][]string, error) {
	descGroupsOnce.Do(func() {
		t := findGameFile("/charactercustomisationdescriptorgroupsdata.mbin")
		if t == "" {
			descGroupsErr = fmt.Errorf("the game's character customisation table wasn't found")
			return
		}
		raw, err := gameFile(t)
		if err != nil {
			descGroupsErr = err
			return
		}
		descGroups, descGroupsErr = parseDescriptorGroups(raw)
	})
	return descGroups, descGroupsErr
}

func parseDescriptorGroups(raw []byte) (map[string][]string, error) {
	m, err := openMbin(raw, 0x6E1D4A06924711BB, "charactercustomisationdescriptorgroupsdata.mbin")
	if err != nil {
		return nil, err
	}
	out := map[string][]string{}
	sa, sn := m.list(0x20 + 0x30)
	for i := 0; i < sn; i++ {
		set := sa + i*0x38
		if !m.ok(set, 0x38) {
			break
		}
		ga, gn := m.list(set)
		for j := 0; j < gn; j++ {
			g := ga + j*0x108
			if !m.ok(g, 0x108) {
				break
			}
			id := m.fstr(g+0x50, 0x10)
			da, dn := m.list(g + 0x40)
			var names []string
			for k := 0; k < dn; k++ {
				if d := m.fstr(da+k*0x20, 0x20); d != "" {
					names = append(names, d)
				}
			}
			if id != "" {
				out[strings.ToUpper(id)] = names
			}
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("the character customisation table has no groups")
	}
	return out, nil
}

// travellerNames turns the save's descriptor groups into option node names; unknown groups are returned too.
func travellerNames(groups []string) (names, missing []string, err error) {
	names, missing = []string{}, []string{}
	tab, err := travellerGroups()
	if err != nil {
		return nil, nil, err
	}
	for _, g := range groups {
		id := strings.ToUpper(strings.TrimPrefix(strings.TrimSpace(g), "^"))
		if id == "" {
			continue
		}
		if ns, ok := tab[id]; ok {
			names = append(names, ns...)
		} else {
			missing = append(missing, id)
		}
	}
	return names, missing, nil
}

func travellerGroupsParam(r *http.Request) []string {
	var gs []string
	for _, g := range strings.Split(r.URL.Query().Get("groups"), ",") {
		if g = strings.TrimSpace(g); g != "" {
			gs = append(gs, g)
		}
	}
	return gs
}

// GET /api/model/traveller?groups=^HEAD_ASTBOT2,^TORSO_VYK,…  -> {scene, names, missing}; the page draws it with
// /api/model/mesh?scene=…&picks={"_names": names joined with "|"}.
func handleTraveller(w http.ResponseWriter, r *http.Request) {
	names, missing, err := travellerNames(travellerGroupsParam(r))
	if err != nil {
		writeJSON(w, map[string]any{"error": err.Error()})
		return
	}
	if _, err := loadScene(travellerScene); err != nil {
		writeJSON(w, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"scene": travellerScene, "names": names, "missing": missing})
}

// The open save's traveller, for the Blender add-on's "Import my traveller" (it may fetch it with the live token):
// the page POSTs {groups, name} when a save opens, the add-on GETs the .glb.
var trav struct {
	sync.Mutex
	groups []string
	name   string
	look   string // the save's colours and texture choices (travLook as JSON)
	tools  []toolRef
}

// the save's multi-tools, for the add-on's "Hold a multi-tool"
type toolRef struct {
	Name  string          `json:"name"`
	Scene string          `json:"scene"`
	Seed  string          `json:"seed"`
	Picks json.RawMessage `json:"picks"`
}

func toolNames() []string {
	out := []string{}
	for _, t := range trav.tools {
		out = append(out, t.Name)
	}
	return out
}

// GET /api/live/tool?i=N (the add-on, with the live token) -> that multi-tool as a textured .glb
func handleLiveTool(w http.ResponseWriter, r *http.Request) {
	i, err := strconv.Atoi(r.URL.Query().Get("i"))
	trav.Lock()
	var t toolRef
	ok := err == nil && i >= 0 && i < len(trav.tools)
	if ok {
		t = trav.tools[i]
	}
	trav.Unlock()
	if !ok {
		http.Error(w, "Open a save in Harmonious Save Editor first.", http.StatusNotFound)
		return
	}
	sc := normGamePath(t.Scene)
	if !scenePathRe.MatchString(sc) || strings.Contains(sc, "..") {
		http.Error(w, "not a model path", http.StatusBadRequest)
		return
	}
	trav.Lock()
	groups := trav.groups
	trav.Unlock()
	var place *mat4
	if names, _, err := travellerNames(groups); err == nil {
		if m, ok := travellerSocket(names, "r_hand_socket_Aux"); ok {
			place = &m
		}
	}
	glb, err := modelGLB(sc, t.Seed, string(t.Picks), "", t.Name, place)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "model/gltf-binary")
	w.Write(glb)
}

func handleLiveTraveller(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var v struct {
			Groups []string        `json:"groups"`
			Name   string          `json:"name"`
			Look   json.RawMessage `json:"look"`
			Tools  []toolRef       `json:"tools"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&v); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		trav.Lock()
		trav.groups, trav.name, trav.look, trav.tools = v.Groups, strings.TrimSpace(v.Name), string(v.Look), v.Tools
		trav.Unlock()
		writeJSON(w, map[string]any{"ok": true})
		return
	}
	trav.Lock()
	groups, name, look := trav.groups, trav.name, trav.look
	trav.Unlock()
	if len(groups) == 0 {
		http.Error(w, "Open a save in Harmonious Save Editor first.", http.StatusNotFound)
		return
	}
	names, _, err := travellerNames(groups)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	if name == "" {
		name = "Traveller"
	}
	glb, err := travellerGLB(names, name, r.URL.Query().Get("textures") != "0", parseLook(look))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "model/gltf-binary")
	w.Header().Set("X-Traveller", safeFileName(name))
	w.Write(glb)
}

// GET /api/model/traveller/glb?groups=…&name=Pastullio -> the rigged model as a binary glTF.
func handleTravellerGLB(w http.ResponseWriter, r *http.Request) {
	names, _, err := travellerNames(travellerGroupsParam(r))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" {
		name = "Traveller"
	}
	glb, err := travellerGLB(names, name, r.URL.Query().Get("textures") != "0", parseLook(r.URL.Query().Get("look")))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "model/gltf-binary")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", safeFileName(name)+".glb"))
	w.Write(glb)
}

func safeFileName(s string) string {
	s = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`<>:"/\|?*`, r) || r < 32 {
			return '_'
		}
		return r
	}, s)
	if s == "" {
		return "Traveller"
	}
	return s
}

type tJoint struct {
	name   string
	index  int // JOINTINDEX
	parent int // index into the joint list, -1 for a root
	world  mat4
	local  mat4
}

// travellerJoints walks the scene's skeleton: every JOINT with its world (model space) and local transforms.
func travellerJoints(root *sceneNode) []tJoint {
	var js []tJoint
	var walk func(n *sceneNode, m mat4, parent int)
	walk = func(n *sceneNode, m mat4, parent int) {
		m = matMul(m, transformOf(n.T))
		if n.Type == "JOINT" {
			idx := -1
			fmt.Sscan(n.Attrs["JOINTINDEX"], &idx)
			j := tJoint{name: n.Name, index: idx, parent: parent, world: m}
			if parent >= 0 {
				j.local = matMul(invert(js[parent].world), m)
			} else {
				j.local = m
			}
			js = append(js, j)
			parent = len(js) - 1
		}
		for _, k := range n.Kids {
			walk(k, m, parent)
		}
	}
	walk(root, identity(), -1)
	return js
}

// bindPose puts each joint where the mesh was bound to it. The scene's own joint transforms
// don't match the geometry (the hips came out 0.24 m apart vertically), but the geometry's
// inverse bind matrices do: stored column-major, so transpose, then invert for the joint's world.
// Locals are rebuilt from the new worlds; a joint without a binding keeps its scene placement
// relative to its (corrected) parent.
func bindPose(js []tJoint, ibm [][16]float32) {
	for i := range js {
		j := &js[i]
		old := j.local
		if j.index >= 0 && j.index < len(ibm) {
			var m mat4
			for r := 0; r < 4; r++ {
				for c := 0; c < 4; c++ {
					m[r*4+c] = float64(ibm[j.index][c*4+r])
				}
			}
			j.world = invert(m)
		} else if j.parent >= 0 {
			j.world = matMul(js[j.parent].world, old)
		}
		if j.parent >= 0 {
			j.local = matMul(invert(js[j.parent].world), j.world)
		} else {
			j.local = j.world
		}
	}
}

// travellerSocket: where a joint (the right hand's weapon socket) sits on this traveller at rest, in model space.
func travellerSocket(names []string, joint string) (mat4, bool) {
	root, err := loadScene(travellerScene)
	if err != nil {
		return mat4{}, false
	}
	out := &meshOut{onlyDepth: 1, collect: true}
	if buildMesh(travellerScene, map[string]string{"_names": strings.Join(names, "|")}, "", 0, out, identity(), 0) != nil {
		return mat4{}, false
	}
	joints := travellerJoints(root)
	for _, p := range out.parts {
		if p.skinned && p.geo != nil && len(p.geo.invBind) > 0 {
			bindPose(joints, p.geo.invBind)
			break
		}
	}
	for _, j := range joints {
		if strings.Contains(j.name, joint) {
			return j.world, true
		}
	}
	return mat4{}, false
}

func travellerGLB(names []string, name string, textures bool, look *travLook) ([]byte, error) {
	root, err := loadScene(travellerScene)
	if err != nil {
		return nil, err
	}
	out := &meshOut{onlyDepth: 1, collect: true}
	if err := buildMesh(travellerScene, map[string]string{"_names": strings.Join(names, "|")}, "", 0, out, identity(), 0); err != nil {
		return nil, err
	}
	if len(out.parts) == 0 {
		return nil, fmt.Errorf("the traveller has no geometry")
	}
	joints := travellerJoints(root)
	for _, p := range out.parts {
		if p.skinned && p.geo != nil && len(p.geo.invBind) > 0 {
			bindPose(joints, p.geo.invBind)
			break
		}
	}
	byIndex := map[int]int{}
	for i, j := range joints {
		if j.index >= 0 {
			byIndex[j.index] = i
		}
	}
	return writeGLB(name, out.parts, joints, byIndex, textures, look)
}

// ------------------------------------------------------------------ glTF

type glbBuf struct{ b bytes.Buffer }

func (g *glbBuf) align() {
	for g.b.Len()%4 != 0 {
		g.b.WriteByte(0)
	}
}

type prim struct {
	material string
	matPath  string // the game material, for its textures
	pos, nrm []float32
	uv       []float32
	joints   []uint16
	weights  []float32
	idx      []uint32
}

func writeGLB(name string, parts []meshPart, joints []tJoint, byIndex map[int]int, withTextures bool, look *travLook) ([]byte, error) {
	static := len(joints) == 0
	// one primitive per material
	prims := map[string]*prim{}
	var order []string
	for _, p := range parts {
		mat := strings.TrimSuffix(path.Base(strings.ToLower(strings.ReplaceAll(p.material, "\\", "/"))), ".material.mbin")
		if mat == "" || mat == "." {
			mat = "default"
		}
		pr := prims[mat]
		if pr == nil {
			pr = &prim{material: mat, matPath: p.material}
			prims[mat] = pr
			order = append(order, mat)
		}
		s := p.s
		nv := len(s.pos) / 3
		base := uint32(len(pr.pos) / 3)
		m := p.m
		for v := 0; v < nv; v++ {
			x, y, z := float64(s.pos[v*3]), float64(s.pos[v*3+1]), float64(s.pos[v*3+2])
			pr.pos = append(pr.pos, float32(m[0]*x+m[1]*y+m[2]*z+m[3]), float32(m[4]*x+m[5]*y+m[6]*z+m[7]), float32(m[8]*x+m[9]*y+m[10]*z+m[11]))
			if len(s.uv) >= (v+1)*2 {
				pr.uv = append(pr.uv, s.uv[v*2], s.uv[v*2+1])
			} else {
				pr.uv = append(pr.uv, 0, 0)
			}
			var jj [4]uint16
			var ww [4]float32
			if p.skinned && len(s.bones) >= (v+1)*4 && p.geo != nil {
				sum := float32(0)
				for c := 0; c < 4; c++ {
					w := s.weights[v*4+c]
					slot := p.firstSkin + int(s.bones[v*4+c])
					if w <= 0 || slot < 0 || slot >= len(p.geo.skinLayout) {
						continue
					}
					ji, ok := byIndex[int(p.geo.skinLayout[slot])]
					if !ok {
						continue
					}
					jj[c], ww[c] = uint16(ji), w
					sum += w
				}
				if sum > 0 {
					for c := range ww {
						ww[c] /= sum
					}
				} else {
					ww[0] = 1
				}
			} else {
				ww[0] = 1 // a rigid piece: rides on the first joint
			}
			pr.joints = append(pr.joints, jj[:]...)
			pr.weights = append(pr.weights, ww[:]...)
		}
		for k := 0; k+2 < len(s.idx); k += 3 {
			a, b, c := s.idx[k], s.idx[k+1], s.idx[k+2]
			if int(a) < nv && int(b) < nv && int(c) < nv {
				pr.idx = append(pr.idx, base+a, base+b, base+c)
			}
		}
	}

	var bin glbBuf
	type view struct {
		Buffer     int `json:"buffer"`
		ByteOffset int `json:"byteOffset"`
		ByteLength int `json:"byteLength"`
		Target     int `json:"target,omitempty"`
	}
	type accessor struct {
		BufferView    int       `json:"bufferView"`
		ComponentType int       `json:"componentType"`
		Count         int       `json:"count"`
		Type          string    `json:"type"`
		Min           []float32 `json:"min,omitempty"`
		Max           []float32 `json:"max,omitempty"`
	}
	var views []view
	var accs []accessor
	put := func(data any, target int) int {
		bin.align()
		off := bin.b.Len()
		_ = binary.Write(&bin.b, binary.LittleEndian, data)
		views = append(views, view{0, off, bin.b.Len() - off, target})
		return len(views) - 1
	}
	addAcc := func(a accessor) int { accs = append(accs, a); return len(accs) - 1 }

	type gPrim struct {
		Attributes map[string]int `json:"attributes"`
		Indices    int            `json:"indices"`
		Material   int            `json:"material"`
	}
	type gMat struct {
		Name   string         `json:"name"`
		PBR    map[string]any `json:"pbrMetallicRoughness"`
		Normal any            `json:"normalTexture,omitempty"`
	}
	type gTex struct {
		Index int `json:"index"`
	}
	var gprims []gPrim
	var mats []gMat
	// the game's textures (owner, 2026-11-10): colour, normal and roughness/metal maps per material, as JPEGs
	var images []map[string]any
	var texs []map[string]any
	texIndex := map[string]int{}
	var looks map[string]*glbLook
	if withTextures {
		looks = materialImages(order, prims, look)
	}
	texFor := func(t *glbImage) *gTex {
		if t == nil || len(t.jpeg) == 0 {
			return nil
		}
		if i, ok := texIndex[t.key]; ok {
			return &gTex{i}
		}
		bin.align()
		off := bin.b.Len()
		bin.b.Write(t.jpeg)
		views = append(views, view{0, off, len(t.jpeg), 0})
		images = append(images, map[string]any{"name": t.name, "bufferView": len(views) - 1, "mimeType": "image/jpeg"})
		texs = append(texs, map[string]any{"source": len(images) - 1, "sampler": 0})
		texIndex[t.key] = len(texs) - 1
		return &gTex{len(texs) - 1}
	}
	for _, k := range order {
		pr := prims[k]
		nv := len(pr.pos) / 3
		if nv == 0 || len(pr.idx) == 0 {
			continue
		}
		pr.nrm = vertexNormals(pr.pos, pr.idx)
		mn, mx := []float32{math.MaxFloat32, math.MaxFloat32, math.MaxFloat32}, []float32{-math.MaxFloat32, -math.MaxFloat32, -math.MaxFloat32}
		for v := 0; v < nv; v++ {
			for c := 0; c < 3; c++ {
				x := pr.pos[v*3+c]
				mn[c] = float32(math.Min(float64(mn[c]), float64(x)))
				mx[c] = float32(math.Max(float64(mx[c]), float64(x)))
			}
		}
		pa := addAcc(accessor{put(pr.pos, 34962), 5126, nv, "VEC3", mn, mx})
		na := addAcc(accessor{put(pr.nrm, 34962), 5126, nv, "VEC3", nil, nil})
		ua := addAcc(accessor{put(pr.uv, 34962), 5126, nv, "VEC2", nil, nil})
		attrs := map[string]int{}
		if !static { // a static model (a ship, a multi-tool) has no skeleton
			attrs["JOINTS_0"] = addAcc(accessor{put(pr.joints, 34962), 5123, nv, "VEC4", nil, nil})
			attrs["WEIGHTS_0"] = addAcc(accessor{put(pr.weights, 34962), 5126, nv, "VEC4", nil, nil})
		}
		ia := addAcc(accessor{put(pr.idx, 34963), 5125, len(pr.idx), "SCALAR", nil, nil})
		gm := gMat{Name: k, PBR: map[string]any{"baseColorFactor": []float32{0.55, 0.57, 0.6, 1}, "metallicFactor": 0.1, "roughnessFactor": 0.7}}
		if lk := looks[pr.matPath]; lk != nil {
			if t := texFor(lk.diffuse); t != nil {
				gm.PBR["baseColorTexture"] = t
				gm.PBR["baseColorFactor"] = []float32{1, 1, 1, 1}
			}
			if t := texFor(lk.masks); t != nil {
				gm.PBR["metallicRoughnessTexture"] = t
				gm.PBR["metallicFactor"], gm.PBR["roughnessFactor"] = 1.0, 1.0
			}
			if t := texFor(lk.normal); t != nil {
				gm.Normal = t
			}
		}
		mats = append(mats, gm)
		attrs["POSITION"], attrs["NORMAL"], attrs["TEXCOORD_0"] = pa, na, ua
		gprims = append(gprims, gPrim{attrs, ia, len(mats) - 1})
	}
	if len(gprims) == 0 {
		return nil, fmt.Errorf("the model has no geometry")
	}
	// inverse bind matrices from the rest pose (column-major)
	ibm := make([]float32, 0, 16*len(joints))
	for _, j := range joints {
		inv := invert(j.world)
		for c := 0; c < 4; c++ {
			for r := 0; r < 4; r++ {
				ibm = append(ibm, float32(inv[r*4+c]))
			}
		}
	}
	ibmAcc := -1
	if !static {
		ibmAcc = addAcc(accessor{put(ibm, 0), 5126, len(joints), "MAT4", nil, nil})
	}

	type gNode struct {
		Name     string    `json:"name"`
		Children []int     `json:"children,omitempty"`
		Matrix   []float64 `json:"matrix,omitempty"`
		Mesh     *int      `json:"mesh,omitempty"`
		Skin     *int      `json:"skin,omitempty"`
	}
	// node 0: the traveller, node 1: the mesh, nodes 2…: the joints in order
	nodes := []gNode{{Name: name, Matrix: []float64{-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1}}, {Name: name + " body"}}
	zero := 0
	nodes[1].Mesh = &zero
	if !static {
		nodes[1].Skin = &zero
	} else {
		nodes[0].Matrix = nil
	}
	nodes[0].Children = []int{1}
	jointNodes := make([]int, len(joints))
	for i, j := range joints {
		var mtx []float64
		for c := 0; c < 4; c++ {
			for r := 0; r < 4; r++ {
				mtx = append(mtx, j.local[r*4+c])
			}
		}
		nodes = append(nodes, gNode{Name: strings.TrimSuffix(strings.TrimPrefix(j.name, "player01_"), "SHJnt"), Matrix: mtx})
		jointNodes[i] = len(nodes) - 1
	}
	var skelRoots []int
	for i, j := range joints {
		if j.parent >= 0 {
			p := &nodes[jointNodes[j.parent]]
			p.Children = append(p.Children, jointNodes[i])
		} else {
			skelRoots = append(skelRoots, jointNodes[i])
		}
	}
	nodes[0].Children = append(nodes[0].Children, skelRoots...)
	skel := 0
	if len(skelRoots) > 0 {
		skel = skelRoots[0]
	}
	doc := map[string]any{
		"asset":       map[string]any{"version": "2.0", "generator": "Harmonious Save Editor " + appVersion},
		"scene":       0,
		"scenes":      []any{map[string]any{"name": name, "nodes": []int{0}}},
		"nodes":       nodes,
		"meshes":      []any{map[string]any{"name": name, "primitives": gprims}},
		"materials":   mats,
		"accessors":   accs,
		"bufferViews": views,
		"buffers":     []any{map[string]any{"byteLength": bin.b.Len()}},
	}
	if !static {
		doc["skins"] = []any{map[string]any{"name": name + " skeleton", "joints": jointNodes, "inverseBindMatrices": ibmAcc, "skeleton": skel}}
	}
	if len(images) > 0 {
		doc["images"], doc["textures"] = images, texs
		doc["samplers"] = []any{map[string]any{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}}
	}
	js, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	for len(js)%4 != 0 {
		js = append(js, ' ')
	}
	bin.align()
	var outb bytes.Buffer
	total := 12 + 8 + len(js) + 8 + bin.b.Len()
	binary.Write(&outb, binary.LittleEndian, []uint32{0x46546C67, 2, uint32(total), uint32(len(js)), 0x4E4F534A})
	outb.Write(js)
	binary.Write(&outb, binary.LittleEndian, []uint32{uint32(bin.b.Len()), 0x004E4942})
	outb.Write(bin.b.Bytes())
	return outb.Bytes(), nil
}

// vertexNormals: area-weighted smooth normals (the game's packed normals aren't read yet).
func vertexNormals(pos []float32, idx []uint32) []float32 {
	n := make([]float32, len(pos))
	for k := 0; k+2 < len(idx); k += 3 {
		a, b, c := idx[k]*3, idx[k+1]*3, idx[k+2]*3
		ux, uy, uz := pos[b]-pos[a], pos[b+1]-pos[a+1], pos[b+2]-pos[a+2]
		vx, vy, vz := pos[c]-pos[a], pos[c+1]-pos[a+1], pos[c+2]-pos[a+2]
		nx, ny, nz := uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
		for _, i := range []uint32{a, b, c} {
			n[i] += nx
			n[i+1] += ny
			n[i+2] += nz
		}
	}
	for i := 0; i+2 < len(n); i += 3 {
		l := float32(math.Sqrt(float64(n[i]*n[i] + n[i+1]*n[i+1] + n[i+2]*n[i+2])))
		if l > 0 {
			n[i], n[i+1], n[i+2] = n[i]/l, n[i+1]/l, n[i+2]/l
		} else {
			n[i+1] = 1
		}
	}
	return n
}

// invert: the inverse of a 4×4 transform (row-major), by cofactors.
func invert(m mat4) mat4 {
	var inv mat4
	inv[0] = m[5]*m[10]*m[15] - m[5]*m[11]*m[14] - m[9]*m[6]*m[15] + m[9]*m[7]*m[14] + m[13]*m[6]*m[11] - m[13]*m[7]*m[10]
	inv[4] = -m[4]*m[10]*m[15] + m[4]*m[11]*m[14] + m[8]*m[6]*m[15] - m[8]*m[7]*m[14] - m[12]*m[6]*m[11] + m[12]*m[7]*m[10]
	inv[8] = m[4]*m[9]*m[15] - m[4]*m[11]*m[13] - m[8]*m[5]*m[15] + m[8]*m[7]*m[13] + m[12]*m[5]*m[11] - m[12]*m[7]*m[9]
	inv[12] = -m[4]*m[9]*m[14] + m[4]*m[10]*m[13] + m[8]*m[5]*m[14] - m[8]*m[6]*m[13] - m[12]*m[5]*m[10] + m[12]*m[6]*m[9]
	inv[1] = -m[1]*m[10]*m[15] + m[1]*m[11]*m[14] + m[9]*m[2]*m[15] - m[9]*m[3]*m[14] - m[13]*m[2]*m[11] + m[13]*m[3]*m[10]
	inv[5] = m[0]*m[10]*m[15] - m[0]*m[11]*m[14] - m[8]*m[2]*m[15] + m[8]*m[3]*m[14] + m[12]*m[2]*m[11] - m[12]*m[3]*m[10]
	inv[9] = -m[0]*m[9]*m[15] + m[0]*m[11]*m[13] + m[8]*m[1]*m[15] - m[8]*m[3]*m[13] - m[12]*m[1]*m[11] + m[12]*m[3]*m[9]
	inv[13] = m[0]*m[9]*m[14] - m[0]*m[10]*m[13] - m[8]*m[1]*m[14] + m[8]*m[2]*m[13] + m[12]*m[1]*m[10] - m[12]*m[2]*m[9]
	inv[2] = m[1]*m[6]*m[15] - m[1]*m[7]*m[14] - m[5]*m[2]*m[15] + m[5]*m[3]*m[14] + m[13]*m[2]*m[7] - m[13]*m[3]*m[6]
	inv[6] = -m[0]*m[6]*m[15] + m[0]*m[7]*m[14] + m[4]*m[2]*m[15] - m[4]*m[3]*m[14] - m[12]*m[2]*m[7] + m[12]*m[3]*m[6]
	inv[10] = m[0]*m[5]*m[15] - m[0]*m[7]*m[13] - m[4]*m[1]*m[15] + m[4]*m[3]*m[13] + m[12]*m[1]*m[7] - m[12]*m[3]*m[5]
	inv[14] = -m[0]*m[5]*m[14] + m[0]*m[6]*m[13] + m[4]*m[1]*m[14] - m[4]*m[2]*m[13] - m[12]*m[1]*m[6] + m[12]*m[2]*m[5]
	inv[3] = -m[1]*m[6]*m[11] + m[1]*m[7]*m[10] + m[5]*m[2]*m[11] - m[5]*m[3]*m[10] - m[9]*m[2]*m[7] + m[9]*m[3]*m[6]
	inv[7] = m[0]*m[6]*m[11] - m[0]*m[7]*m[10] - m[4]*m[2]*m[11] + m[4]*m[3]*m[10] + m[8]*m[2]*m[7] - m[8]*m[3]*m[6]
	inv[11] = -m[0]*m[5]*m[11] + m[0]*m[7]*m[9] + m[4]*m[1]*m[11] - m[4]*m[3]*m[9] - m[8]*m[1]*m[7] + m[8]*m[3]*m[5]
	inv[15] = m[0]*m[5]*m[10] - m[0]*m[6]*m[9] - m[4]*m[1]*m[10] + m[4]*m[2]*m[9] + m[8]*m[1]*m[6] - m[8]*m[2]*m[5]
	det := m[0]*inv[0] + m[1]*inv[4] + m[2]*inv[8] + m[3]*inv[12]
	if det == 0 {
		return identity()
	}
	for i := range inv {
		inv[i] /= det
	}
	return inv
}

// ------------------------------------------------------------------ files for the developer (textures)

// handleTravellerSample zips what the traveller's materials use (owner, 2026-11-10: realistic textures next):
// each material, the DDS textures it names (shrunk to 1024 px so the zip fits in a chat upload), the playerdata
// tables (palettes) and the save's look as the page sends it ({groups, custom}: CharacterCustomisationData[0]).
func handleTravellerSample(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	if _, err := openGamePaks(); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	var v struct {
		Groups []string        `json:"groups"`
		Custom json.RawMessage `json:"custom"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<20)).Decode(&v); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	names, _, _ := travellerNames(v.Groups)
	out := &meshOut{onlyDepth: 1, collect: true}
	if err := buildMesh(travellerScene, map[string]string{"_names": strings.Join(names, "|")}, "", 0, out, identity(), 0); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	files := map[string]bool{normGamePath(travellerScene): true}
	for _, n := range allGameFiles() {
		if strings.Contains(n, "metadata/gamestate/playerdata/") && strings.HasSuffix(n, ".mbin") {
			files[n] = true
		}
	}
	report := []string{"Editor version: " + appVersion, "Parts: " + strings.Join(names, ", "), "", "Materials:"}
	texRe := regexp.MustCompile(`(?i)textures/[a-z0-9_./\-]+?\.dds`)
	seen, stems := map[string]bool{}, map[string]bool{}
	for _, p := range out.parts {
		m := normGamePath(p.material)
		if m == "" || seen[m] {
			continue
		}
		seen[m] = true
		raw, err := gameFile(m)
		if err != nil {
			report = append(report, m+": "+err.Error())
			continue
		}
		files[m] = true
		var tex []string
		for _, t := range texRe.FindAll(raw, -1) {
			tn := normGamePath(string(t))
			if _, err := gameFile(tn); err == nil {
				files[tn] = true
				tex = append(tex, filepath.Base(tn))
			}
			// the layers the game paints the save's colours with: <stem>.texture.mbin and every texture of that stem
			stem := path.Dir(tn) + "/" + strings.SplitN(path.Base(tn), ".", 2)[0] + "."
			if !stems[stem] {
				stems[stem] = true
				for _, n := range allGameFiles() {
					if strings.HasPrefix(n, stem) && (strings.HasSuffix(n, ".dds") || strings.HasSuffix(n, ".texture.mbin")) {
						files[n] = true
					}
				}
			}
		}
		report = append(report, m+" ("+p.name+"): "+strings.Join(tex, ", "))
	}
	// the game's layered textures (.texture.mbin: which layer gets which palette colour) are small: take every one
	// for the player, and list every texture file of the player character, to find where the save's colours go
	report = append(report, "", "Layered textures in the game:")
	var playerTex []string
	for _, n := range allGameFiles() {
		if strings.HasSuffix(n, ".texture.mbin") {
			report = append(report, n)
			if strings.Contains(n, "/player/") {
				files[n] = true
			}
		} else if strings.HasPrefix(n, "textures/common/player/") {
			playerTex = append(playerTex, n)
		}
	}
	report = append(report, "", "Player textures in the game:")
	report = append(report, playerTex...)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	list := make([]string, 0, len(files))
	for n := range files {
		list = append(list, n)
	}
	sort.Strings(list)
	for _, n := range list {
		b, err := gameFile(n)
		if err != nil {
			continue
		}
		if strings.HasSuffix(n, ".dds") {
			b = shrinkDDS(b, 1024)
		}
		if f, err := zw.Create(n); err == nil {
			f.Write(b)
		}
	}
	if len(v.Custom) > 0 {
		if f, err := zw.Create("save-look.json"); err == nil {
			f.Write(v.Custom)
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
	p := filepath.Join(dir, "Traveller files for the developer "+time.Now().Format("2006-01-02 1504")+".zip")
	for n := 2; fileExists(p); n++ {
		p = strings.TrimSuffix(p, ".zip") + " (" + strconv.Itoa(n) + ").zip"
	}
	if err := atomicWrite(p, buf.Bytes()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = revealFile(p)
	writeJSON(w, map[string]any{"path": p, "files": len(list), "size": buf.Len()})
}

// shrinkDDS drops a block-compressed texture's top mip levels until it is at most max pixels across. Anything it
// doesn't understand (arrays, cube maps, other formats, no mips) comes back unchanged.
func shrinkDDS(b []byte, max int) []byte {
	if len(b) < 128 || string(b[:4]) != "DDS " {
		return b
	}
	le := binary.LittleEndian
	h, w, mips := int(le.Uint32(b[12:])), int(le.Uint32(b[16:])), int(le.Uint32(b[28:]))
	if le.Uint32(b[112:])&0x200 != 0 { // DDSCAPS2_CUBEMAP
		return b
	}
	head, bs := 128, 0
	switch string(b[84:88]) {
	case "DXT1", "ATI1", "BC4U":
		bs = 8
	case "DXT3", "DXT5", "ATI2", "BC5U":
		bs = 16
	case "DX10":
		if len(b) < 148 || le.Uint32(b[140:]) != 1 {
			return b
		}
		head = 148
		switch le.Uint32(b[128:]) {
		case 70, 71, 72, 79, 80, 81:
			bs = 8
		case 73, 74, 75, 76, 77, 78, 82, 83, 84, 94, 95, 96, 97, 98, 99:
			bs = 16
		}
	}
	if bs == 0 || mips < 2 || w <= max {
		return b
	}
	off := head
	for w > max && mips > 1 {
		size := ((w + 3) / 4) * ((h + 3) / 4) * bs
		if off+size >= len(b) {
			return b
		}
		off += size
		w, h, mips = (w+1)/2, (h+1)/2, mips-1
		if w < 1 {
			w = 1
		}
		if h < 1 {
			h = 1
		}
	}
	out := append(append([]byte{}, b[:head]...), b[off:]...)
	le.PutUint32(out[12:], uint32(h))
	le.PutUint32(out[16:], uint32(w))
	le.PutUint32(out[20:], uint32(((w+3)/4)*((h+3)/4)*bs))
	le.PutUint32(out[28:], uint32(mips))
	return out
}

// ------------------------------------------------------------------ textures

// A material names its textures with the sampler that uses them right after each path (TkMaterialSampler: Map,
// then Name): gDiffuseMap (colour, greyscale where the game tints it with the save's colours), gMasksMap (two
// channels: roughness, metal) and gNormalMap (two channels, X and Y).
var texPathRe = regexp.MustCompile(`(?i)textures/[a-z0-9_./\-]+?\.dds`)
var samplerRe = regexp.MustCompile(`g[A-Z][A-Za-z0-9]*Map`)

func materialSamplers(raw []byte) map[string]string {
	out := map[string]string{}
	for _, loc := range texPathRe.FindAllIndex(raw, -1) {
		p := normGamePath(string(raw[loc[0]:loc[1]]))
		end := loc[1] + 0xC0
		if end > len(raw) {
			end = len(raw)
		}
		name := ""
		if m := samplerRe.Find(raw[loc[1]:end]); m != nil {
			name = string(m)
		} else if strings.Contains(p, ".normal.") {
			name = "gNormalMap"
		} else if strings.Contains(p, ".masks.") {
			name = "gMasksMap"
		} else {
			name = "gDiffuseMap"
		}
		if _, ok := out[name]; !ok {
			out[name] = p
		}
	}
	return out
}

type glbImage struct {
	key, name string
	jpeg      []byte
}

type glbLook struct{ diffuse, masks, normal *glbImage }

var (
	texCacheMu sync.Mutex
	texCache   = map[string]*glbImage{}
)

// materialImages reads every material's textures in parallel (each decoded once per run of the app).
func materialImages(order []string, prims map[string]*prim, look *travLook) map[string]*glbLook {
	out := map[string]*glbLook{}
	type job struct {
		tex, kind string
		dst       **glbImage
	}
	var jobs []job
	for _, k := range order {
		mp := prims[k].matPath
		if mp == "" || out[mp] != nil {
			continue
		}
		raw, err := gameFile(normGamePath(mp))
		if err != nil {
			continue
		}
		smp := materialSamplers(raw)
		lk := &glbLook{}
		out[mp] = lk
		if t := smp["gDiffuseMap"]; t != "" {
			jobs = append(jobs, job{t, "diffuse", &lk.diffuse})
		}
		if t := smp["gMasksMap"]; t != "" {
			jobs = append(jobs, job{t, "masks", &lk.masks})
		}
		if t := smp["gNormalMap"]; t != "" {
			jobs = append(jobs, job{t, "normal", &lk.normal})
		}
	}
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for _, j := range jobs {
		wg.Add(1)
		go func(j job) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			*j.dst = textureImage(j.tex, j.kind, look)
		}(j)
	}
	wg.Wait()
	return out
}

func textureImage(tex, kind string, look *travLook) *glbImage {
	key := kind + "|" + tex
	if kind == "diffuse" {
		key += "|" + look.key()
	}
	texCacheMu.Lock()
	if im, ok := texCache[key]; ok {
		texCacheMu.Unlock()
		return im
	}
	texCacheMu.Unlock()
	im := &glbImage{key: key, name: strings.TrimSuffix(path.Base(tex), ".dds")}
	if raw, err := gameFile(tex); err == nil {
		var img *image.NRGBA
		if kind == "diffuse" {
			img = layeredColour(tex, look) // the save's own colours, when the texture is painted in layers
		}
		if img == nil {
			img, _ = decodeDDS(shrinkDDS(raw, 1024))
		}
		if img != nil {
			im.jpeg = encodeTexture(img, kind)
		}
	}
	texCacheMu.Lock()
	texCache[key] = im
	texCacheMu.Unlock()
	return im
}

// encodeTexture turns a decoded game texture into what glTF expects: colour as is (no alpha: the game uses it
// for its own masks), metal/roughness with roughness in G and metal in B, and normals with Z rebuilt from X and Y.
func encodeTexture(img *image.NRGBA, kind string) []byte {
	w, h := img.Rect.Dx(), img.Rect.Dy()
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < w*h; i++ {
		r, g, b := img.Pix[i*4], img.Pix[i*4+1], img.Pix[i*4+2]
		switch kind {
		case "masks":
			r, g, b = 255, r, g
		case "normal":
			x, y := float64(r)/127.5-1, float64(g)/127.5-1
			z := 1 - x*x - y*y
			if z < 0 {
				z = 0
			}
			b = byte(math.Round((math.Sqrt(z) + 1) * 127.5))
		}
		out.Pix[i*4], out.Pix[i*4+1], out.Pix[i*4+2], out.Pix[i*4+3] = r, g, b, 255
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: 88}); err != nil {
		return nil
	}
	return buf.Bytes()
}

// GET /api/model/glb?scene=…&seed=…&picks={…}&look={…}&name=… -> any model (a ship, a multi-tool) as a textured,
// static .glb, painted with the look's colours where its textures are layered (owner, 2026-11-10: ships in their
// own colours on the Traveller card, a multi-tool in the traveller's hand in Blender).
func handleModelGLB(w http.ResponseWriter, r *http.Request) {
	p, err := sceneParam(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	glb, err := modelGLB(p, r.URL.Query().Get("seed"), r.URL.Query().Get("picks"), r.URL.Query().Get("look"), r.URL.Query().Get("name"), nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "model/gltf-binary")
	w.Write(glb)
}

func modelGLB(scene, seed, picksJSON, look, name string, place *mat4) ([]byte, error) {
	picks := map[string]string{}
	if picksJSON != "" {
		_ = json.Unmarshal([]byte(picksJSON), &picks)
	}
	out := &meshOut{onlyDepth: 1, collect: true}
	if err := buildMesh(scene, picks, seed, 0, out, identity(), 0); err != nil {
		return nil, err
	}
	if len(out.parts) == 0 {
		return nil, fmt.Errorf("the model has no geometry")
	}
	if name == "" {
		name = strings.TrimSuffix(path.Base(scene), ".scene.mbin")
	}
	if place != nil { // placed in the traveller's model space (in the hand), turned like the traveller's .glb
		r180 := mat4{-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1}
		m := matMul(r180, *place)
		for i := range out.parts {
			out.parts[i].m = matMul(m, out.parts[i].m)
		}
	}
	return writeGLB(name, out.parts, nil, nil, true, parseLook(look))
}
