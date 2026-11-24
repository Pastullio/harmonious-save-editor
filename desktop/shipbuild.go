package main

// Ship builder (owner 2026-11-24: "the same ability to create a ship as they do with the multitool"). A ship built at
// the game's fabricator keeps its parts as descriptor groups in its slot's CharacterCustomisationData entry (seen in
// the owner's save: a fighter with ^FIGHT_COCKAB, ^FIGHT_WINGA, ^FIGHT_ENGIC, 330 colours and the texture option
// SHIP_FIGHT/COATING). The parts on offer are the slots of modularcustomisationdatatable.mbin (parseModularSlots,
// staff.go); what each group stands for in the model is in the descriptor groups table (travellerGroups): one group
// names several option nodes (DROPS_WINGAAA -> _SUBWINGS_A, _THRUSTERS_A, _HULL_A, _WINGS_A), so the model is built
// with picks._names. The reactor core slot has no model part (it sets the class) and is left out.

import (
	"net/http"
	"strings"
)

type shipKind struct {
	Scene string
	Slots []string
}

const spacecraft = "MODELS/COMMON/SPACECRAFT/"

var shipKinds = map[string]shipKind{
	"fighter":    {spacecraft + "FIGHTERS/FIGHTER_PROC.SCENE.MBIN", []string{"FIGHTER_COCKPIT", "FIGHTER_ENGINES", "FIGHTER_WINGS"}},
	"dropship":   {spacecraft + "DROPSHIPS/DROPSHIP_PROC.SCENE.MBIN", []string{"DROPSHIP_COCKPI", "DROPSHIP_ENGINE", "DROPSHIP_WINGS"}},
	"scientific": {spacecraft + "SCIENTIFIC/SCIENTIFIC_PROC.SCENE.MBIN", []string{"SCIENTIFIC_COCK", "SCI_L_WING", "SCI_R_WING"}},
	"shuttle":    {spacecraft + "SHUTTLE/SHUTTLE_PROC.SCENE.MBIN", []string{"SHUTTLE_COCKPIT", "SHUTTLE_HULL", "SHUTTLE_WING"}},
	"sail":       {spacecraft + "SAILSHIP/SAILSHIP_PROC.SCENE.MBIN", []string{"SAIL_BODY", "SAIL_SAIL", "SAIL_WINGS"}},
}

type shipPart struct {
	Group string   `json:"group"`
	Item  string   `json:"item"`
	Names []string `json:"names"` // the option nodes this part switches on
}

type shipSlot struct {
	ID    string     `json:"id"`
	Label string     `json:"label"`
	Parts []shipPart `json:"parts"`
}

// shipSlotsFrom pairs the builder's slots with what each part stands for in the model.
func shipSlotsFrom(modular []byte, groups map[string][]string, ids []string) []shipSlot {
	var out []shipSlot
	for _, id := range ids {
		got := parseModularSlots(modular, id)
		if len(got) != 1 {
			continue
		}
		s := shipSlot{ID: id, Label: got[0].Label}
		for _, p := range got[0].Parts {
			sp := shipPart{Group: p.Group, Item: p.Item, Names: groups[p.Group]}
			if len(sp.Names) == 0 {
				continue // a part the model has no nodes for can't be drawn or checked
			}
			s.Parts = append(s.Parts, sp)
		}
		if len(s.Parts) > 0 {
			out = append(out, s)
		}
	}
	return out
}

// groupNames: the option nodes of these descriptor groups (ids without ^), for picks._names.
func groupNames(groups map[string][]string, ids []string) []string {
	var names []string
	for _, g := range ids {
		id := strings.ToUpper(strings.TrimPrefix(strings.TrimSpace(g), "^"))
		if plainTableID(id) {
			names = append(names, groups[id]...)
		}
	}
	return names
}

// picks may carry "_groups" (descriptor groups joined with ","): they become "_names", so the page can draw a ship
// built at the fabricator from what its save entry holds.
func resolvePickGroups(picks map[string]string) {
	gs := picks["_groups"]
	if gs == "" {
		return
	}
	delete(picks, "_groups")
	tab, _ := travellerGroups()
	if ns := groupNames(tab, strings.Split(gs, ",")); len(ns) > 0 {
		if picks["_names"] != "" {
			ns = append(ns, picks["_names"])
		}
		picks["_names"] = strings.Join(ns, "|")
	}
}

// GET /api/model/shipbuild?kind=fighter&groups=FIGHT_COCKAB,FIGHT_ENGIC,FIGHT_WINGA -> {scene, slots, names (the
// option nodes of those groups), colours (the palette colours that ship shows)}
func handleShipBuild(w http.ResponseWriter, r *http.Request) {
	k, ok := shipKinds[r.URL.Query().Get("kind")]
	if !ok {
		http.Error(w, "unknown kind of ship", http.StatusBadRequest)
		return
	}
	res := map[string]any{"scene": k.Scene}
	tab, err := travellerGroups()
	if err != nil {
		res["error"] = err.Error()
		writeJSON(w, res)
		return
	}
	if t := findGameFile("/modularcustomisationdatatable.mbin"); t != "" {
		if raw, err := gameFile(t); err == nil {
			res["slots"] = shipSlotsFrom(raw, tab, k.Slots)
		}
	}
	if _, err := loadScene(k.Scene); err != nil {
		res["error"] = err.Error()
		writeJSON(w, res)
		return
	}
	names := groupNames(tab, travellerGroupsParam(r))
	res["names"] = names
	if len(names) > 0 {
		out := &meshOut{onlyDepth: 1, collect: true}
		if err := buildMesh(k.Scene, map[string]string{"_names": strings.Join(names, "|")}, "", 0, out, identity(), 0); err == nil {
			res["colours"] = modelPalettes(out.parts)
		}
	}
	writeJSON(w, res)
}
