package main

// The app's own item library, built from the owner's No Man's Sky install: item names, types,
// stack sizes and icons read from the game's archives and cached in %LOCALAPPDATA%\HarmoniousSaveEditor\
// itemlib. Nothing from the game is bundled with the app; each player builds it from their own copy,
// and it is rebuilt when the game's archives change after an update.

import (
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const itemlibVersion = 5 // 2: words, frigate traits and settlement perks; 3: expedition, Twitch and platform rewards; 4: biome odds; 5: Dead-to-Exotic share

type libItem struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Type   string `json:"type"` // Substance, Product, Technology
	Icon   string `json:"icon,omitempty"`
	Sub    string `json:"sub,omitempty"`
	Cat    string `json:"cat,omitempty"`
	Stack  int    `json:"stack,omitempty"`  // stack multiplier (products, substances)
	Charge int    `json:"charge,omitempty"` // charge amount (technology)
	Proc   bool   `json:"proc,omitempty"`   // procedural upgrade; saves add #seed to the id
}

type libFile struct {
	Version  int               `json:"version"`
	Built    string            `json:"built"`
	Game     string            `json:"game"`
	Stamp    map[string]string `json:"stamp"`
	Items    []libItem         `json:"items"`
	Missing  []string          `json:"missingIcons,omitempty"`
	Words    []libWord         `json:"words,omitempty"`
	Traits   []libTrait        `json:"traits,omitempty"`
	Perks    []libPerk         `json:"perks,omitempty"`
	Ranks    []libRanks        `json:"ranks,omitempty"`
	Biomes   *libBiomes        `json:"biomes,omitempty"`
	Seasons  []libSeason       `json:"seasons,omitempty"`
	Rewards  []libReward       `json:"rewards,omitempty"`
	Twitch   []libTwitch       `json:"twitch,omitempty"`
	Platform []libPlatform     `json:"platform,omitempty"`
}

// an expedition (historicalseasondatatable): rewards point at it by its display number
type libSeason struct {
	Num   int    `json:"num"`
	Name  string `json:"name"`
	Title string `json:"title,omitempty"` // the player title it unlocks
	Desc  string `json:"desc,omitempty"`
	Icon  string `json:"icon,omitempty"`
	Final string `json:"final,omitempty"` // the reward for finishing it
}

// an expedition reward (unlockableseasonrewards): unlocked per account in UnlockedSeasonRewards
type libReward struct {
	ID     string `json:"id"`
	Season int    `json:"season"`           // first of SeasonIds
	Stage  int    `json:"stage"`            // first of StageIds (-1: not tied to a stage)
	Must   bool   `json:"must,omitempty"`   // MustBeUnlocked
	Switch bool   `json:"switch,omitempty"` // SwitchExclusive
}

// a Twitch drop (unlockabletwitchrewards): unlocked per account in UnlockedTwitchRewards
type libTwitch struct {
	ID      string `json:"id"`
	Product string `json:"product"`
	Group   string `json:"group,omitempty"`
}

// a platform reward (unlockableplatformrewards): unlocked per account in UnlockedPlatformRewards
type libPlatform struct {
	ID      string `json:"id"`
	Product string `json:"product"`
}

// a stat with named levels (standing with each race and guild, journey milestones): the level is
// reached when the stat's value is at least Levels[i].Value
// biome odds per star colour (GcBiomeListPerStarType): weights in GcBiomeType order, not yet normalised
type libBiomes struct {
	Star            [][]float64 `json:"star"`        // Yellow, Green, Blue, Red, Purple (GcGalaxyStarTypes)
	StarPrime       [][]float64 `json:"prime"`       // the same for prime planets
	AbandonedYellow []float64   `json:"abandoned"`   // yellow stars in empty galaxies (7, 19, 27, 39…)
	LushYellow      []float64   `json:"lush"`        // yellow stars in lush galaxies (10, 12, 30, 32…)
	DeadToWeird     float64     `json:"deadToWeird"` // the share of Dead planets made Exotic instead (ConvertDeadToWeird)
}

type libRanks struct {
	ID     string    `json:"id"`
	Title  string    `json:"title"`
	Levels []libRank `json:"levels"`
}

type libRank struct {
	Name  string  `json:"name"`
	Value float64 `json:"value"`
}

