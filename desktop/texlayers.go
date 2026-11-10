package main

// The traveller's own colours (owner, 2026-11-10). The game paints a player part's colour texture from layers at run
// time: next to the material's colour texture (VYKEENTORSO.BASE.DDS) sits VYKEENTORSO.TEXTURE.MBIN, a
// TkProceduralTextureList (libMBIN 2026-11: Layers[8] of 0x48 bytes at 0x00: Group 0x00, LinkedLayer 0x10, Name 0x20
// (16-byte strings), Textures list 0x30 of TkProceduralTexture, 0x60 bytes each: AverageColour 0x00, Name 0x10
// (0x20), TextureName 0x30 (a variable string), Palette 0x40 {ColourAlt, Index, Palette}, Probability 0x4C,
// TextureGameplayUse 0x50, Multiply 0x54, OverrideAverageColour 0x55). Layers run from the top one down to BASE.
// Each layer's texture is drawn in a stand-in colour; its alpha is where the layer shows. The save's
// CustomData.Colours give a colour per palette (Custom_Torso…) and ColourAlt (Primary, Alternative1…), and
// CustomData.TextureOptions pick which texture of a layer is worn (^TORSO_VYK -> ^1): the option group
// (charactercustomisationtextureoptiondata.mbin, GcCustomisationTextureOptionGroup: Group 0x00, Layer 0x10,
// TextureOptionsID 0x40) names the layer's Group and Name. Checked 2026-11-10 on the owner's files (13 layered
// textures in their outfit, every layer texture present).
//
// Recolouring keeps the texture's own shading: the layer's hue and saturation become the palette colour's, and its
// brightness moves by the difference between the palette colour and the layer's average colour.

import (
	"crypto/sha1"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"image"
	"math"
	"path"
	"strings"
	"sync"
)

var paletteNames = strings.Fields(`Grass Plant Leaf Wood Rock Stone Crystal Sand Dirt Metal Paint Plastic Fur Scale
Feather Water Cloud Sky Space Underbelly Undercoat Snow SkyHorizon SkyFog SkyHeightFog SkySunset SkyNight WaterNear
SpaceCloud SpaceBottom SpaceSolar SpaceLight Warrior Scientific Trader WarriorAlt ScientificAlt TraderAlt
RockSaturated RockLight RockDark PlanetRing Custom_Head Custom_Torso Custom_Chest_Armour Custom_Backpack Custom_Arms
Custom_Hands Custom_Legs Custom_Feet Cave GrassAlt BioShip_Body BioShip_Underbelly BioShip_Cockpit SailShip_Sails
Freighter FreighterPaint PirateBase PirateAlt SpaceStationBase SpaceStationAlt SpaceStationLights DeepWaterBioLum
Slime Hulk`)

var colourAlts = []string{"Primary", "Alternative1", "Alternative2", "Alternative3", "Alternative4", "Unique", "MatchGround", "None"}

type ptTex struct {
	name, file   string
	alt, palette string
	avg          [4]float32
	override     bool
}

type ptLayer struct {
	group, name string
	texs        []ptTex
}

func cleanName(s string) string { return strings.TrimSpace(strings.TrimPrefix(s, "\ufeff")) }

func parseProceduralTexture(raw []byte) []ptLayer {
	if len(raw) < 0x20+8*0x48 || binary.LittleEndian.Uint32(raw) != 0xCCCCCCCC {
		return nil
	}
	m := &mbin{raw}
	var out []ptLayer
	for i := 0; i < 8; i++ {
		l := 0x20 + i*0x48
		ly := ptLayer{group: cleanName(m.fstr(l, 0x10)), name: cleanName(m.fstr(l+0x20, 0x10))}
		a, n := m.list(l + 0x30)
		for k := 0; k < n && k < 64; k++ {
			t := a + k*0x60
			if !m.ok(t, 0x60) {
				break
			}
			pt := ptTex{name: cleanName(m.fstr(t+0x10, 0x20)), file: normGamePath(m.vstr(t + 0x30)), override: raw[t+0x55] != 0}
			if alt := int(m.i32(t + 0x40)); alt >= 0 && alt < len(colourAlts) {
				pt.alt = colourAlts[alt]
			}
			if p := int(m.i32(t + 0x48)); p >= 0 && p < len(paletteNames) {
				pt.palette = paletteNames[p]
			}
			for c := 0; c < 4; c++ {
				pt.avg[c] = math.Float32frombits(binary.LittleEndian.Uint32(raw[t+c*4:]))
			}
			ly.texs = append(ly.texs, pt)
		}
		if ly.name != "" || len(ly.texs) > 0 {
			out = append(out, ly)
		}
	}
	return out
}

