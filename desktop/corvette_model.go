package main

// Corvette models from the owner's game files: a corvette build is a list of base parts (ObjectID, Position, Up, At).
// The game's building table (basebuildingobjectstable.mbin) says which scene each part ID uses: its PlacementScene,
// or for single parts the model of the matching entry in basebuildingpartstable.mbin. Each part's scene is built
// once (models.go's buildMesh) and copied into place, so the page can draw the whole corvette in 3D without Blender.

import (
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"os"
	"sort"
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
var partMeshes = struct {
	sync.Mutex
	m map[string]*meshOut
}{m: map[string]*meshOut{}}

func partMesh(scene string, lod int) *meshOut {
	key := normGamePath(scene) + "|" + strconv.Itoa(lod)
	partMeshes.Lock()
	if pm, ok := partMeshes.m[key]; ok {
		partMeshes.Unlock()
		return pm
	}
	partMeshes.Unlock()
	pm := &meshOut{}
	if err := buildMesh(scene, nil, "", lod, pm, identity(), 0); err != nil || len(pm.idx) == 0 {
		pm = nil
	}
	partMeshes.Lock()
	if len(partMeshes.m) > 2000 {
		partMeshes.m = map[string]*meshOut{}
	}
	partMeshes.m[key] = pm
	partMeshes.Unlock()
	return pm
}

type buildPart struct {
	ObjectID string    `json:"ObjectID"`
	Position []float64 `json:"Position"`
	Up       []float64 `json:"Up"`
	At       []float64 `json:"At"`
}

// partMatrix: columns Right (Up x At), Up, At; the length of Up is the part's scale.
func partMatrix(p buildPart) (mat4, bool) {
	if len(p.Position) < 3 || len(p.Up) < 3 || len(p.At) < 3 {
		return mat4{}, false
	}
	u := [3]float64{p.Up[0], p.Up[1], p.Up[2]}
	a := [3]float64{p.At[0], p.At[1], p.At[2]}
	s := math.Sqrt(u[0]*u[0] + u[1]*u[1] + u[2]*u[2])
	al := math.Sqrt(a[0]*a[0] + a[1]*a[1] + a[2]*a[2])
	if s == 0 || al == 0 || math.IsNaN(s) || math.IsNaN(al) {
		return mat4{}, false
	}
	for k := range a {
		a[k] = a[k] / al * s
	}
	r := [3]float64{u[1]*a[2] - u[2]*a[1], u[2]*a[0] - u[0]*a[2], u[0]*a[1] - u[1]*a[0]}
	rl := math.Sqrt(r[0]*r[0] + r[1]*r[1] + r[2]*r[2])
	if rl == 0 {
		return mat4{}, false
	}
	for k := range r {
		r[k] = r[k] / rl * s
	}
	return mat4{
		r[0], u[0], a[0], p.Position[0],
		r[1], u[1], a[1], p.Position[1],
		r[2], u[2], a[2], p.Position[2],
		0, 0, 0, 1,
	}, true
}

// POST /api/model/build?lod=n, body {"Objects": [...]} with plain keys: the whole build as one HSEM mesh.
// X-Parts-Missing says how many parts had no model (unknown ID, or the model couldn't be read).
func handleModelBuild(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Objects []buildPart `json:"Objects"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<20)).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	scenes, err := partScenes()
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	lod, _ := strconv.Atoi(r.URL.Query().Get("lod"))
	budget := 1_500_000 // triangles: plenty for a cover, and light enough for the page
	if v, err := strconv.Atoi(r.URL.Query().Get("max")); err == nil && v > 0 && v < budget {
		budget = v
	}
	type placed struct {
		pm   *meshOut
		m    mat4
		size float64 // radius x scale: big parts are kept first when the build is over the budget
	}
	var parts []placed
	missing, total := 0, 0
	for _, p := range body.Objects {
		scene := scenes[strings.ToUpper(strings.TrimPrefix(p.ObjectID, "^"))]
		if scene == "" {
			scene = scenes["*"] // tests only: HSE_TEST_PARTSCENES can give one model for every part
		}
		m, ok := partMatrix(p)
		if scene == "" || !ok {
			missing++
			continue
		}
		pm := partMesh(scene, lod)
		if pm == nil {
			missing++
			continue
		}
		scale := math.Sqrt(m[1]*m[1] + m[5]*m[5] + m[9]*m[9])
		parts = append(parts, placed{pm, m, pm.radius() * scale})
		total += len(pm.idx) / 3
	}
	dropped := 0
	if total > budget {
		sort.SliceStable(parts, func(a, b int) bool { return parts[a].size > parts[b].size })
		n := 0
		for k, pt := range parts {
			if n+len(pt.pm.idx)/3 > budget {
				dropped = len(parts) - k
				parts = parts[:k]
				break
			}
			n += len(pt.pm.idx) / 3
		}
	}
	out := &meshOut{}
	for _, pt := range parts {
		out.add(&meshStream{pos: pt.pm.pos, idx: pt.pm.idx}, pt.m)
	}
	if len(out.idx) == 0 {
		http.Error(w, "none of the build's parts have a model in the game files", http.StatusNotFound)
		return
	}
	w.Header().Set("X-Parts-Missing", strconv.Itoa(missing))
	w.Header().Set("X-Parts-Dropped", strconv.Itoa(dropped))
	writeMesh(w, out)
}

// radius: the farthest vertex from the part's own origin
func (o *meshOut) radius() float64 {
	if o.r > 0 {
		return o.r
	}
	r := 0.0
	for v := 0; v+2 < len(o.pos); v += 3 {
		x, y, z := float64(o.pos[v]), float64(o.pos[v+1]), float64(o.pos[v+2])
		if d := x*x + y*y + z*z; d > r {
			r = d
		}
	}
	o.r = math.Sqrt(r)
	return o.r
}
