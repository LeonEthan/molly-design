package shell

import (
	"bufio"
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"

	"github.com/LeonEthan/molly-design/internal/browserfetch"
	"github.com/LeonEthan/molly-design/internal/ipc"
	"github.com/LeonEthan/molly-design/internal/platform"
	"github.com/LeonEthan/molly-design/internal/security"
)

//go:embed preload.js
var preloadScriptSource string

var pushEvent = mygo.NewEvent[PushEnvelope]("molly:push")

type PushEnvelope struct {
	Channel string `json:"channel"`
	Payload any    `json:"payload"`
}

var (
	ErrUntrustedCallerPage = errors.New("ipc call rejected: caller page is not the trusted workbench")
	ErrStaleDocGeneration  = errors.New("ipc call rejected: stale document generation")
	ErrBlockedIpcChannel   = errors.New("blocked ipc channel")
)

var allowedInvokeGroups = map[string]bool{
	"design":           true,
	"app":              true,
	"cli":              true,
	"image":            true,
	"modelConnections": true,
	"localPlatform":    true,
	"localProjects":    true,
	"loro":             true,
	"machineRpc":       true,
	"notifications":    true,
	"publicBrowser":    true,
	"sessionControl":   true,
	"updater":          true,
}

var allowedSendChannels = map[string]bool{
	"loro.send":      true,
	"loro.subscribe": true,
	"cli.subscribe":  true,
}

var invokeChannelPattern = regexp.MustCompile(`^([A-Za-z][A-Za-z0-9]*)\.([A-Za-z][A-Za-z0-9]*)$`)

func IsAllowedInvokeChannel(channel string) bool {
	m := invokeChannelPattern.FindStringSubmatch(channel)
	if len(m) != 3 {
		return false
	}
	return allowedInvokeGroups[m[1]]
}

func IsAllowedSendChannel(channel string) bool {
	return allowedSendChannels[channel]
}

type PublicBrowserRecord struct {
	BrowserID  string `json:"browserId"`
	Phase      string `json:"phase"`
	URL        string `json:"url,omitempty"`
	Title      string `json:"title,omitempty"`
	CanGoBack  bool   `json:"canGoBack"`
	CanGoFwd   bool   `json:"canGoForward"`
	Error      string `json:"error,omitempty"`
	BlockedURL string `json:"blockedUrl,omitempty"`
}

type PublicBrowserHost interface {
	OpenAndNavigate(ctx context.Context, browserID string, targetURL string) error
	CloseBrowser(browserID string)
}

type DesignBounds struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type DesignHostController interface {
	Attach(ctx context.Context, artworkID string, bounds DesignBounds, hostID string) error
	Hide(artworkID string, hostID string) error
	PresentToolbar(artworkID string, hostID string, presentation json.RawMessage) error
	SyncFromStore(ctx context.Context, artworkID string, hostID string) error
	Export(ctx context.Context, artworkID string, format string, title string, scale int) error
}

type BridgeConfig struct {
	AppVersion        string
	DataDir           string
	ControlSocketPath string
	ProbeSocketPath   string
	LoroSocketPath    string
	DesignHost        *DesignProtocolHost
	CanvasGate        *CanvasAccessGate
	DesignWorker      *DesignWorkerClient
	DesignController  DesignHostController
	LoroRelay         *LoroRelay
	PublicBrowserHost PublicBrowserHost
	OnEmitPush        func(channel string, payload any)
}

type MollyBridge struct {
	cfg BridgeConfig

	mu             sync.RWMutex
	workbenchPage  *mygo.Page
	docGen         atomic.Int64
	publicBrowsers map[string]*PublicBrowserRecord
	windowBadge    map[string]int
}

func NewMollyBridge(cfg BridgeConfig) *MollyBridge {
	if cfg.AppVersion == "" {
		cfg.AppVersion = "0.2.0-mygo-experimental"
	}
	if cfg.DataDir == "" {
		cfg.DataDir = resolveDefaultDataDir("")
	}
	if cfg.CanvasGate == nil {
		cfg.CanvasGate = NewCanvasAccessGate()
	}
	b := &MollyBridge{
		cfg:            cfg,
		publicBrowsers: make(map[string]*PublicBrowserRecord),
		windowBadge:    map[string]int{"unread": 0, "waiting": 0, "working": 0},
	}
	b.docGen.Store(1)
	return b
}

func (b *MollyBridge) AttachWorkbenchPage(page *mygo.Page) int64 {
	b.mu.Lock()
	b.workbenchPage = page
	gen := b.docGen.Load()
	b.mu.Unlock()
	return gen
}

func (b *MollyBridge) AdvanceDocGeneration() int64 {
	return b.docGen.Add(1)
}

func (b *MollyBridge) CurrentDocGeneration() int64 {
	return b.docGen.Load()
}

func (b *MollyBridge) BuildPreloadScript(docGen int64) string {
	home, _ := os.UserHomeDir()
	host, _ := os.Hostname()
	platformName := runtime.GOOS
	if platformName == "windows" {
		platformName = "win32"
	}
	bootstrap, _ := json.Marshal(map[string]any{
		"os":                       platformName,
		"homeDir":                  home,
		"machineName":              host,
		"preferredSystemLanguages": []string{"en-US"},
	})
	return fmt.Sprintf(
		"window.__MOLLY_DOC_GEN__ = %d;\nwindow.__MOLLY_PLATFORM_BOOTSTRAP__ = %s;\n%s",
		docGen,
		string(bootstrap),
		preloadScriptSource,
	)
}

