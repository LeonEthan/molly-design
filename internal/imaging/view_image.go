package imaging

import (
	"errors"
	"fmt"
	"image"
	"os"
	"strconv"

	"github.com/LeonEthan/molly-design/internal/security"
	xdraw "golang.org/x/image/draw"
)

const (
	SingleImageNote  = "Multiply delivered pixel coordinates by scale (and add region x/y) to get original coordinates."
	ContactSheetNote = "Cells are numbered left to right, top to bottom. Use path with region to look closer at one image."
)

type Scope struct {
	Workdir          string `json:"workdir"`
	PreviewDirectory string `json:"previewDirectory,omitempty"`
}

type Region struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type ViewResult struct {
	JPEG     []byte         `json:"-"`
	Metadata map[string]any `json:"metadata"`
}

func (s Scope) imageRoots() []security.PathRoot {
	roots := []security.PathRoot{{Dir: s.Workdir}}
	if s.PreviewDirectory != "" {
		roots = append(roots, security.PathRoot{Dir: s.PreviewDirectory, RejectSymlinkRoot: true})
	}
	return roots
}

func ReadScopedImage(scope Scope, target string) (string, []byte, DecodedImage, error) {
	if scope.Workdir == "" {
		return "", nil, DecodedImage{}, errors.New("Image path is outside this design session.")
	}
	absPath, raw, err := security.ReadAllowedFileBounded(target, scope.Workdir, scope.imageRoots(), false, MaxImageBytes)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil, DecodedImage{}, fmt.Errorf("Cannot decode %s.", target)
		}
		if isOutsideScopeErr(err) {
			return "", nil, DecodedImage{}, errors.New("Image path is outside this design session.")
		}
		return "", nil, DecodedImage{}, fmt.Errorf("Cannot decode %s.", target)
	}
	decoded, err := InspectAndDecodeBounded(raw, true)
	if err != nil {
		if errors.Is(err, ErrUnsupportedImageFormat) {
			return "", nil, DecodedImage{}, fmt.Errorf("Cannot decode %s: %w", target, ErrUnsupportedImageFormat)
		}
		return "", nil, DecodedImage{}, fmt.Errorf("Cannot decode %s.", target)
	}
	return absPath, raw, decoded, nil
}

func isOutsideScopeErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return msg == "path must not be empty" ||
		msg == "relative path requires a base directory" ||
		len(msg) >= len("path is outside allowed directories:") && msg[:len("path is outside allowed directories:")] == "path is outside allowed directories:"
}

func ViewSingleOrRegion(scope Scope, target string, region *Region) (ViewResult, error) {
	if region != nil {
		if region.X < 0 || region.Y < 0 || region.Width <= 0 || region.Height <= 0 {
			return ViewResult{}, errors.New("Region is outside the image.")
		}
	}
	_, raw, decoded, err := ReadScopedImage(scope, target)
	if err != nil {
		return ViewResult{}, err
	}

	working := decoded.Image
	srcW, srcH := decoded.Width, decoded.Height
	if region != nil {
		if region.X+region.Width > decoded.Width || region.Y+region.Height > decoded.Height {
			return ViewResult{}, errors.New("Region is outside the image.")
		}
		rect := image.Rect(region.X, region.Y, region.X+region.Width, region.Y+region.Height)
		cropped, cropErr := Crop(working, rect)
		if cropErr != nil {
			return ViewResult{}, errors.New("Region is outside the image.")
		}
		working = cropped
		srcW, srcH = region.Width, region.Height
	}

	flattened, hadAlpha := FlattenAlpha(working, AlphaBackground)
	deliveredImg, _ := FitInside(flattened, MaxLongEdge, MaxLongEdge)
	jpegBytes, err := EncodeJPEG(deliveredImg, JPEGQuality)
	if err != nil {
		return ViewResult{}, fmt.Errorf("Cannot decode %s.", target)
	}

	deliveredW := deliveredImg.Bounds().Dx()
	deliveredH := deliveredImg.Bounds().Dy()
	downscaled := deliveredW < srcW || deliveredH < srcH
	scale := float64(maxInt(srcW, srcH)) / float64(maxInt(deliveredW, deliveredH))

	meta := map[string]any{
		"path":            target,
		"format":          "jpeg",
		"originalWidth":   decoded.Width,
		"originalHeight":  decoded.Height,
		"originalBytes":   len(raw),
		"deliveredWidth":  deliveredW,
		"deliveredHeight": deliveredH,
		"deliveredBytes":  len(jpegBytes),
		"downscaled":      downscaled,
		"scale":           scale,
		"note":            SingleImageNote,
	}
	if region != nil {
		meta["region"] = map[string]int{
			"x":      region.X,
			"y":      region.Y,
			"width":  region.Width,
			"height": region.Height,
		}
	}
	if hadAlpha {
		meta["alphaBackground"] = AlphaBackgroundHex
	}
	return ViewResult{JPEG: jpegBytes, Metadata: meta}, nil
}