// travLook is the save's colours and texture choices, as the page sends them.
type travLook struct {
	Colours []struct {
		Palette string     `json:"p"`
		Alt     string     `json:"a"`
		Colour  [4]float64 `json:"c"`
	} `json:"c"`
	Options [][2]string `json:"t"` // [option group ID, option name], without ^
}

func parseLook(s string) *travLook {
	if s == "" {
		return nil
	}
	var l travLook
	if json.Unmarshal([]byte(s), &l) != nil || (len(l.Colours) == 0 && len(l.Options) == 0) {
		return nil
	}
	return &l
}

func (l *travLook) key() string {
	if l == nil {
		return ""
	}
	b, _ := json.Marshal(l)
	h := sha1.Sum(b)
	return hex.EncodeToString(h[:8])
}

func (l *travLook) colour(palette, alt string) ([3]float64, bool) {
	for _, c := range l.Colours {
		if strings.EqualFold(strings.TrimPrefix(c.Palette, "^"), palette) && strings.EqualFold(c.Alt, alt) {
			return [3]float64{c.Colour[0], c.Colour[1], c.Colour[2]}, true
		}
	}
	return [3]float64{}, false
}

var (
	texOptOnce sync.Once
	texOpts    map[string][2]string // option group ID -> layer Group, layer Name
)

func textureOptionGroups() map[string][2]string {
	texOptOnce.Do(func() {
		texOpts = map[string][2]string{}
		raw, err := gameFile("metadata/gamestate/playerdata/charactercustomisationtextureoptiondata.mbin")
		if err != nil {
			return
		}
		m := &mbin{raw}
		// each GcCustomisationTextureOptionGroup: Group, Layer and (0x40 on) TextureOptionsID, all 16-byte strings
		for o := 0x60; o+0x10 <= len(raw); o += 8 {
			id := cleanName(m.fstr(o, 0x10))
			if id == "" || !plainID(id) {
				continue
			}
			g, ly := cleanName(m.fstr(o-0x40, 0x10)), cleanName(m.fstr(o-0x30, 0x10))
			if g != "" && ly != "" && plainID(g) && plainID(ly) {
				if _, ok := texOpts[id]; !ok {
					texOpts[id] = [2]string{g, ly}
				}
			}
		}
	})
	return texOpts
}

func plainID(s string) bool {
	if len(s) < 2 {
		return false
	}
	for _, r := range s {
		if !(r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_') {
			return false
		}
	}
	return true
}

// pick says which texture a layer wears: the one the save's texture option for that layer names, else the first
// that has a file.
func (l *travLook) pick(ly ptLayer) *ptTex {
	if l != nil {
		groups := textureOptionGroups()
		for _, o := range l.Options {
			gl, ok := groups[strings.ToUpper(o[0])]
			if !ok || !strings.EqualFold(gl[0], ly.group) {
				continue
			}
			for i := range ly.texs {
				if strings.EqualFold(ly.texs[i].name, o[1]) && ly.texs[i].file != "" && (strings.EqualFold(gl[1], ly.name) || len(ly.texs) > 1) {
					return &ly.texs[i]
				}
			}
		}
	}
	for i := range ly.texs {
		if ly.texs[i].file != "" {
			return &ly.texs[i]
		}
	}
	return nil
}

