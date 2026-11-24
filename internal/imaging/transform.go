package imaging

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"math"

	xdraw "golang.org/x/image/draw"
)

const AlphaBackgroundHex = "#808080"

var (
	AlphaBackground = color.RGBA{R: 0x80, G: 0x80, B: 0x80, A: 0xff}
	WhiteBackground = color.RGBA{R: 0xff, G: 0xff, B: 0xff, A: 0xff}
	BlackInk        = color.RGBA{R: 0x00, G: 0x00, B: 0x00, A: 0xff}
)

var Lanczos3Kernel = &xdraw.Kernel{
	Support: 3,
	At: func(t float64) float64 {
		t = math.Abs(t)
		if t == 0 {
			return 1
		}
		if t >= 3 {
			return 0
		}
		piT := math.Pi * t
		return (math.Sin(piT) / piT) * (math.Sin(piT/3) / (piT / 3))
	},
}

func HasTransparency(src image.Image) bool {
	type opaquer interface {
		Opaque() bool
	}
	if op, ok := src.(opaquer); ok && op.Opaque() {
		return false
	}
	b := src.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			_, _, _, a := src.At(x, y).RGBA()
			if a < 0xffff {
				return true
			}
		}
	}
	return false
}

func FlattenAlpha(src image.Image, bg color.RGBA) (*image.RGBA, bool) {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	hadAlpha := false
	bgR := uint32(bg.R)
	bgG := uint32(bg.G)
	bgB := uint32(bg.B)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r16, g16, b16, a16 := src.At(b.Min.X+x, b.Min.Y+y).RGBA()
			if a16 < 0xffff {
				hadAlpha = true
			}
			inv := 0xffff - a16
			outR := (r16 + (bgR*0x101*inv)/0xffff) >> 8
			outG := (g16 + (bgG*0x101*inv)/0xffff) >> 8
			outB := (b16 + (bgB*0x101*inv)/0xffff) >> 8
			if outR > 255 {
				outR = 255
			}
			if outG > 255 {
				outG = 255
			}
			if outB > 255 {
				outB = 255
			}
			dst.SetRGBA(x, y, color.RGBA{R: uint8(outR), G: uint8(outG), B: uint8(outB), A: 0xff})
		}
	}
	return dst, hadAlpha
}

func Resize(src image.Image, dstW, dstH int) *image.RGBA {
	if dstW < 1 {
		dstW = 1
	}
	if dstH < 1 {
		dstH = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, dstW, dstH))
	Lanczos3Kernel.Scale(dst, dst.Bounds(), src, src.Bounds(), xdraw.Src, nil)
	return dst
}

func FitInside(src image.Image, maxW, maxH int) (*image.RGBA, bool) {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= maxW && h <= maxH {
		dst := image.NewRGBA(image.Rect(0, 0, w, h))
		xdraw.Copy(dst, image.Point{}, src, b, xdraw.Src, nil)
		return dst, false
	}
	scaleW := float64(maxW) / float64(w)
	scaleH := float64(maxH) / float64(h)
	scale := scaleW
	if scaleH < scale {
		scale = scaleH
	}
	targetW := int(math.Round(float64(w) * scale))
	targetH := int(math.Round(float64(h) * scale))
	if targetW < 1 {
		targetW = 1
	}
	if targetH < 1 {
		targetH = 1
	}
	if targetW > maxW {
		targetW = maxW
	}
	if targetH > maxH {
		targetH = maxH
	}
	return Resize(src, targetW, targetH), true
}

func Crop(src image.Image, rect image.Rectangle) (*image.RGBA, error) {
	b := src.Bounds()
	shifted := rect.Add(b.Min)
	if rect.Dx() <= 0 || rect.Dy() <= 0 || !shifted.In(b) {
		return nil, fmt.Errorf("region (%d,%d,%d,%d) is outside image bounds %dx%d",
			rect.Min.X, rect.Min.Y, rect.Dx(), rect.Dy(), b.Dx(), b.Dy())
	}
	dst := image.NewRGBA(image.Rect(0, 0, rect.Dx(), rect.Dy()))
	xdraw.Copy(dst, image.Point{}, src, shifted, xdraw.Src, nil)
	return dst, nil
}

