package shell

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/LeonEthan/molly-design/internal/security"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestConflictCopy(t *testing.T) {
	g := NewCanvasAccessGate()
	g.UpdateFromDaemon(nil, nil)
	h := NewDesignProtocolHostFromBytes(nil, g, func(string, DesignSaveRequest) (DesignSaveResult, error) {
		return DesignSaveResult{}, errors.New("DESIGN_CONFLICT")
	})
	h.SetRequireOwnerPageForTest(false)
	src := h.CreateSurface("source", nil, true)
	req := httptest.NewRequest("POST", src.Origin+"/ws/source/save", strings.NewReader(`{"baseRevisionId":"old","doc":{},"assets":{}}`))
	req.Header.Set("Origin", src.Origin)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(security.CapabilityTokenHeader, src.CapabilityToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 409 {
		t.Fatal(rec.Code, rec.Body)
	}
	snap := settingsObject{"doc": settingsObject{"canvas": settingsObject{"width": float64(1), "height": float64(2)}, "title": "unsaved"}, "assets": settingsObject{"asset": "data:image/png;base64,AA=="}}
	inst := &mygoCanvasInstance{artworkID: "source", hostID: "host", surface: src, page: testCanvasPage(func(ctx context.Context, js string) (any, error) {
		switch {
		case strings.Contains(js, ".flush"):
			return settingsObject{"ok": false, "error": "DESIGN_CONFLICT"}, nil
		case strings.Contains(js, ".snapshot"):
			if _, ok := ctx.Deadline(); !ok || !g.IsReadonly("source") {
				return nil, errors.New("unprotected snapshot")
			}
			return snap, nil
		default:
			return true, nil
		}
	})}
	c := newMygoDesignController(h, g, nil)
	c.instances["source"] = inst
	if err := g.Register(inst); err != nil {
		t.Fatal(err)
	}
	defer g.Unregister(inst)
	if err := inst.Flush(""); err == nil {
		t.Fatal("conflict unexpectedly flushed")
	}
	var saved json.RawMessage
	w := designWorkerFunc(func(ctx context.Context, v any, checks ...func() error) (json.RawMessage, error) {
		for _, f := range checks {
			if err := f(); err != nil {
				return nil, err
			}
		}
		q := v.(settingsObject)
		switch q["operation"] {
		case "create":
			saved, _ = json.Marshal(q["copy"])
		case "read":
			if q["sessionId"] != "target" || q["readOnly"] != true {
				return nil, errors.New("invalid read")
			}
		default:
			return nil, errors.New("unexpected operation")
		}
		return saved, nil
	})
	s := &CLISupervisor{done: make(chan struct{})}
	s.owned.Store(true)
	b := NewMollyBridge(BridgeConfig{Supervisor: s, DesignWorker: w, DesignController: c, CanvasGate: g})
	args := []json.RawMessage{json.RawMessage(`"source"`), json.RawMessage(`{"sessionId":"target"}`), json.RawMessage(`"host"`)}
	if _, err := b.handleDesign(t.Context(), "copy", args); err != nil {
		t.Fatal(err)
	}
	if g.IsReadonly("source") || src.IsRevoked() || !strings.Contains(string(saved), "unsaved") {
		t.Fatal("copy not retained")
	}
	args[1] = json.RawMessage(`"target"`)
	original := saved
	saved = json.RawMessage(strings.Replace(string(saved), "AA==", "AQ==", 1))
	if _, err := b.handleDesign(t.Context(), "finishCopy", args); err == nil || err.Error() != "DESIGN_COPY_SOURCE_MISMATCH" || src.IsRevoked() || g.IsReadonly("source") {
		t.Fatal("retired source despite changed target asset")
	}
	saved = original
	doc := snap["doc"].(settingsObject)
	doc["title"] = "edited"
	if _, err := b.handleDesign(t.Context(), "finishCopy", args); err == nil || err.Error() != "DESIGN_COPY_SOURCE_MISMATCH" || src.IsRevoked() || g.IsReadonly("source") {
		t.Fatal("retired or froze edited source")
	}
	if doc["title"] != "edited" || string(saved) != string(original) {
		t.Fatal("copy mismatch changed source or target")
	}
	doc["title"] = "unsaved"
	if _, err := b.handleDesign(t.Context(), "finishCopy", args); err != nil {
		t.Fatal(err)
	}
	if !src.IsRevoked() || g.IsReadonly("source") {
		t.Fatal("source did not retire")
	}
}
