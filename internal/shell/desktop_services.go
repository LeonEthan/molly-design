package shell

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"os"
	"path/filepath"
	"time"

	"github.com/egoist/mygo"
)

func stringArg(args []json.RawMessage, i int) string {
	var s string
	if i < len(args) {
		_ = json.Unmarshal(args[i], &s)
	}
	return s
}

func nativeThemeSnapshot() settingsObject {
	return settingsObject{"themeSource": mygo.Theme.Source(), "shouldUseDarkColors": mygo.Theme.IsDark()}
}

func (b *MollyBridge) workspace() string {
	snapshot, _ := readLocalPlatformSnapshot(b.cfg.DataDir)
	ws, _ := snapshot["workspace"].(map[string]any)
	id, _ := ws["workspaceId"].(string)
	return id
}

func (b *MollyBridge) closeSettings() {
	b.settingsMu.Lock()
	defer b.settingsMu.Unlock()
	b.settingsClosed = true
	if b.settings != nil {
		b.settings.Close()
		b.settings = nil
	}
}

func (b *MollyBridge) handleModelConnections(method string, args []json.RawMessage) (any, error) {
	if c := b.cfg.Bundled; c != nil {
		switch method {
		case "getBundledCapabilities":
			return c.GetBundledCapabilities()
		case "getModelCatalog":
			return c.GetModelCatalog()
		case "getModelMetadataSnapshot":
			return c.GetModelMetadataSnapshot()
		}
	}
	b.settingsMu.Lock()
	defer b.settingsMu.Unlock()
	if b.settingsClosed || !b.private.Load().OwnsPrivateDaemon() {
		return nil, errors.New("private_daemon_required")
	}
	ws := b.workspace()
	if ws == "" {
		return nil, errors.New("workspace_unavailable")
	}
	if b.settings == nil || b.settings.workspace != ws {
		if b.settings != nil {
			b.settings.Close()
		}
		var err error
		b.settings, err = NewModelConnectionsService(b.cfg.DataDir, ws, nil, nil, func() {
			select {
			case b.vaultWake <- struct{}{}:
			default:
			}
		})
		if err != nil {
			return nil, err
		}
	}
	s := b.settings
	var q settingsObject
	if len(args) > 0 {
		if err := json.Unmarshal(args[0], &q); err != nil {
			return nil, err
		}
	}
	switch method {
	case "getSnapshot":
		return s.GetSnapshot()
	case "getImageSnapshot":
		return s.GetImageSnapshot()
	case "getMcpSnapshot":
		return s.GetMcpSnapshot()
	case "prepareStorageRecovery":
		return s.PrepareStorageRecovery()
	case "save":
		return s.Save(q)
	case "saveMcp":
		return s.SaveMcp(q)
	case "saveImage":
		return s.SaveImage(q)
	case "signOutOpenAiAuth":
		return s.SignOutOpenAiAuth(q)
	case "recoverUnreadableStorage":
		return s.RecoverUnreadableStorage(q)
	case "checkImage":
		return s.CheckImage(q)
	case "delete":
		return nil, s.Delete(q)
	case "deleteImage":
		return nil, s.DeleteImage(q)
	case "deleteMcp":
		return nil, s.DeleteMcp(q)
	case "listMcpTools":
		return s.ListMcpTools(q), nil
	case "discover":
		return s.Discover(q), nil
	case "check":
		return s.Check(q), nil
	case "beginOpenAiAuth":
		return s.BeginOpenAiAuth(q), nil
	case "completeOpenAiAuth":
		return s.CompleteOpenAiAuth(q), nil
	case "cancelOpenAiAuth":
		s.CancelOpenAiAuth(q)
		return nil, nil
	}
	return nil, errors.New("unknown modelConnections method")
}

func (b *MollyBridge) previewFile(ctx context.Context, docGen int64, args []json.RawMessage) (any, error) {
	store := b.cfg.Resources
	if store == nil || len(args) != 1 {
		return nil, os.ErrInvalid
	}
	b.mu.RLock()
	gen := store.CurrentGen()
	current := b.docGen.Load()
	b.mu.RUnlock()
	if current != docGen {
		return nil, ErrStaleDocGeneration
	}
	var req struct {
		Method string
		Params map[string]json.RawMessage
	}
	if json.Unmarshal(args[0], &req) != nil || req.Method != "file/resolve-local" || req.Params == nil {
		return nil, os.ErrInvalid
	}
	result, err := b.handleLocalControl(ctx, "/machine-rpc", args)
	if err != nil {
		return nil, err
	}
	envelope, _ := result.(map[string]any)
	if envelope["ok"] != true {
		return nil, errors.New("file_resolution_failed")
	}
	file, _ := envelope["result"].(map[string]any)
	if file["status"] == "error" {
		return file, nil
	}
	absolute, _ := file["absolutePath"].(string)
	path, _ := file["path"].(string)
	external, ok := file["external"].(bool)
	if file["status"] != "local-file" || !ok || !filepath.IsAbs(absolute) || path == "" {
		return nil, os.ErrInvalid
	}
	volumeRoot := filepath.VolumeName(absolute) + string(filepath.Separator)
	name, err := filepath.Rel(volumeRoot, absolute)
	if err != nil || !filepath.IsLocal(name) {
		return nil, os.ErrInvalid
	}
	root, err := os.OpenRoot(volumeRoot)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	_, attachment := req.Params["attachment"]
	return store.Issue(gen, root, name, path, external, attachment)
}

