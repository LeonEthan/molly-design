package fonts

import (
	"errors"
	"fmt"
	"image"
	"image/color"
	"math"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/LeonEthan/molly-design/internal/imaging"
	"github.com/go-text/typesetting/di"
	"github.com/go-text/typesetting/font"
	ot "github.com/go-text/typesetting/font/opentype"
	"github.com/go-text/typesetting/shaping"
	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/math/fixed"
	"golang.org/x/image/vector"
)

const (
	MaxFonts            = 8
	MaxTextRunes        = 60
	MaxFaceNameRunes    = 120
	MinTargetInkHeight  = 48
	MaxTargetInkHeight  = 120
	DefaultInkHeight    = 96
	LabelGutterWidth    = 32
	RowGap              = 8
	InkWhiteThreshold   = 248
	InitialRenderPxSize = 144
	FontRowsNote        = "Rows are scaled to the same ink height; widthRatio = row ink width / reference ink width. Pick the closest row, then set fontSize from font-catalog match and render the artwork once."
)

type FontSpec struct {
	File string `json:"file"`
	Face string `json:"face"`
}

type SampleRequest struct {
	Scope           imaging.Scope   `json:"scope"`
	Fonts           []FontSpec      `json:"fonts"`
	Text            string          `json:"text"`
	ReferencePath   string          `json:"path,omitempty"`
	ReferenceRegion *imaging.Region `json:"region,omitempty"`
	SystemFontDirs  []string        `json:"-"`
}

type RowMetadata struct {
	Row                any             `json:"row"`
	Path               string          `json:"path,omitempty"`
	Region             *imaging.Region `json:"region,omitempty"`
	File               string          `json:"file,omitempty"`
	Face               string          `json:"face,omitempty"`
	InkWidth           int             `json:"inkWidth"`
	InkHeight          int             `json:"inkHeight"`
	WidthRatio         *float64        `json:"widthRatio,omitempty"`
	Downscaled         bool            `json:"downscaled,omitempty"`
	DeliveredInkWidth  int             `json:"deliveredInkWidth,omitempty"`
	DeliveredInkHeight int             `json:"deliveredInkHeight,omitempty"`
}

type rawRow struct {
	label  string
	img    *image.RGBA
	width  int
	height int
	meta   RowMetadata
}

