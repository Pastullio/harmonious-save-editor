package main

// Checks against real game files when HSE_TEST_FILES points at an extracted copy (nmsfiles/) and
// HSE_TEST_BANKS at .pak files built from it. Skipped otherwise.

import (
	"bytes"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPakMatchesExtracted(t *testing.T) {
	banks, files := os.Getenv("HSE_TEST_BANKS"), os.Getenv("HSE_TEST_FILES")
	if banks == "" || files == "" {
		t.Skip("set HSE_TEST_BANKS and HSE_TEST_FILES")
	}
	paks, _ := filepath.Glob(filepath.Join(banks, "*.pak"))
	n := 0
	for _, pp := range paks {
		p, err := openPak(pp)
		if err != nil {
			t.Fatal(err)
		}
		for name := range p.files {
			got, err := p.Read(name)
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			want, err := os.ReadFile(filepath.Join(files, filepath.FromSlash(name)))
			if err != nil {
				continue
			}
			if !bytes.Equal(got, want) {
				t.Fatalf("%s differs (%d vs %d bytes)", name, len(got), len(want))
			}
			n++
		}
		p.Close()
	}
	t.Logf("%d files read back identically", n)
}

func TestBC7AgainstReference(t *testing.T) {
	files, ref := os.Getenv("HSE_TEST_FILES"), os.Getenv("HSE_TEST_REF") // ref: folder of PNGs decoded by Pillow, same relative names
	if files == "" || ref == "" {
		t.Skip("set HSE_TEST_FILES and HSE_TEST_REF")
	}
	n, worst := 0, 0
	filepath.Walk(filepath.Join(files, "textures"), func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".dds") {
			return nil
		}
		rel, _ := filepath.Rel(files, path)
		rf, err := os.Open(filepath.Join(ref, rel+".png"))
		if err != nil {
			return nil
		}
		defer rf.Close()
		want, err := png.Decode(rf)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := os.ReadFile(path)
		got, err := decodeDDS(b)
		if err != nil {
			t.Fatalf("%s: %v", rel, err)
		}
		if got.Rect != want.Bounds() {
			t.Fatalf("%s: size %v vs %v", rel, got.Rect, want.Bounds())
		}
		for y := 0; y < got.Rect.Dy(); y++ {
			for x := 0; x < got.Rect.Dx(); x++ {
				r1, g1, b1, a1 := got.At(x, y).RGBA()
				r2, g2, b2, a2 := want.At(x, y).RGBA()
				for _, d := range []int{int(r1>>8) - int(r2>>8), int(g1>>8) - int(g2>>8), int(b1>>8) - int(b2>>8), int(a1>>8) - int(a2>>8)} {
					if d < 0 {
						d = -d
					}
					if d > worst {
						worst = d
					}
				}
			}
		}
		n++
		return nil
	})
	if worst > 1 {
		t.Fatalf("largest pixel difference %d", worst)
	}
	t.Logf("%d textures match Pillow (largest difference %d)", n, worst)
}