// layeredColour paints a material's colour texture with the save's colours, or returns nil when the texture has no
// layers (then the plain texture is used).
func layeredColour(diffuse string, look *travLook) *image.NRGBA {
	if look == nil {
		return nil
	}
	stem := path.Dir(diffuse) + "/" + strings.SplitN(path.Base(diffuse), ".", 2)[0] + ".texture.mbin"
	raw, err := gameFile(stem)
	if err != nil {
		return nil
	}
	layers := parseProceduralTexture(raw)
	if len(layers) == 0 {
		return nil
	}
	var out *image.NRGBA
	painted := false
	for i := len(layers) - 1; i >= 0; i-- { // BASE first, then up
		t := look.pick(layers[i])
		if t == nil {
			continue
		}
		b, err := gameFile(t.file)
		if err != nil {
			continue
		}
		img, err := decodeDDS(shrinkDDS(b, 1024))
		if err != nil {
			continue
		}
		col, has := look.colour(t.palette, t.alt)
		if out == nil {
			out = image.NewNRGBA(img.Rect)
			if has {
				recolour(img, col, t)
				painted = true
			}
			copy(out.Pix, img.Pix)
			for p := 3; p < len(out.Pix); p += 4 {
				out.Pix[p] = 255
			}
			continue
		}
		if has {
			recolour(img, col, t)
			painted = true
		}
		blendOver(out, img)
	}
	if !painted {
		return nil
	}
	return out
}

// recolour gives a layer the palette colour: hue and saturation from the colour, brightness shifted by how far the
// colour is from the layer's average (its own, unless the game gives one), so the texture's shading stays.
func recolour(img *image.NRGBA, col [3]float64, t *ptTex) {
	var ar, ag, ab float64
	if t.override {
		ar, ag, ab = float64(t.avg[0]), float64(t.avg[1]), float64(t.avg[2])
	} else {
		var sum [3]float64
		var w float64
		for i := 0; i+3 < len(img.Pix); i += 4 * 7 {
			a := float64(img.Pix[i+3]) / 255
			sum[0] += float64(img.Pix[i]) / 255 * a
			sum[1] += float64(img.Pix[i+1]) / 255 * a
			sum[2] += float64(img.Pix[i+2]) / 255 * a
			w += a
		}
		if w == 0 {
			return
		}
		ar, ag, ab = sum[0]/w, sum[1]/w, sum[2]/w
	}
	_, as, av := rgbToHSV(ar, ag, ab)
	ph, ps, pv := rgbToHSV(col[0], col[1], col[2])
	for i := 0; i+3 < len(img.Pix); i += 4 {
		_, s, v := rgbToHSV(float64(img.Pix[i])/255, float64(img.Pix[i+1])/255, float64(img.Pix[i+2])/255)
		r, g, b := hsvToRGB(ph, clamp01(s+ps-as), clamp01(v+pv-av))
		img.Pix[i], img.Pix[i+1], img.Pix[i+2] = byte(r*255+0.5), byte(g*255+0.5), byte(b*255+0.5)
	}
}

// blendOver lays a layer over what's below it by the layer's alpha (scaled to the base's size if it differs).
func blendOver(dst, src *image.NRGBA) {
	dw, dh := dst.Rect.Dx(), dst.Rect.Dy()
	sw, sh := src.Rect.Dx(), src.Rect.Dy()
	for y := 0; y < dh; y++ {
		sy := y * sh / dh
		for x := 0; x < dw; x++ {
			so := (sy*sw + x*sw/dw) * 4
			a := int(src.Pix[so+3])
			if a == 0 {
				continue
			}
			do := (y*dw + x) * 4
			for c := 0; c < 3; c++ {
				dst.Pix[do+c] = byte((int(src.Pix[so+c])*a + int(dst.Pix[do+c])*(255-a) + 127) / 255)
			}
		}
	}
}

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }

func rgbToHSV(r, g, b float64) (h, s, v float64) {
	mx, mn := math.Max(r, math.Max(g, b)), math.Min(r, math.Min(g, b))
	v = mx
	d := mx - mn
	if mx > 0 {
		s = d / mx
	}
	if d == 0 {
		return 0, s, v
	}
	switch mx {
	case r:
		h = math.Mod((g-b)/d, 6)
	case g:
		h = (b-r)/d + 2
	default:
		h = (r-g)/d + 4
	}
	h /= 6
	if h < 0 {
		h++
	}
	return
}

func hsvToRGB(h, s, v float64) (float64, float64, float64) {
	i := math.Floor(h * 6)
	f := h*6 - i
	p, q, t := v*(1-s), v*(1-f*s), v*(1-(1-f)*s)
	switch int(i) % 6 {
	case 0:
		return v, t, p
	case 1:
		return q, v, p
	case 2:
		return p, v, t
	case 3:
		return p, q, v
	case 4:
		return t, p, v
	}
	return v, p, q
}