func (b *MollyBridge) EmitToWorkbench(channel string, payload any) error {
	if b.cfg.OnEmitPush != nil {
		b.cfg.OnEmitPush(channel, payload)
	}
	b.mu.RLock()
	page := b.workbenchPage
	b.mu.RUnlock()
	if page == nil {
		return nil
	}
	return pushEvent.EmitPage(page, PushEnvelope{Channel: channel, Payload: payload})
}

func (b *MollyBridge) verifyCallerPage(ctx context.Context) error {
	b.mu.RLock()
	expected := b.workbenchPage
	b.mu.RUnlock()
	caller := mygo.CallerPage(ctx)
	if expected != nil && caller != expected {
		return ErrUntrustedCallerPage
	}
	if expected == nil && caller != nil {
		return ErrUntrustedCallerPage
	}
	return nil
}

func (b *MollyBridge) SyncDocGen(ctx context.Context) (int64, error) {
	if err := b.verifyCallerPage(ctx); err != nil {
		return 0, err
	}
	return b.docGen.Load(), nil
}

func (b *MollyBridge) verifyCaller(ctx context.Context, docGen int64) error {
	if err := b.verifyCallerPage(ctx); err != nil {
		return err
	}
	if docGen != b.docGen.Load() {
		return ErrStaleDocGeneration
	}
	return nil
}

func (b *MollyBridge) Invoke(ctx context.Context, docGen int64, channel string, args []json.RawMessage) (any, error) {
	if err := b.verifyCaller(ctx, docGen); err != nil {
		return nil, err
	}
	if !IsAllowedInvokeChannel(channel) {
		return nil, fmt.Errorf("%w: %s", ErrBlockedIpcChannel, channel)
	}
	group, method, _ := strings.Cut(channel, ".")
	switch group {
	case "localPlatform":
		return b.handleLocalPlatform(method)
	case "app":
		return b.handleApp(method, args)
	case "cli":
		return b.handleCLI(ctx, method)
	case "loro":
		return b.handleLoro(method)
	case "sessionControl":
		return b.handleSessionControl(ctx, method, args)
	case "localProjects":
		return b.handleLocalProjects(ctx, method, args)
	case "machineRpc":
		return b.handleMachineRPC(ctx, method, args)
	case "design":
		return b.handleDesign(ctx, method, args)
	case "notifications":
		return b.handleNotifications(method, args)
	case "image":
		return b.handleImage(method)
	case "publicBrowser":
		return b.handlePublicBrowser(ctx, method, args)
	case "modelConnections":
		return b.handleModelConnections(method)
	case "updater":
		return b.handleUpdater(method)
	default:
		return nil, fmt.Errorf("%w: %s", ErrBlockedIpcChannel, channel)
	}
}

func (b *MollyBridge) Send(ctx context.Context, docGen int64, channel string, payload json.RawMessage) error {
	if err := b.verifyCaller(ctx, docGen); err != nil {
		return err
	}
	if !IsAllowedSendChannel(channel) {
		return fmt.Errorf("%w: %s", ErrBlockedIpcChannel, channel)
	}
	switch channel {
	case "loro.subscribe":
		if b.cfg.LoroRelay != nil {
			_ = b.EmitToWorkbench("loro.status", b.cfg.LoroRelay.IsConnected())
		} else {
			_ = b.EmitToWorkbench("loro.status", false)
		}
		return nil
	case "loro.send":
		if b.cfg.LoroRelay == nil {
			return nil
		}
		return b.cfg.LoroRelay.Send("workbench", payload)
	case "cli.subscribe":
		state, _ := b.handleCLI(ctx, "getState")
		_ = b.EmitToWorkbench("cli.state", state)
		return nil
	default:
		return nil
	}
}

func (b *MollyBridge) handleLocalPlatform(method string) (any, error) {
	if method != "getSnapshot" {
		return nil, fmt.Errorf("unknown localPlatform method: %s", method)
	}
	return readLocalPlatformSnapshot(b.cfg.DataDir)
}

func readLocalPlatformSnapshot(dataDir string) (map[string]any, error) {
	if strings.TrimSpace(dataDir) == "" {
		return nil, nil
	}
	catalogPath := filepath.Join(dataDir, "workspace-catalog.json")
	raw, err := os.ReadFile(catalogPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var catalog struct {
		Identity *struct {
			UserID string `json:"userId"`
		} `json:"identity"`
		Workspaces []struct {
			WorkspaceID string  `json:"workspaceId"`
			Name        string  `json:"name"`
			Slug        *string `json:"slug"`
			Role        string  `json:"role"`
			State       string  `json:"state"`
		} `json:"workspaces"`
	}
	if err := json.Unmarshal(raw, &catalog); err != nil {
		return nil, errors.New("local platform catalog is not valid JSON")
	}
	if catalog.Identity == nil || !strings.HasPrefix(catalog.Identity.UserID, "local:") {
		return nil, nil
	}
	activeIdx := -1
	activeCount := 0
	for i, ws := range catalog.Workspaces {
		if ws.State == "active" {
			activeIdx = i
			activeCount++
		}
	}
	if activeCount != 1 {
		return nil, nil
	}
	ws := catalog.Workspaces[activeIdx]
	if !strings.HasPrefix(ws.WorkspaceID, "lw_") {
		return nil, nil
	}
	return map[string]any{
		"userId": catalog.Identity.UserID,
		"workspace": map[string]any{
			"workspaceId": ws.WorkspaceID,
			"name":        ws.Name,
			"slug":        ws.Slug,
			"role":        ws.Role,
		},
	}, nil
}

func (b *MollyBridge) handleApp(method string, args []json.RawMessage) (any, error) {
	switch method {
	case "getVersion":
		return b.cfg.AppVersion, nil
	case "getLocale":
		return "en", nil
	case "getNativeTheme":
		return map[string]any{"themeSource": "system", "shouldUseDarkColors": false}, nil
	case "isFullscreen":
		return false, nil
	case "getComposition":
		return platform.DefaultComposition(), nil
	case "getAutoLaunchStatus":
		return map[string]any{"supported": false, "enabled": false}, nil
	case "setWindowBadge":
		if len(args) > 0 {
			var badge map[string]int
			if json.Unmarshal(args[0], &badge) == nil {
				b.mu.Lock()
				b.windowBadge = badge
				b.mu.Unlock()
			}
		}
		return map[string]any{"ok": true}, nil
	case "openExternal":
		if len(args) == 0 {
			return map[string]any{"opened": false, "error": "missing_url"}, nil
		}
		var target string
		if err := json.Unmarshal(args[0], &target); err != nil {
			return map[string]any{"opened": false, "error": "invalid_url"}, nil
		}
		parsed, err := url.Parse(strings.TrimSpace(target))
		if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
			return map[string]any{"opened": false, "error": "disallowed_scheme"}, nil
		}
		if err := openExternalURL(parsed.String()); err != nil {
			return map[string]any{"opened": false, "url": parsed.String(), "error": err.Error()}, nil
		}
		return map[string]any{"opened": true, "url": parsed.String()}, nil
	default:
		return map[string]any{"ok": false, "error": "unsupported_in_experimental_mygo_shell"}, nil
	}
}

