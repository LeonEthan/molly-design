package shell

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"time"

	"github.com/LeonEthan/molly-design/internal/security"
	"github.com/google/uuid"
)

type renderWork struct {
	RequestID, PayloadPath, OutputPath string
	Width, Height                      int
}
type renderReport struct {
	RequestID string `json:"requestId"`
	OK        bool   `json:"ok"`
	Error     string `json:"error,omitempty"`
}

func (b *MollyBridge) renderWork(ctx context.Context, w renderWork) error {
	return b.renderStaged(ctx, w, func(ctx context.Context, id string, payload json.RawMessage) ([]byte, error) {
		data, _, _, _, _, err := renderDesignOffscreenContext(ctx, b.cfg.DesignHost, id, payload, "png", 1, nil)
		return data, err
	})
}
func (b *MollyBridge) renderStaged(ctx context.Context, w renderWork, raster func(context.Context, string, json.RawMessage) ([]byte, error)) error {
	stage := filepath.Join(b.cfg.DataDir, "design-preview-stage")
	if uuid.Validate(w.RequestID) != nil || w.PayloadPath != filepath.Join(stage, w.RequestID+".json") || !filepath.IsAbs(w.OutputPath) || filepath.Base(filepath.Dir(w.OutputPath)) != "design-preview" || filepath.Ext(w.OutputPath) != ".png" {
		return errors.New("invalid preview paths")
	}
	raw, err := security.ReadBoundedFileInRoot(b.cfg.DataDir, filepath.Join("design-preview-stage", w.RequestID+".json"), 64<<20)
	if err != nil {
		return err
	}
	var p struct {
		Doc struct{ Canvas struct{ Width, Height int } }
	}
	if json.Unmarshal(raw, &p) != nil || w.Width < 1 || w.Height < 1 || w.Width > 4096 || w.Height > 4096 || p.Doc.Canvas.Width != w.Width || p.Doc.Canvas.Height != w.Height {
		return errors.New("invalid preview dimensions")
	}
	data, err := raster(ctx, w.RequestID, raw)
	if err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	dir, _, err := security.OpenPathRoot(security.PathRoot{Dir: filepath.Dir(w.OutputPath), RejectSymlinkRoot: true})
	if err != nil {
		return err
	}
	defer dir.Close()
	return writeAtomicInRoot(dir, filepath.Base(w.OutputPath), data)
}
func (b *MollyBridge) startRenderHost(ctx context.Context, s *CLISupervisor) {
	if !s.OwnsPrivateDaemon() || b.cfg.DesignHost == nil {
		return
	}
	b.renderHosts.Go(func() {
		timer := time.NewTicker(2 * time.Second)
		defer timer.Stop()
		b.renderLoop(ctx, s, timer.C, b.renderWork)
	})
}
func (b *MollyBridge) renderLoop(ctx context.Context, s *CLISupervisor, ticks <-chan time.Time, render func(context.Context, renderWork) error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan renderReport, 8)
	queue := make(chan renderWork, 8)
	workerDone := make(chan struct{})
	defer func() { cancel(); close(queue); <-workerDone }()
	go func() {
		defer close(workerDone)
		for w := range queue {
			if ctx.Err() != nil {
				return
			}
			r := renderReport{RequestID: w.RequestID, OK: true}
			if err := render(ctx, w); err != nil {
				r.OK = false
				r.Error = "Could not render staged preview"
			}
			select {
			case done <- r:
			case <-ctx.Done():
				return
			}
		}
	}()
	pending := []renderReport{}
	for s.OwnsPrivateDaemon() {
		select {
		case <-ctx.Done():
			return
		case <-s.done:
			return
		case r := <-done:
			pending = append(pending, r)
		case <-ticks:
		}
		machine, ws := b.getLocalMachineID(ctx), b.workspace()
		if machine == "" || ws == "" {
			continue
		}
		var reply struct {
			Type     string
			Requests []renderWork
		}
		if b.coordinatorRPC(ctx, s, machine, ws, "design/render-host", settingsObject{"reports": pending}, &reply) != nil || reply.Type != "design/render-host" {
			continue
		}
		pending = []renderReport{}
		for _, w := range reply.Requests {
			select {
			case queue <- w:
			default:
				pending = append(pending, renderReport{RequestID: w.RequestID, Error: "Renderer is busy"})
			}
		}
	}
}