func (b *MollyBridge) runCanvasHost(ctx context.Context) {
	timer := time.NewTicker(time.Second)
	defer timer.Stop()
	b.canvasExchangeLoop(ctx, timer.C, b.exchangeCanvas)
}

func (b *MollyBridge) exchangeCanvas(ctx context.Context, s *CLISupervisor, reports []DesignCanvasReport) ([]DesignCanvasState, error) {
	ws := b.workspace()
	machine := b.getLocalMachineID(ctx)
	if ws == "" || machine == "" {
		return nil, errors.New("canvas_host_identity_unavailable")
	}
	var reply struct {
		Type    string
		Version int
		Active  []DesignCanvasState
	}
	err := b.coordinatorRPC(ctx, s, machine, ws, "design/canvas-host", settingsObject{"version": 1, "reports": reports}, &reply)
	if err != nil {
		return nil, err
	}
	if reply.Type != "design/canvas-host" || reply.Version != 1 || reply.Active == nil {
		return nil, errors.New("invalid canvas exchange")
	}
	return reply.Active, nil
}

func (b *MollyBridge) canvasExchangeLoop(ctx context.Context, ticks <-chan time.Time, exchange func(context.Context, *CLISupervisor, []DesignCanvasReport) ([]DesignCanvasState, error)) {
	gate := b.cfg.CanvasGate
	type prepared struct {
		owner  *CLISupervisor
		report DesignCanvasReport
	}
	type synced struct {
		owner *CLISupervisor
		turn  string
		err   error
	}
	ready := make(chan prepared, 100)
	finished := make(chan synced, 1)
	syncing := map[string]bool{}
	var pending []DesignCanvasReport
	var previous *CLISupervisor
	for {
		select {
		case <-ctx.Done():
			return
		case r := <-ready:
			if r.owner == previous {
				pending = append(pending, r.report)
			}
		case r := <-finished:
			if previous == r.owner {
				if r.err == nil {
					syncing[r.turn] = true
				} else {
					delete(syncing, r.turn)
					continue
				}
			}
		case <-ticks:
		}
		s := b.private.Load()
		if s != previous {
			gate.Disconnected()
			pending = nil
			previous = s
			clear(syncing)
		}
		if !s.OwnsPrivateDaemon() {
			gate.Disconnected()
			continue
		}
		n := min(len(pending), 100)
		batch := append([]DesignCanvasReport{}, pending[:n]...)
		active, err := exchange(ctx, s, batch)
		if err != nil || b.private.Load() != s {
			gate.Disconnected()
			continue
		}
		pending = pending[n:]
		gate.mu.Lock()
		wasKnown := gate.known
		before := maps.Clone(gate.active)
		gate.mu.Unlock()
		gate.UpdateFromDaemon(active, func(id string) error {
			if b.cfg.DesignController == nil {
				return nil
			}
			turn := before[id].TurnID
			done, exists := syncing[turn]
			if done {
				delete(syncing, turn)
				return nil
			}
			if !exists {
				syncing[turn] = false
				go func() {
					err := b.cfg.DesignController.SyncFromStore(ctx, id, "")
					select {
					case finished <- synced{s, turn, err}:
					case <-ctx.Done():
					case <-s.done:
					}
				}()
			}
			return ErrCanvasReadOnly
		}, func(r DesignCanvasReport) {
			select {
			case <-ctx.Done():
			case <-s.done:
			case ready <- prepared{s, r}:
			}
		})
		gate.mu.Lock()
		after := maps.Clone(gate.active)
		gate.mu.Unlock()
		b.removePreviews(func(_ string, p *sourcePreview) bool { return p.turn != gate.previewTurn(p.id) })
		for id, st := range after {
			if before[id] != st {
				_ = b.EmitToWorkbench("design.state", settingsObject{"artworkId": id})
			}
		}
		if !wasKnown {
			_ = b.EmitToWorkbench("design.state", settingsObject{})
		}
		for id := range before {
			if _, active := after[id]; !active {
				_ = b.EmitToWorkbench("design.state", settingsObject{"artworkId": id})
			}
		}
	}
}