func openExternalURL(rawURL string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", rawURL).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", rawURL).Start()
	default:
		return exec.Command("xdg-open", rawURL).Start()
	}
}

func (b *MollyBridge) handleCLI(ctx context.Context, method string) (any, error) {
	switch method {
	case "getOutputBacklog":
		return []any{}, nil
	case "getState":
		now := time.Now().UnixMilli()
		if b.cfg.ProbeSocketPath != "" {
			if state, err := b.fetchUnixJSON(ctx, b.cfg.ProbeSocketPath, http.MethodGet, "/state", nil); err == nil {
				return map[string]any{
					"phase":               "running",
					"desiredState":        "running",
					"updatedAtMs":         now,
					"preventSleepEnabled": false,
					"runtime":             state,
					"runtimeOwnership":    "external",
				}, nil
			}
		}
		return map[string]any{
			"phase":               "offline",
			"desiredState":        "running",
			"updatedAtMs":         now,
			"preventSleepEnabled": false,
		}, nil
	case "restart", "terminate":
		return map[string]any{"ok": false, "error": "cli_lifecycle_external_in_mygo_experimental"}, nil
	default:
		return nil, fmt.Errorf("unknown cli method: %s", method)
	}
}

func (b *MollyBridge) handleLoro(method string) (any, error) {
	if method != "isConnected" {
		return nil, fmt.Errorf("unknown loro method: %s", method)
	}
	if b.cfg.LoroRelay == nil {
		return false, nil
	}
	return b.cfg.LoroRelay.IsConnected(), nil
}

func isMainProcessOnlyMachineRPCMethod(method string) bool {
	return method == "harness/host" ||
		method == "mcp/catalog-entry" ||
		method == "design/image-connection" ||
		method == "design/canvas-host" ||
		strings.HasPrefix(method, "browser/")
}

func (b *MollyBridge) handleSessionControl(ctx context.Context, method string, args []json.RawMessage) (any, error) {
	if method != "send" {
		return nil, fmt.Errorf("unknown sessionControl method: %s", method)
	}
	if len(args) == 0 {
		return map[string]any{"ok": false, "error": "invalid_request"}, nil
	}
	var payload struct {
		RequestID string          `json:"requestId"`
		Message   json.RawMessage `json:"message"`
	}
	if err := json.Unmarshal(args[0], &payload); err != nil ||
		len(payload.RequestID) == 0 || len(payload.RequestID) > 128 ||
		len(bytes.TrimSpace(payload.Message)) == 0 || string(bytes.TrimSpace(payload.Message)) == "null" {
		return map[string]any{"ok": false, "error": "invalid_request"}, nil
	}
	if strings.TrimSpace(b.cfg.ControlSocketPath) == "" {
		return map[string]any{"ok": false, "error": "daemon_unavailable"}, nil
	}
	return b.streamSessionControl(ctx, b.cfg.ControlSocketPath, payload.RequestID, payload.Message)
}

func (b *MollyBridge) localIPCClient(socketPath string, timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DialContext: func(dialCtx context.Context, _, _ string) (net.Conn, error) {
				return ipc.DialLocal(dialCtx, socketPath)
			},
		},
	}
}