// a word of an alien language: the save marks a word learnt per race in KnownWordGroups (by Group)
type libWord struct {
	ID    string `json:"id"`
	Text  string `json:"text"`
	Group string `json:"group"`
	Race  int    `json:"race"` // GcAlienRace: Traders, Warriors, Explorers, Robots, Atlas, Diplomats, Exotics, None, Builders
}

// a frigate trait (FleetFrigates TraitIDs)
type libTrait struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Stat     int    `json:"stat"`     // GcFrigateStatType
	Strength int    `json:"strength"` // GcFrigateTraitStrength: 0-2 negative, 3-5 tertiary, 6-8 secondary, 9 primary
}

// a settlement perk (SettlementStatesV2 Perks)
type libPerk struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Desc     string `json:"desc,omitempty"`
	Negative bool   `json:"negative,omitempty"`
	Blessing bool   `json:"blessing,omitempty"`
	Job      bool   `json:"job,omitempty"`
}

type libStatus struct {
	State string `json:"state"` // none, building, ready, error
	Phase string `json:"phase,omitempty"`
	Done  int    `json:"done,omitempty"`
	Total int    `json:"total,omitempty"`
	Error string `json:"error,omitempty"`
}

var (
	libMu     sync.Mutex
	libState  = libStatus{State: "none"}
	libLoaded *libFile
)

func itemlibDir() string { return filepath.Join(appDir, "itemlib") }

// ------------------------------------------------------------------ finding the game

// gameBanks finds GAMEDATA\PCBANKS: the folder set in settings, then every Steam library.
func gameBanks() string {
	try := func(p string) string {
		if p == "" {
			return ""
		}
		for _, c := range []string{p, filepath.Join(p, "GAMEDATA", "PCBANKS"), filepath.Join(p, "PCBANKS")} {
			if st, err := os.Stat(c); err == nil && st.IsDir() {
				if m, _ := filepath.Glob(filepath.Join(c, "NMSARC.*.pak")); len(m) > 0 {
					return c
				}
			}
		}
		return ""
	}
	if b := try(os.Getenv("HSE_GAME")); b != "" {
		return b
	}
	renderMu.Lock()
	custom := settings.Game
	renderMu.Unlock()
	if b := try(custom); b != "" {
		return b
	}
	for _, lib := range steamLibraries() {
		if b := try(filepath.Join(lib, "steamapps", "common", "No Man's Sky")); b != "" {
			return b
		}
	}
	return ""
}

var vdfPathRe = regexp.MustCompile(`"path"\s+"([^"]+)"`)

