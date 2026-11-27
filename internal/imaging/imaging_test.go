package imaging

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func makePNG(t *testing.T, w, h int, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	FillRect(img, img.Bounds(), c)
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	return buf.Bytes()
}

func TestViewSingleDownscaleAlphaAndRegion(t *testing.T) {
	root := t.TempDir()
	workdir := filepath.Join(root, "session")
	previewDir := filepath.Join(root, "preview")
	if err := os.MkdirAll(workdir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(previewDir, 0o755); err != nil {
		t.Fatal(err)
	}

	largePath := filepath.Join(workdir, "poster.png")
	if err := os.WriteFile(largePath, makePNG(t, 2560, 1280, color.RGBA{R: 200, G: 50, B: 40, A: 128}), 0o600); err != nil {
		t.Fatal(err)
	}

	scope := Scope{Workdir: workdir, PreviewDirectory: previewDir}
	res, err := ViewSingleOrRegion(scope, "poster.png", nil)
	if err != nil {
		t.Fatalf("ViewSingleOrRegion: %v", err)
	}
	if res.Metadata["deliveredWidth"] != 1280 || res.Metadata["deliveredHeight"] != 640 {
		t.Fatalf("unexpected delivered dimensions: %v", res.Metadata)
	}
	if res.Metadata["downscaled"] != true || res.Metadata["scale"] != 2.0 {
		t.Fatalf("expected downscaled=true scale=2, got %v", res.Metadata)
	}
	if res.Metadata["alphaBackground"] != AlphaBackgroundHex {
		t.Fatalf("expected alphaBackground=%s, got %v", AlphaBackgroundHex, res.Metadata["alphaBackground"])
	}
	if _, err := jpeg.Decode(bytes.NewReader(res.JPEG)); err != nil {
		t.Fatalf("delivered bytes are not valid jpeg: %v", err)
	}

	cropRes, err := ViewSingleOrRegion(scope, "poster.png", &Region{X: 100, Y: 100, Width: 200, Height: 150})
	if err != nil {
		t.Fatalf("ViewSingleOrRegion crop: %v", err)
	}
	if cropRes.Metadata["deliveredWidth"] != 200 || cropRes.Metadata["deliveredHeight"] != 150 {
		t.Fatalf("unexpected crop dimensions: %v", cropRes.Metadata)
	}
	if cropRes.Metadata["downscaled"] != false {
		t.Fatalf("expected downscaled=false on small crop, got %v", cropRes.Metadata["downscaled"])
	}

	if _, err := ViewSingleOrRegion(scope, "poster.png", &Region{X: 2500, Y: 0, Width: 200, Height: 100}); err == nil {
		t.Fatal("expected out-of-bounds region to fail")
	}
}

func TestViewContactSheet(t *testing.T) {
	workdir := t.TempDir()
	colors := []color.RGBA{
		{R: 220, G: 40, B: 40, A: 255},
		{R: 40, G: 200, B: 40, A: 255},
		{R: 40, G: 40, B: 220, A: 255},
	}
	var paths []string
	for i, c := range colors {
		name := "img" + string(rune('1'+i)) + ".png"
		p := filepath.Join(workdir, name)
		if err := os.WriteFile(p, makePNG(t, 800, 600, c), 0o600); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, name)
	}

	res, err := ViewContactSheet(Scope{Workdir: workdir}, paths)
	if err != nil {
		t.Fatalf("ViewContactSheet: %v", err)
	}
	wantEdge := 2*ContactCellEdge + ContactGap
	if res.Metadata["deliveredWidth"] != wantEdge || res.Metadata["deliveredHeight"] != wantEdge {
		t.Fatalf("canvas = %vx%v, want %dx%d", res.Metadata["deliveredWidth"], res.Metadata["deliveredHeight"], wantEdge, wantEdge)
	}
	cells, ok := res.Metadata["cells"].([]map[string]any)
	if !ok || len(cells) != 3 {
		t.Fatalf("expected 3 cells metadata, got %#v", res.Metadata["cells"])
	}
	if _, err := jpeg.Decode(bytes.NewReader(res.JPEG)); err != nil {
		t.Fatalf("invalid contact sheet jpeg: %v", err)
	}
}

func TestInspectRejectsGIFFrameBombAndCorruptImage(t *testing.T) {
	var validGIF bytes.Buffer
	pal := color.Palette{color.Black, color.White}
	frame := image.NewPaletted(image.Rect(0, 0, 8, 8), pal)
	if err := gif.EncodeAll(&validGIF, &gif.GIF{Image: []*image.Paletted{frame}, Delay: []int{0}}); err != nil {
		t.Fatal(err)
	}
	decoded, err := InspectAndDecodeBounded(validGIF.Bytes(), false)
	if err != nil {
		t.Fatalf("valid gif rejected: %v", err)
	}
	if decoded.MIME != MimeGIF || decoded.Width != 8 || decoded.Height != 8 {
		t.Fatalf("unexpected gif metadata: %+v", decoded)
	}

	var bomb bytes.Buffer
	bomb.WriteString("GIF89a")
	_ = binary.Write(&bomb, binary.LittleEndian, uint16(4000))
	_ = binary.Write(&bomb, binary.LittleEndian, uint16(4000))
	bomb.Write([]byte{0x00, 0x00, 0x00})
	for i := 0; i < 6; i++ {
		bomb.WriteByte(0x2c)
		_ = binary.Write(&bomb, binary.LittleEndian, uint16(0))
		_ = binary.Write(&bomb, binary.LittleEndian, uint16(0))
		_ = binary.Write(&bomb, binary.LittleEndian, uint16(4000))
		_ = binary.Write(&bomb, binary.LittleEndian, uint16(4000))
		bomb.Write([]byte{0x00, 0x02, 0x00})
	}
	bomb.WriteByte(0x3b)
	if _, err := InspectAndDecodeBounded(bomb.Bytes(), false); err == nil {
		t.Fatal("expected 6-frame 4000x4000 GIF bomb (>64M pixels) to be rejected")
	}

	if _, err := InspectAndDecodeBounded([]byte("not an image"), true); err == nil {
		t.Fatal("expected corrupt bytes to be rejected")
	}
}