func (b *MollyBridge) streamSessionControl(ctx context.Context, socketPath, requestID string, message []byte) (map[string]any, error) {
	client := b.localIPCClient(socketPath, 30*time.Second)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://localhost/session-control", bytes.NewReader(message))
	if err != nil {
		return map[string]any{"ok": false, "error": err.Error()}, nil
	}
	req.Header.Set("x-lody-local-control", "1")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/x-ndjson, application/json")

	resp, err := client.Do(req)
	if err != nil {
		return map[string]any{"ok": false, "error": "daemon_unavailable"}, nil
	}
	defer resp.Body.Close()

	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if strings.Contains(contentType, "application/x-ndjson") {
		responses := make([]any, 0)
		scanner := bufio.NewScanner(io.LimitReader(resp.Body, 16<<20))
		scanner.Buffer(make([]byte, 64*1024), 16<<20)
		completed := false
		for scanner.Scan() {
			line := bytes.TrimSpace(scanner.Bytes())
			if len(line) == 0 {
				continue
			}
			var frame struct {
				Kind     string `json:"kind"`
				Response any    `json:"response"`
				Error    string `json:"error"`
				Status   int    `json:"status"`
				Details  any    `json:"details"`
			}
			if unmarshalErr := json.Unmarshal(line, &frame); unmarshalErr != nil {
				return map[string]any{"ok": false, "error": "invalid_session_control_stream"}, nil
			}
			switch frame.Kind {
			case "response":
				responses = append(responses, frame.Response)
				_ = b.EmitToWorkbench("sessionControl.response", map[string]any{
					"requestId": requestID,
					"response":  frame.Response,
				})
			case "complete":
				completed = true
			case "error":
				errCode := frame.Error
				if errCode == "" {
					errCode = "local_control_failed"
				}
				out := map[string]any{"ok": false, "error": errCode}
				if frame.Status != 0 {
					out["status"] = frame.Status
				}
				if frame.Details != nil {
					out["details"] = frame.Details
				}
				return out, nil
			}
		}
		if scanErr := scanner.Err(); scanErr != nil {
			return map[string]any{"ok": false, "error": scanErr.Error()}, nil
		}
		if !completed {
			return map[string]any{"ok": false, "error": "session_control_stream_incomplete"}, nil
		}
		return map[string]any{"ok": true, "responses": responses}, nil
	}

	data, readErr := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if readErr != nil {
		return map[string]any{"ok": false, "error": readErr.Error()}, nil
	}
	var envelope map[string]any
	if err := json.Unmarshal(data, &envelope); err != nil {
		return map[string]any{"ok": false, "error": fmt.Sprintf("local control returned HTTP %d", resp.StatusCode)}, nil
	}
	if okVal, _ := envelope["ok"].(bool); okVal {
		if rawResponses, has := envelope["responses"].([]any); has {
			for _, item := range rawResponses {
				_ = b.EmitToWorkbench("sessionControl.response", map[string]any{
					"requestId": requestID,
					"response":  item,
				})
			}
		}
	}
	return envelope, nil
}

func (b *MollyBridge) getLocalMachineID(ctx context.Context) string {
	if strings.TrimSpace(b.cfg.ProbeSocketPath) == "" {
		return ""
	}
	raw, err := b.fetchUnixJSON(ctx, b.cfg.ProbeSocketPath, http.MethodGet, "/state", nil)
	if err != nil {
		return ""
	}
	if m, ok := raw.(map[string]any); ok {
		if id, okID := m["machineId"].(string); okID {
			return strings.TrimSpace(id)
		}
	}
	return ""
}