func ViewContactSheet(scope Scope, targets []string) (ViewResult, error) {
	if len(targets) < 2 || len(targets) > 9 {
		return ViewResult{}, fmt.Errorf("contact sheet requires 2 to 9 images, got %d", len(targets))
	}

	type tile struct {
		img          *image.RGBA
		path         string
		origW, origH int
		origBytes    int
		hadAlpha     bool
		deliveredW   int
		deliveredH   int
	}
	tiles := make([]tile, 0, len(targets))
	for _, target := range targets {
		_, raw, decoded, err := ReadScopedImage(scope, target)
		if err != nil {
			return ViewResult{}, err
		}
		flattened, hadAlpha := FlattenAlpha(decoded.Image, AlphaBackground)
		fitted, _ := FitInside(flattened, ContactCellEdge, ContactCellEdge)
		tiles = append(tiles, tile{
			img:        fitted,
			path:       target,
			origW:      decoded.Width,
			origH:      decoded.Height,
			origBytes:  len(raw),
			hadAlpha:   hadAlpha,
			deliveredW: fitted.Bounds().Dx(),
			deliveredH: fitted.Bounds().Dy(),
		})
	}

	cols := ceilSqrt(len(tiles))
	rows := (len(tiles) + cols - 1) / cols
	canvasW := cols*ContactCellEdge + (cols-1)*ContactGap
	canvasH := rows*ContactCellEdge + (rows-1)*ContactGap
	canvas := image.NewRGBA(image.Rect(0, 0, canvasW, canvasH))
	FillRect(canvas, canvas.Bounds(), WhiteBackground)

	cellsMeta := make([]map[string]any, 0, len(tiles))
	anyAlpha := false
	for i, tl := range tiles {
		col := i % cols
		row := i / cols
		cellX := col * (ContactCellEdge + ContactGap)
		cellY := row * (ContactCellEdge + ContactGap)
		offsetX := cellX + (ContactCellEdge-tl.deliveredW)/2
		offsetY := cellY + (ContactCellEdge-tl.deliveredH)/2
		xdraw.Copy(canvas, image.Pt(offsetX, offsetY), tl.img, tl.img.Bounds(), xdraw.Src, nil)
		DrawBadge(canvas, cellX, cellY, strconv.Itoa(i+1))
		if tl.hadAlpha {
			anyAlpha = true
		}
		cellsMeta = append(cellsMeta, map[string]any{
			"index":          i + 1,
			"path":           tl.path,
			"originalWidth":  tl.origW,
			"originalHeight": tl.origH,
			"originalBytes":  tl.origBytes,
		})
	}

	jpegBytes, err := EncodeJPEG(canvas, JPEGQuality)
	if err != nil {
		return ViewResult{}, err
	}
	meta := map[string]any{
		"cells":           cellsMeta,
		"deliveredWidth":  canvasW,
		"deliveredHeight": canvasH,
		"deliveredBytes":  len(jpegBytes),
		"note":            ContactSheetNote,
	}
	if anyAlpha {
		meta["alphaBackground"] = AlphaBackgroundHex
	}
	return ViewResult{JPEG: jpegBytes, Metadata: meta}, nil
}

func ceilSqrt(n int) int {
	c := 1
	for c*c < n {
		c++
	}
	return c
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
