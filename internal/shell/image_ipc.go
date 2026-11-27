package shell

import (
	"bytes"
	"encoding/json"
	"image/png"
	"os"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo"
)

func (b *MollyBridge) handleImage(method string, args []json.RawMessage) (any, error) {
	return b.imageAction(method, args, mygo.Clipboard.WriteImage, mygo.Dialog.Save)
}
func (b *MollyBridge) imageAction(method string, args []json.RawMessage, copyPNG func([]byte) error, chooseFile func(mygo.SaveDialogOptions) (string, error)) (any, error) {
	var q struct {
		Items           []struct{ Action, Label string }
		Bytes, PNGBytes []byte
		FileName        string
	}
	if len(args) > 0 {
		if err := json.Unmarshal(args[0], &q); err != nil {
			q.Bytes = nil
			q.PNGBytes = nil
			q.Items = nil
		}
	}
	switch method {
	case "showPreviewMenu":
		var result any
		var items []*mygo.MenuItem
		for _, item := range q.Items {
			if (item.Action != "copy" && item.Action != "save") || strings.TrimSpace(item.Label) == "" || len(q.Items) > 2 {
				return settingsObject{"action": nil}, nil
			}
			items = append(items, &mygo.MenuItem{Label: item.Label, Click: func(*mygo.MenuItem, *mygo.Window) { result = item.Action }})
		}
		if win := b.workbench.Load(); win != nil && len(items) > 0 {
			mygo.NewMenu(items).Popup(win)
		}
		return settingsObject{"action": result}, nil
	case "copyToClipboard":
		cfg, e := png.DecodeConfig(bytes.NewReader(q.PNGBytes))
		if e != nil || len(q.PNGBytes) > 64<<20 || int64(cfg.Width)*int64(cfg.Height) > 64<<20 {
			return settingsObject{"copied": false, "error": "unsupported_image"}, nil
		}
		if e = copyPNG(q.PNGBytes); e != nil {
			return settingsObject{"copied": false, "error": e.Error()}, nil
		}
		return settingsObject{"copied": true}, nil
	case "saveAs", "saveFile":
		if len(q.Bytes) == 0 || len(q.Bytes) > 64<<20 {
			return settingsObject{"saved": false, "error": "invalid_bytes"}, nil
		}
		name := filepath.Base(strings.ReplaceAll(q.FileName, "\\", "/"))
		if !filepath.IsLocal(name) || name == "." {
			name = "image"
		}
		path, e := chooseFile(mygo.SaveDialogOptions{DefaultPath: name})
		if e == nil && path == "" {
			return settingsObject{"saved": false, "canceled": true}, nil
		}
		if e == nil {
			e = writeFileAtomicMode0600(path, q.Bytes)
		}
		if e != nil {
			return settingsObject{"saved": false, "error": e.Error()}, nil
		}
		return settingsObject{"saved": true, "path": path}, nil
	}
	return nil, os.ErrInvalid
}