func (b *MollyBridge) handleLocalProjects(ctx context.Context, method string, args []json.RawMessage) (any, error) {
	sendProjectControl := func(req map[string]any) (map[string]any, error) {
		if strings.TrimSpace(b.cfg.ControlSocketPath) == "" {
			return nil, errors.New("cli_not_running")
		}
		machineID, _ := req["machineId"].(string)
		machineID = strings.TrimSpace(machineID)
		if machineID == "" {
			machineID = b.getLocalMachineID(ctx)
			if machineID == "" {
				return nil, errors.New("cli_not_running")
			}
			req["machineId"] = machineID
		}
		postOnce := func(bodyMap map[string]any) (map[string]any, error) {
			rawBody, err := json.Marshal(bodyMap)
			if err != nil {
				return nil, err
			}
			resp, err := b.fetchUnixJSON(ctx, b.cfg.ControlSocketPath, http.MethodPost, "/project-control", rawBody)
			if err != nil {
				return nil, errors.New("cli_not_running")
			}
			respMap, ok := resp.(map[string]any)
			if !ok {
				return nil, errors.New("invalid local project control response")
			}
			return respMap, nil
		}
		respMap, err := postOnce(req)
		if err != nil {
			return nil, err
		}
		if okVal, _ := respMap["ok"].(bool); !okVal {
			if errCode, _ := respMap["error"].(string); errCode == "machine_mismatch" {
				refreshed := b.getLocalMachineID(ctx)
				if refreshed != "" && refreshed != machineID {
					req["machineId"] = refreshed
					return postOnce(req)
				}
			}
		}
		return respMap, nil
	}

	switch method {
	case "control":
		if len(args) == 0 {
			return map[string]any{"ok": false, "error": "invalid_request"}, nil
		}
		var req map[string]any
		if err := json.Unmarshal(args[0], &req); err != nil {
			return map[string]any{"ok": false, "error": "invalid_request"}, nil
		}
		resp, err := sendProjectControl(req)
		if err != nil {
			return map[string]any{"ok": false, "error": "daemon_unavailable"}, nil
		}
		return resp, nil
	case "listDir":
		if len(args) < 3 {
			return nil, errors.New("localProjects.listDir requires (workspaceId, localProjectId, relativePath, options?)")
		}
		var workspaceID, localProjectID, relativePath string
		if err := json.Unmarshal(args[0], &workspaceID); err != nil || strings.TrimSpace(workspaceID) == "" {
			return nil, errors.New("invalid workspaceId")
		}
		if err := json.Unmarshal(args[1], &localProjectID); err != nil || strings.TrimSpace(localProjectID) == "" {
			return nil, errors.New("invalid localProjectId")
		}
		if err := json.Unmarshal(args[2], &relativePath); err != nil {
			return nil, errors.New("invalid relativePath")
		}
		req := map[string]any{
			"type":           "local-project/list-dir",
			"workspaceId":    workspaceID,
			"localProjectId": localProjectID,
			"relativePath":   relativePath,
		}
		if len(args) >= 4 && len(bytes.TrimSpace(args[3])) > 0 && string(bytes.TrimSpace(args[3])) != "null" {
			var opts struct {
				Limit *int `json:"limit"`
			}
			if json.Unmarshal(args[3], &opts) == nil && opts.Limit != nil {
				req["limit"] = *opts.Limit
			}
		}
		resp, err := sendProjectControl(req)
		if err != nil {
			return nil, err
		}
		if okVal, _ := resp["ok"].(bool); !okVal {
			if errCode, _ := resp["error"].(string); errCode == "daemon_unavailable" {
				return nil, errors.New("cli_not_running")
			}
			if msg, _ := resp["message"].(string); msg != "" {
				return nil, errors.New(msg)
			}
			return nil, errors.New("Failed to list project directory")
		}
		if respType, _ := resp["type"].(string); respType != "local-project/list-dir" {
			return nil, fmt.Errorf("Unexpected response type: %s", respType)
		}
		return resp["result"], nil
	case "listFiles":
		if len(args) < 2 {
			return nil, errors.New("localProjects.listFiles requires (workspaceId, localProjectId, options?)")
		}
		var workspaceID, localProjectID string
		if err := json.Unmarshal(args[0], &workspaceID); err != nil || strings.TrimSpace(workspaceID) == "" {
			return nil, errors.New("invalid workspaceId")
		}
		if err := json.Unmarshal(args[1], &localProjectID); err != nil || strings.TrimSpace(localProjectID) == "" {
			return nil, errors.New("invalid localProjectId")
		}
		req := map[string]any{
			"type":           "local-project/list-files",
			"workspaceId":    workspaceID,
			"localProjectId": localProjectID,
		}
		if len(args) >= 3 && len(bytes.TrimSpace(args[2])) > 0 && string(bytes.TrimSpace(args[2])) != "null" {
			var opts struct {
				MaxFiles *int `json:"maxFiles"`
			}
			if json.Unmarshal(args[2], &opts) == nil && opts.MaxFiles != nil {
				req["maxFiles"] = *opts.MaxFiles
			}
		}
		resp, err := sendProjectControl(req)
		if err != nil {
			return nil, err
		}
		if okVal, _ := resp["ok"].(bool); !okVal {
			if errCode, _ := resp["error"].(string); errCode == "daemon_unavailable" {
				return nil, errors.New("cli_not_running")
			}
			if msg, _ := resp["message"].(string); msg != "" {
				return nil, errors.New(msg)
			}
			return nil, errors.New("Failed to list project files")
		}
		if respType, _ := resp["type"].(string); respType != "local-project/list-files" {
			return nil, fmt.Errorf("Unexpected response type: %s", respType)
		}
		return resp["result"], nil
	case "readFile":
		if len(args) < 3 {
			return nil, errors.New("localProjects.readFile requires (workspaceId, localProjectId, relativePath, options?)")
		}
		var workspaceID, localProjectID, relativePath string
		if err := json.Unmarshal(args[0], &workspaceID); err != nil || strings.TrimSpace(workspaceID) == "" {
			return nil, errors.New("invalid workspaceId")
		}
		if err := json.Unmarshal(args[1], &localProjectID); err != nil || strings.TrimSpace(localProjectID) == "" {
			return nil, errors.New("invalid localProjectId")
		}
		if err := json.Unmarshal(args[2], &relativePath); err != nil {
			return nil, errors.New("invalid relativePath")
		}
		req := map[string]any{
			"type":           "local-project/read-file",
			"workspaceId":    workspaceID,
			"localProjectId": localProjectID,
			"relativePath":   relativePath,
		}
		if len(args) >= 4 && len(bytes.TrimSpace(args[3])) > 0 && string(bytes.TrimSpace(args[3])) != "null" {
			var opts struct {
				MaxBytes *int `json:"maxBytes"`
			}
			if json.Unmarshal(args[3], &opts) == nil && opts.MaxBytes != nil {
				req["maxBytes"] = *opts.MaxBytes
			}
		}
		resp, err := sendProjectControl(req)
		if err != nil {
			return nil, nil
		}
		if okVal, _ := resp["ok"].(bool); !okVal {
			return nil, nil
		}
		if respType, _ := resp["type"].(string); respType != "local-project/read-file" {
			return nil, nil
		}
		return resp["result"], nil
	case "getGitState":
		if len(args) < 2 {
			return nil, errors.New("localProjects.getGitState requires (workspaceId, localProjectId)")
		}
		var workspaceID, localProjectID string
		if err := json.Unmarshal(args[0], &workspaceID); err != nil || strings.TrimSpace(workspaceID) == "" {
			return nil, errors.New("invalid workspaceId")
		}
		if err := json.Unmarshal(args[1], &localProjectID); err != nil || strings.TrimSpace(localProjectID) == "" {
			return nil, errors.New("invalid localProjectId")
		}
		resp, err := sendProjectControl(map[string]any{
			"type":           "local-project/git-state",
			"workspaceId":    workspaceID,
			"localProjectId": localProjectID,
		})
		if err != nil {
			return map[string]any{"error": err.Error()}, nil
		}
		if okVal, _ := resp["ok"].(bool); !okVal {
			return map[string]any{"error": resp["message"]}, nil
		}
		if respType, _ := resp["type"].(string); respType != "local-project/git-state" {
			return map[string]any{"error": fmt.Sprintf("Unexpected response type: %s", respType)}, nil
		}
		return resp["result"], nil
	case "listSessionWorktreeFiles":
		if len(args) < 2 {
			return nil, errors.New("localProjects.listSessionWorktreeFiles requires (repoKey, sessionId, options?)")
		}
		var repoKey, sessionID string
		if err := json.Unmarshal(args[0], &repoKey); err != nil || strings.TrimSpace(repoKey) == "" {
			return nil, errors.New("invalid repoKey")
		}
		if err := json.Unmarshal(args[1], &sessionID); err != nil || strings.TrimSpace(sessionID) == "" {
			return nil, errors.New("invalid sessionId")
		}
		req := map[string]any{
			"type":         "worktree/list-files",
			"repoFullName": repoKey,
			"sessionId":    sessionID,
		}
		if len(args) >= 3 && len(bytes.TrimSpace(args[2])) > 0 && string(bytes.TrimSpace(args[2])) != "null" {
			var opts struct {
				MaxFiles *int `json:"maxFiles"`
			}
			if json.Unmarshal(args[2], &opts) == nil && opts.MaxFiles != nil {
				req["maxFiles"] = *opts.MaxFiles
			}
		}
		resp, err := sendProjectControl(req)
		if err != nil {
			return nil, err
		}
		if okVal, _ := resp["ok"].(bool); !okVal {
			if errCode, _ := resp["error"].(string); errCode == "daemon_unavailable" {
				return nil, errors.New("cli_not_running")
			}
			if msg, _ := resp["message"].(string); msg != "" {
				return nil, errors.New(msg)
			}
			return nil, errors.New("Failed to list worktree files")
		}
		if respType, _ := resp["type"].(string); respType != "worktree/list-files" {
			return nil, fmt.Errorf("Unexpected response type: %s", respType)
		}
		return resp["result"], nil
	case "readSessionWorktreeFile":
		if len(args) < 3 {
			return nil, errors.New("localProjects.readSessionWorktreeFile requires (repoKey, sessionId, relativePath, options?)")
		}
		var repoKey, sessionID, relativePath string
		if err := json.Unmarshal(args[0], &repoKey); err != nil || strings.TrimSpace(repoKey) == "" {
			return nil, errors.New("invalid repoKey")
		}
		if err := json.Unmarshal(args[1], &sessionID); err != nil || strings.TrimSpace(sessionID) == "" {
			return nil, errors.New("invalid sessionId")
		}
		if err := json.Unmarshal(args[2], &relativePath); err != nil {
			return nil, errors.New("invalid relativePath")
		}
		req := map[string]any{
			"type":         "worktree/read-file",
			"repoFullName": repoKey,
			"sessionId":    sessionID,
			"relativePath": relativePath,
		}
		if len(args) >= 4 && len(bytes.TrimSpace(args[3])) > 0 && string(bytes.TrimSpace(args[3])) != "null" {
			var opts struct {
				MaxBytes *int `json:"maxBytes"`
			}
			if json.Unmarshal(args[3], &opts) == nil && opts.MaxBytes != nil {
				req["maxBytes"] = *opts.MaxBytes
			}
		}
		resp, err := sendProjectControl(req)
		if err != nil {
			return nil, nil
		}
		if okVal, _ := resp["ok"].(bool); !okVal {
			return nil, nil
		}
		if respType, _ := resp["type"].(string); respType != "worktree/read-file" {
			return nil, nil
		}
		return resp["result"], nil
	default:
		return nil, fmt.Errorf("localProjects method unavailable in experimental shell: %s", method)
	}
}