func RenderFontSampleRows(req SampleRequest) (imaging.ViewResult, error) {
	if len(req.Fonts) < 1 || len(req.Fonts) > MaxFonts {
		return imaging.ViewResult{}, fmt.Errorf("fonts must contain 1 to %d entries", MaxFonts)
	}
	textRunes := []rune(req.Text)
	if len(textRunes) == 0 || utf8.RuneCountInString(req.Text) > MaxTextRunes || strings.TrimSpace(req.Text) == "" {
		return imaging.ViewResult{}, fmt.Errorf("text must be non-empty and at most %d characters", MaxTextRunes)
	}
	if req.ReferenceRegion != nil && strings.TrimSpace(req.ReferencePath) == "" {
		return imaging.ViewResult{}, errors.New("region requires path")
	}

	var rows []rawRow
	hasReference := strings.TrimSpace(req.ReferencePath) != ""
	if hasReference {
		refRow, err := renderReferenceRow(req.Scope, req.ReferencePath, req.ReferenceRegion)
		if err != nil {
			return imaging.ViewResult{}, err
		}
		rows = append(rows, refRow)
	}

	inkHeight := DefaultInkHeight
	if hasReference {
		inkHeight = clampInt(rows[0].height, MinTargetInkHeight, MaxTargetInkHeight)
	}

	for idx, spec := range req.Fonts {
		faceName := strings.TrimSpace(spec.Face)
		if faceName == "" || utf8.RuneCountInString(faceName) > MaxFaceNameRunes {
			return imaging.ViewResult{}, fmt.Errorf("font[%d].face must be 1 to %d characters", idx, MaxFaceNameRunes)
		}
		fontBytes, err := ReadAllowedFont(spec.File, req.Scope.Workdir, req.SystemFontDirs)
		if err != nil {
			return imaging.ViewResult{}, err
		}
		face, err := LoadMatchedFace(fontBytes, faceName)
		if err != nil {
			if errors.Is(err, ErrFaceNotFound) {
				return imaging.ViewResult{}, fmt.Errorf("Face %q is not in %s.", faceName, spec.File)
			}
			return imaging.ViewResult{}, fmt.Errorf("Cannot render %s as %q.", spec.File, faceName)
		}
		trimmed, err := rasterizeTextToInk(face, textRunes, InitialRenderPxSize)
		if err != nil {
			return imaging.ViewResult{}, fmt.Errorf("Cannot render %s as %q: %w", spec.File, faceName, err)
		}
		rows = append(rows, rawRow{
			label:  strconv.Itoa(idx + 1),
			img:    trimmed,
			width:  trimmed.Bounds().Dx(),
			height: trimmed.Bounds().Dy(),
			meta: RowMetadata{
				Row:  idx + 1,
				File: spec.File,
				Face: faceName,
			},
		})
	}

	widths := make([]int, len(rows))
	maxRowWidth := 1
	for i, r := range rows {
		w := maxInt(1, int(math.Round(float64(r.width)*float64(inkHeight)/float64(r.height))))
		widths[i] = w
		if w > maxRowWidth {
			maxRowWidth = w
		}
	}
	canvasW := maxRowWidth + LabelGutterWidth
	if canvasW > imaging.MaxLongEdge {
		canvasW = imaging.MaxLongEdge
	}
	canvasH := len(rows)*inkHeight + (len(rows)-1)*RowGap
	canvas := image.NewRGBA(image.Rect(0, 0, canvasW, canvasH))
	imaging.FillRect(canvas, canvas.Bounds(), imaging.WhiteBackground)

	maxContentW := canvasW - LabelGutterWidth
	var referenceWidth int
	if hasReference {
		referenceWidth = widths[0]
	}

	metaRows := make([]RowMetadata, 0, len(rows))
	for i, r := range rows {
		rowWidth := widths[i]
		downscaled := rowWidth > maxContentW
		var resized *image.RGBA
		if downscaled {
			targetH := maxInt(1, int(math.Round(float64(r.height)*float64(maxContentW)/float64(r.width))))
			if targetH > inkHeight {
				targetH = inkHeight
			}
			resized = imaging.Resize(r.img, maxContentW, targetH)
		} else {
			resized = imaging.Resize(r.img, rowWidth, inkHeight)
		}

		top := i * (inkHeight + RowGap)
		imgTop := top + (inkHeight-resized.Bounds().Dy())/2
		xdraw.Copy(canvas, image.Pt(LabelGutterWidth, imgTop), resized, resized.Bounds(), xdraw.Src, nil)
		imaging.DrawBadge(canvas, 0, top, r.label)

		entry := r.meta
		entry.InkWidth = rowWidth
		entry.InkHeight = inkHeight
		if _, isNumericRow := entry.Row.(int); isNumericRow && hasReference && referenceWidth > 0 {
			ratio := float64(rowWidth) / float64(referenceWidth)
			entry.WidthRatio = &ratio
		}
		if downscaled {
			entry.Downscaled = true
			entry.DeliveredInkWidth = resized.Bounds().Dx()
			entry.DeliveredInkHeight = resized.Bounds().Dy()
		}
		metaRows = append(metaRows, entry)
	}

	jpegBytes, err := imaging.EncodeJPEG(canvas, imaging.JPEGQuality)
	if err != nil {
		return imaging.ViewResult{}, err
	}
	return imaging.ViewResult{
		JPEG: jpegBytes,
		Metadata: map[string]any{
			"rows":            metaRows,
			"text":            req.Text,
			"deliveredWidth":  canvasW,
			"deliveredHeight": canvasH,
			"deliveredBytes":  len(jpegBytes),
			"note":            FontRowsNote,
		},
	}, nil
}

func renderReferenceRow(scope imaging.Scope, target string, region *imaging.Region) (rawRow, error) {
	_, _, decoded, err := imaging.ReadScopedImage(scope, target)
	if err != nil {
		return rawRow{}, err
	}
	working := decoded.Image
	if region != nil {
		if region.X < 0 || region.Y < 0 || region.Width <= 0 || region.Height <= 0 ||
			region.X+region.Width > decoded.Width || region.Y+region.Height > decoded.Height {
			return rawRow{}, errors.New("Region is outside the image.")
		}
		cropped, cropErr := imaging.Crop(working, image.Rect(region.X, region.Y, region.X+region.Width, region.Y+region.Height))
		if cropErr != nil {
			return rawRow{}, errors.New("Region is outside the image.")
		}
		working = cropped
	}
	flattened, _ := imaging.FlattenAlpha(working, imaging.WhiteBackground)
	trimmed, _, hasInk := imaging.TrimInk(flattened, InkWhiteThreshold)
	if !hasInk {
		trimmed = flattened
	}
	return rawRow{
		label:  "R",
		img:    trimmed,
		width:  trimmed.Bounds().Dx(),
		height: trimmed.Bounds().Dy(),
		meta: RowMetadata{
			Row:    "R",
			Path:   target,
			Region: region,
		},
	}, nil
}