func FillRect(dst *image.RGBA, rect image.Rectangle, c color.RGBA) {
	clipped := rect.Intersect(dst.Bounds())
	for y := clipped.Min.Y; y < clipped.Max.Y; y++ {
		for x := clipped.Min.X; x < clipped.Max.X; x++ {
			dst.SetRGBA(x, y, c)
		}
	}
}

func EncodeJPEG(img image.Image, quality int) ([]byte, error) {
	if quality <= 0 || quality > 100 {
		return nil, errors.New("jpeg quality must be in 1..100")
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, fmt.Errorf("encode jpeg: %w", err)
	}
	return out.Bytes(), nil
}

func TrimInk(src *image.RGBA, whiteThreshold uint8) (*image.RGBA, image.Rectangle, bool) {
	b := src.Bounds()
	minX, minY := b.Max.X, b.Max.Y
	maxX, maxY := b.Min.X-1, b.Min.Y-1
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			c := src.RGBAAt(x, y)
			if c.R < whiteThreshold || c.G < whiteThreshold || c.B < whiteThreshold {
				if x < minX {
					minX = x
				}
				if y < minY {
					minY = y
				}
				if x > maxX {
					maxX = x
				}
				if y > maxY {
					maxY = y
				}
			}
		}
	}
	if maxX < minX || maxY < minY {
		return nil, image.Rectangle{}, false
	}
	trimRect := image.Rect(minX, minY, maxX+1, maxY+1)
	out := image.NewRGBA(image.Rect(0, 0, trimRect.Dx(), trimRect.Dy()))
	xdraw.Copy(out, image.Point{}, src, trimRect, xdraw.Src, nil)
	return out, trimRect, true
}

var badgeGlyphs = map[rune][7]string{
	'0': {".XXX.", "X...X", "X..XX", "X.X.X", "XX..X", "X...X", ".XXX."},
	'1': {"..X..", ".XX..", "..X..", "..X..", "..X..", "..X..", ".XXX."},
	'2': {".XXX.", "X...X", "....X", "..XX.", ".X...", "X....", "XXXXX"},
	'3': {".XXX.", "X...X", "....X", "..XX.", "....X", "X...X", ".XXX."},
	'4': {"...X.", "..XX.", ".X.X.", "X..X.", "XXXXX", "...X.", "...X."},
	'5': {"XXXXX", "X....", "XXXX.", "....X", "....X", "X...X", ".XXX."},
	'6': {".XXX.", "X....", "XXXX.", "X...X", "X...X", "X...X", ".XXX."},
	'7': {"XXXXX", "....X", "...X.", "..X..", ".X...", ".X...", ".X..."},
	'8': {".XXX.", "X...X", "X...X", ".XXX.", "X...X", "X...X", ".XXX."},
	'9': {".XXX.", "X...X", "X...X", ".XXXX", "....X", "X...X", ".XXX."},
	'R': {"XXXX.", "X...X", "X...X", "XXXX.", "X.X..", "X..X.", "X...X"},
}

func DrawBadge(dst *image.RGBA, x, y int, label string) {
	const (
		badgeW = 32
		badgeH = 28
		scale  = 2
	)
	FillRect(dst, image.Rect(x, y, x+badgeW, y+badgeH), WhiteBackground)
	runes := []rune(label)
	if len(runes) == 0 {
		return
	}
	glyphW := 5 * scale
	glyphH := 7 * scale
	gap := 2
	totalW := len(runes)*glyphW + (len(runes)-1)*gap
	startX := x + (badgeW-totalW)/2
	startY := y + (badgeH-glyphH)/2
	for idx, r := range runes {
		bitmap, ok := badgeGlyphs[r]
		if !ok {
			continue
		}
		gx := startX + idx*(glyphW+gap)
		for row := 0; row < 7; row++ {
			for col := 0; col < 5; col++ {
				if bitmap[row][col] == 'X' {
					FillRect(dst, image.Rect(
						gx+col*scale,
						startY+row*scale,
						gx+(col+1)*scale,
						startY+(row+1)*scale,
					), BlackInk)
				}
			}
		}
	}
}