func (b *MollyBridge) handleMachineRPC(ctx context.Context, method string, args []json.RawMessage) (any, error) {
	if method == "previewFile" {
		return nil, errors.New("preview_file_unavailable_in_experimental_shell")
	}
	if method != "send" {
		return nil, fmt.Errorf("unknown machineRpc method: %s", method)
	}
	if len(args) == 0 {
		return nil, errors.New("missing machineRpc message")
	}
	var envelope struct {
		Method string `json:"method"`
	}
	if err := json.Unmarshal(args[0], &envelope); err != nil || strings.TrimSpace(envelope.Method) == "" {
		return nil, errors.New("invalid machineRpc message")
	}
	if isMainProcessOnlyMachineRPCMethod(envelope.Method) {
		return nil, errors.New("main_process_only_method")
	}
	return b.handleLocalControl(ctx, "/machine-rpc", args)
}

func (b *MollyBridge) handleLocalControl(ctx context.Context, path string, args []json.RawMessage) (any, error) {
	if strings.TrimSpace(b.cfg.ControlSocketPath) == "" {
		return map[string]any{"ok": false, "error": "local_daemon_not_connected"}, nil
	}
	var payload []byte
	if len(args) > 0 {
		payload = args[0]
	} else {
		payload = []byte("{}")
	}
	return b.fetchUnixJSON(ctx, b.cfg.ControlSocketPath, http.MethodPost, path, payload)
}

func (b *MollyBridge) fetchUnixRaw(ctx context.Context, socketPath, method, reqPath string, body []byte) (int, string, []byte, error) {
	client := b.localIPCClient(socketPath, 10*time.Second)
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://localhost"+reqPath, reader)
	if err != nil {
		return 0, "", nil, err
	}
	req.Header.Set("x-lody-local-control", "1")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, "", nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return resp.StatusCode, resp.Header.Get("Content-Type"), nil, err
	}
	return resp.StatusCode, resp.Header.Get("Content-Type"), data, nil
}

