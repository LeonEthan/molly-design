package fonts

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"unicode/utf16"

	"github.com/LeonEthan/molly-design/internal/imaging"
)

func copyFixtureFont(t *testing.T, dest string) {
	t.Helper()
	fixture := filepath.Join("..", "..", "apps", "cli", "src", "mcp", "fixtures", "fonts", "MollyTestSerif-Regular.ttf")
	data, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatalf("read fixture font: %v", err)
	}
	if err := os.WriteFile(dest, data, 0o600); err != nil {
		t.Fatalf("write fixture font: %v", err)
	}
}

func makeReferencePNG(t *testing.T, dest string, inkW, inkH int) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, inkW+40, inkH+40))
	imaging.FillRect(img, img.Bounds(), imaging.WhiteBackground)
	imaging.FillRect(img, image.Rect(20, 20, 20+inkW, 20+inkH), color.RGBA{R: 10, G: 10, B: 10, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dest, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
}

func buildSyntheticCJKTTF(t *testing.T, familyName string, glyphWidth int16) []byte {
	t.Helper()
	const upem uint16 = 1000
	const glyphHeight int16 = 800
	const advancePadding int16 = 100
	advWidth := uint16(glyphWidth + advancePadding)

	makeSimpleBoxGlyph := func(w, h int16) []byte {
		var b bytes.Buffer
		_ = binary.Write(&b, binary.BigEndian, int16(1))
		_ = binary.Write(&b, binary.BigEndian, int16(0))
		_ = binary.Write(&b, binary.BigEndian, int16(0))
		_ = binary.Write(&b, binary.BigEndian, w)
		_ = binary.Write(&b, binary.BigEndian, h)
		_ = binary.Write(&b, binary.BigEndian, uint16(3))
		_ = binary.Write(&b, binary.BigEndian, uint16(0))
		b.Write([]byte{0x01, 0x01, 0x01, 0x01})
		_ = binary.Write(&b, binary.BigEndian, int16(0))
		_ = binary.Write(&b, binary.BigEndian, int16(0))
		_ = binary.Write(&b, binary.BigEndian, w)
		_ = binary.Write(&b, binary.BigEndian, int16(0))
		_ = binary.Write(&b, binary.BigEndian, int16(0))
		_ = binary.Write(&b, binary.BigEndian, h)
		_ = binary.Write(&b, binary.BigEndian, int16(0))
		_ = binary.Write(&b, binary.BigEndian, -h)
		for b.Len()%4 != 0 {
			b.WriteByte(0)
		}
		return b.Bytes()
	}

	g0 := makeSimpleBoxGlyph(300, glyphHeight)
	g1 := makeSimpleBoxGlyph(glyphWidth, glyphHeight)
	g2 := makeSimpleBoxGlyph(glyphWidth, glyphHeight)
	glyf := append(append([]byte(nil), g0...), g1...)
	glyf = append(glyf, g2...)

	var loca bytes.Buffer
	_ = binary.Write(&loca, binary.BigEndian, uint32(0))
	_ = binary.Write(&loca, binary.BigEndian, uint32(len(g0)))
	_ = binary.Write(&loca, binary.BigEndian, uint32(len(g0)+len(g1)))
	_ = binary.Write(&loca, binary.BigEndian, uint32(len(glyf)))

	var head bytes.Buffer
	_ = binary.Write(&head, binary.BigEndian, uint32(0x00010000))
	_ = binary.Write(&head, binary.BigEndian, uint32(0x00010000))
	_ = binary.Write(&head, binary.BigEndian, uint32(0))
	_ = binary.Write(&head, binary.BigEndian, uint32(0x5F0F3CF5))
	_ = binary.Write(&head, binary.BigEndian, uint16(0))
	_ = binary.Write(&head, binary.BigEndian, upem)
	_ = binary.Write(&head, binary.BigEndian, int64(0))
	_ = binary.Write(&head, binary.BigEndian, int64(0))
	_ = binary.Write(&head, binary.BigEndian, int16(0))
	_ = binary.Write(&head, binary.BigEndian, int16(0))
	_ = binary.Write(&head, binary.BigEndian, glyphWidth)
	_ = binary.Write(&head, binary.BigEndian, glyphHeight)
	_ = binary.Write(&head, binary.BigEndian, uint16(0))
	_ = binary.Write(&head, binary.BigEndian, uint16(8))
	_ = binary.Write(&head, binary.BigEndian, int16(2))
	_ = binary.Write(&head, binary.BigEndian, int16(1))
	_ = binary.Write(&head, binary.BigEndian, int16(0))

	var hhea bytes.Buffer
	_ = binary.Write(&hhea, binary.BigEndian, uint32(0x00010000))
	_ = binary.Write(&hhea, binary.BigEndian, glyphHeight)
	_ = binary.Write(&hhea, binary.BigEndian, int16(-200))
	_ = binary.Write(&hhea, binary.BigEndian, int16(0))
	_ = binary.Write(&hhea, binary.BigEndian, advWidth)
	_ = binary.Write(&hhea, binary.BigEndian, int16(0))
	_ = binary.Write(&hhea, binary.BigEndian, int16(0))
	_ = binary.Write(&hhea, binary.BigEndian, glyphWidth)
	_ = binary.Write(&hhea, binary.BigEndian, int16(1))
	_ = binary.Write(&hhea, binary.BigEndian, int16(0))
	_ = binary.Write(&hhea, binary.BigEndian, int16(0))
	_ = binary.Write(&hhea, binary.BigEndian, [4]int16{})
	_ = binary.Write(&hhea, binary.BigEndian, int16(0))
	_ = binary.Write(&hhea, binary.BigEndian, uint16(3))

	var maxp bytes.Buffer
	_ = binary.Write(&maxp, binary.BigEndian, uint32(0x00010000))
	_ = binary.Write(&maxp, binary.BigEndian, uint16(3))
	_ = binary.Write(&maxp, binary.BigEndian, uint16(4))
	_ = binary.Write(&maxp, binary.BigEndian, uint16(1))
	_ = binary.Write(&maxp, binary.BigEndian, [11]uint16{})

	var hmtx bytes.Buffer
	for _, aw := range []uint16{400, advWidth, advWidth} {
		_ = binary.Write(&hmtx, binary.BigEndian, aw)
		_ = binary.Write(&hmtx, binary.BigEndian, int16(0))
	}

	var post bytes.Buffer
	_ = binary.Write(&post, binary.BigEndian, uint32(0x00030000))
	_ = binary.Write(&post, binary.BigEndian, int32(0))
	_ = binary.Write(&post, binary.BigEndian, int16(-100))
	_ = binary.Write(&post, binary.BigEndian, int16(50))
	_ = binary.Write(&post, binary.BigEndian, uint32(0))
	_ = binary.Write(&post, binary.BigEndian, [4]uint32{})

	var cmap bytes.Buffer
	_ = binary.Write(&cmap, binary.BigEndian, uint16(0))
	_ = binary.Write(&cmap, binary.BigEndian, uint16(1))
	_ = binary.Write(&cmap, binary.BigEndian, uint16(3))
	_ = binary.Write(&cmap, binary.BigEndian, uint16(1))
	_ = binary.Write(&cmap, binary.BigEndian, uint32(12))
	var sub bytes.Buffer
	segCount := uint16(3)
	_ = binary.Write(&sub, binary.BigEndian, uint16(4))
	_ = binary.Write(&sub, binary.BigEndian, uint16(16+segCount*8))
	_ = binary.Write(&sub, binary.BigEndian, uint16(0))
	_ = binary.Write(&sub, binary.BigEndian, segCount*2)
	_ = binary.Write(&sub, binary.BigEndian, uint16(4))
	_ = binary.Write(&sub, binary.BigEndian, uint16(1))
	_ = binary.Write(&sub, binary.BigEndian, uint16(2))
	_ = binary.Write(&sub, binary.BigEndian, []uint16{0x4E2D, 0x6587, 0xFFFF})
	_ = binary.Write(&sub, binary.BigEndian, uint16(0))
	_ = binary.Write(&sub, binary.BigEndian, []uint16{0x4E2D, 0x6587, 0xFFFF})
	_ = binary.Write(&sub, binary.BigEndian, []int16{int16(1 - 0x4E2D), int16(2 - 0x6587), 1})
	_ = binary.Write(&sub, binary.BigEndian, []uint16{0, 0, 0})
	cmap.Write(sub.Bytes())

	encodeUTF16BE := func(s string) []byte {
		u := utf16.Encode([]rune(s))
		var out bytes.Buffer
		for _, v := range u {
			_ = binary.Write(&out, binary.BigEndian, v)
		}
		return out.Bytes()
	}
	nameEntries := []struct {
		id  uint16
		val []byte
	}{
		{1, encodeUTF16BE(familyName)},
		{2, encodeUTF16BE("Regular")},
		{4, encodeUTF16BE(familyName)},
		{6, encodeUTF16BE(familyName)},
	}
	var nameTable bytes.Buffer
	var strBuf bytes.Buffer
	_ = binary.Write(&nameTable, binary.BigEndian, uint16(0))
	_ = binary.Write(&nameTable, binary.BigEndian, uint16(len(nameEntries)))
	_ = binary.Write(&nameTable, binary.BigEndian, uint16(6+len(nameEntries)*12))
	for _, e := range nameEntries {
		_ = binary.Write(&nameTable, binary.BigEndian, uint16(3))
		_ = binary.Write(&nameTable, binary.BigEndian, uint16(1))
		_ = binary.Write(&nameTable, binary.BigEndian, uint16(0x0409))
		_ = binary.Write(&nameTable, binary.BigEndian, e.id)
		_ = binary.Write(&nameTable, binary.BigEndian, uint16(len(e.val)))
		_ = binary.Write(&nameTable, binary.BigEndian, uint16(strBuf.Len()))
		strBuf.Write(e.val)
	}
	nameTable.Write(strBuf.Bytes())

	rawTables := map[string][]byte{
		"cmap": cmap.Bytes(),
		"glyf": glyf,
		"head": head.Bytes(),
		"hhea": hhea.Bytes(),
		"hmtx": hmtx.Bytes(),
		"loca": loca.Bytes(),
		"maxp": maxp.Bytes(),
		"name": nameTable.Bytes(),
		"post": post.Bytes(),
	}
	tags := make([]string, 0, len(rawTables))
	for tag := range rawTables {
		tags = append(tags, tag)
	}
	sort.Strings(tags)

	var out bytes.Buffer
	numTables := uint16(len(tags))
	_ = binary.Write(&out, binary.BigEndian, uint32(0x00010000))
	_ = binary.Write(&out, binary.BigEndian, numTables)
	_ = binary.Write(&out, binary.BigEndian, uint16(128))
	_ = binary.Write(&out, binary.BigEndian, uint16(3))
	_ = binary.Write(&out, binary.BigEndian, uint16(numTables*16-128))

	offset := uint32(12 + int(numTables)*16)
	var body bytes.Buffer
	for _, tag := range tags {
		data := rawTables[tag]
		out.WriteString(tag)
		_ = binary.Write(&out, binary.BigEndian, uint32(0))
		_ = binary.Write(&out, binary.BigEndian, offset)
		_ = binary.Write(&out, binary.BigEndian, uint32(len(data)))
		body.Write(data)
		for body.Len()%4 != 0 {
			body.WriteByte(0)
		}
		offset = uint32(12 + int(numTables)*16 + body.Len())
	}
	out.Write(body.Bytes())
	return out.Bytes()
}

func TestRenderFontSampleRowsWithReferenceAndGuards(t *testing.T) {
	root := t.TempDir()
	workdir := filepath.Join(root, "session")
	previewDir := filepath.Join(root, "preview")
	outsideDir := filepath.Join(root, "outside")
	for _, d := range []string{workdir, previewDir, outsideDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	fontFile := filepath.Join(workdir, "MollyTestSerif-Regular.ttf")
	copyFixtureFont(t, fontFile)
	refFile := filepath.Join(workdir, "ref.png")
	makeReferencePNG(t, refFile, 120, 60)

	scope := imaging.Scope{Workdir: workdir, PreviewDirectory: previewDir}
	res, err := RenderFontSampleRows(SampleRequest{
		Scope:         scope,
		Fonts:         []FontSpec{{File: fontFile, Face: "Molly Test Serif"}},
		Text:          "Hello",
		ReferencePath: "ref.png",
	})
	if err != nil {
		t.Fatalf("RenderFontSampleRows failed: %v", err)
	}
	if _, err := jpeg.Decode(bytes.NewReader(res.JPEG)); err != nil {
		t.Fatalf("invalid JPEG output: %v", err)
	}
	rows, ok := res.Metadata["rows"].([]RowMetadata)
	if !ok || len(rows) != 2 {
		t.Fatalf("expected 2 rows (R + 1), got %#v", res.Metadata["rows"])
	}
	if rows[0].Row != "R" || rows[1].Row != 1 {
		t.Fatalf("unexpected row labels: %+v", rows)
	}
	if rows[0].InkHeight != 60 || rows[1].InkHeight != 60 {
		t.Fatalf("expected equal normalized ink height 60, got %d and %d", rows[0].InkHeight, rows[1].InkHeight)
	}
	if rows[1].WidthRatio == nil || *rows[1].WidthRatio <= 0 {
		t.Fatalf("expected positive widthRatio, got %+v", rows[1].WidthRatio)
	}
	if res.Metadata["deliveredHeight"] != 60*2+RowGap {
		t.Fatalf("deliveredHeight = %v, want %d", res.Metadata["deliveredHeight"], 60*2+RowGap)
	}

	if _, err := RenderFontSampleRows(SampleRequest{
		Scope: scope,
		Fonts: []FontSpec{{File: fontFile, Face: "Wrong Face Name"}},
		Text:  "Hello",
	}); err == nil {
		t.Fatal("expected mismatched face name to fail")
	}

	if _, err := RenderFontSampleRows(SampleRequest{
		Scope: scope,
		Fonts: []FontSpec{{File: fontFile, Face: "Molly Test Serif"}},
		Text:  "你好世界",
	}); err == nil {
		t.Fatal("expected missing CJK glyphs in Latin test font to fail explicitly")
	}

	previewFont := filepath.Join(previewDir, "in-preview.ttf")
	copyFixtureFont(t, previewFont)
	if _, err := RenderFontSampleRows(SampleRequest{
		Scope:          scope,
		Fonts:          []FontSpec{{File: previewFont, Face: "Molly Test Serif"}},
		Text:           "Hello",
		SystemFontDirs: []string{filepath.Join(root, "empty-sys")},
	}); err == nil {
		t.Fatal("expected font inside previewDirectory to be rejected")
	}

	outsideFont := filepath.Join(outsideDir, "outside.ttf")
	copyFixtureFont(t, outsideFont)
	symlinkFont := filepath.Join(workdir, "escape.ttf")
	if err := os.Symlink(outsideFont, symlinkFont); err != nil {
		t.Fatal(err)
	}
	if _, err := RenderFontSampleRows(SampleRequest{
		Scope:          scope,
		Fonts:          []FontSpec{{File: symlinkFont, Face: "Molly Test Serif"}},
		Text:           "Hello",
		SystemFontDirs: []string{filepath.Join(root, "empty-sys")},
	}); err == nil {
		t.Fatal("expected symlink escape font to be rejected")
	}
}

func TestRenderCJKFontWidthRatiosDeterministic(t *testing.T) {
	workdir := t.TempDir()
	narrowPath := filepath.Join(workdir, "cjk-narrow.ttf")
	widePath := filepath.Join(workdir, "cjk-wide.ttf")
	if err := os.WriteFile(narrowPath, buildSyntheticCJKTTF(t, "Molly CJK Narrow", 400), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(widePath, buildSyntheticCJKTTF(t, "Molly CJK Wide", 700), 0o600); err != nil {
		t.Fatal(err)
	}
	refPath := filepath.Join(workdir, "ref.png")
	makeReferencePNG(t, refPath, 100, 80)

	res, err := RenderFontSampleRows(SampleRequest{
		Scope: imaging.Scope{Workdir: workdir},
		Fonts: []FontSpec{
			{File: narrowPath, Face: "Molly CJK Narrow"},
			{File: widePath, Face: "Molly CJK Wide"},
		},
		Text:          "中文",
		ReferencePath: "ref.png",
	})
	if err != nil {
		t.Fatalf("CJK RenderFontSampleRows failed: %v", err)
	}
	rows, ok := res.Metadata["rows"].([]RowMetadata)
	if !ok || len(rows) != 3 {
		t.Fatalf("expected 3 rows (R + 2 CJK fonts), got %#v", res.Metadata["rows"])
	}
	if rows[0].InkHeight != 80 || rows[1].InkHeight != 80 || rows[2].InkHeight != 80 {
		t.Fatalf("expected equal inkHeight=80, got %+v", rows)
	}
	if rows[1].WidthRatio == nil || rows[2].WidthRatio == nil {
		t.Fatalf("missing CJK widthRatio: %+v", rows)
	}
	ratioCompare := *rows[2].WidthRatio / *rows[1].WidthRatio
	if math.Abs(ratioCompare-1.66) > 0.15 {
		t.Fatalf("expected wide/narrow CJK width ratio around 1.66 (1500/900), got %.3f (rows=%+v)", ratioCompare, rows)
	}
}
