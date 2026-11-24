package shell

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"image/png"
	"math"
)

const (
	MaxExportEdgePx      = 16384
	MaxExportTotalPixels = 64_000_000
	MinBleedPx           = 64
	MaxBleedPx           = 512
	DefaultTileEdge      = 1536
)

type TileRect struct {
	LogicalX      int
	LogicalY      int
	LogicalWidth  int
	LogicalHeight int
	CaptureX      int
	CaptureY      int
	CaptureWidth  int
	CaptureHeight int
	CropOffsetX   int
	CropOffsetY   int
}

type CapturedTile struct {
	Rect  TileRect
	Image image.Image
}

type PixelDiffReport struct {
	Width             int     `json:"width"`
	Height            int     `json:"height"`
	TotalPixels       int     `json:"totalPixels"`
	DifferingPixels   int     `json:"differingPixels"`
	DifferingPercent  float64 `json:"differingPercent"`
	MeanAbsoluteError float64 `json:"meanAbsoluteError"`
	MaxChannelDiff    uint8   `json:"maxChannelDiff"`
}

func ComputeDynamicBleedPx(docJSON []byte) int {
	var raw any
	if err := json.Unmarshal(docJSON, &raw); err != nil {
		return MinBleedPx
	}
	maxBleed := float64(MinBleedPx)
	walkShadowBleed(raw, &maxBleed)
	bleed := int(math.Ceil(maxBleed))
	if bleed < MinBleedPx {
		return MinBleedPx
	}
	if bleed > MaxBleedPx {
		return MaxBleedPx
	}
	return bleed
}

func walkShadowBleed(node any, maxBleed *float64) {
	switch v := node.(type) {
	case map[string]any:
		if shadow, ok := v["shadow"].(map[string]any); ok {
			updateBleedFromShadowMap(shadow, maxBleed)
		}
		if shadows, ok := v["shadows"].([]any); ok {
			for _, item := range shadows {
				if sm, ok := item.(map[string]any); ok {
					updateBleedFromShadowMap(sm, maxBleed)
				}
			}
		}
		if sw := toFloat(v["strokeWidth"]); sw > 0 {
			if sw > *maxBleed {
				*maxBleed = sw
			}
		}
		if blur := toFloat(v["blur"]); blur > 0 {
			if b := blur * 2.5; b > *maxBleed {
				*maxBleed = b
			}
		}
		for _, child := range v {
			walkShadowBleed(child, maxBleed)
		}
	case []any:
		for _, item := range v {
			walkShadowBleed(item, maxBleed)
		}
	}
}

func updateBleedFromShadowMap(sm map[string]any, maxBleed *float64) {
	ox := math.Abs(toFloat(sm["offsetX"]))
	oy := math.Abs(toFloat(sm["offsetY"]))
	if ox == 0 {
		ox = math.Abs(toFloat(sm["x"]))
	}
	if oy == 0 {
		oy = math.Abs(toFloat(sm["y"]))
	}
	blur := math.Abs(toFloat(sm["blur"]))
	spread := math.Abs(toFloat(sm["spread"]))
	extent := math.Max(ox, oy) + blur*2.5 + spread
	if extent > *maxBleed {
		*maxBleed = extent
	}
}

func toFloat(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	default:
		return 0
	}
}