func (b *MollyBridge) fetchUnixJSON(ctx context.Context, socketPath, method, reqPath string, body []byte) (any, error) {
	_, _, data, err := b.fetchUnixRaw(ctx, socketPath, method, reqPath, body)
	if err != nil {
		return nil, err
	}
	var parsed any
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, err
	}
	return parsed, nil
}

func (b *MollyBridge) handleDesign(ctx context.Context, method string, args []json.RawMessage) (any, error) {
	switch method {
	case "getState", "state":
		var id string
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &id)
		}
		return b.cfg.CanvasGate.State(id), nil
	case "prepareForSend", "save":
		var id string
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &id)
		}
		if err := b.cfg.CanvasGate.PrepareForSend(id); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true}, nil
	case "read":
		if b.cfg.DesignWorker == nil {
			return nil, errors.New("design worker unavailable")
		}
		var id string
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &id)
		}
		return b.cfg.DesignWorker.Request(ctx, map[string]any{
			"operation": "read",
			"sessionId": id,
		})
	case "versions":
		if b.cfg.DesignWorker == nil {
			return nil, errors.New("design worker unavailable")
		}
		var id string
		if len(args) == 0 || json.Unmarshal(args[0], &id) != nil || strings.TrimSpace(id) == "" {
			return nil, errors.New("invalid design sessionId")
		}
		return b.cfg.DesignWorker.Request(ctx, map[string]any{
			"operation": "history-list",
			"sessionId": id,
		})
	case "attach":
		if b.cfg.DesignController == nil {
			return nil, errors.New("design canvas host unavailable")
		}
		if len(args) < 3 {
			return nil, errors.New("design.attach requires (sessionId, bounds, hostId)")
		}
		var artworkID, hostID string
		var bounds DesignBounds
		if err := json.Unmarshal(args[0], &artworkID); err != nil || strings.TrimSpace(artworkID) == "" {
			return nil, errors.New("invalid design sessionId")
		}
		if err := json.Unmarshal(args[1], &bounds); err != nil {
			return nil, errors.New("invalid design bounds")
		}
		if err := json.Unmarshal(args[2], &hostID); err != nil || strings.TrimSpace(hostID) == "" {
			return nil, errors.New("invalid design hostId")
		}
		if err := b.cfg.DesignController.Attach(ctx, artworkID, bounds, hostID); err != nil {
			return nil, err
		}
		return nil, nil
	case "hide":
		if b.cfg.DesignController == nil {
			return nil, nil
		}
		var artworkID, hostID string
		if len(args) >= 1 {
			_ = json.Unmarshal(args[0], &artworkID)
		}
		if len(args) >= 2 {
			_ = json.Unmarshal(args[1], &hostID)
		}
		return nil, b.cfg.DesignController.Hide(artworkID, hostID)
	case "presentToolbar":
		if b.cfg.DesignController == nil {
			return nil, nil
		}
		if len(args) < 3 {
			return nil, errors.New("design.presentToolbar requires (sessionId, hostId, presentation)")
		}
		var artworkID, hostID string
		if err := json.Unmarshal(args[0], &artworkID); err != nil || strings.TrimSpace(artworkID) == "" {
			return nil, errors.New("invalid design sessionId")
		}
		if err := json.Unmarshal(args[1], &hostID); err != nil || strings.TrimSpace(hostID) == "" {
			return nil, errors.New("invalid design hostId")
		}
		return nil, b.cfg.DesignController.PresentToolbar(artworkID, hostID, args[2])
	case "syncFromStore":
		if b.cfg.DesignController == nil {
			return nil, nil
		}
		var artworkID, hostID string
		if len(args) >= 1 {
			_ = json.Unmarshal(args[0], &artworkID)
		}
		if len(args) >= 2 {
			_ = json.Unmarshal(args[1], &hostID)
		}
		return nil, b.cfg.DesignController.SyncFromStore(ctx, artworkID, hostID)
	case "export":
		if b.cfg.DesignController == nil {
			return nil, errors.New("design export unavailable")
		}
		if len(args) < 3 {
			return nil, errors.New("design.export requires (sessionId, format, title, scale?)")
		}
		var artworkID, format, title string
		scale := 1
		if err := json.Unmarshal(args[0], &artworkID); err != nil || strings.TrimSpace(artworkID) == "" {
			return nil, errors.New("invalid design sessionId")
		}
		if err := json.Unmarshal(args[1], &format); err != nil || (format != "png" && format != "jpeg") {
			return nil, errors.New("invalid export format")
		}
		if err := json.Unmarshal(args[2], &title); err != nil || strings.TrimSpace(title) == "" {
			return nil, errors.New("invalid export title")
		}
		if len(args) >= 4 && len(bytes.TrimSpace(args[3])) > 0 && string(bytes.TrimSpace(args[3])) != "null" {
			if err := json.Unmarshal(args[3], &scale); err != nil || scale < 1 || scale > 3 {
				return nil, errors.New("invalid export scale")
			}
		}
		return nil, b.cfg.DesignController.Export(ctx, artworkID, format, title, scale)
	default:
		return nil, fmt.Errorf("design method unavailable in experimental shell: %s", method)
	}
}

func (b *MollyBridge) handleNotifications(method string, _ []json.RawMessage) (any, error) {
	switch method {
	case "getPermissionStatus":
		return map[string]any{"supported": true, "permission": "default", "source": "system"}, nil
	case "showSessionCompletion":
		return map[string]any{"shown": false, "reason": "experimental_mygo_shell"}, nil
	case "openSystemSettings":
		return map[string]any{"opened": false, "platform": runtime.GOOS}, nil
	default:
		return nil, fmt.Errorf("unknown notifications method: %s", method)
	}
}

