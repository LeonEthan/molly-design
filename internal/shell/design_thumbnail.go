package shell

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io/fs"
	"math"
	"os"
	"path/filepath"

	"github.com/LeonEthan/molly-design/internal/security"
	"golang.org/x/image/draw"
)

func (b *MollyBridge) thumbnail(ctx context.Context, id string) (string, error) {
	if id == "" || b.cfg.DesignHost == nil || b.cfg.DesignWorker == nil {
		return "", os.ErrInvalid
	}
	b.thumbMu.Lock()
	defer b.thumbMu.Unlock()
	raw, e := b.cfg.DesignWorker.Request(ctx, settingsObject{"operation": "read", "sessionId": id, "readOnly": true})
	if e != nil {
		return "", e
	}
	var saved struct {
		RevisionID string
		Doc        struct {
			Elements   []json.RawMessage
			Background struct{ Type, Color string }
		}
	}
	if e = json.Unmarshal(raw, &saved); e != nil {
		return "", e
	}
	if blankThumbnail(saved.Doc.Background, saved.Doc.Elements) {
		return "", nil
	}
	root, e := os.OpenRoot(b.cfg.DataDir)
	if e != nil {
		return "", e
	}
	defer root.Close()
	directory := thumbnailDirectory(id)
	if e = root.MkdirAll(directory, 0700); e != nil {
		return "", e
	}

	cache, e := root.OpenRoot(directory)
	if e != nil {
		return "", e
	}
	defer cache.Close()
	name := fmt.Sprintf("%x.png", sha256.Sum256([]byte(id+"\x00"+saved.RevisionID)))
	if data, e := security.ReadBoundedFileFromRoot(cache, name, 64<<20); e == nil {
		return pngDataURL(data), nil
	}
	data, _, _, _, _, e := renderDesignOffscreen(b.cfg.DesignHost, id, raw, "png", 1, nil)
	if e != nil {
		return "", e
	}
	src, e := png.Decode(bytes.NewReader(data))
	if e != nil {
		return "", e
	}
	w, h := src.Bounds().Dx(), src.Bounds().Dy()
	scale := math.Min(1, 560/float64(min(w, h)))
	dst := image.NewRGBA(image.Rect(0, 0, max(1, int(math.Round(float64(w)*scale))), max(1, int(math.Round(float64(h)*scale)))))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Src, nil)
	var buf bytes.Buffer
	if e = png.Encode(&buf, dst); e != nil {
		return "", e
	}
	tmp := randomHexToken(16) + ".tmp"
	f, e := cache.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return "", e
	}
	defer cache.Remove(tmp)
	_, e = f.Write(buf.Bytes())
	if e = errors.Join(e, f.Close()); e != nil {
		return "", e
	}
	if e = cache.Rename(tmp, name); e != nil {
		return "", e
	}
	entries, _ := fs.ReadDir(cache.FS(), ".")
	for _, entry := range entries {
		if entry.Name() != name && filepath.Ext(entry.Name()) == ".png" {
			_ = cache.Remove(entry.Name())
		}
	}
	return pngDataURL(buf.Bytes()), nil
}

func thumbnailDirectory(id string) string {
	return filepath.Join("design-thumbnails-v2", fmt.Sprintf("%x", sha256.Sum256([]byte(id))))
}

func (b *MollyBridge) forgetThumbnail(id string) error {
	b.thumbMu.Lock()
	defer b.thumbMu.Unlock()
	r, e := os.OpenRoot(b.cfg.DataDir)
	if e != nil {
		return e
	}
	defer r.Close()
	return r.RemoveAll(thumbnailDirectory(id))
}