func PlanExportTiles(canvasWidth, canvasHeight, scale, maxTileEdge, bleedPx int) ([]TileRect, error) {
	if canvasWidth <= 0 || canvasHeight <= 0 {
		return nil, errors.New("canvas dimensions must be positive")
	}
	if scale < 1 || scale > 3 {
		return nil, fmt.Errorf("unsupported export scale %d", scale)
	}
	if max(canvasWidth, canvasHeight)*scale > MaxExportEdgePx {
		return nil, fmt.Errorf("export exceeds maximum edge %d px", MaxExportEdgePx)
	}
	totalPixels := int64(canvasWidth*scale) * int64(canvasHeight*scale)
	if totalPixels > MaxExportTotalPixels {
		return nil, fmt.Errorf("export exceeds maximum pixel budget %d", MaxExportTotalPixels)
	}
	if maxTileEdge <= 0 {
		maxTileEdge = DefaultTileEdge
	}
	if bleedPx < 0 {
		bleedPx = 0
	}
	if canvasWidth <= maxTileEdge && canvasHeight <= maxTileEdge {
		return []TileRect{{
			LogicalX:      0,
			LogicalY:      0,
			LogicalWidth:  canvasWidth,
			LogicalHeight: canvasHeight,
			CaptureX:      0,
			CaptureY:      0,
			CaptureWidth:  canvasWidth,
			CaptureHeight: canvasHeight,
			CropOffsetX:   0,
			CropOffsetY:   0,
		}}, nil
	}

	var tiles []TileRect
	for y := 0; y < canvasHeight; y += maxTileEdge {
		lh := min(maxTileEdge, canvasHeight-y)
		capY := max(0, y-bleedPx)
		capEndY := min(canvasHeight, y+lh+bleedPx)
		for x := 0; x < canvasWidth; x += maxTileEdge {
			lw := min(maxTileEdge, canvasWidth-x)
			capX := max(0, x-bleedPx)
			capEndX := min(canvasWidth, x+lw+bleedPx)
			tiles = append(tiles, TileRect{
				LogicalX:      x,
				LogicalY:      y,
				LogicalWidth:  lw,
				LogicalHeight: lh,
				CaptureX:      capX,
				CaptureY:      capY,
				CaptureWidth:  capEndX - capX,
				CaptureHeight: capEndY - capY,
				CropOffsetX:   x - capX,
				CropOffsetY:   y - capY,
			})
		}
	}
	return tiles, nil
}

type IncrementalTileStitcher struct {
	outW  int
	outH  int
	scale int
	dst   *image.NRGBA
}

func NewIncrementalTileStitcher(outWidth, outHeight, scale int) (*IncrementalTileStitcher, error) {
	if outWidth <= 0 || outHeight <= 0 || scale < 1 || scale > 3 {
		return nil, errors.New("invalid stitch output dimensions")
	}
	if max(outWidth, outHeight)*scale > MaxExportEdgePx {
		return nil, fmt.Errorf("stitch output exceeds maximum edge %d px", MaxExportEdgePx)
	}
	if int64(outWidth*scale)*int64(outHeight*scale) > MaxExportTotalPixels {
		return nil, fmt.Errorf("stitch output exceeds maximum pixel budget %d", MaxExportTotalPixels)
	}
	return &IncrementalTileStitcher{
		outW:  outWidth,
		outH:  outHeight,
		scale: scale,
		dst:   image.NewNRGBA(image.Rect(0, 0, outWidth*scale, outHeight*scale)),
	}, nil
}

func (s *IncrementalTileStitcher) AddTile(rect TileRect, tileImg image.Image) error {
	if tileImg == nil {
		return errors.New("tile image is nil")
	}
	if rect.CaptureWidth <= 0 || rect.CaptureHeight <= 0 || rect.LogicalWidth <= 0 || rect.LogicalHeight <= 0 {
		return errors.New("tile bounds invalid")
	}
	sb := tileImg.Bounds()
	if sb.Dx() < rect.CaptureWidth || sb.Dy() < rect.CaptureHeight {
		return fmt.Errorf("captured tile %dx%d smaller than expected viewport %dx%d", sb.Dx(), sb.Dy(), rect.CaptureWidth, rect.CaptureHeight)
	}
	dprX := float64(sb.Dx()) / float64(rect.CaptureWidth)
	dprY := float64(sb.Dy()) / float64(rect.CaptureHeight)
	if math.Abs(dprX-dprY) > 0.05 {
		return fmt.Errorf("captured tile aspect ratio mismatch: dprX=%.3f dprY=%.3f", dprX, dprY)
	}

	targetW := rect.LogicalWidth * s.scale
	targetH := rect.LogicalHeight * s.scale
	dstOriginX := rect.LogicalX * s.scale
	dstOriginY := rect.LogicalY * s.scale

	if math.Abs(dprX-float64(s.scale)) < 0.01 && math.Abs(dprY-float64(s.scale)) < 0.01 {
		srcX := sb.Min.X + int(math.Round(float64(rect.CropOffsetX)*dprX))
		srcY := sb.Min.Y + int(math.Round(float64(rect.CropOffsetY)*dprY))
		dstRect := image.Rect(dstOriginX, dstOriginY, dstOriginX+targetW, dstOriginY+targetH)
		draw.Draw(s.dst, dstRect, tileImg, image.Pt(srcX, srcY), draw.Src)
		return nil
	}

	for dy := 0; dy < targetH; dy++ {
		logicalY := float64(rect.CropOffsetY) + (float64(dy)+0.5)/float64(s.scale)
		srcY := sb.Min.Y + int(math.Floor(logicalY*dprY))
		if srcY >= sb.Max.Y {
			srcY = sb.Max.Y - 1
		}
		for dx := 0; dx < targetW; dx++ {
			logicalX := float64(rect.CropOffsetX) + (float64(dx)+0.5)/float64(s.scale)
			srcX := sb.Min.X + int(math.Floor(logicalX*dprX))
			if srcX >= sb.Max.X {
				srcX = sb.Max.X - 1
			}
			s.dst.Set(dstOriginX+dx, dstOriginY+dy, tileImg.At(srcX, srcY))
		}
	}
	return nil
}