func (b *MollyBridge) handleImage(method string) (any, error) {
	switch method {
	case "showPreviewMenu":
		return map[string]any{"action": nil}, nil
	case "copyToClipboard":
		return map[string]any{"copied": false, "error": "experimental_mygo_shell"}, nil
	case "saveFile":
		return map[string]any{"saved": false, "canceled": true}, nil
	default:
		return nil, fmt.Errorf("unknown image method: %s", method)
	}
}

func (b *MollyBridge) handlePublicBrowser(ctx context.Context, method string, args []json.RawMessage) (any, error) {
	switch method {
	case "getCapabilities":
		return map[string]any{
			"hasNativeWebMCP": false,
			"engine":          "mygo-untrusted-webview",
		}, nil
	case "getAccountSummary":
		return map[string]any{
			"importAvailable":         false,
			"importUnavailableReason": "signing-required",
			"sites":                   []any{},
		}, nil
	case "create":
		var in struct {
			BrowserID string `json:"browserId"`
		}
		if len(args) == 0 || json.Unmarshal(args[0], &in) != nil || strings.TrimSpace(in.BrowserID) == "" {
			return map[string]any{"ok": false, "error": "invalid_browser_id"}, nil
		}
		rec := &PublicBrowserRecord{BrowserID: in.BrowserID, Phase: "idle"}
		b.mu.Lock()
		b.publicBrowsers[in.BrowserID] = rec
		b.mu.Unlock()
		return map[string]any{"ok": true, "state": rec}, nil
	case "navigate":
		if b.cfg.PublicBrowserHost == nil {
			return map[string]any{"ok": false, "error": "public_browser_disabled_pending_g4"}, nil
		}
		var in struct {
			BrowserID string `json:"browserId"`
			URL       string `json:"url"`
		}
		if len(args) == 0 || json.Unmarshal(args[0], &in) != nil || strings.TrimSpace(in.BrowserID) == "" {
			return map[string]any{"ok": false, "error": "invalid_navigate_input"}, nil
		}
		if err := security.ValidatePublicHTTPURL(ctx, in.URL); err != nil {
			b.mu.Lock()
			rec := b.publicBrowsers[in.BrowserID]
			if rec == nil {
				rec = &PublicBrowserRecord{BrowserID: in.BrowserID}
				b.publicBrowsers[in.BrowserID] = rec
			}
			rec.Phase = "error"
			rec.BlockedURL = in.URL
			rec.Error = err.Error()
			copyRec := *rec
			b.mu.Unlock()
			return map[string]any{"ok": false, "error": err.Error(), "state": copyRec}, nil
		}
		parsed, _ := url.Parse(strings.TrimSpace(in.URL))
		if err := b.cfg.PublicBrowserHost.OpenAndNavigate(ctx, in.BrowserID, parsed.String()); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}, nil
		}
		b.mu.Lock()
		rec := b.publicBrowsers[in.BrowserID]
		if rec == nil {
			rec = &PublicBrowserRecord{BrowserID: in.BrowserID}
			b.publicBrowsers[in.BrowserID] = rec
		}
		rec.Phase = "ready"
		rec.URL = parsed.String()
		rec.BlockedURL = ""
		rec.Error = ""
		copyRec := *rec
		b.mu.Unlock()
		return map[string]any{"ok": true, "state": copyRec}, nil
	case "fetchImage":
		var in struct {
			URL        string `json:"url"`
			PageOrigin string `json:"pageOrigin,omitempty"`
		}
		if len(args) == 0 || json.Unmarshal(args[0], &in) != nil {
			return map[string]any{"ok": false, "error": "invalid_fetch_input"}, nil
		}
		fetcher := &browserfetch.Fetcher{}
		res, err := fetcher.FetchImage(ctx, browserfetch.Request{
			URL:        in.URL,
			PageOrigin: in.PageOrigin,
		})
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}, nil
		}
		return map[string]any{"ok": true, "result": res}, nil
	case "destroy":
		var in struct {
			BrowserID string `json:"browserId"`
		}
		if len(args) > 0 && json.Unmarshal(args[0], &in) == nil {
			if b.cfg.PublicBrowserHost != nil {
				b.cfg.PublicBrowserHost.CloseBrowser(in.BrowserID)
			}
			b.mu.Lock()
			delete(b.publicBrowsers, in.BrowserID)
			b.mu.Unlock()
		}
		return map[string]any{"ok": true}, nil
	default:
		return map[string]any{"ok": false, "error": "public_browser_method_unavailable", "method": method}, nil
	}
}

func (b *MollyBridge) handleModelConnections(method string) (any, error) {
	switch method {
	case "list", "getAll":
		return map[string]any{
			"connections": []any{},
			"readOnly":    true,
			"reason":      "experimental_mygo_shell_pending_g1_signing",
		}, nil
	default:
		return nil, errors.New("modelConnections write is disabled in experimental MyGo shell until G1 signing")
	}
}

func (b *MollyBridge) handleUpdater(method string) (any, error) {
	switch method {
	case "getState":
		return map[string]any{
			"phase":          "disabled",
			"currentVersion": b.cfg.AppVersion,
			"disabledReason": "experimental_mygo_shell",
		}, nil
	case "checkForUpdates":
		return map[string]any{
			"started": false,
			"error":   "updater_disabled_in_experimental_mygo_shell",
		}, nil
	case "quitAndInstall":
		return map[string]any{
			"ok":    false,
			"error": "updater_disabled_in_experimental_mygo_shell",
		}, nil
	default:
		return nil, fmt.Errorf("unknown updater method: %s", method)
	}
}
