package main

// Part sizes for the corvette hologram: a corvette build is a list of base parts (ObjectID, Position, Up, At). The
// game's building table (basebuildingobjectstable.mbin) says which scene each part ID uses: its PlacementScene, or for
// single parts the model of the matching entry in basebuildingpartstable.mbin. A part's box is the union of the mesh
// bounds and collision boxes in that scene, in the part's own space, so the page can draw every part at its real size.
//
// (Drawing the real corvette hull from these scenes doesn't work: a module's placement scene holds every variant at
// once, and the game picks the visible hull pieces at run time from snap-point rules. See ROADMAP.md.)

import (
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
)

var partTable = struct {
	sync.Mutex
	at     string            // the PCBANKS folder it was read from
	scenes map[string]string // part ID (no ^, upper case) -> scene path
}{}

const (
	objectsTableFile = "metadata/reality/tables/basebuildingobjectstable.mbin"
	partsTableFile   = "metadata/reality/tables/basebuildingpartstable.mbin"
)

// partScenes reads which scene each building part uses (GcBaseBuildingTable.Objects, GcBaseBuildingPartsTable.Parts;
// offsets from libMBIN, relative to the data at 0x20).
func partScenes() (map[string]string, error) {
	partTable.Lock()
	defer partTable.Unlock()
	if f := os.Getenv("HSE_TEST_PARTSCENES"); f != "" { // tests: a JSON map instead of the tables
		if partTable.scenes == nil {
			b, err := os.ReadFile(f)
			if err != nil {
				return nil, err
			}
			m := map[string]string{}
			if err := json.Unmarshal(b, &m); err != nil {
				return nil, err
			}
			partTable.scenes = m
		}
		return partTable.scenes, nil
	}
	banks := gameBanks()
	if partTable.scenes != nil && partTable.at == banks {
		return partTable.scenes, nil
	}
	raw, err := gameFile(objectsTableFile)
	if err != nil {
		return nil, err
	}
	partsRaw, _ := gameFile(partsTableFile)
	out, err := parsePartScenes(raw, partsRaw)
	if err != nil {
		return nil, err
	}
	partTable.scenes, partTable.at = out, banks
	return out, nil
}

func parsePartScenes(raw, partsRaw []byte) (map[string]string, error) {
	m, err := openMbin(raw, 0xF2A28AF70F065D9A, "basebuildingobjectstable.mbin")
	if err != nil {
		return nil, err
	}
	single := map[string]string{} // part ID -> SinglePartID ("_B_WALL…"), resolved below
	out := map[string]string{}
	a, n := m.list(0x20 + 0x1C8)
	for i := 0; i < n; i++ {
		e := a + i*0x2B8
		id := strings.ToUpper(m.fstr(e+0x208, 0x10))
		if id == "" {
			continue
		}
		if s := m.vstr(e + 0x158); s != "" {
			out[id] = s
		} else if sp := m.fstr(e+0x178, 0x20); sp != "" {
			single[id] = strings.ToUpper(sp)
		}
	}
	if len(single) > 0 && partsRaw != nil {
		{
			if p, err := openMbin(partsRaw, 0xCE06C82FAE566931, "basebuildingpartstable.mbin"); err == nil {
				model := map[string]string{}
				a, n := p.list(0x20)
				for i := 0; i < n; i++ {
					e := a + i*0x30
					if sa, sn := p.list(e + 0x20); sn > 0 {
						model[strings.ToUpper(p.fstr(e, 0x20))] = p.vstr(sa + 0x20) // StyleModels[0].Model
					}
				}
				for id, sp := range single {
					if s := model[sp]; s != "" {
						out[id] = s
					}
				}
			}
		}
	}
	if len(out) == 0 {
		return nil, errors.New("the game's building table has no parts")
	}
	return out, nil
}

// one part's mesh in its own space, built once per scene

// ------------------------------------------------------------------ boxes

type partBox [6]float64 // min x, y, z, max x, y, z in the part's own space (X right, Y up, Z along At)

var partBoxes = struct {
	sync.Mutex
	m map[string]*partBox // scene path -> box (nil: none found)
}{m: map[string]*partBox{}}

