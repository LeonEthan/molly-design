package shell

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"time"

	"github.com/egoist/mygo"
)

type previewWindow interface {
	Destroy()
	Hide()
	Show()
	SetContentSize(width, height int)
}

type sourcePreview struct {
	id, turn, identity string
	payload            json.RawMessage
	cancel             context.CancelFunc
	win                previewWindow
	surface            *DesignSurface
	bounds             DesignBounds
	visible            bool
}

func (b *MollyBridge) updatePreviews(action func() error) error {
	err := context.Canceled
	run := func() {
		b.previewMu.Lock()
		defer b.previewMu.Unlock()
		err = action()
	}
	if b.cfg.previewUI != nil {
		b.cfg.previewUI(run)
	} else {
		run()
	}
	return err
}

func (b *MollyBridge) discardPreview(p *sourcePreview) {
	p.cancel()
	if p.win != nil {
		b.cfg.DesignHost.RevokeSurface(p.surface.Host)
		p.win.Destroy()
	}
}
func (b *MollyBridge) clearPreviews() {
	b.removePreviews(func(string, *sourcePreview) bool { return true })
}
func (g *CanvasAccessGate) previewTurn(id string) string {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.known {
		return ""
	}
	return g.daemonTurns[id]
}
func (b *MollyBridge) removePreviews(remove func(string, *sourcePreview) bool) {
	_ = b.updatePreviews(func() error {
		for host, p := range b.previews {
			if !remove(host, p) {
				continue
			}
			delete(b.previews, host)
			b.discardPreview(p)
		}
		return nil
	})
}
func (b *MollyBridge) displayPreview(p *sourcePreview) {
	if !p.visible || len(p.payload) == 0 {
		return
	}
	if p.win == nil {
		p.surface = b.cfg.DesignHost.CreateSurface(p.id, p.payload, false)
		win := mygo.NewWindow(mygo.WindowOptions{Title: "Design preview", Hidden: true, Width: int(p.bounds.Width), Height: int(p.bounds.Height)})
		b.cfg.DesignHost.BindSurfaceLifecycle(win, p.surface)
		win.Page().LoadURL(p.surface.URL)
		p.win = win
	}
	p.win.SetContentSize(int(p.bounds.Width), int(p.bounds.Height))
	p.win.Show()
}

func (b *MollyBridge) previewAction(method string, args []json.RawMessage) (any, error) {
	host := stringArg(args, 0)
	return nil, b.updatePreviews(func() error {
		p := b.previews[host]
		if p == nil {
			return nil
		}
		switch method {
		case "attachPreview":
			if len(args) != 2 || json.Unmarshal(args[1], &p.bounds) != nil || p.bounds.Width <= 0 || p.bounds.Height <= 0 {
				return os.ErrInvalid
			}
			p.visible = true
			b.displayPreview(p)
		case "hidePreview":
			cancel := true
			if len(args) > 1 && json.Unmarshal(args[1], &cancel) != nil {
				return os.ErrInvalid
			}
			if !cancel {
				p.visible = false
				if p.win != nil {
					p.win.Hide()
				}
				return nil
			}
			fallthrough
		case "closePreview":
			delete(b.previews, host)
			b.discardPreview(p)
		}
		return nil
	})
}
func (b *MollyBridge) refreshPreview(ctx context.Context, args []json.RawMessage) (any, error) {
	id, host := stringArg(args, 0), stringArg(args, 1)
	var req settingsObject
	if id == "" || host == "" || len(args) != 3 || json.Unmarshal(args[2], &req) != nil || req["method"] != "design/source-path" || b.cfg.DesignWorker == nil || b.cfg.DesignHost == nil {
		return nil, os.ErrInvalid
	}
	params, ok := req["params"].(map[string]any)
	if !ok || len(params) != 0 {
		return nil, os.ErrInvalid
	}
	req["params"] = settingsObject{"version": 2}
	raw, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	parent := b.cfg.appContext
	if parent == nil {
		parent = ctx
	}
	watch, cancel := context.WithCancel(parent)
	p := &sourcePreview{id: id, cancel: cancel}
	err = b.updatePreviews(func() error {
		if watch.Err() != nil {
			return watch.Err()
		}
		p.turn = b.cfg.CanvasGate.previewTurn(id)
		if p.turn == "" {
			return errors.New("design source changed")
		}
		if b.previews == nil {
			b.previews = map[string]*sourcePreview{}
		}
		if old := b.previews[host]; old != nil {
			if old.id == id {
				if old.turn == p.turn {
					p.identity, p.payload = old.identity, old.payload
					p.win, p.surface = old.win, old.surface
					old.win = nil
				}
				p.visible = old.visible
				p.bounds = old.bounds
			}
			b.discardPreview(old)
		}
		b.previews[host] = p
		return nil
	})
	if err != nil {
		cancel()
		return nil, err
	}

	initial, cancelInitial := context.WithCancel(ctx)
	stopCancel := context.AfterFunc(watch, cancelInitial)
	result, err := b.readSourcePreview(initial, p, host, raw)
	stopCancel()
	cancelInitial()
	if err != nil {
		_ = b.updatePreviews(func() error {
			if b.previews[host] == p {
				delete(b.previews, host)
				b.discardPreview(p)
			}
			return nil
		})
		return nil, err
	}
	go func() {
		last := result
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-watch.Done():
				return
			case <-ticker.C:
				r, e := b.readSourcePreview(watch, p, host, raw)
				if e != nil {
					r = settingsObject{"hostId": host, "status": "waiting", "error": e.Error()}
				}
				if watch.Err() == nil && !reflect.DeepEqual(last, r) {
					last = r
					_ = b.EmitToWorkbench("design.preview", r)
				}
			}
		}
	}()
	return result, nil
}