func steamLibraries() []string {
	seen, out := map[string]bool{}, []string{}
	add := func(p string) {
		p = filepath.Clean(p)
		if !seen[strings.ToLower(p)] {
			seen[strings.ToLower(p)] = true
			out = append(out, p)
		}
	}
	for _, root := range steamRoots() {
		add(root)
		if b, err := os.ReadFile(filepath.Join(root, "steamapps", "libraryfolders.vdf")); err == nil {
			for _, m := range vdfPathRe.FindAllStringSubmatch(string(b), -1) {
				add(strings.ReplaceAll(m[1], `\\`, `\`))
			}
		}
	}
	return out
}

// stampOf records each archive's size and time, so a game update is noticed.
func stampOf(banks string, names []string) map[string]string {
	st := map[string]string{}
	for _, n := range names {
		if fi, err := os.Stat(filepath.Join(banks, n)); err == nil {
			st[n] = fmt.Sprintf("%d/%d", fi.Size(), fi.ModTime().Unix())
		}
	}
	return st
}

// ------------------------------------------------------------------ building

var locMarkup = regexp.MustCompile(`<[A-Z_]*>|<>`)

type libBuilder struct {
	banks string
	paks  map[string]*hgpak
	loc   map[string]string
}

func (b *libBuilder) progress(phase string, done, total int) {
	libMu.Lock()
	libState = libStatus{State: "building", Phase: phase, Done: done, Total: total}
	libMu.Unlock()
}

// find returns the archive holding a file, trying the usual archive first.
func (b *libBuilder) find(file, usual string) (*hgpak, error) {
	if p := b.paks[usual]; p != nil && p.Has(file) {
		return p, nil
	}
	for _, p := range b.paks {
		if p.Has(file) {
			return p, nil
		}
	}
	return nil, fmt.Errorf("%s wasn't found in the game's archives", file)
}

func (b *libBuilder) text(key string) string {
	if v, ok := b.loc[key]; ok {
		return strings.TrimSpace(locMarkup.ReplaceAllString(v, ""))
	}
	return ""
}

func (b *libBuilder) name(lower, upper, id string) string {
	if v := b.text(lower); v != "" {
		if strings.ToUpper(v) == v && strings.ToLower(v) != v { // a few "lower" names are all capitals
			return strings.Title(strings.ToLower(v)) //nolint:staticcheck
		}
		return v
	}
	if v := b.text(upper); v != "" {
		return strings.Title(strings.ToLower(v)) //nolint:staticcheck // plain ASCII names
	}
	return id
}

func iconFile(p string) string {
	p = strings.ToLower(strings.ReplaceAll(p, `\`, "/"))
	p = strings.TrimPrefix(p, "textures/ui/frontend/icons/")
	p = strings.TrimSuffix(p, ".dds")
	return strings.ReplaceAll(p, "/", ".") + ".png"
}

func buildItemLibrary() (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("unexpected problem reading the game files: %v", r)
		}
	}()
	banks := gameBanks()
	if banks == "" {
		return errors.New("No Man's Sky wasn't found. Set the game folder on the Item names page")
	}
	b := &libBuilder{banks: banks, paks: map[string]*hgpak{}, loc: map[string]string{}}
	defer func() {
		for _, p := range b.paks {
			p.Close()
		}
	}()
	entries, err := os.ReadDir(banks)
	if err != nil {
		return err
	}
	var pakNames []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".pak") {
			pakNames = append(pakNames, e.Name())
		}
	}
	sort.Strings(pakNames)
	// the three archives that hold what we need are opened first; the rest only if those moved
	for _, want := range []string{"NMSARC.Precache.pak", "NMSARC.MetadataEtc.pak", "NMSARC.TexUI.pak"} {
		for _, n := range pakNames {
			if strings.EqualFold(n, want) {
				if p, err := openPak(filepath.Join(banks, n)); err == nil {
					b.paks[want] = p
				}
			}
		}
	}
	const prodT, substT, techT, procT = "metadata/reality/tables/nms_reality_gcproducttable.mbin", "metadata/reality/tables/nms_reality_gcsubstancetable.mbin",
		"metadata/reality/tables/nms_reality_gctechnologytable.mbin", "metadata/reality/tables/nms_reality_gcproceduraltechnologytable.mbin"
	if b.paks["NMSARC.Precache.pak"] == nil || !b.paks["NMSARC.Precache.pak"].Has(prodT) || b.paks["NMSARC.TexUI.pak"] == nil {
		for i, n := range pakNames {
			b.progress("Looking through the game archives", i, len(pakNames))
			if _, open := b.paks[n]; open {
				continue
			}
			if p, err := openPak(filepath.Join(banks, n)); err == nil {
				b.paks[n] = p
			}
		}
	}

	// English text: every language file the archives list
	b.progress("Reading the game's English text", 0, 0)
	var langFiles []string
	for _, p := range b.paks {
		for f := range p.files {
			if strings.HasPrefix(f, "language/") && strings.HasSuffix(f, "_english.mbin") && !strings.HasSuffix(f, "_usenglish.mbin") {
				langFiles = append(langFiles, f)
			}
		}
	}
	sort.Strings(langFiles)
	for _, f := range langFiles {
		p, _ := b.find(f, "NMSARC.MetadataEtc.pak")
		raw, err := p.Read(f)
		if err != nil {
			return fmt.Errorf("reading %s: %w", f, err)
		}
		m, err := openMbin(raw, 0xDE95E805E17A7B69, f)
		if err != nil {
			return err
		}
		a, n := m.list(0x20)
		for i := 0; i < n; i++ {
			e := a + i*0x130
			k := m.fstr(e, 0x20)
			if _, dup := b.loc[k]; !dup {
				if v := m.vstr(e + 0x40); v != "" {
					b.loc[k] = v
				}
			}
		}
	}
	if len(b.loc) == 0 {
		return errors.New("the game's English text wasn't found")
	}

	table := func(file string, guid uint64) (*mbin, error) {
		p, err := b.find(file, "NMSARC.Precache.pak")
		if err != nil {
			return nil, err
		}
		raw, err := p.Read(file)
		if err != nil {
			return nil, fmt.Errorf("reading %s: %w", file, err)
		}
		return openMbin(raw, guid, filepath.Base(file))
	}
	b.progress("Reading the item tables", 0, 0)
	var items []libItem
	iconPaths := map[string]string{} // png name -> path in the archive

	icon := func(path string) string {
		if path == "" {
			return ""
		}
		f := iconFile(path)
		iconPaths[f] = strings.ToLower(path)
		return f
	}

	// substances
	m, err := table(substT, 0x7E06AA18E2BF796D)
	if err != nil {
		return err
	}
	substCat := []string{"Fuel", "Metal", "Catalyst", "Stellar", "Flora", "Earth", "Exotic", "Special", "BuildingPart"}
	a, n := m.list(0x20 + 0x10)
	for i := 0; i < n; i++ {
		e := a + i*0x1A0
		id := m.fstr(e+0xC8, 0x10)
		if id == "" {
			continue
		}
		it := libItem{ID: "^" + id, Type: "Substance", Name: b.name(m.fstr(e+0x154, 0x20), m.fstr(e+0x134, 0x20), id),
			Icon: icon(m.vstr(e + 0xA0)), Sub: b.text(m.vstr(e + 0xD8)), Stack: int(m.i32(e + 0x12C))}
		if c := int(m.i32(e + 0x110)); c >= 0 && c < len(substCat) {
			it.Cat = substCat[c]
		}
		items = append(items, it)
	}

	// products: the main table, then base parts and customisation parts (same layout)
	prodCat := []string{"Component", "Consumable", "Tradeable", "Curiosity", "BuildingPart", "Procedural", "Emote", "CustomisationPart", "CreatureEgg", "Fish", "ExhibitBone", "SpaceSalvage"}
	seen := map[string]bool{}
	for ti, file := range []string{prodT, "metadata/reality/tables/nms_basepartproducts.mbin", "metadata/reality/tables/nms_modularcustomisationproducts.mbin"} {
		m, err = table(file, 0xD648571CB22CFD4B)
		if err != nil {
			if ti == 0 {
				return err
			}
			log.Printf("item library: skipping %s: %v", file, err)
			continue
		}
		a, n = m.list(0x20)
		for i := 0; i < n; i++ {
			e := a + i*0x300
			id := m.fstr(e+0x150, 0x10)
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			it := libItem{ID: "^" + id, Type: "Product", Name: b.name(m.fstr(e+0x270, 0x80), m.fstr(e+0x1F0, 0x80), id),
				Icon: icon(m.vstr(e + 0xC8)), Sub: b.text(m.vstr(e + 0x170)), Stack: int(m.i32(e + 0x1E0))}
			if c := int(m.i32(e + 0x1E8)); c >= 0 && c < len(prodCat) {
				it.Cat = prodCat[c]
			}
			items = append(items, it)
		}
	}

	// technology
	m, err = table(techT, 0x9373B1DC2FEEE859)
	if err != nil {
		return err
	}
	techIcon, techName, techSub := map[string]string{}, map[string]string{}, map[string]string{}
	a, n = m.list(0x20)
	for i := 0; i < n; i++ {
		e := a + i*0x2E0
		id := m.fstr(e+0x108, 0x10)
		if id == "" {
			continue
		}
		it := libItem{ID: "^" + id, Type: "Technology", Name: b.name(m.fstr(e+0x244, 0x80), m.fstr(e+0x1C4, 0x80), id),
			Icon: icon(m.vstr(e + 0xB0)), Sub: b.text(m.vstr(e + 0x168)), Charge: int(m.i32(e + 0x198))}
		techIcon[id], techName[id], techSub[id] = it.Icon, it.Name, it.Sub
		items = append(items, it)
	}

	// procedural upgrades: "S-Class Thermal Protection Upgrade", with the icon of the tech they upgrade
	m, err = table(procT, 0x63A7DEF7997212ED)
	if err != nil {
		return err
	}
	a, n = m.list(0x20)
	for i := 0; i < n; i++ {
		e := a + i*0x290
		id := m.fstr(e+0x40, 0x10)
		if id == "" {
			continue
		}
		tpl := m.fstr(e+0x60, 0x10)
		base := b.name(m.fstr(e+0x184, 0x80), m.fstr(e+0x104, 0x80), "")
		if base == "" {
			base = techName[tpl]
		}
		// the subtitle is either a pattern ("S-Class %NAME% Upgrade") or the module's own name ("Forbidden Exosuit Module")
		name, sub := base, techSub[tpl]
		if f := b.text(m.fstr(e+0x204, 0x80)); strings.Contains(f, "%NAME%") {
			name = strings.ReplaceAll(f, "%NAME%", base)
		} else if f != "" {
			name, sub = f, base
		}
		if name == "" {
			name = id
		}
		items = append(items, libItem{ID: "^" + id, Type: "Technology", Name: name, Icon: techIcon[tpl], Sub: sub, Proc: true})
	}

	// words, frigate traits and settlement perks: nice to have, so a layout change only skips them
	var words []libWord
	if m, err := table("metadata/reality/tables/nms_dialog_gcalienspeechtable.mbin", 0x29A23A2F80FBE6D8); err != nil {
		log.Printf("item library: skipping words: %v", err)
	} else {
		a, n := m.list(0x20)
		for i := 0; i < n; i++ {
			e := a + i*0x68
			id, grp := m.fstr(e+0x40, 0x10), m.fstr(e, 0x20)
			if id == "" || grp == "" {
				continue
			}
			txt := b.text(m.fstr(e+0x20, 0x20))
			if txt == "" {
				txt = strings.ToLower(id)
			}
			words = append(words, libWord{ID: "^" + id, Text: txt, Group: "^" + grp, Race: int(m.i32(e + 0x5C))})
		}
	}
	var traits []libTrait
	if m, err := table("metadata/reality/tables/frigatetraittable.mbin", 0x59E8152F3D9078A8); err != nil {
		log.Printf("item library: skipping frigate traits: %v", err)
	} else {
		a, n := m.list(0x20)
		for i := 0; i < n; i++ {
			e := a + i*0x68
			id := m.fstr(e+0x20, 0x10)
			if id == "" {
				continue
			}
			name := b.text(m.fstr(e, 0x20))
			if name == "" {
				name = id
			}
			traits = append(traits, libTrait{ID: "^" + id, Name: name, Stat: int(m.i32(e + 0x5C)), Strength: int(m.i32(e + 0x60))})
		}
	}
	var perks []libPerk
	if m, err := table("metadata/reality/tables/settlementperkstable.mbin", 0x34625E03A674E543); err != nil {
		log.Printf("item library: skipping settlement perks: %v", err)
	} else {
		a, n := m.list(0x20)
		for i := 0; i < n; i++ {
			e := a + i*0x78
			id := m.fstr(e+0x50, 0x10)
			if id == "" {
				continue
			}
			name := b.text(m.fstr(e+0x20, 0x20))
			if name == "" {
				name = id
			}
			perks = append(perks, libPerk{ID: "^" + id, Name: name, Desc: b.text(m.fstr(e, 0x20)), Negative: m.u8(e+0x72) != 0, Blessing: m.u8(e+0x70) != 0, Job: m.u8(e+0x71) != 0})
		}
	}

	// rewards: expeditions (seasons), their rewards, Twitch drops and platform rewards
	var seasons []libSeason
	var rewards []libReward
	var twitch []libTwitch
	var platform []libPlatform
	if m, err := table("metadata/reality/tables/historicalseasondatatable.mbin", 0xF917FBD15953731A); err != nil {
		log.Printf("item library: skipping expeditions: %v", err)
	} else {
		a, n := m.list(0x20)
		for i := 0; i < n; i++ {
			e := a + i*0xB8
			num := int(m.i32(e + 0x88))
			if num <= 0 || num > 500 {
				continue
			}
			name := b.text(m.fstr(e, 0x20))
			if name == "" {
				name = fmt.Sprintf("Expedition %d", num)
			}
			seasons = append(seasons, libSeason{Num: num, Name: name, Title: b.text(m.fstr(e+0x40, 0x20)), Desc: b.text(m.fstr(e+0x94, 0x20)), Icon: icon(m.vstr(e + 0x60)), Final: "^" + m.fstr(e+0x78, 0x10)})
		}
	}
	ints := func(m *mbin, p int) []int {
		a, n := m.list(p)
		out := []int{}
		for k := 0; k < n && k < 64; k++ {
			out = append(out, int(m.i32(a+4*k)))
		}
		return out
	}
	if m, err := table("metadata/reality/tables/unlockableseasonrewards.mbin", 0x5D906A07E9EA8A9F); err != nil {
		log.Printf("item library: skipping expedition rewards: %v", err)
	} else {
		a, n := m.list(0x20)
		for i := 0; i < n; i++ {
			e := a + i*0x78
			id := m.fstr(e+0x40, 0x10)
			if id == "" || !printable(id) {
				continue
			}
			r := libReward{ID: "^" + id, Stage: -1, Must: m.u8(e+0x70) != 0, Switch: m.u8(e+0x71) != 0}
			if s := ints(m, e+0x50); len(s) > 0 {
				r.Season = s[0]
			}
			if s := ints(m, e+0x60); len(s) > 0 {
				r.Stage = s[0]
			}
			rewards = append(rewards, r)
		}
	}
	if m, err := table("metadata/reality/tables/unlockabletwitchrewards.mbin", 0xDAE66604A5D6F5D4); err != nil {
		log.Printf("item library: skipping Twitch rewards: %v", err)
	} else {
		a, n := m.list(0x20)
		for i := 0; i < n; i++ {
			e := a + i*0x30
			if id := m.fstr(e+0x20, 0x10); id != "" && printable(id) {
				t := libTwitch{ID: "^" + id, Product: "^" + m.fstr(e+0x10, 0x10)}
				if gr := m.fstr(e, 0x10); gr != "" {
					t.Group = "^" + gr
				}
				twitch = append(twitch, t)
			}
		}
	}
	if m, err := table("metadata/reality/tables/unlockableplatformrewards.mbin", 0x6813221B24CD0086); err != nil {
		log.Printf("item library: skipping platform rewards: %v", err)
	} else {
		a, n := m.list(0x20)
		for i := 0; i < n; i++ {
			e := a + i*0x20
			if id := m.fstr(e+0x10, 0x10); id != "" && printable(id) {
				platform = append(platform, libPlatform{ID: "^" + id, Product: "^" + m.fstr(e, 0x10)})
			}
		}
	}

	// stat levels (metadata/gamestate/stats, in MetadataEtc): GcLeveledStatData is 0x610 bytes, 11 levels of
	// 0x80 at the start (name key at 0, GcStatValueData at 0x70: denominator, float, int), the id at 0x5F8.
	// Anything that doesn't look right is dropped, so a quiet layout change only loses the rank names.
	var ranks []libRanks
	if p, err := b.find("metadata/gamestate/stats/leveledstatstable.mbin", "NMSARC.MetadataEtc.pak"); err != nil {
		log.Printf("item library: skipping stat levels: %v", err)
	} else if raw, err := p.Read("metadata/gamestate/stats/leveledstatstable.mbin"); err != nil {
		log.Printf("item library: skipping stat levels: %v", err)
	} else if m, err := openMbin(raw, 0x8C5EEFF51B0E1C86, "leveledstatstable.mbin"); err != nil {
		log.Printf("item library: skipping stat levels: %v", err)
	} else {
		a, n := m.list(0x20)
		for i := 0; i < n; i++ {
			e := a + i*0x610
			id := m.fstr(e+0x5F8, 0x10)
			if id == "" || !printable(id) {
				continue
			}
			r := libRanks{ID: "^" + id, Title: b.text(m.fstr(e+0x5C0, 0x20))}
			last, ok := math.Inf(-1), true
			for l := 0; l < 11; l++ {
				le := e + l*0x80
				key := m.fstr(le, 0x20)
				if key == "" {
					break
				}
				v := float64(m.i32(le + 0x78))
				if f := float64(math.Float32frombits(uint32(m.i32(le + 0x74)))); v == 0 && f != 0 && !math.IsNaN(f) {
					v = f
				}
				if v < last {
					ok = false
				}
				last = v
				name := b.text(key)
				if name == "" {
					name = key
				}
				r.Levels = append(r.Levels, libRank{Name: name, Value: v})
			}
			if ok && len(r.Levels) > 0 {
				ranks = append(ranks, r)
			}
		}
	}

	// biome odds (metadata/simulation/solarsystem/biomes/biomelistperstartype.mbin): GcBiomeListPerStarType is
	// StarType[5] of GcBiomeList (0x88 bytes: 17 float BiomeProbability, then 17 float PrimeBiomeProbability),
	// then AbandonedYellow at 0x2A8 and LushYellow at 0x330. Dropped if the numbers don't look like weights.
	var biomes *libBiomes
	const biomeFile = "metadata/simulation/solarsystem/biomes/biomelistperstartype.mbin"
	if p, err := b.find(biomeFile, "NMSARC.Precache.pak"); err != nil {
		log.Printf("item library: skipping biome odds: %v", err)
	} else if raw, err := p.Read(biomeFile); err != nil {
		log.Printf("item library: skipping biome odds: %v", err)
	} else if bi, err := parseBiomes(raw); err != nil {
		log.Printf("item library: skipping biome odds: %v", err)
	} else {
		biomes = bi
	}

	// icons: read in order from the texture archive, decoded and shrunk on every core
	if err := os.MkdirAll(filepath.Join(itemlibDir(), "icons"), 0o755); err != nil {
		return err
	}
	names := make([]string, 0, len(iconPaths))
	for f := range iconPaths {
		names = append(names, f)
	}
	// read in archive order so each compressed chunk is only unpacked once
	offsetOf := func(f string) int64 {
		if p, err := b.find(iconPaths[f], "NMSARC.TexUI.pak"); err == nil {
			return p.files[iconPaths[f]].off
		}
		return -1
	}
	sort.Slice(names, func(i, j int) bool { return offsetOf(names[i]) < offsetOf(names[j]) })
	type job struct {
		name string
		dds  []byte
	}
	jobs := make(chan job, 64)
	var wg sync.WaitGroup
	var missMu sync.Mutex
	var missing []string
	var done int
	for w := 0; w < runtime.NumCPU(); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				img, err := decodeDDS(j.dds)
				if err == nil {
					var f *os.File
					tmp := filepath.Join(itemlibDir(), "icons", j.name+".tmp")
					if f, err = os.Create(tmp); err == nil {
						err = (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(f, shrink(img, 128))
						f.Close()
						if err == nil {
							err = os.Rename(tmp, filepath.Join(itemlibDir(), "icons", j.name))
						}
					}
				}
				missMu.Lock()
				if err != nil {
					missing = append(missing, j.name+": "+err.Error())
				}
				done++
				if done%25 == 0 {
					b.progress("Converting icons", done, len(names))
				}
				missMu.Unlock()
			}
		}()
	}
	for _, f := range names {
		p, err := b.find(iconPaths[f], "NMSARC.TexUI.pak")
		var raw []byte
		if err == nil {
			raw, err = p.Read(iconPaths[f])
		}
		if err != nil {
			missMu.Lock()
			missing = append(missing, f+": not in the archives")
			done++
			missMu.Unlock()
			continue
		}
		jobs <- job{f, raw}
	}
	close(jobs)
	wg.Wait()

	stampNames := []string{}
	for n := range b.paks {
		stampNames = append(stampNames, n)
	}
	sort.Strings(stampNames)
	lib := &libFile{Version: itemlibVersion, Built: time.Now().Format(time.RFC3339), Game: banks, Stamp: stampOf(banks, stampNames), Items: items, Missing: missing, Words: words, Traits: traits, Perks: perks, Ranks: ranks, Biomes: biomes, Seasons: seasons, Rewards: rewards, Twitch: twitch, Platform: platform}
	out, _ := json.Marshal(lib)
	if err := atomicWrite(filepath.Join(itemlibDir(), "items.json"), out); err != nil {
		return err
	}
	libMu.Lock()
	libLoaded = lib
	libMu.Unlock()
	log.Printf("item library: %d items, %d icons (%d missing), %d words, %d frigate traits, %d perks, %d ranked stats, %d expeditions, %d rewards, %d Twitch drops from %s", len(items), len(names)-len(missing), len(missing), len(words), len(traits), len(perks), len(ranks), len(seasons), len(rewards), len(twitch), banks)
	return nil
}

func loadItemLibrary() {
	libMu.Lock()
	defer libMu.Unlock()
	if libLoaded != nil {
		return
	}
	b, err := os.ReadFile(filepath.Join(itemlibDir(), "items.json"))
	if err != nil {
		return
	}
	var lib libFile
	if json.Unmarshal(b, &lib) == nil && lib.Version == itemlibVersion && len(lib.Items) > 0 {
		libLoaded = &lib
		libState = libStatus{State: "ready"}
	}
}

// ------------------------------------------------------------------ handlers

// GET: status (and whether the game has changed since the last build). POST {"game": path}: remember the
// game folder. POST {"build": true}: build in the background.
func handleItemLib(w http.ResponseWriter, r *http.Request) {
	startRenderWorker() // loads settings
	loadItemLibrary()
	if r.Method == http.MethodPost {
		var in struct {
			Build bool    `json:"build"`
			Game  *string `json:"game"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if in.Game != nil {
			renderMu.Lock()
			settings.Game = strings.Trim(*in.Game, `" `)
			_ = saveSettings()
			renderMu.Unlock()
		}
		if in.Build {
			libMu.Lock()
			busy := libState.State == "building"
			if !busy {
				libState = libStatus{State: "building", Phase: "Starting"}
			}
			libMu.Unlock()
			if !busy {
				go func() {
					err := buildItemLibrary()
					libMu.Lock()
					if err != nil {
						log.Printf("item library: %v", err)
						libState = libStatus{State: "error", Error: err.Error()}
					} else {
						libState = libStatus{State: "ready"}
					}
					libMu.Unlock()
				}()
			}
		}
	}
	libMu.Lock()
	st, lib := libState, libLoaded
	libMu.Unlock()
	banks := gameBanks()
	out := map[string]any{"status": st, "game": banks}
	renderMu.Lock()
	out["gameSet"] = settings.Game
	renderMu.Unlock()
	if lib != nil {
		names := []string{}
		for n := range lib.Stamp {
			names = append(names, n)
		}
		stale := false
		if banks != "" {
			now := stampOf(banks, names)
			for n, s := range lib.Stamp {
				if now[n] != s {
					stale = true
				}
			}
		}
		out["items"], out["built"], out["missingIcons"], out["stale"], out["builtFrom"] = len(lib.Items), lib.Built, len(lib.Missing), stale, lib.Game
	}
	writeJSON(w, out)
}

func handleItemLibItems(w http.ResponseWriter, r *http.Request) {
	loadItemLibrary()
	p := filepath.Join(itemlibDir(), "items.json")
	if !fileExists(p) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, p)
}

var libIconRe = regexp.MustCompile(`^[a-z0-9_\-.]+\.png$`)

func handleItemLibIcon(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if !libIconRe.MatchString(name) {
		http.Error(w, "bad icon name", http.StatusBadRequest)
		return
	}
	p := filepath.Join(itemlibDir(), "icons", name)
	if !fileExists(p) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, p)
}

func printable(s string) bool {
	for _, c := range s {
		if c < 0x20 || c > 0x7E {
			return false
		}
	}
	return true
}

// parseBiomes reads GcBiomeListPerStarType: StarType[5] of GcBiomeList (0x88 bytes: 17 float BiomeProbability,
// then 17 float PrimeBiomeProbability), then AbandonedYellow at 0x2A8 and LushYellow at 0x330.
func parseBiomes(raw []byte) (*libBiomes, error) {
	m, err := openMbin(raw, 0x816993EB69267DD2, "biomelistperstartype.mbin")
	if err != nil {
		return nil, err
	}
	const base = 0x20
	if !m.ok(base, 0x3DC) {
		return nil, errors.New("biomelistperstartype.mbin is too short")
	}
	list := func(at int) []float64 {
		out := make([]float64, 17)
		sum := 0.0
		for k := range out {
			f := float64(math.Float32frombits(uint32(m.i32(base + at + k*4))))
			if math.IsNaN(f) || f < 0 || f > 1e6 {
				return nil
			}
			out[k] = f
			sum += f
		}
		if sum <= 0 {
			return nil
		}
		return out
	}
	bi := &libBiomes{AbandonedYellow: list(0x2A8), LushYellow: list(0x330)}
	if f := float64(math.Float32frombits(uint32(m.i32(base + 0x3D8)))); f >= 0 && f <= 1 {
		bi.DeadToWeird = f
	}
	for s := 0; s < 5; s++ {
		a := list(s * 0x88)
		if a == nil {
			return nil, errors.New("biome odds don't look like weights")
		}
		bi.Star = append(bi.Star, a)
		bi.StarPrime = append(bi.StarPrime, list(s*0x88+0x44))
	}
	return bi, nil
}