func (s *IncrementalTileStitcher) Image() *image.NRGBA {
	return s.dst
}

func StitchCapturedTiles(outWidth, outHeight, scale int, tiles []CapturedTile) (*image.NRGBA, error) {
	stitcher, err := NewIncrementalTileStitcher(outWidth, outHeight, scale)
	if err != nil {
		return nil, err
	}
	for i, tile := range tiles {
		if err := stitcher.AddTile(tile.Rect, tile.Image); err != nil {
			return nil, fmt.Errorf("tile %d: %w", i, err)
		}
	}
	return stitcher.Image(), nil
}

func EncodeExportImage(img image.Image, format string) ([]byte, error) {
	var buf bytes.Buffer
	switch format {
	case "png":
		if err := png.Encode(&buf, img); err != nil {
			return nil, err
		}
	case "jpeg":
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 92}); err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("unsupported export format %q", format)
	}
	return buf.Bytes(), nil
}

func CompareImagesPixelDiff(imgA, imgB image.Image) (PixelDiffReport, error) {
	if imgA == nil || imgB == nil {
		return PixelDiffReport{}, errors.New("both images are required")
	}
	ba := imgA.Bounds()
	bb := imgB.Bounds()
	if ba.Dx() != bb.Dx() || ba.Dy() != bb.Dy() {
		return PixelDiffReport{}, fmt.Errorf("image dimensions differ: %dx%d vs %dx%d", ba.Dx(), ba.Dy(), bb.Dx(), bb.Dy())
	}
	w, h := ba.Dx(), ba.Dy()
	total := w * h
	if total == 0 {
		return PixelDiffReport{}, errors.New("empty image")
	}
	var sumAbs uint64
	var maxDiff uint8
	var diffPixels int
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			ra, ga, baC, aa := imgA.At(ba.Min.X+x, ba.Min.Y+y).RGBA()
			rb, gb, bbC, ab := imgB.At(bb.Min.X+x, bb.Min.Y+y).RGBA()
			dR := absDiffUint8(uint8(ra>>8), uint8(rb>>8))
			dG := absDiffUint8(uint8(ga>>8), uint8(gb>>8))
			dB := absDiffUint8(uint8(baC>>8), uint8(bbC>>8))
			dA := absDiffUint8(uint8(aa>>8), uint8(ab>>8))
			sumAbs += uint64(dR) + uint64(dG) + uint64(dB) + uint64(dA)
			pxMax := max(max(dR, dG), max(dB, dA))
			if pxMax > maxDiff {
				maxDiff = pxMax
			}
			if pxMax > 2 {
				diffPixels++
			}
		}
	}
	return PixelDiffReport{
		Width:             w,
		Height:            h,
		TotalPixels:       total,
		DifferingPixels:   diffPixels,
		DifferingPercent:  (float64(diffPixels) / float64(total)) * 100.0,
		MeanAbsoluteError: float64(sumAbs) / float64(total*4),
		MaxChannelDiff:    maxDiff,
	}, nil
}

func absDiffUint8(a, b uint8) uint8 {
	if a >= b {
		return a - b
	}
	return b - a
}
