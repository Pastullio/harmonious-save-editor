package main

// Reading No Man's Sky's own files, for the item library: HGPAK archives (the game's .pak format since
// 5.50, chunks compressed with zstd on PC), MBIN tables, and BC7 DDS textures.
//
// HGPAK layout follows HGPAKtool by monkeyman192 (MIT). MBIN field offsets come from MBINCompiler's
// libMBIN struct definitions; each table is checked against its template GUID so a game update that
// changes a layout is caught instead of misread. The BC7 decoder is a port of Pillow's BcnDecode.c.

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"io"
	"os"
	"strings"
	"sync"

	"github.com/klauspost/compress/zstd"
)

// ------------------------------------------------------------------ HGPAK

const pakChunk = 0x10000 // decompressed chunk size on PC (zstd)

type pakEntry struct{ off, size int64 }

type hgpak struct {
	mu         sync.Mutex
	f          *os.File
	compressed bool
	dataOffset int64
	chunkSize  []int64
	chunkOff   []int64
	files      map[string]pakEntry
	cache      map[int][]byte
	order      []int
}

var zstdDec, _ = zstd.NewReader(nil, zstd.WithDecoderConcurrency(1))

func openPak(path string) (*hgpak, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	p := &hgpak{f: f, files: map[string]pakEntry{}, cache: map[int][]byte{}}
	if err := p.parse(); err != nil {
		f.Close()
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return p, nil
}

func (p *hgpak) Close() { p.f.Close() }

func (p *hgpak) parse() error {
	head := make([]byte, 0x30)
	if _, err := io.ReadFull(p.f, head); err != nil {
		return err
	}
	if string(head[:5]) != "HGPAK" {
		return errors.New("not an HGPAK file")
	}
	le := binary.LittleEndian
	version, fileCount, chunkCount := le.Uint64(head[8:]), le.Uint64(head[16:]), le.Uint64(head[24:])
	p.compressed = head[32] != 0
	p.dataOffset = int64(le.Uint64(head[40:]))
	if version != 2 || fileCount == 0 || fileCount > 1<<22 || chunkCount > 1<<26 {
		return fmt.Errorf("unsupported HGPAK header (version %d)", version)
	}
	index := make([]byte, 0x20*fileCount)
	if _, err := io.ReadFull(p.f, index); err != nil {
		return err
	}
	type info struct{ start, size int64 }
	infos := make([]info, fileCount)
	for i := range infos {
		e := index[i*0x20:]
		infos[i] = info{int64(le.Uint64(e[16:])), int64(le.Uint64(e[24:]))}
	}
	if p.compressed {
		sizes := make([]byte, 8*chunkCount)
		if _, err := io.ReadFull(p.f, sizes); err != nil {
			return err
		}
		pos := p.dataOffset
		for i := uint64(0); i < chunkCount; i++ {
			s := int64(le.Uint64(sizes[i*8:]))
			p.chunkSize = append(p.chunkSize, s)
			p.chunkOff = append(p.chunkOff, pos)
			pos += (s + 15) &^ 15
		}
	}
	// file 0 is the manifest: the names of the other files, one per line
	man, err := p.readAt(p.entryFor(infos[0].start, infos[0].size))
	if err != nil {
		return fmt.Errorf("reading the file list: %w", err)
	}
	names := strings.Split(strings.TrimRight(string(man), "\r\n"), "\r\n")
	for i, n := range names {
		if n != "" && i+1 < len(infos) {
			p.files[strings.ToLower(n)] = p.entryFor(infos[i+1].start, infos[i+1].size)
		}
	}
	return nil
}

func (p *hgpak) entryFor(start, size int64) pakEntry {
	if p.compressed {
		return pakEntry{start - p.dataOffset, size}
	}
	return pakEntry{start, size}
}

func (p *hgpak) chunk(i int) ([]byte, error) {
	if c, ok := p.cache[i]; ok {
		return c, nil
	}
	if i < 0 || i >= len(p.chunkSize) {
		return nil, errors.New("chunk out of range")
	}
	raw := make([]byte, p.chunkSize[i])
	if _, err := p.f.ReadAt(raw, p.chunkOff[i]); err != nil {
		return nil, err
	}
	out, err := zstdDec.DecodeAll(raw, make([]byte, 0, pakChunk))
	if err != nil {
		if len(raw) == pakChunk { // stored without compression
			out = raw
		} else {
			return nil, fmt.Errorf("chunk %d: %w", i, err)
		}
	}
	p.cache[i] = out
	p.order = append(p.order, i)
	if len(p.order) > 96 {
		delete(p.cache, p.order[0])
		p.order = p.order[1:]
	}
	return out, nil
}

func (p *hgpak) readAt(e pakEntry) ([]byte, error) {
	if !p.compressed {
		b := make([]byte, e.size)
		_, err := p.f.ReadAt(b, e.off)
		return b, err
	}
	out := make([]byte, 0, e.size)
	for pos := e.off; pos < e.off+e.size; {
		ci := int(pos / pakChunk)
		c, err := p.chunk(ci)
		if err != nil {
			return nil, err
		}
		from := pos - int64(ci)*pakChunk
		to := int64(len(c))
		if rest := e.off + e.size - int64(ci)*pakChunk; rest < to {
			to = rest
		}
		if from >= to {
			return nil, errors.New("file runs past the end of its chunk")
		}
		out = append(out, c[from:to]...)
		pos = int64(ci)*pakChunk + to
	}
	return out, nil
}

// Read returns one file from the archive by its path (case-insensitive, forward slashes).
func (p *hgpak) Read(name string) ([]byte, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	e, ok := p.files[strings.ToLower(strings.ReplaceAll(name, `\`, "/"))]
	if !ok {
		return nil, os.ErrNotExist
	}
	return p.readAt(e)
}

func (p *hgpak) Has(name string) bool {
	_, ok := p.files[strings.ToLower(strings.ReplaceAll(name, `\`, "/"))]
	return ok
}

// ------------------------------------------------------------------ MBIN

type mbin struct{ d []byte }

func openMbin(b []byte, guid uint64, what string) (*mbin, error) {
	if magic := binary.LittleEndian.Uint32(b); len(b) < 0x30 || (magic != 0xCCCCCCCC && magic != 0xDDDDDDDD) { // DD: geometry files
		return nil, fmt.Errorf("%s isn't an MBIN file", what)
	}
	if g := binary.LittleEndian.Uint64(b[0x10:]); g != guid {
		return nil, fmt.Errorf("%s has a newer layout than this app knows (template %016X); update Harmonious Save Editor", what, g)
	}
	return &mbin{b}, nil
}

func (m *mbin) ok(p, n int) bool { return p >= 0 && n >= 0 && p+n <= len(m.d) }

// list returns where a dynamic array's elements start and how many there are.
func (m *mbin) list(p int) (int, int) {
	if !m.ok(p, 16) {
		return 0, 0
	}
	off := int(binary.LittleEndian.Uint64(m.d[p:]))
	n := int(binary.LittleEndian.Uint32(m.d[p+8:]))
	if n == 0 || !m.ok(p+off, 0) {
		return 0, 0
	}
	return p + off, n
}

// vstr reads a variable-length string (stored like a list of bytes).
func (m *mbin) vstr(p int) string {
	a, n := m.list(p)
	if n == 0 || !m.ok(a, n) {
		return ""
	}
	return cstr(m.d[a : a+n])
}

func (m *mbin) fstr(p, n int) string {
	if !m.ok(p, n) {
		return ""
	}
	return cstr(m.d[p : p+n])
}

func (m *mbin) i32(p int) int32 {
	if !m.ok(p, 4) {
		return 0
	}
	return int32(binary.LittleEndian.Uint32(m.d[p:]))
}

func (m *mbin) u8(p int) byte {
	if !m.ok(p, 1) {
		return 0
	}
	return m.d[p]
}

func cstr(b []byte) string {
	if i := bytes.IndexByte(b, 0); i >= 0 {
		b = b[:i]
	}
	return string(b)
}

// ------------------------------------------------------------------ DDS (BC7, BC1, BC3, RGBA8)

func decodeDDS(b []byte) (*image.NRGBA, error) {
	if len(b) < 128 || string(b[:4]) != "DDS " {
		return nil, errors.New("not a DDS file")
	}
	le := binary.LittleEndian
	h, w := int(le.Uint32(b[12:])), int(le.Uint32(b[16:]))
	fourcc := string(b[84:88])
	data := b[128:]
	format := fourcc
	if fourcc == "DX10" {
		if len(b) < 148 {
			return nil, errors.New("short DX10 header")
		}
		switch le.Uint32(b[128:]) {
		case 98, 99:
			format = "BC7"
		case 71, 72:
			format = "DXT1"
		case 77, 78:
			format = "DXT5"
		case 28, 29:
			format = "RGBA"
		default:
			return nil, fmt.Errorf("unsupported DXGI format %d", le.Uint32(b[128:]))
		}
		data = b[148:]
	}
	if w <= 0 || h <= 0 || w > 8192 || h > 8192 {
		return nil, errors.New("bad DDS size")
	}
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	if format == "RGBA" {
		if len(data) < w*h*4 {
			return nil, errors.New("short DDS data")
		}
		copy(img.Pix, data[:w*h*4])
		return img, nil
	}
	bs := 16
	if format == "DXT1" {
		bs = 8
	}
	bw, bh := (w+3)/4, (h+3)/4
	if len(data) < bw*bh*bs {
		return nil, errors.New("short DDS data")
	}
	var px [16][4]byte
	for by := 0; by < bh; by++ {
		for bx := 0; bx < bw; bx++ {
			blk := data[(by*bw+bx)*bs:]
			switch format {
			case "BC7":
				decodeBC7(blk, &px)
			case "DXT1":
				decodeBC1(blk, &px, true)
			case "DXT5":
				decodeBC1(blk[8:], &px, false)
				decodeBC3Alpha(blk, &px)
			default:
				return nil, fmt.Errorf("unsupported DDS format %q", format)
			}
			for i := 0; i < 16; i++ {
				x, y := bx*4+i%4, by*4+i/4
				if x < w && y < h {
					o := img.PixOffset(x, y)
					copy(img.Pix[o:o+4], px[i][:])
				}
			}
		}
	}
	return img, nil
}

type bc7mode struct{ ns, pb, rb, isb, cb, ab, epb, spb, ib, ib2 int }

var bc7modes = [8]bc7mode{
	{3, 4, 0, 0, 4, 0, 1, 0, 3, 0}, {2, 6, 0, 0, 6, 0, 0, 1, 3, 0}, {3, 6, 0, 0, 5, 0, 0, 0, 2, 0}, {2, 6, 0, 0, 7, 0, 1, 0, 2, 0},
	{1, 0, 2, 1, 5, 6, 0, 0, 2, 3}, {1, 0, 2, 0, 7, 8, 0, 0, 2, 2}, {1, 0, 0, 0, 7, 7, 1, 0, 4, 0}, {2, 6, 0, 0, 5, 5, 1, 0, 2, 0},
}

var bc7si2 = [64]uint16{
	0xcccc, 0x8888, 0xeeee, 0xecc8, 0xc880, 0xfeec, 0xfec8, 0xec80, 0xc800, 0xffec, 0xfe80, 0xe800, 0xffe8, 0xff00, 0xfff0, 0xf000,
	0xf710, 0x008e, 0x7100, 0x08ce, 0x008c, 0x7310, 0x3100, 0x8cce, 0x088c, 0x3110, 0x6666, 0x366c, 0x17e8, 0x0ff0, 0x718e, 0x399c,
	0xaaaa, 0xf0f0, 0x5a5a, 0x33cc, 0x3c3c, 0x55aa, 0x9696, 0xa55a, 0x73ce, 0x13c8, 0x324c, 0x3bdc, 0x6996, 0xc33c, 0x9966, 0x0660,
	0x0272, 0x04e4, 0x4e40, 0x2720, 0xc936, 0x936c, 0x39c6, 0x639c, 0x9336, 0x9cc6, 0x817e, 0xe718, 0xccf0, 0x0fcc, 0x7744, 0xee22,
}

var bc7si3 = [64]uint32{
	0xaa685050, 0x6a5a5040, 0x5a5a4200, 0x5450a0a8, 0xa5a50000, 0xa0a05050, 0x5555a0a0, 0x5a5a5050, 0xaa550000, 0xaa555500, 0xaaaa5500,
	0x90909090, 0x94949494, 0xa4a4a4a4, 0xa9a59450, 0x2a0a4250, 0xa5945040, 0x0a425054, 0xa5a5a500, 0x55a0a0a0, 0xa8a85454, 0x6a6a4040,
	0xa4a45000, 0x1a1a0500, 0x0050a4a4, 0xaaa59090, 0x14696914, 0x69691400, 0xa08585a0, 0xaa821414, 0x50a4a450, 0x6a5a0200, 0xa9a58000,
	0x5090a0a8, 0xa8a09050, 0x24242424, 0x00aa5500, 0x24924924, 0x24499224, 0x50a50a50, 0x500aa550, 0xaaaa4444, 0x66660000, 0xa5a0a5a0,
	0x50a050a0, 0x69286928, 0x44aaaa44, 0x66666600, 0xaa444444, 0x54a854a8, 0x95809580, 0x96969600, 0xa85454a8, 0x80959580, 0xaa141414,
	0x96960000, 0xaaaa1414, 0xa05050a0, 0xa0a5a5a0, 0x96000000, 0x40804080, 0xa9a8a9a8, 0xaaaaaa44, 0x2a4a5254,
}

var bc7ai0 = [64]int{15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2,
	15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6, 6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15}
var bc7ai1 = [64]int{3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3, 3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5, 15, 15,
	8, 15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15, 15, 3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3}
var bc7ai2 = [64]int{15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8, 15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6, 10, 15, 15, 10, 8,
	15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8, 15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3, 15, 15, 8}

var bc7w = map[int][]int{2: {0, 21, 43, 64}, 3: {0, 9, 18, 27, 37, 46, 55, 64}, 4: {0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64}}

func bits(src []byte, bit, count int) int {
	if count == 0 {
		return 0
	}
	v := 0
	for i := 0; i < count; i++ {
		b := bit + i
		if src[b>>3]>>(b&7)&1 != 0 {
			v |= 1 << i
		}
	}
	return v
}

func decodeBC7(src []byte, out *[16][4]byte) {
	if src[0] == 0 {
		for i := range out {
			out[i] = [4]byte{0, 0, 0, 255}
		}
		return
	}
	mode := 0
	for src[0]&(1<<mode) == 0 {
		mode++
	}
	bit := mode + 1
	m := bc7modes[mode]
	load := func(n int) int { v := bits(src, bit, n); bit += n; return v }
	partition, rotation, indexSel := load(m.pb), load(m.rb), load(m.isb)
	numep := m.ns * 2
	var ep [6][4]int
	for c := 0; c < 3; c++ {
		for i := 0; i < numep; i++ {
			ep[i][c] = load(m.cb)
		}
	}
	for i := 0; i < numep; i++ {
		if m.ab > 0 {
			ep[i][3] = load(m.ab)
		} else {
			ep[i][3] = 255
		}
	}
	cb, ab := m.cb, m.ab
	if m.epb > 0 {
		cb++
		if ab > 0 {
			ab++
		}
		for i := 0; i < numep; i++ {
			v := load(1)
			for c := 0; c < 3; c++ {
				ep[i][c] = ep[i][c]<<1 | v
			}
			if m.ab > 0 {
				ep[i][3] = ep[i][3]<<1 | v
			}
		}
	}
	if m.spb > 0 {
		cb++
		if ab > 0 {
			ab++
		}
		for i := 0; i < numep; i += 2 {
			v := load(1)
			for j := 0; j < 2; j++ {
				for c := 0; c < 3; c++ {
					ep[i+j][c] = ep[i+j][c]<<1 | v
				}
				if m.ab > 0 {
					ep[i+j][3] = ep[i+j][3]<<1 | v
				}
			}
		}
	}
	expand := func(v, b int) int { v = (v << (8 - b)) & 0xFF; return v | v>>b }
	for i := 0; i < numep; i++ {
		for c := 0; c < 3; c++ {
			ep[i][c] = expand(ep[i][c], cb)
		}
		if m.ab > 0 {
			ep[i][3] = expand(ep[i][3], ab)
		}
	}
	cw := bc7w[m.ib]
	aw := cw
	if m.ab > 0 && m.ib2 > 0 {
		aw = bc7w[m.ib2]
	}
	cibit := bit
	aibit := cibit + 16*m.ib - m.ns
	for i := 0; i < 16; i++ {
		s := 0
		switch m.ns {
		case 2:
			s = int(bc7si2[partition] >> i & 1)
		case 3:
			s = int(bc7si3[partition] >> (2 * i) & 3)
		}
		s <<= 1
		ib := m.ib
		if i == 0 || (m.ns == 2 && i == bc7ai0[partition]) || (m.ns == 3 && (i == bc7ai1[partition] || i == bc7ai2[partition])) {
			ib--
		}
		i0 := bits(src, cibit, ib)
		cibit += ib
		var wc, wa int
		if m.ab > 0 && m.ib2 > 0 {
			ib2 := m.ib2
			if i == 0 {
				ib2--
			}
			i1 := bits(src, aibit, ib2)
			aibit += ib2
			if indexSel != 0 {
				wc, wa = aw[i1], cw[i0]
			} else {
				wc, wa = cw[i0], aw[i1]
			}
		} else {
			wc, wa = cw[i0], cw[i0]
		}
		e0, e1 := ep[s], ep[s+1]
		var px [4]byte
		for c := 0; c < 3; c++ {
			px[c] = byte(((64-wc)*e0[c] + wc*e1[c] + 32) >> 6)
		}
		px[3] = byte(((64-wa)*e0[3] + wa*e1[3] + 32) >> 6)
		switch rotation {
		case 1:
			px[0], px[3] = px[3], px[0]
		case 2:
			px[1], px[3] = px[3], px[1]
		case 3:
			px[2], px[3] = px[3], px[2]
		}
		out[i] = px
	}
}

func rgb565(v uint16) [3]int {
	r, g, b := int(v>>11&31), int(v>>5&63), int(v&31)
	return [3]int{r<<3 | r>>2, g<<2 | g>>4, b<<3 | b>>2}
}

func decodeBC1(src []byte, out *[16][4]byte, alpha bool) {
	c0v, c1v := binary.LittleEndian.Uint16(src), binary.LittleEndian.Uint16(src[2:])
	c0, c1 := rgb565(c0v), rgb565(c1v)
	var pal [4][4]int
	pal[0] = [4]int{c0[0], c0[1], c0[2], 255}
	pal[1] = [4]int{c1[0], c1[1], c1[2], 255}
	if c0v > c1v || !alpha {
		for c := 0; c < 3; c++ {
			pal[2][c] = (2*c0[c] + c1[c]) / 3
			pal[3][c] = (c0[c] + 2*c1[c]) / 3
		}
		pal[2][3], pal[3][3] = 255, 255
	} else {
		for c := 0; c < 3; c++ {
			pal[2][c] = (c0[c] + c1[c]) / 2
		}
		pal[2][3], pal[3] = 255, [4]int{0, 0, 0, 0}
	}
	idx := binary.LittleEndian.Uint32(src[4:])
	for i := 0; i < 16; i++ {
		p := pal[idx>>(2*i)&3]
		out[i] = [4]byte{byte(p[0]), byte(p[1]), byte(p[2]), byte(p[3])}
	}
}

func decodeBC3Alpha(src []byte, out *[16][4]byte) {
	a0, a1 := int(src[0]), int(src[1])
	var pal [8]int
	pal[0], pal[1] = a0, a1
	if a0 > a1 {
		for i := 1; i < 7; i++ {
			pal[i+1] = ((7-i)*a0 + i*a1) / 7
		}
	} else {
		for i := 1; i < 5; i++ {
			pal[i+1] = ((5-i)*a0 + i*a1) / 5
		}
		pal[6], pal[7] = 0, 255
	}
	var idx uint64
	for i := 0; i < 6; i++ {
		idx |= uint64(src[2+i]) << (8 * i)
	}
	for i := 0; i < 16; i++ {
		out[i][3] = byte(pal[idx>>(3*i)&7])
	}
}

// shrink scales an image down to fit in max×max with a box filter (icons are square powers of two).
func shrink(src *image.NRGBA, max int) *image.NRGBA {
	w, h := src.Rect.Dx(), src.Rect.Dy()
	f := 1
	for w/f > max || h/f > max {
		f *= 2
	}
	if f == 1 {
		return src
	}
	dw, dh := w/f, h/f
	dst := image.NewNRGBA(image.Rect(0, 0, dw, dh))
	n := f * f
	for y := 0; y < dh; y++ {
		for x := 0; x < dw; x++ {
			// premultiply so transparent pixels don't darken the edges
			var r, g, b, a int
			for yy := 0; yy < f; yy++ {
				for xx := 0; xx < f; xx++ {
					c := src.NRGBAAt(x*f+xx, y*f+yy)
					al := int(c.A)
					r += int(c.R) * al
					g += int(c.G) * al
					b += int(c.B) * al
					a += al
				}
			}
			out := color.NRGBA{}
			if a > 0 {
				out = color.NRGBA{uint8(r / a), uint8(g / a), uint8(b / a), uint8(a / n)}
			}
			dst.SetNRGBA(x, y, out)
		}
	}
	return dst
}
