package shell

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"regexp"
)

var designCommitID = regexp.MustCompile("^[a-f0-9]{40}$")

func (b *MollyBridge) workerWrite(ctx context.Context, id string, q settingsObject) (json.RawMessage, error) {
	return b.workerWritePermitted(ctx, id, "", q)
}

func (b *MollyBridge) workerWritePermitted(ctx context.Context, id, permit string, q settingsObject, checks ...func() error) (json.RawMessage, error) {
	var result json.RawMessage
	err := b.cfg.CanvasGate.Write(id, permit, func() error {
		var err error
		check := func() error {
			if !b.private.Load().OwnsPrivateDaemon() || !b.cfg.CanvasGate.IsWriteAllowed(id, permit) {
				return ErrCanvasReadOnly
			}
			return nil
		}
		result, err = b.cfg.DesignWorker.Request(ctx, q, append(checks, check)...)
		return err
	})
	return result, err
}

func (b *MollyBridge) designStore(ctx context.Context, method string, args []json.RawMessage) (any, error) {
	w := b.cfg.DesignWorker
	if w == nil {
		return nil, errors.New("design worker unavailable")
	}
	if method == "pending" {
		return b.pendingDesigns(ctx)
	}
	id := stringArg(args, 0)
	if method == "create" {
		var q settingsObject
		if len(args) == 0 || json.Unmarshal(args[0], &q) != nil {
			return nil, os.ErrInvalid
		}
		association, _ := q["association"].(map[string]any)
		id, _ = association["sessionId"].(string)
		if id == "" {
			return nil, os.ErrInvalid
		}
		q["operation"] = "create"
		return b.workerWrite(ctx, id, q)
	}
	if id == "" {
		return nil, os.ErrInvalid
	}
	q := settingsObject{"sessionId": id}
	switch method {
	case "read", "versions", "history-read":
		q["operation"] = method
		if method == "versions" {
			q["operation"] = "history-list"
		}
		if method == "history-read" {
			commit := stringArg(args, 1)
			if !designCommitID.MatchString(commit) {
				return nil, os.ErrInvalid
			}
			q["commitId"] = commit
		}
		if b.private.Load().OwnsPrivateDaemon() && b.cfg.CanvasGate.IsWriteAllowed(id, "") {
			r, e := b.workerWrite(ctx, id, q)
			if !errors.Is(e, ErrCanvasReadOnly) {
				return r, e
			}
		}
		q["readOnly"] = true
		return w.Request(ctx, q)
	case "acknowledge":
		q["operation"] = "acknowledge"
		q["verifyProjection"] = true
		_, e := b.workerWrite(ctx, id, q)
		return nil, e
	}
	if method == "restoreVersion" && !designCommitID.MatchString(stringArg(args, 1)) {
		return nil, os.ErrInvalid
	}
	gate := b.cfg.CanvasGate
	p, writable, seq, release := gate.AcquireCloseFreeze(id, randomHexToken(16))
	defer release()
	if !writable {
		return nil, ErrCanvasReadOnly
	}
	if e := gate.flushInstances(ctx, id, p, seq); e != nil {
		return nil, e
	}
	raw, e := w.Request(ctx, settingsObject{"operation": "read", "sessionId": id, "readOnly": true})
	if e != nil {
		return nil, e
	}
	var current struct {
		RevisionID  string
		Doc, Assets json.RawMessage
	}
	if json.Unmarshal(raw, &current) != nil || current.RevisionID == "" {
		return nil, os.ErrInvalid
	}
	q["baseRevisionId"] = current.RevisionID
	switch method {
	case "saveVersion":
		q["operation"] = "history-create"
	case "restoreVersion":
		q["operation"] = "history-restore"
		q["commitId"] = stringArg(args, 1)
	case "rename":
		q["operation"] = "save"
		q["name"] = stringArg(args, 1)
		q["content"] = settingsObject{"doc": current.Doc, "assets": current.Assets}
	default:
		return nil, os.ErrInvalid
	}
	result, e := b.workerWritePermitted(ctx, id, p, q)
	if e != nil {
		return nil, e
	}
	_ = b.EmitToWorkbench("design.state", settingsObject{"artworkId": id})
	if c, ok := b.cfg.DesignController.(*mygoDesignController); ok && method != "restoreVersion" {
		saved := result
		if method == "saveVersion" {
			saved, e = w.Request(ctx, settingsObject{"operation": "read", "sessionId": id, "readOnly": true})
		}
		var next struct{ RevisionID string }
		if e == nil {
			e = json.Unmarshal(saved, &next)
		}
		if e == nil {
			for _, i := range c.targets(id, "", nil) {
				if _, e = i.call(ctx, "rebase", current.RevisionID, next.RevisionID); e != nil {
					break
				}
			}
		}
	} else if b.cfg.DesignController != nil {
		e = b.cfg.DesignController.SyncFromStore(ctx, id, "")
	}
	if method == "restoreVersion" {
		var restored struct{ RevisionID string }
		if err := json.Unmarshal(result, &restored); err != nil {
			return nil, err
		}
		out := settingsObject{"revisionId": restored.RevisionID}
		if e != nil {
			out["reloadError"] = e.Error()
		}
		return out, nil
	}
	if e != nil {
		var obj settingsObject
		if json.Unmarshal(result, &obj) == nil {
			obj["reloadError"] = e.Error()
			return obj, nil
		}
	}
	return result, nil
}