func attrF(n *sceneNode, k string) (float64, bool) {
	v, ok := n.Attrs[k]
	if !ok {
		return 0, false
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	return f, err == nil && !math.IsNaN(f) && !math.IsInf(f, 0)
}

// sceneBox: the union of mesh bounds (AABB attributes) and collision boxes, through references, in the scene's space
func sceneBox(path string) *partBox {
	key := normGamePath(path)
	partBoxes.Lock()
	if b, ok := partBoxes.m[key]; ok {
		partBoxes.Unlock()
		return b
	}
	partBoxes.Unlock()
	// collision boxes give a part's footprint; mesh bounds (which include every variant a module can show) are the
	// fallback when a part has no collision box
	empty := partBox{math.Inf(1), math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1), math.Inf(-1)}
	coll, mesh := empty, empty
	hasColl, hasMesh := false, false
	grow := func(b *partBox, m mat4, lo, hi [3]float64) {
		for c := 0; c < 8; c++ {
			x, y, z := lo[0], lo[1], lo[2]
			if c&1 != 0 {
				x = hi[0]
			}
			if c&2 != 0 {
				y = hi[1]
			}
			if c&4 != 0 {
				z = hi[2]
			}
			p := [3]float64{m[0]*x + m[1]*y + m[2]*z + m[3], m[4]*x + m[5]*y + m[6]*z + m[7], m[8]*x + m[9]*y + m[10]*z + m[11]}
			for k := 0; k < 3; k++ {
				b[k] = math.Min(b[k], p[k])
				b[k+3] = math.Max(b[k+3], p[k])
			}
		}
	}
	var walk func(n *sceneNode, m mat4, depth int)
	walk = func(n *sceneNode, m mat4, depth int) {
		if depth > 10 {
			return
		}
		m = matMul(m, transformOf(n.T))
		switch n.Type {
		case "MESH":
			if skipMaterial(n.Attrs["MATERIAL"]) {
				break
			}
			var v [6]float64
			ok := true
			for i, k := range []string{"AABBMINX", "AABBMINY", "AABBMINZ", "AABBMAXX", "AABBMAXY", "AABBMAXZ"} {
				f, has := attrF(n, k)
				ok = ok && has
				v[i] = f
			}
			if ok && v[3]-v[0] < 500 && v[4]-v[1] < 500 && v[5]-v[2] < 500 {
				grow(&mesh, m, [3]float64{v[0], v[1], v[2]}, [3]float64{v[3], v[4], v[5]})
				hasMesh = true
			}
		case "COLLISION":
			w, okW := attrF(n, "WIDTH")
			h, okH := attrF(n, "HEIGHT")
			d, okD := attrF(n, "DEPTH")
			if n.Attrs["TYPE"] == "Box" && okW && okH && okD && w < 500 && h < 500 && d < 500 {
				grow(&coll, m, [3]float64{-w / 2, -h / 2, -d / 2}, [3]float64{w / 2, h / 2, d / 2})
				hasColl = true
			}
		case "REFERENCE":
			if ref := n.Attrs["SCENEGRAPH"]; ref != "" && !skipReference(ref) {
				if s, err := loadScene(ref); err == nil {
					walk(s, m, depth+1)
				}
			}
		}
		for _, k := range n.Kids {
			walk(k, m, depth+1)
		}
	}
	var out *partBox
	if root, err := loadScene(path); err == nil {
		walk(root, identity(), 0)
		if hasColl {
			out = &coll
		} else if hasMesh {
			out = &mesh
		}
	}
	partBoxes.Lock()
	partBoxes.m[key] = out
	partBoxes.Unlock()
	return out
}

// POST /api/model/boxes {"ids": ["B_COK_D", …]}: {"B_COK_D": [minx, miny, minz, maxx, maxy, maxz], …} for the parts
// whose size could be read from the game files
func handleModelBoxes(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	scenes, err := partScenes()
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	out := map[string]partBox{}
	for _, raw := range body.IDs {
		id := strings.ToUpper(strings.TrimPrefix(raw, "^"))
		if sc := scenes[id]; sc != "" {
			if b := sceneBox(sc); b != nil {
				out[strings.TrimPrefix(raw, "^")] = *b
			}
		}
	}
	writeJSON(w, out)
}