func (b *MollyBridge) readSourcePreview(ctx context.Context, p *sourcePreview, host string, raw json.RawMessage) (settingsObject, error) {
	id := p.id
	v, err := b.handleMachineRPC(ctx, "send", []json.RawMessage{raw})
	if err != nil {
		return nil, err
	}
	envelope, _ := v.(map[string]any)
	source, _ := envelope["result"].(map[string]any)
	live, _ := source["live"].(map[string]any)
	turn, _ := live["turnId"].(string)
	sid, _ := live["sessionId"].(string)
	path, _ := source["path"].(string)
	if envelope["ok"] != true || source["ok"] != true || source["type"] != "design/source-path" || source["artworkId"] != id || turn == "" || sid == "" || filepath.Base(path) != "design.yaml" || !filepath.IsAbs(path) || b.cfg.CanvasGate.previewTurn(id) != turn || p.turn != turn {
		return nil, errors.New("design source changed")
	}
	token, _ := live["sourceTurnId"].(string)
	result := settingsObject{"status": "waiting", "hostId": host}
	if token == "" {
		return result, nil
	}
	request := settingsObject{"operation": "source-preview", "workdir": filepath.Dir(path), "live": settingsObject{"sessionId": sid, "sourceTurnId": token}}
	if p.turn == turn && p.identity != "" {
		request["previousSourceIdentity"] = p.identity
	}
	data, err := b.cfg.DesignWorker.Request(ctx, request)
	if err != nil {
		return nil, err
	}
	var built struct {
		Status, SourceIdentity, Error string
		Doc, Assets                   json.RawMessage
	}
	if err = json.Unmarshal(data, &built); err != nil {
		return nil, err
	}
	err = b.updatePreviews(func() error {
		if b.previews[host] != p || b.cfg.CanvasGate.previewTurn(id) != turn || p.turn != turn {
			result = settingsObject{"status": "superseded", "hostId": host}
			return nil
		}
		switch built.Status {
		case "unchanged":
			if len(p.payload) == 0 {
				return errors.New("missing preview")
			}
			result["status"] = "ready"
		case "ok":
			p.payload, err = json.Marshal(settingsObject{"doc": built.Doc, "assets": built.Assets, "association": settingsObject{"sessionId": id}, "revisionId": built.SourceIdentity})
			if err != nil {
				return err
			}
			p.identity = built.SourceIdentity
			if p.win != nil {
				b.cfg.DesignHost.RevokeSurface(p.surface.Host)
				p.win.Destroy()
				p.win = nil
			}
			b.displayPreview(p)
			result["status"] = "ready"
		case "refused":
			result["error"] = built.Error
			result["retained"] = p.turn == turn && len(p.payload) > 0
		default:
			return errors.New("invalid preview response")
		}
		return nil
	})
	return result, err
}
