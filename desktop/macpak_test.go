package main

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLZ4Block(t *testing.T) {
	// "abcabcabcabcabc!": 3 literals, a match of 12 at distance 3 (it overlaps what it writes), then 1 literal
	src := []byte{0x38, 'a', 'b', 'c', 3, 0, 0x10, '!'}
	got, err := lz4Block(src, 64)
	if err != nil || string(got) != "abcabcabcabcabc!" {
		t.Fatalf("got %q, %v", got, err)
	}
	// long runs: 300 literals (15 + 255 + 30), then a match of 4 + 15 + 5 at distance 1
	long := append([]byte{0xFF, 255, 30}, bytes.Repeat([]byte{'x'}, 300)...)
	long = append(long, 1, 0, 5)
	if got, err := lz4Block(long, 1024); err != nil || len(got) != 324 || !bytes.Equal(got, bytes.Repeat([]byte{'x'}, 324)) {
		t.Fatalf("long: %d bytes, %v", len(got), err)
	}
	for name, bad := range map[string][]byte{"a match before the start": {0x10, 'a', 9, 0}, "distance 0": {0x10, 'a', 0, 0}, "literals past the end": {0x50, 'a'}, "half an offset": {0x10, 'a', 1}} {
		if _, err := lz4Block(bad, 64); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	if _, err := lz4Block(long, 100); err == nil {
		t.Error("more than a chunk was accepted")
	}
}

// HSE_TEST_PAKS=<folder made by test/make_test_paks.py>: the same files packed the Mac's way and the PC's way must
// both read back byte for byte, and each archive's kind must be recognised.
func TestMacAndPCPaks(t *testing.T) {
	dir := os.Getenv("HSE_TEST_PAKS")
	if dir == "" {
		t.Skip("set HSE_TEST_PAKS")
	}
	var sums map[string]string
	b, err := os.ReadFile(filepath.Join(dir, "sums.json"))
	if err != nil || json.Unmarshal(b, &sums) != nil || len(sums) == 0 {
		t.Fatal("no sums.json")
	}
	for folder, mac := range map[string]bool{"MACOSBANKS": true, "PCBANKS": false} {
		p, err := openPak(filepath.Join(dir, folder, "NMSARC.Test.pak"))
		if err != nil {
			t.Fatal(folder, err)
		}
		if p.lz4 != mac {
			t.Errorf("%s: taken for the wrong kind (lz4 %v)", folder, p.lz4)
		}
		for n, want := range sums {
			got, err := p.Read(n)
			h := sha1.Sum(got)
			if err != nil || hex.EncodeToString(h[:]) != want {
				t.Fatalf("%s: %s read wrong (%v, %d bytes)", folder, n, err, len(got))
			}
		}
		t.Logf("%s: %d files in %d chunks of 0x%X", folder, len(sums), len(p.chunkSize), p.chunkLen)
		p.Close()
	}
	// the Mac's folder is found like the PC's, also inside the app bundle
	app := filepath.Join(t.TempDir(), "No Man's Sky.app", "Contents", "Resources", "GAMEDATA")
	if err := os.MkdirAll(app, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, "MACOSBANKS"), filepath.Join(app, "MACOSBANKS")); err != nil {
		t.Fatal(err)
	}
	for _, from := range []string{filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(app)))), filepath.Dir(filepath.Dir(filepath.Dir(app))), app, filepath.Join(app, "MACOSBANKS")} {
		if got := banksUnder(from); got != filepath.Join(app, "MACOSBANKS") {
			t.Errorf("from %s: found %q", from, got)
		}
	}
}

// The Mac's archives name platform files ".macos" where the PC's say ".pc"; a scene may name either.
func TestPlatformNames(t *testing.T) {
	got := platformNames("models/a/acca.geometry.mbin.pc")
	if len(got) != 2 || got[0] != "models/a/acca.geometry.mbin.pc" || got[1] != "models/a/acca.geometry.mbin.macos" {
		t.Fatalf("pc name: %v", got)
	}
	got = platformNames("models/a/acca.geometry.data.mbin.macos")
	if len(got) != 2 || got[1] != "models/a/acca.geometry.data.mbin.pc" {
		t.Fatalf("mac name: %v", got)
	}
	if got = platformNames("models/a/acca.scene.mbin"); len(got) != 1 {
		t.Fatalf("plain name: %v", got)
	}
	for _, in := range []string{`MODELS\A\ACCA.GEOMETRY.MBIN.PC`, "models/a/acca.geometry.mbin.macos", "models/a/acca.geometry.mbin", "models/a/acca.geometry.data.mbin.macos", "models/a/acca"} {
		if s := geomStem(in); s != "models/a/acca" {
			t.Fatalf("geomStem(%q) = %q", in, s)
		}
	}
}
