package shell

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"time"
)

func (i *mygoCanvasInstance) call(ctx context.Context, method string, args ...any) (any, error) {
	if i == nil || i.surface.IsRevoked() {
		return nil, errors.New("canvas unavailable")
	}
	if args == nil {
		args = []any{}
	}
	payload, e := json.Marshal(args)
	if e != nil {
		return nil, e
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return i.page.EvalContext(ctx, "window.molly."+method+"(..."+string(payload)+")")
}

func (b *MollyBridge) canvasAction(ctx context.Context, method string, args []json.RawMessage) (any, error) {
	id, host := stringArg(args, 0), stringArg(args, 1)
	if id == "" {
		return nil, os.ErrInvalid
	}
	c, ok := b.cfg.DesignController.(*mygoDesignController)
	if !ok {
		return nil, errors.New("canvas unavailable")
	}
	if method == "copy" || method == "finishCopy" {
		host = stringArg(args, 2)
	}
	targets := c.targets(id, host, nil)
	var i *mygoCanvasInstance
	if len(targets) == 1 {
		i = targets[0]
	}
	if method == "compareAvailable" {
		for _, inst := range targets {
			if inst.compare != "" {
				return true, nil
			}
		}
		return false, nil
	}
	if i == nil {
		switch method {
		case "settleNotes", "highlight", "compareHold":
			return false, nil
		case "selectionSummary", "cover", "finishCopy":
			return nil, nil
		}
		return nil, errors.New("current artwork is not visible")
	}
	switch method {
	case "selectionSummary":
		ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		return i.page.EvalContext(ctx, "window.__mollySelectionSummary?.()")
	case "settleNotes":
		var epoch *int64
		var sent *bool
		if len(args) < 4 || json.Unmarshal(args[2], &epoch) != nil || epoch == nil || *epoch < 0 || json.Unmarshal(args[3], &sent) != nil || sent == nil {
			return nil, os.ErrInvalid
		}
		return i.call(ctx, "settleNotes", *epoch, *sent, stringArg(args, 4))
	case "cover", "compareHold":
		var value *bool
		if len(args) < 3 || json.Unmarshal(args[2], &value) != nil || value == nil {
			return nil, os.ErrInvalid
		}
		if method == "cover" {
			if *value {
				i.win.Hide()
			} else {
				i.win.Show()
			}
			return nil, nil
		}
		var src any
		if *value {
			if i.compare == "" {
				return false, nil
			}
			src = i.compare
		}
		_, err := i.call(ctx, "showCompare", src)
		return err == nil, err
	case "highlight", "applyCommand":
		if len(args) != 3 {
			return nil, os.ErrInvalid
		}
		if method == "highlight" {
			_, err := i.call(ctx, "highlight", args[2])
			return err == nil, err
		}
		var result any
		err := c.gate.Write(id, "", func() error {
			if !c.gate.IsWriteAllowed(id, "") {
				return ErrCanvasReadOnly
			}
			var err error
			result, err = i.call(ctx, "applyCommands", args[2])
			return err
		})
		return result, err
	case "selection":
		if !c.gate.IsWriteAllowed(id, "") {
			return nil, ErrCanvasReadOnly
		}
		onlySaved := false
		if len(args) > 3 && json.Unmarshal(args[3], &onlySaved) != nil {
			return nil, os.ErrInvalid
		}
		for _, inst := range c.targets(id, "", nil) {
			state, err := inst.EditorState()
			if err != nil {
				return nil, err
			}
			if validateCanvasStateCleanForReload(state) != nil {
				if onlySaved {
					return nil, errors.New("selection awaits autosave")
				}
				if err = c.gate.Flush(id); err != nil {
					return nil, err
				}
				break
			}
		}
		selected, err := i.call(ctx, "selection")
		if err != nil {
			return nil, err
		}
		state, err := i.EditorState()
		if err != nil || validateCanvasStateCleanForReload(state) != nil {
			return nil, errors.New("selection changed")
		}
		raw, err := c.worker.Request(ctx, settingsObject{"operation": "read", "sessionId": id, "readOnly": true})
		if err != nil {
			return nil, err
		}
		var saved struct {
			RevisionID string
			Doc        struct{ Elements []struct{ ID, Kind string } }
		}
		if json.Unmarshal(raw, &saved) != nil || state.RevisionID != saved.RevisionID {
			return nil, errors.New("selection revision changed")
		}
		kinds := map[string]string{}
		for _, el := range saved.Doc.Elements {
			kinds[el.ID] = el.Kind
		}
		els, _ := selected.([]any)
		var ids []string
		for _, el := range els {
			row, _ := el.(map[string]any)
			eid, _ := row["id"].(string)
			if eid == "" || kinds[eid] == "" || stringArg(args, 2) != "" && stringArg(args, 2) != kinds[eid] {
				return nil, os.ErrInvalid
			}
			ids = append(ids, eid)
		}
		if len(ids) == 0 || !c.gate.IsWriteAllowed(id, "") {
			return nil, errors.New("selection unavailable")
		}
		return settingsObject{"artworkId": id, "baselineRevisionId": state.RevisionID, "elementIds": ids}, nil
	case "copy", "finishCopy":
		i.copyMu.Lock()
		defer i.copyMu.Unlock()
		var association settingsObject
		targetID := stringArg(args, 1)
		if method == "copy" {
			if len(args) < 2 || json.Unmarshal(args[1], &association) != nil {
				return nil, os.ErrInvalid
			}
			targetID, _ = association["sessionId"].(string)
		}
		if targetID == "" || targetID == id {
			return nil, os.ErrInvalid
		}
		if method == "finishCopy" && i.copyTarget != targetID {
			return nil, errors.New("no pending copy")
		}
		p, writable, seq, release := c.gate.AcquireCloseFreeze(id, randomHexToken(16))
		defer release()
		if !writable {
			return nil, ErrCanvasReadOnly
		}
		if err := c.gate.WaitApplied(ctx, seq, id); err != nil {
			return nil, err
		}
		var result any
		err := c.gate.Write(id, p, func() error {
			snapshot, err := i.call(ctx, "snapshot")
			if err != nil {
				return err
			}
			snap, _ := snapshot.(map[string]any)
			doc, _ := snap["doc"].(map[string]any)
			canvas, _ := doc["canvas"].(map[string]any)
			if canvas == nil {
				return os.ErrInvalid
			}
			if !c.gate.IsWriteAllowed(id, p) {
				return ErrCanvasReadOnly
			}
			if method == "copy" {
				result, err = b.workerWritePermitted(ctx, targetID, "", settingsObject{"operation": "create", "association": association, "width": canvas["width"], "height": canvas["height"], "copy": snap}, func() error {
					if !c.gate.IsWriteAllowed(id, p) {
						return ErrCanvasReadOnly
					}
					return nil
				})
				if err != nil {
					return err
				}
			}
			raw, err := b.cfg.DesignWorker.Request(ctx, settingsObject{"operation": "read", "sessionId": targetID, "readOnly": true})
			if err != nil {
				return err
			}
			var target settingsObject
			if err := json.Unmarshal(raw, &target); err != nil {
				return err
			}
			if !reflect.DeepEqual(doc, target["doc"]) || !matchesStoredCopyAssets(snap["assets"], target["assets"]) {
				return errors.New("DESIGN_COPY_SOURCE_MISMATCH")
			}
			return nil
		})
		if err == nil && method == "copy" {
			i.copyTarget = targetID
		}
		if err == nil && method == "finishCopy" {
			if !c.gate.IsWriteAllowed(id, p) {
				return nil, ErrCanvasReadOnly
			}
			c.designHost.RevokeSurface(i.surface.Host)
			if i.win != nil {
				i.win.Destroy()
			}
		}
		return result, err
	}
	return nil, os.ErrInvalid
}

func matchesStoredCopyAssets(snapshot, stored any) bool {
	source, ok := snapshot.(map[string]any)
	if !ok {
		return false
	}
	validated, ok := stored.(map[string]any)
	if !ok {
		return false
	}
	for key, value := range validated {
		uri, ok := value.(string)
		if !ok || uri == "" || source[key] != uri {
			return false
		}
	}
	return true
}

func pngDataURL(data []byte) string {
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
}

func blankThumbnail(background struct{ Type, Color string }, elements []json.RawMessage) bool {
	return len(elements) == 0 && background.Type == "solid" && (strings.EqualFold(background.Color, "#fff") || strings.EqualFold(background.Color, "#ffffff"))
}