func rasterizeTextToInk(face *font.Face, textRunes []rune, pxSize int) (*image.RGBA, error) {
	for _, r := range textRunes {
		if unicode.IsSpace(r) {
			continue
		}
		gid, ok := face.NominalGlyph(r)
		if !ok || gid == 0 {
			return nil, fmt.Errorf("missing glyph for character %q (U+%04X)", r, r)
		}
	}

	shaper := &shaping.HarfbuzzShaper{}
	out := shaper.Shape(shaping.Input{
		Text:      textRunes,
		RunStart:  0,
		RunEnd:    len(textRunes),
		Direction: di.DirectionLTR,
		Face:      face,
		Size:      fixed.I(pxSize),
	})
	if len(out.Glyphs) == 0 {
		return nil, errors.New("shaping produced no glyphs")
	}

	upem := float32(face.Upem())
	if upem <= 0 {
		return nil, errors.New("font has invalid units-per-em")
	}
	scale := float32(pxSize) / upem

	type placedOutline struct {
		outline font.GlyphOutline
		x       float32
		y       float32
	}
	placed := make([]placedOutline, 0, len(out.Glyphs))
	penX := float32(0)
	penY := float32(0)
	minX := float32(math.Inf(1))
	minY := float32(math.Inf(1))
	maxX := float32(math.Inf(-1))
	maxY := float32(math.Inf(-1))
	hasPath := false

	for _, g := range out.Glyphs {
		if g.GlyphID == 0 {
			if clusterHasVisibleRune(textRunes, g.TextIndex(), g.RuneCount) {
				return nil, errors.New("shaping produced missing glyph (.notdef)")
			}
			penX += fixedToFloat32(g.Advance)
			continue
		}
		gx := penX + fixedToFloat32(g.XOffset)
		gy := penY - fixedToFloat32(g.YOffset)
		penX += fixedToFloat32(g.Advance)

		outline, ok := face.GlyphDataOutline(g.GlyphID)
		if !ok || len(outline.Segments) == 0 {
			continue
		}
		for _, seg := range outline.Segments {
			for _, pt := range seg.ArgsSlice() {
				px := gx + pt.X*scale
				py := gy - pt.Y*scale
				if px < minX {
					minX = px
				}
				if py < minY {
					minY = py
				}
				if px > maxX {
					maxX = px
				}
				if py > maxY {
					maxY = py
				}
				hasPath = true
			}
		}
		placed = append(placed, placedOutline{outline: outline, x: gx, y: gy})
	}
	if !hasPath {
		return nil, errors.New("font rendered no visible ink")
	}

	const margin = 8
	width := int(math.Ceil(float64(maxX-minX))) + margin*2
	height := int(math.Ceil(float64(maxY-minY))) + margin*2
	if width < 1 || height < 1 || width > imaging.MaxEdge || height > imaging.MaxEdge {
		return nil, fmt.Errorf("rendered glyph surface out of bounds (%dx%d)", width, height)
	}
	shiftX := -minX + float32(margin)
	shiftY := -minY + float32(margin)

	ras := vector.NewRasterizer(width, height)
	ras.DrawOp = xdraw.Over
	for _, p := range placed {
		ox := p.x + shiftX
		oy := p.y + shiftY
		for _, seg := range p.outline.Segments {
			switch seg.Op {
			case ot.SegmentOpMoveTo:
				ras.MoveTo(ox+seg.Args[0].X*scale, oy-seg.Args[0].Y*scale)
			case ot.SegmentOpLineTo:
				ras.LineTo(ox+seg.Args[0].X*scale, oy-seg.Args[0].Y*scale)
			case ot.SegmentOpQuadTo:
				ras.QuadTo(
					ox+seg.Args[0].X*scale, oy-seg.Args[0].Y*scale,
					ox+seg.Args[1].X*scale, oy-seg.Args[1].Y*scale,
				)
			case ot.SegmentOpCubeTo:
				ras.CubeTo(
					ox+seg.Args[0].X*scale, oy-seg.Args[0].Y*scale,
					ox+seg.Args[1].X*scale, oy-seg.Args[1].Y*scale,
					ox+seg.Args[2].X*scale, oy-seg.Args[2].Y*scale,
				)
			}
		}
		ras.ClosePath()
	}

	alphaMask := image.NewAlpha(image.Rect(0, 0, width, height))
	ras.Draw(alphaMask, alphaMask.Bounds(), image.Opaque, image.Point{})

	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			a := alphaMask.AlphaAt(x, y).A
			v := uint8(255 - a)
			canvas.SetRGBA(x, y, color.RGBA{R: v, G: v, B: v, A: 0xff})
		}
	}

	trimmed, _, ok := imaging.TrimInk(canvas, InkWhiteThreshold)
	if !ok {
		return nil, errors.New("font rendered blank ink")
	}
	return trimmed, nil
}

func clusterHasVisibleRune(runes []rune, start int, count int) bool {
	if start < 0 || start >= len(runes) {
		return true
	}
	if count <= 0 {
		count = 1
	}
	end := start + count
	if end > len(runes) {
		end = len(runes)
	}
	for _, r := range runes[start:end] {
		if !unicode.IsSpace(r) {
			return true
		}
	}
	return false
}

func fixedToFloat32(v fixed.Int26_6) float32 {
	return float32(v) / 64.0
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
