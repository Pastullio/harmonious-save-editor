package main

// The staff builder (owner 2026-11-23). A staff is a multi-tool whose model is STAFFMULTITOOL.SCENE.MBIN and whose
// CustomisationData.DescriptorGroups name one part per slot: ^STAFF_HEAD_5A, ^STAFF_CORE_5, ^STAFF_POLE_2 (seen in the
// owner's save; the equipped tool's copy sits in CharacterCustomisationData[2]). The groups are the ones in
// charactercustomisationdescriptorgroupsdata.mbin (STAFF_HEAD_5A -> the scene's option node _STAFFHEAD_5A), the same
// table the traveller uses. Which parts exist comes from modularcustomisationdatatable.mbin: a slot (STAFF_HEAD,
// STAFF_CORE, STAFF_POLE) holds its label 0x40 before its ID and, 0x10 after it, a list of 0x40-byte items
// {DescriptorGroups list 0x00 (16-byte IDs), ItemID 0x10}: STAFF_PART_C -> STAFF_HEAD_1, STAFF_HEAD1 -> STAFF_HEAD_2,
// STAFF_HEAD4B -> STAFF_HEAD_5A… (checked 2026-11-23 on the owner's table: 7 heads, 6 cores, 6 poles). The slots are
// found by their IDs and every field is checked, so a changed layout gives nothing and the page keeps its own list.
// The staff's colours are CustomisationData.Colours (palette, ColourAlt, colour); which of them a staff shows is
// read from its materials' layered textures (texlayers.go), so the page only offers the colours that do something.

import (
	"net/http"
	"path"
	"strings"
)

const staffScene = "MODELS/COMMON/WEAPONS/MULTITOOL/STAFFMULTITOOL.SCENE.MBIN"

type staffPart struct {
	Group string `json:"group"` // the descriptor group the save stores (without ^)
	Item  string `json:"item"`  // the product the game builds it from
}

type staffSlot struct {
	ID    string      `json:"id"`
	Label string      `json:"label"`
	Parts []staffPart `json:"parts"`
}

type palUse struct {
	Palette string     `json:"p"`
	Alt     string     `json:"a"`
	Avg     [3]float32 `json:"avg"` // the layer's own average colour
	Layer   string     `json:"layer"`
}

func plainTableID(s string) bool {
	if len(s) < 2 || len(s) > 15 {
		return false
	}
	for _, c := range s {
		if !(c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_') {
			return false
		}
	}
	return true
}

// parseModularSlots finds the named slots of the modular customisation table and lists their parts.
func parseModularSlots(raw []byte, ids ...string) []staffSlot {
	if len(raw) < 0x60 || raw[0] != 0xCC || raw[1] != 0xCC || raw[2] != 0xCC || raw[3] != 0xCC {
		return nil
	}
	m := &mbin{raw}
	var out []staffSlot
	for _, id := range ids {
		var best *staffSlot
		for p := 0x40; p+0x20 <= len(raw); p += 8 {
			if raw[p] != id[0] || m.fstr(p, 0x10) != id {
				continue
			}
			a, n := m.list(p + 0x10)
			if n < 1 || n > 400 || !m.ok(a, n*0x40) { // a hauler has well over a hundred wing sets
				continue
			}
			s := staffSlot{ID: id, Label: m.fstr(p-0x40, 0x20)}
			for i := 0; i < n; i++ {
				e := a + i*0x40
				ga, gn := m.list(e)
				g, item := "", m.fstr(e+0x10, 0x10)
				if gn >= 1 && gn <= 8 && m.ok(ga, gn*0x10) {
					g = m.fstr(ga, 0x10)
				}
				if !plainTableID(g) || !plainTableID(item) {
					s.Parts = nil
					break
				}
				s.Parts = append(s.Parts, staffPart{Group: g, Item: item})
			}
			if len(s.Parts) == n {
				best = &s
				break
			}
		}
		if best == nil {
			return nil
		}
		out = append(out, *best)
	}
	return out
}

func staffSlots() []staffSlot {
	t := findGameFile("/modularcustomisationdatatable.mbin")
	if t == "" {
		return nil
	}
	raw, err := gameFile(t)
	if err != nil {
		return nil
	}
	return parseModularSlots(raw, "STAFF_HEAD", "STAFF_CORE", "STAFF_POLE")
}

var staffGroupRe = strings.NewReplacer("STAFF_HEAD_", "_STAFFHEAD_", "STAFF_CORE_", "_STAFFCORE_", "STAFF_POLE_", "_STAFFPOLE_")

// staffNames turns a staff's descriptor groups into the scene's option nodes: from the game's table, else by the
// names' own pattern (STAFF_HEAD_5A -> _STAFFHEAD_5A).
func staffNames(groups []string) []string {
	tab, _ := travellerGroups()
	var names []string
	for _, g := range groups {
		id := strings.ToUpper(strings.TrimPrefix(strings.TrimSpace(g), "^"))
		if !plainTableID(id) || !strings.HasPrefix(id, "STAFF_") {
			continue
		}
		if ns := tab[id]; len(ns) > 0 {
			names = append(names, ns...)
		} else if n := staffGroupRe.Replace(id); n != id {
			names = append(names, n)
		}
	}
	return names
}

// modelPalettes lists the palette colours a model's layered textures take, in the order its materials appear.
func modelPalettes(parts []meshPart) []palUse {
	var out []palUse
	seen, mats := map[string]bool{}, map[string]bool{}
	for _, p := range parts {
		if p.material == "" || mats[p.material] {
			continue
		}
		mats[p.material] = true
		raw, err := gameFile(normGamePath(p.material))
		if err != nil {
			continue
		}
		diffuse := materialSamplers(raw)["gDiffuseMap"]
		if diffuse == "" {
			continue
		}
		tex, err := gameFile(path.Dir(diffuse) + "/" + strings.SplitN(path.Base(diffuse), ".", 2)[0] + ".texture.mbin")
		if err != nil {
			continue
		}
		var none *travLook
		for _, ly := range parseProceduralTexture(tex) {
			t := none.pick(ly)
			if t == nil || t.palette == "" || t.alt == "" || t.alt == "None" {
				continue
			}
			if k := t.palette + "|" + t.alt; !seen[k] {
				seen[k] = true
				out = append(out, palUse{Palette: t.palette, Alt: t.alt, Avg: [3]float32{t.avg[0], t.avg[1], t.avg[2]}, Layer: ly.name})
			}
		}
	}
	return out
}

// GET /api/model/staff?groups=STAFF_HEAD_5A,STAFF_CORE_5,STAFF_POLE_2 -> {scene, slots (the game's part list, or
// null), names (the option nodes of those groups, for picks._names), colours (the palette colours that staff shows)}
func handleStaff(w http.ResponseWriter, r *http.Request) {
	res := map[string]any{"scene": staffScene, "slots": staffSlots()}
	if _, err := loadScene(staffScene); err != nil {
		res["error"] = err.Error()
		writeJSON(w, res)
		return
	}
	names := staffNames(travellerGroupsParam(r))
	res["names"] = names
	if len(names) > 0 {
		out := &meshOut{onlyDepth: 1, collect: true}
		if err := buildMesh(staffScene, map[string]string{"_names": strings.Join(names, "|")}, "", 0, out, identity(), 0); err == nil {
			res["colours"] = modelPalettes(out.parts)
		}
	}
	writeJSON(w, res)
}