func (b *MollyBridge) pendingDesigns(ctx context.Context) (any, error) {
	type item struct {
		SessionID       string
		Association     json.RawMessage
		RevisionID      string
		ProjectionStale bool
	}
	var items []item
	q := settingsObject{"operation": "pending-associations", "readOnly": true}
	cursor := ""
	for {
		raw, e := b.cfg.DesignWorker.Request(ctx, q)
		if e != nil {
			return nil, e
		}
		var page struct {
			Items      []item
			NextCursor *string
		}
		if e = json.Unmarshal(raw, &page); e != nil {
			return nil, e
		}
		items = append(items, page.Items...)
		if page.NextCursor == nil {
			break
		}
		if *page.NextCursor <= cursor {
			return nil, errors.New("invalid pending cursor")
		}
		cursor = *page.NextCursor
		q["cursor"] = cursor
	}
	out := make([]settingsObject, 0, len(items))
	for _, it := range items {
		if it.ProjectionStale && b.private.Load().OwnsPrivateDaemon() && b.cfg.CanvasGate.IsWriteAllowed(it.SessionID, "") {
			raw, e := b.workerWrite(ctx, it.SessionID, settingsObject{"operation": "repair-projection", "sessionId": it.SessionID})
			if e == nil {
				var repaired struct{ RevisionID string }
				if json.Unmarshal(raw, &repaired) == nil && repaired.RevisionID != "" {
					it.RevisionID = repaired.RevisionID
				}
			}
		}
		out = append(out, settingsObject{"association": it.Association, "revisionId": it.RevisionID})
	}
	return out, nil
}

func (b *MollyBridge) designState(ctx context.Context, id string) (any, error) {
	idJSON, _ := json.Marshal(id)
	read := func(method string, args ...json.RawMessage) (settingsObject, error) {
		res, e := b.designStore(ctx, method, args)
		if e != nil {
			return nil, e
		}
		raw, ok := res.(json.RawMessage)
		if !ok {
			return nil, os.ErrInvalid
		}
		var value settingsObject
		e = json.Unmarshal(raw, &value)
		return value, e
	}
	saved, e := read("read", idJSON)
	if e != nil {
		return nil, e
	}
	state := b.cfg.CanvasGate.State(id)
	state["revisionId"] = saved["revisionId"]
	state["changed"] = true
	editing, _ := saved["editing"].(map[string]any)
	if base, ok := editing["baseVersionId"].(string); ok {
		baseJSON, _ := json.Marshal(base)
		historic, e := read("history-read", idJSON, baseJSON)
		if e != nil {
			return nil, e
		}
		state["baseVersionId"] = base
		state["changed"] = !reflect.DeepEqual(saved["doc"], historic["doc"]) || !reflect.DeepEqual(saved["assets"], historic["assets"])
	}
	return state, nil
}
