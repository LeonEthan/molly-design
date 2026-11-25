package shell

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"

	"github.com/LeonEthan/molly-design/internal/security"
)

var bindBridgeOnce sync.Once
var activeBridgeMu sync.RWMutex
var activeBridge *MollyBridge

type BridgeDispatcher struct{}

func (BridgeDispatcher) Invoke(ctx context.Context, docGen int64, channel string, args []json.RawMessage) (any, error) {
	activeBridgeMu.RLock()
	b := activeBridge
	activeBridgeMu.RUnlock()
	if b == nil {
		return nil, errors.New("bridge not initialized")
	}
	return b.Invoke(ctx, docGen, channel, args)
}

func (BridgeDispatcher) Send(ctx context.Context, docGen int64, channel string, payload json.RawMessage) error {
	activeBridgeMu.RLock()
	b := activeBridge
	activeBridgeMu.RUnlock()
	if b == nil {
		return errors.New("bridge not initialized")
	}
	return b.Send(ctx, docGen, channel, payload)
}

func (BridgeDispatcher) SyncDocGen(ctx context.Context) (int64, error) {
	activeBridgeMu.RLock()
	b := activeBridge
	activeBridgeMu.RUnlock()
	if b == nil {
		return 0, errors.New("bridge not initialized")
	}
	return b.SyncDocGen(ctx)
}

func installGlobalBridge(b *MollyBridge) {
	activeBridgeMu.Lock()
	activeBridge = b
	activeBridgeMu.Unlock()
	bindBridgeOnce.Do(func() {
		mygo.BindAs("MollyBridge", BridgeDispatcher{})
	})
}

type mygoPublicBrowserHost struct {
	closed   bool
	proxy    *security.PublicEgressProxy
	resolver security.IPResolver
	session  *mygo.Session
	windows  map[string]*mygo.Window
}

func openMygoPublicBrowserSession(proxy *security.PublicEgressProxy, resolver security.IPResolver) (*mygoPublicBrowserHost, error) {
	session, err := mygo.NewProxiedSession("molly-public-browser", mygo.SessionProxyConfig{HTTPProxy: proxy.URL, Username: proxy.Username, Password: proxy.Password})
	if err == nil {
		_, err = session.Cookies.List(mygo.CookieFilter{URL: "https://molly.invalid/"})
	}
	if err != nil {
		return nil, errors.Join(err, proxy.Close())
	}
	return &mygoPublicBrowserHost{proxy: proxy, resolver: resolver, session: session, windows: make(map[string]*mygo.Window)}, nil
}

func (h *mygoPublicBrowserHost) OpenAndNavigate(ctx context.Context, browserID string, targetURL string) error {
	if err := security.ValidatePublicHTTPURLWithResolver(ctx, targetURL, h.resolver); err != nil {
		return err
	}
	err := errors.New("public browser host is closed")
	mygo.RunOnMain(func() {
		if h.closed {
			return
		}
		win := h.windows[browserID]
		if win == nil || win.IsDestroyed() {
			win = mygo.NewWindow(mygo.WindowOptions{
				Title: "Molly Browser", Width: 1024, Height: 720,
				Page: mygo.PageOptions{Untrusted: true, Session: h.session, BackgroundThrottling: mygo.ThrottlingOff},
			})
			win.Page().OnWillNavigate(func(e *mygo.NavigateEvent) {
				if err := security.ValidatePublicHTTPURLWithResolver(context.Background(), e.URL, h.resolver); err != nil {
					e.PreventDefault()
				}
			})
			win.OnClosed(func() {
				if h.windows[browserID] == win {
					delete(h.windows, browserID)
				}
			})
			h.windows[browserID] = win
		}
		err = win.Page().LoadURL(targetURL)
	})
	return err
}

func (h *mygoPublicBrowserHost) CloseBrowser(browserID string) {
	mygo.RunOnMain(func() {
		win := h.windows[browserID]
		delete(h.windows, browserID)
		if win != nil && !win.IsDestroyed() {
			win.Close()
		}
	})
}

func (h *mygoPublicBrowserHost) CloseAll() {
	mygo.RunOnMain(func() {
		if h.closed {
			return
		}
		h.closed = true
		for id := range h.windows {
			h.CloseBrowser(id)
		}
	})
	_ = h.proxy.Close()
}

func configureDesktopSchemeLimits() error {
	return mygo.Protocol.SetBodyLimits(mygo.SchemeBodyLimits{MaxRequestBodyBytes: 5 << 20, MaxInFlightRequestBodyBytes: 32 << 20})
}

type DesktopOptions struct {
	EnablePublicBrowser bool
	RendererDir         string
	DesignDir           string
	DataDir             string
	AppVersion          string
	ControlSocketPath   string
	ProbeSocketPath     string
	LoroSocketPath      string
	NodeBin             string
	DesignWorkerJS      string
}

func newDesktopBridge(opts DesktopOptions, cfg BridgeConfig) *MollyBridge {
	cfg.AppVersion = opts.AppVersion
	cfg.PublicBrowserHost = nil
	return NewMollyBridge(cfg)
}

func installationNamespace() string {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("MOLLY_INSTALLATION_CHANNEL")), "preview") {
		return "molly-preview"
	}
	return "molly"
}

func resolveDefaultDataDir(override string) string {
	if strings.TrimSpace(override) != "" {
		return override
	}
	if envDir := strings.TrimSpace(os.Getenv("MOLLY_DATA_DIR")); envDir != "" {
		return envDir
	}
	home, _ := os.UserHomeDir()
	if home == "" {
		return ""
	}
	if installationNamespace() == "molly-preview" {
		return filepath.Join(home, ".molly-preview-mygo-experimental")
	}
	return filepath.Join(home, ".molly-mygo-experimental")
}

func windowsUserPipeScopeFor(username, homedir string) string {
	cleanUser := username
	if idx := strings.LastIndexAny(cleanUser, `\/`); idx >= 0 {
		cleanUser = cleanUser[idx+1:]
	}
	sum := sha256.Sum256([]byte("-1:" + cleanUser + ":" + homedir))
	return hex.EncodeToString(sum[:8])
}

func windowsUserPipeScope() string {
	username := ""
	if u, err := user.Current(); err == nil && u != nil {
		username = u.Username
	}
	home, _ := os.UserHomeDir()
	return windowsUserPipeScopeFor(username, home)
}

func resolveDaemonSocketPaths(dataDir string, opts DesktopOptions) (controlSock, probeSock, loroSock string) {
	controlSock = opts.ControlSocketPath
	probeSock = opts.ProbeSocketPath
	loroSock = opts.LoroSocketPath
	ns := installationNamespace()
	if runtime.GOOS == "windows" {
		scope := windowsUserPipeScope()
		if controlSock == "" {
			controlSock = `\\.\pipe\` + ns + "-control-" + scope
		}
		if probeSock == "" {
			probeSock = `\\.\pipe\` + ns + "-probe-" + scope
		}
		if loroSock == "" {
			loroSock = `\\.\pipe\` + ns + "-loro-data-plane-" + scope
		}
		return
	}
	if dataDir == "" {
		return
	}
	runDir := filepath.Join(dataDir, "run")
	if controlSock == "" {
		controlSock = filepath.Join(runDir, ns+"-control.sock")
	}
	if probeSock == "" {
		probeSock = filepath.Join(runDir, ns+"-probe.sock")
	}
	if loroSock == "" {
		loroSock = filepath.Join(runDir, ns+"-loro-data-plane.sock")
	}
	return
}

func resolveCLIEntry(worker string) string {
	var candidates []string
	if worker != "" {
		candidates = append(candidates, filepath.Join(filepath.Dir(worker), "index.js"))
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "..", "Resources", "cli", "index.js"))
	}
	candidates = append(candidates, filepath.Join("apps", "electron", "resources", "cli", "index.js"), filepath.Join("apps", "cli", "dist", "index.js"))
	for _, path := range candidates {
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
			return path
		}
	}
	return ""
}

func resolveDesignWorkerRuntime(opts DesktopOptions) (string, string) {
	nodeBin := opts.NodeBin
	entryJS := opts.DesignWorkerJS
	if exe, err := os.Executable(); err == nil {
		resDir := filepath.Join(filepath.Dir(exe), "..", "Resources")
		if nodeBin == "" {
			candidate := filepath.Join(resDir, "runtime", "node")
			if runtime.GOOS == "windows" {
				candidate += ".exe"
			}
			if _, statErr := os.Stat(candidate); statErr == nil {
				nodeBin = candidate
			}
		}
		if entryJS == "" {
			candidate := filepath.Join(resDir, "cli", "design.js")
			if _, statErr := os.Stat(candidate); statErr == nil {
				entryJS = candidate
			}
		}
	}
	if nodeBin == "" {
		if found, err := exec.LookPath("node"); err == nil {
			nodeBin = found
		}
	}
	if entryJS == "" {
		candidate := filepath.Join("apps", "electron", "resources", "cli", "design.js")
		if _, statErr := os.Stat(candidate); statErr == nil {
			entryJS = candidate
		}
	}
	return nodeBin, entryJS
}

type canvasPage interface {
	EvalContext(context.Context, string) (any, error)
}
type mygoCanvasInstance struct {
	copyMu     sync.Mutex
	copyTarget string
	compare    string
	lastSeq    atomic.Uint64
	artworkID  string
	hostID     string
	win        *mygo.Window
	page       canvasPage
	surface    *DesignSurface
}

func (c *mygoCanvasInstance) ArtworkID() string { return c.artworkID }

func (c *mygoCanvasInstance) SetReadonly(ctx context.Context, seq uint64, readonly bool, reason string) error {
	for {
		prev := c.lastSeq.Load()
		if seq < prev {
			return nil
		}
		if c.lastSeq.CompareAndSwap(prev, seq) {
			break
		}
	}
	if c.page == nil || (c.win != nil && c.win.IsDestroyed()) {
		return nil
	}
	reasonJSON, _ := json.Marshal(reason)
	applied, err := c.page.EvalContext(ctx, fmt.Sprintf("window.__mollyApplyReadonly?.(%d,%t,%s)", seq, readonly, reasonJSON))
	if err == nil && applied != true {
		return errors.New("canvas editor unavailable")
	}
	return err
}

type canvasEditorState struct {
	Ready      bool   `json:"ready"`
	Dirty      bool   `json:"dirty"`
	Composing  bool   `json:"composing"`
	Saving     bool   `json:"saving"`
	Readonly   bool   `json:"readonly"`
	RevisionID string `json:"revisionId"`
}

func validateCanvasStateCleanForReload(state *canvasEditorState) error {
	if state == nil || state.Dirty || state.Saving || state.Composing {
		return errors.New("Canvas has unsaved edits; preserve or save them before reloading")
	}
	return nil
}

func (c *mygoCanvasInstance) EditorState() (*canvasEditorState, error) {
	if c.page == nil || (c.win != nil && c.win.IsDestroyed()) {
		return nil, errors.New("canvas surface is not attached")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	res, err := c.page.EvalContext(ctx, `(() => (window.molly && typeof window.molly.state === 'function' ? window.molly.state() : null))()`)
	if err != nil {
		return nil, err
	}
	if res == nil {
		return nil, nil
	}
	raw, err := json.Marshal(res)
	if err != nil {
		return nil, err
	}
	var flags map[string]any
	if err := json.Unmarshal(raw, &flags); err != nil {
		return nil, err
	}
	for _, key := range []string{"dirty", "saving", "composing"} {
		if _, ok := flags[key].(bool); !ok {
			return nil, errors.New("unknown canvas editor state")
		}
	}
	var st canvasEditorState
	if err := json.Unmarshal(raw, &st); err != nil {
		return nil, err
	}
	return &st, nil
}

func (c *mygoCanvasInstance) Flush(permit string) error {
	if c.page == nil || (c.win != nil && c.win.IsDestroyed()) {
		return errors.New("canvas surface is not attached")
	}
	permitJSON, _ := json.Marshal(permit)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	res, err := c.page.EvalContext(ctx, fmt.Sprintf(`(async () => {
		if (!window.molly || typeof window.molly.flush !== 'function') {
			return { ok: false, error: 'canvas editor is not ready to flush' };
		}
		return await window.molly.flush(%s);
	})()`, string(permitJSON)))
	if err != nil {
		return err
	}
	raw, _ := json.Marshal(res)
	var outcome struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(raw, &outcome); err != nil {
		return errors.New("canvas flush returned invalid result")
	}
	if !outcome.OK {
		if strings.TrimSpace(outcome.Error) == "" {
			return errors.New("canvas flush failed")
		}
		return errors.New(outcome.Error)
	}
	return nil
}

type mygoDesignController struct {
	emit       func(string, any) error
	exit       canvasExit
	mu         sync.Mutex
	designHost *DesignProtocolHost
	gate       *CanvasAccessGate
	worker     *DesignWorkerClient
	instances  map[string]*mygoCanvasInstance
}

func newMygoDesignController(designHost *DesignProtocolHost, gate *CanvasAccessGate, worker *DesignWorkerClient) *mygoDesignController {
	return &mygoDesignController{
		designHost: designHost,
		gate:       gate,
		worker:     worker,
		instances:  make(map[string]*mygoCanvasInstance), exit: canvasExit{closing: make(map[*mygo.Window]string), approved: make(map[*mygo.Window]bool)},
	}
}

func canvasInstanceKey(artworkID, hostID string) string {
	return artworkID + "\x00" + hostID
}

func (c *mygoDesignController) openOrReplaceSurface(ctx context.Context, artworkID, hostID string, bounds DesignBounds, expected *mygoCanvasInstance, frame string) error {
	if c.worker == nil || c.designHost == nil {
		return errors.New("design worker or protocol host unavailable")
	}
	payload, err := c.worker.Request(ctx, map[string]any{
		"operation": "read", "readOnly": true,
		"sessionId": artworkID,
	})
	if err != nil {
		return err
	}

	surface := c.designHost.CreateSurface(artworkID, payload, true)
	w := int(bounds.Width)
	h := int(bounds.Height)
	if w < 320 {
		w = 1100
	}
	if h < 240 {
		h = 760
	}
	win := mygo.NewWindow(mygo.WindowOptions{
		Title: "Molly Canvas - " + artworkID, Hidden: true,
		Width:  w,
		Height: h,
		Page: mygo.PageOptions{
			PreloadScript:        BuildCanvasPreloadScript(surface),
			BackgroundThrottling: mygo.ThrottlingOff,
		},
	})
	if c.emit != nil {
		surface.mu.Lock()
		surface.onSelection = func(summary map[string]any) { summary["hostId"] = hostID; _ = c.emit("design.selection", summary) }
		surface.mu.Unlock()
	}
	c.designHost.BindSurfaceLifecycle(win, surface)
	inst := &mygoCanvasInstance{
		artworkID: artworkID,
		hostID:    hostID,
		win:       win,
		page:      win.Page(),
		surface:   surface,
	}

	inst.compare = frame
	c.exit.mu.Lock()
	if c.exit.phase != quitIdle || len(c.exit.closing) > 0 || c.exit.closingArtwork[artworkID] {
		c.exit.mu.Unlock()
		win.Destroy()
		return errors.New("canvas close in progress")
	}
	key := canvasInstanceKey(artworkID, hostID)
	c.mu.Lock()
	existing := c.instances[key]
	if existing != expected {
		c.mu.Unlock()
		c.exit.mu.Unlock()
		win.Destroy()
		return errors.New("canvas instance changed")
	}
	c.instances[key] = inst
	c.mu.Unlock()

	c.exit.mu.Unlock()
	c.guardWindow(win, false)
	_ = c.gate.Register(inst)
	win.Page().OnDidFinishLoad(func() { c.gate.mu.Lock(); c.gate.signalLocked(artworkID); c.gate.mu.Unlock() })
	win.OnClosed(func() {
		c.mu.Lock()
		if c.instances[key] == inst {
			delete(c.instances, key)
		}
		c.mu.Unlock()
		c.gate.Unregister(inst)
	})
	win.Page().LoadURL(surface.URL)
	win.Show()

	if existing != nil {
		c.gate.Unregister(existing)
		if existing.surface != nil {
			c.designHost.RevokeSurface(existing.surface.Host)
		}
		if existing.win != nil && !existing.win.IsDestroyed() {
			existing.win.Destroy()
		}
	}
	return nil
}

func (c *mygoDesignController) Attach(ctx context.Context, artworkID string, bounds DesignBounds, hostID string) error {
	key := canvasInstanceKey(artworkID, hostID)
	c.mu.Lock()
	existing := c.instances[key]
	c.mu.Unlock()
	if existing != nil && existing.win != nil && !existing.win.IsDestroyed() && existing.surface != nil && !existing.surface.IsRevoked() {
		existing.win.Show()
		return nil
	}
	if existing != nil && !existing.win.IsDestroyed() {
		state, err := existing.EditorState()
		if err != nil {
			return err
		}
		if err := validateCanvasStateCleanForReload(state); err != nil {
			return err
		}
	}
	return c.openOrReplaceSurface(ctx, artworkID, hostID, bounds, existing, "")
}

func (c *mygoDesignController) Hide(artworkID string, hostID string) error {
	c.mu.Lock()
	inst := c.instances[canvasInstanceKey(artworkID, hostID)]
	c.mu.Unlock()
	if inst != nil && inst.win != nil && !inst.win.IsDestroyed() {
		inst.win.Hide()
	}
	return nil
}

func (c *mygoDesignController) PresentToolbar(artworkID string, hostID string, presentation json.RawMessage) error {
	c.mu.Lock()
	inst := c.instances[canvasInstanceKey(artworkID, hostID)]
	c.mu.Unlock()
	if inst == nil || inst.page == nil || (inst.win != nil && inst.win.IsDestroyed()) {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err := inst.page.EvalContext(ctx, fmt.Sprintf(`(() => {
		if (window.molly && typeof window.molly.presentToolbar === 'function') {
			window.molly.presentToolbar(%s);
		}
		return true;
	})()`, string(presentation)))
	return err
}

func (c *mygoDesignController) SyncFromStore(ctx context.Context, artworkID string, hostID string) error {
	c.mu.Lock()
	var targets []*mygoCanvasInstance
	for _, inst := range c.instances {
		if inst.artworkID != artworkID {
			continue
		}
		if hostID != "" && inst.hostID != hostID {
			continue
		}
		targets = append(targets, inst)
	}
	c.mu.Unlock()
	if len(targets) == 0 {
		return nil
	}
	_, _, seq, release := c.gate.AcquireCloseFreeze(artworkID, randomHexToken(16))
	defer release()
	if err := c.gate.WaitApplied(ctx, seq, artworkID); err != nil {
		return err
	}
	for _, inst := range targets {
		st, err := inst.EditorState()
		if err != nil {
			return err
		}
		if err := validateCanvasStateCleanForReload(st); err != nil {
			return err
		}
	}
	for _, inst := range targets {
		frame := ""
		if data, e := inst.win.CapturePage(); e == nil {
			frame = pngDataURL(data)
		}
		if err := c.openOrReplaceSurface(ctx, inst.artworkID, inst.hostID, DesignBounds{Width: 1100, Height: 760}, inst, frame); err != nil {
			return err
		}
	}
	return nil
}

func sanitizeExportFileName(title, format string, scale int) string {
	var b strings.Builder
	for _, r := range title {
		if r < 0x20 || strings.ContainsRune(`<>:"/\|?*`, r) {
			b.WriteByte('_')
		} else {
			b.WriteRune(r)
		}
	}
	base := strings.TrimSpace(b.String())
	if base == "" {
		base = "design"
	}
	suffix := ".png"
	if format == "jpeg" {
		suffix = ".jpg"
	}
	if scale > 1 {
		return fmt.Sprintf("%s@%dx%s", base, scale, suffix)
	}
	return base + suffix
}

func writeFileAtomicMode0600(targetPath string, content []byte) error {
	dir, err := os.OpenRoot(filepath.Dir(targetPath))
	if err != nil {
		return err
	}
	defer dir.Close()
	return writeAtomicInRoot(dir, filepath.Base(targetPath), content)
}
func writeAtomicInRoot(dir *os.Root, targetPath string, content []byte) error {
	tmpPath := targetPath + "." + randomHexToken(8) + ".tmp"
	f, err := dir.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = dir.Remove(tmpPath)
		}
	}()
	if _, err := f.Write(content); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := dir.Rename(tmpPath, targetPath); err != nil {
		return err
	}
	committed = true
	if runtime.GOOS != "windows" {
		if df, dirErr := dir.Open("."); dirErr == nil {
			_ = df.Sync()
			_ = df.Close()
		}
	}
	return nil
}

func (c *mygoDesignController) Export(ctx context.Context, artworkID string, format string, title string, scale int) error {
	if c.worker == nil || c.designHost == nil {
		return errors.New("design export unavailable")
	}
	if !c.gate.IsReadonly(artworkID) {
		if err := c.gate.Flush(artworkID); err != nil {
			return err
		}
	}
	payload, err := c.worker.Request(ctx, map[string]any{
		"operation": "read", "readOnly": true,
		"sessionId": artworkID,
	})
	if err != nil {
		return err
	}
	ext := "png"
	if format == "jpeg" {
		ext = "jpg"
	}
	defaultName := sanitizeExportFileName(title, format, scale)
	targetPath, err := mygo.Dialog.Save(mygo.SaveDialogOptions{
		DefaultPath: defaultName,
		Filters: []mygo.FileFilter{
			{Name: strings.ToUpper(format), Extensions: []string{ext}},
		},
	})
	if err != nil || strings.TrimSpace(targetPath) == "" {
		return err
	}
	outBytes, _, _, _, _, err := renderDesignOffscreen(c.designHost, artworkID, payload, format, scale, nil)
	if err != nil {
		return err
	}
	return writeFileAtomicMode0600(targetPath, outBytes)
}

func buildCanvasHostRPCBody(machineID, workspaceID string, reports []DesignCanvasReport) ([]byte, error) {
	batch := make([]DesignCanvasReport, 0, min(len(reports), 100))
	if len(reports) > 0 {
		limit := len(reports)
		if limit > 100 {
			limit = 100
		}
		batch = append(batch, reports[:limit]...)
	}
	return json.Marshal(map[string]any{
		"machineId":   machineID,
		"workspaceId": workspaceID,
		"method":      "design/canvas-host",
		"params": map[string]any{
			"version": 1,
			"reports": batch,
		},
	})
}

const offscreenReadyJS = `new Promise((resolve, reject) => {
		const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Canvas rendering timed out')); }, 15000);
		const observer = new MutationObserver(check);
		observer.observe(document, { childList: true, subtree: true });
		async function check() {
			const stage = document.querySelector('.ed-stage-scale .bento-slide');
			if (!window.bento || !window.bento.doc || !stage) return;
			observer.disconnect();
			try {
				await document.fonts.ready;
				if ([...document.fonts].some(font => font.status === 'error')) throw new Error('Font failed to load');
				await Promise.all([...stage.querySelectorAll('img')].map(img => img.decode()));
				await Promise.all([...stage.querySelectorAll('image')].map(node => {
					const image = new Image();
					image.src = node.getAttribute('href') || node.getAttribute('xlink:href') || '';
					return image.decode();
				}));
				if (stage.offsetWidth !== %d || stage.offsetHeight !== %d) throw new Error('Canvas dimensions differ');
				document.documentElement.style.cssText = 'margin:0;background:transparent!important;overflow:hidden';
				document.body.style.cssText = 'margin:0;background:transparent!important;overflow:hidden';
				stage.style.cssText += ';transform:none;position:absolute;left:0;top:0';
				stage.inert = true;
				document.body.replaceChildren(stage);
				clearTimeout(timer);
				resolve(devicePixelRatio);
			} catch (e) {
				clearTimeout(timer);
				reject(e);
			}
		}
		check();
	})`

const offscreenTileJS = `new Promise((resolve, reject) => {
	const stage = document.querySelector('.bento-slide');
	stage.style.left = '%dpx';
	stage.style.top = '%dpx';
	const bounds = stage.getBoundingClientRect();
	if (bounds.left !== %d || bounds.top !== %d) throw Error('Tile origin mismatch');
	const seq = %d;
	const {port1, port2} = new MessageChannel();
	port1.onmessage = ({data}) => {
		port1.close();
		port2.close();
		if (data !== seq) reject(Error('Tile sequence mismatch'));
		else resolve(data);
	};
	port2.postMessage(seq);
})`

func renderDesignOffscreen(
	designHost *DesignProtocolHost,
	artworkID string,
	payloadRaw json.RawMessage,
	format string,
	scale int,
	report *G3SelfTestReport,
) ([]byte, int, int, int, int, error) {
	return renderDesignOffscreenContext(context.Background(), designHost, artworkID, payloadRaw, format, scale, report)
}
func renderDesignOffscreenContext(ctx context.Context,
	designHost *DesignProtocolHost,
	artworkID string,
	payloadRaw json.RawMessage,
	format string,
	scale int,
	report *G3SelfTestReport,
) ([]byte, int, int, int, int, error) {
	if designHost == nil {
		return nil, 0, 0, 0, 0, errors.New("design protocol host unavailable")
	}
	var payload struct {
		Doc struct {
			Canvas struct {
				Width  int `json:"width"`
				Height int `json:"height"`
			} `json:"canvas"`
		} `json:"doc"`
	}
	if err := json.Unmarshal(payloadRaw, &payload); err != nil {
		return nil, 0, 0, 0, 0, err
	}
	width := payload.Doc.Canvas.Width
	height := payload.Doc.Canvas.Height
	if width <= 0 || height <= 0 {
		return nil, 0, 0, 0, 0, errors.New("design payload missing doc.canvas width/height")
	}
	if scale <= 0 {
		scale = 1
	}
	bleed := ComputeDynamicBleedPx(payloadRaw)
	tiles, err := PlanExportTiles(width, height, scale, DefaultTileEdge, bleed)
	if err != nil {
		return nil, width, height, bleed, 0, err
	}
	stitcher, err := NewIncrementalTileStitcher(width, height, scale)
	if err != nil {
		return nil, width, height, bleed, len(tiles), err
	}

	surface := designHost.CreateSurface(artworkID, payloadRaw, false)
	defer designHost.RevokeSurface(surface.Host)

	firstTile := tiles[0]
	loadedCh := make(chan struct{}, 1)
	win := mygo.NewWindow(mygo.WindowOptions{
		Title:           "MollyDesignRender",
		Width:           firstTile.CaptureWidth,
		Height:          firstTile.CaptureHeight,
		UseContentSize:  true,
		Hidden:          true,
		Transparent:     true,
		BackgroundColor: "#00000000",
		Page: mygo.PageOptions{
			BackgroundThrottling: mygo.ThrottlingOff,
		},
	})
	defer win.Close()

	surface.BindOwnerPage(win.Page())
	win.Page().OnDidFinishLoad(func() {
		select {
		case loadedCh <- struct{}{}:
		default:
		}
	})
	win.Page().LoadURL(surface.URL)
	select {
	case <-ctx.Done():
		return nil, width, height, bleed, len(tiles), ctx.Err()
	case <-loadedCh:
	case <-time.After(15 * time.Second):
		return nil, width, height, bleed, len(tiles), errors.New("timed out waiting for Bento editor.html load")
	}

	readyCtx, cancelReady := context.WithTimeout(ctx, 20*time.Second)
	defer cancelReady()
	hostDPR, err := win.Page().EvalContext(readyCtx, fmt.Sprintf(offscreenReadyJS, width, height))
	if report != nil {
		report.HostNativeDPR, _ = hostDPR.(float64)
		report.TargetScale = scale
	}
	if err != nil {
		return nil, width, height, bleed, len(tiles), fmt.Errorf("bento ready wait failed: %w", err)
	}

	curW, curH := firstTile.CaptureWidth, firstTile.CaptureHeight
	for seq, tile := range tiles {
		if tile.CaptureWidth != curW || tile.CaptureHeight != curH {
			win.SetContentSize(tile.CaptureWidth, tile.CaptureHeight)
			curW, curH = tile.CaptureWidth, tile.CaptureHeight
		}
		ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
		ready, err := win.Page().EvalContext(ctx, fmt.Sprintf(offscreenTileJS, -tile.CaptureX, -tile.CaptureY, -tile.CaptureX, -tile.CaptureY, seq))
		cancel()
		if err != nil || ready != float64(seq) {
			return nil, width, height, bleed, len(tiles), fmt.Errorf("tile %d readiness failed (receipt %v, error %v)", seq, ready, err)
		}
		rawPNG, err := win.CapturePage()
		if err != nil {
			return nil, width, height, bleed, len(tiles), fmt.Errorf("CapturePage failed: %w", err)
		}
		img, err := png.Decode(bytes.NewReader(rawPNG))
		if err != nil {
			return nil, width, height, bleed, len(tiles), fmt.Errorf("decode captured PNG failed: %w", err)
		}
		if report != nil {
			report.CaptureDPR = float64(img.Bounds().Dx()) / float64(tile.CaptureWidth)
			report.ResamplingMode = "direct-1to1"
			if report.CaptureDPR != float64(scale) {
				report.ResamplingMode = "area-resampled"
			}
		}
		if err := stitcher.AddTile(tile, img); err != nil {
			return nil, width, height, bleed, len(tiles), fmt.Errorf("stitch tile failed: %w", err)
		}
	}

	outBytes, err := EncodeExportImage(stitcher.Image(), format)
	if err != nil {
		return nil, width, height, bleed, len(tiles), err
	}
	return outBytes, width, height, bleed, len(tiles), nil
}

func RunDesktop(opts DesktopOptions) (runErr error) {
	if strings.TrimSpace(opts.RendererDir) == "" {
		return errors.New("renderer directory is required")
	}
	if err := configureDesktopSchemeLimits(); err != nil {
		return err
	}
	dataDir := resolveDefaultDataDir(opts.DataDir)
	if err := ValidateIsolatedShellPaths(dataDir); err != nil {
		return err
	}
	dataDir, err := canonicalDirectory(dataDir)
	if err != nil {
		return err
	}
	controlSock, probeSock, loroSock := resolveDaemonSocketPaths(dataDir, opts)
	nodeBin, designWorkerJS := resolveDesignWorkerRuntime(opts)

	var supervisor *CLISupervisor
	var bridge *MollyBridge
	var startPrivate func(context.Context) (*CLISupervisor, error)
	if opts.ControlSocketPath == "" && opts.ProbeSocketPath == "" && opts.LoroSocketPath == "" {
		if runtime.GOOS == "windows" {
			scope, _, err := dataDirectoryScope(dataDir)
			if err != nil {
				return err
			}
			controlSock += "-" + scope
			probeSock += "-" + scope
			loroSock += "-" + scope
		}
		cliEntry := resolveCLIEntry(designWorkerJS)
		if nodeBin == "" || cliEntry == "" {
			return errors.New("private_cli_runtime_unavailable")
		}
		startPrivate = func(ctx context.Context) (*CLISupervisor, error) {
			if err := ValidateIsolatedShellPaths(dataDir); err != nil {
				return nil, err
			}
			s, err := startPrivateCLI(dataDir, nodeBin, cliEntry)
			if err != nil {
				return nil, err
			}
			ready, cancel := context.WithTimeout(ctx, 45*time.Second)
			defer cancel()
			if err = s.confirmPrivateDaemon(ready, probeSock); err != nil {
				return nil, errors.Join(err, s.Close())
			}
			return s, nil
		}
		supervisor, err = startPrivate(context.Background())
		if err != nil {
			return err
		}
		defer func() {
			if bridge == nil {
				runErr = errors.Join(runErr, supervisor.Close())
			} else {
				runErr = errors.Join(runErr, bridge.closePrivateCLI())
			}
		}()
	}
	gate := NewCanvasAccessGate()
	var worker *DesignWorkerClient
	if nodeBin != "" && designWorkerJS != "" {
		worker = NewDesignWorkerClientWithDataDir(nodeBin, designWorkerJS, dataDir)
	}

	var designHost *DesignProtocolHost
	if opts.DesignDir != "" {
		var saveFn SaveDesignFunc
		if worker != nil {
			saveFn = func(artworkID string, req DesignSaveRequest) (DesignSaveResult, error) {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				raw, err := worker.Request(ctx, map[string]any{
					"operation":      "save",
					"sessionId":      artworkID,
					"baseRevisionId": req.BaseRevisionID,
					"content": map[string]any{
						"doc":    req.Doc,
						"assets": req.Assets,
					},
				}, req.BeforeSend)
				if err != nil {
					return DesignSaveResult{}, err
				}
				var saved struct {
					RevisionID string `json:"revisionId"`
				}
				if err := json.Unmarshal(raw, &saved); err != nil {
					return DesignSaveResult{}, err
				}
				return DesignSaveResult{RevisionID: saved.RevisionID, Payload: raw}, nil
			}
		}
		var err error
		designHost, err = NewDesignProtocolHostWithDataDir(opts.DesignDir, gate, saveFn, dataDir)
		if err != nil {
			return err
		}
		if err := mygo.Protocol.Handle("molly-design", designHost); err != nil {
			return err
		}
	}

	var relay *LoroRelay
	if loroSock != "" {
		relay = NewLoroRelay(LoroRelayConfig{
			SocketPath: loroSock,
			OnEvent: func(raw json.RawMessage) {
				if bridge != nil {
					_ = bridge.EmitToWorkbench("loro.event", raw)
				}
			},
			OnStatus: func(connected bool) {
				if bridge != nil {
					_ = bridge.EmitToWorkbench("loro.status", connected)
				}
			},
		})
	}

	var designController DesignHostController
	if designHost != nil {
		designController = newMygoDesignController(designHost, gate, worker)
	}

	resources := NewLocalFileResourceStore()
	if err := mygo.Protocol.Handle("molly-resource", resources); err != nil {
		return err
	}
	defer resources.RevokeAll()
	appCtx, cancelApp := context.WithCancel(context.Background())
	defer cancelApp()
	bridge = newDesktopBridge(opts, BridgeConfig{
		previewUI: mygo.RunOnMain, startPrivate: startPrivate, appContext: appCtx, Resources: resources, Bundled: NewBundledCapabilities(resolveCLIEntry(designWorkerJS)),
		Supervisor:        supervisor,
		DataDir:           dataDir,
		ControlSocketPath: controlSock,
		ProbeSocketPath:   probeSock,
		LoroSocketPath:    loroSock,
		DesignHost:        designHost,
		CanvasGate:        gate,

		DesignController: designController,
		LoroRelay:        relay,
	})
	if worker != nil {
		bridge.cfg.DesignWorker = worker
	}
	gate.onWritable = func(id string) { _ = bridge.EmitToWorkbench("design.state", settingsObject{"artworkId": id}) }
	gate.owns = func() bool { return bridge.private.Load().OwnsPrivateDaemon() }
	if c, ok := designController.(*mygoDesignController); ok {
		c.emit = bridge.EmitToWorkbench
	}
	installGlobalBridge(bridge)
	go bridge.runCanvasHost(appCtx)
	if supervisor.OwnsPrivateDaemon() {
		go bridge.runHarnessHost(appCtx, supervisor)
	}

	mygo.App.SetName("Molly")
	mygo.SetFrontend(rendererFiles{os.DirFS(opts.RendererDir), runtime.GOOS})

	mygo.App.OnReady(func() {
		bridge.startRenderHost(appCtx, supervisor)
		if relay != nil {
			go func() {
				ctx, cancel := context.WithTimeout(appCtx, 2*time.Second)
				defer cancel()
				_ = relay.Connect(ctx)
			}()
		}
		gen := bridge.CurrentDocGeneration()
		win := mygo.NewWindow(mygo.WindowOptions{
			Title:  "Molly (MyGo Experimental)",
			Width:  1280,
			Height: 820,
			URL:    "/",
			Page: mygo.PageOptions{
				PreloadScript:        bridge.BuildPreloadScript(gen),
				BackgroundThrottling: mygo.ThrottlingOff,
			},
		})
		page := win.Page()
		bridge.AttachWorkbenchPage(page)
		bridge.workbench.Store(win)
		if c, ok := designController.(*mygoDesignController); ok {
			c.guardWindow(win, true)
			c.guardQuit()
		}
		win.OnClosed(func() { bridge.AdvanceDocGeneration(); bridge.workbench.Store(nil); bridge.AttachWorkbenchPage(nil) })
		win.OnEnterFullScreen(func() { _ = bridge.EmitToWorkbench("app.fullscreen", true) })
		win.OnLeaveFullScreen(func() { _ = bridge.EmitToWorkbench("app.fullscreen", false) })
		mygo.Theme.OnUpdated(func() {
			theme := "light"
			if mygo.Theme.IsDark() {
				theme = "dark"
			}
			_ = bridge.EmitToWorkbench("app.nativeTheme", theme)
		})
		var wbNavCount atomic.Int64
		page.OnWillNavigate(func(e *mygo.NavigateEvent) {
			if err := validateProtocolNavigation(e.URL, runtime.GOOS, "mygo", "localhost"); err != nil {
				e.PreventDefault()
				return
			}
			resources.AdvanceGen()
		})
		page.OnDidNavigate(func(_ string) {
			if wbNavCount.Add(1) > 1 {
				bridge.AdvanceDocGeneration()
			}
			if relay != nil {
				relay.ReleaseSender("workbench")
			}
		})
	})

	mygo.App.OnQuit(func() { bridge.shutdownDesktop(cancelApp) })
	err = mygo.App.Run()
	cancelApp()
	bridge.renderHosts.Wait()
	return err
}

func (bridge *MollyBridge) shutdownDesktop(cancelApp context.CancelFunc) {
	cancelApp()
	bridge.clearPreviews()
	designHost, gate, worker, relay := bridge.cfg.DesignHost, bridge.cfg.CanvasGate, bridge.cfg.DesignWorker, bridge.cfg.LoroRelay

	if designHost != nil {
		designHost.mu.Lock()
		var hosts []string
		for host := range designHost.surfaces {
			hosts = append(hosts, host)
		}
		designHost.mu.Unlock()
		for _, host := range hosts {
			designHost.RevokeSurface(host)
		}
	}
	gate.SetUpdating(true)
	gate.Disconnected()
	gate.mu.Lock()
	clear(gate.closeFreezes)
	gate.mu.Unlock()
	if worker != nil {
		_ = worker.Close()
	}
	if relay != nil {
		_ = relay.Close()
	}
	_ = bridge.closePrivateCLI()
	bridge.closeSettings()
	if resources := bridge.cfg.Resources; resources != nil {
		resources.Close()
	}
	if bridge.releaseAwake != nil {
		bridge.releaseAwake()
		bridge.releaseAwake = nil
	}
	if designHost != nil && designHost.spool != nil {
		_ = designHost.spool.Close()
	}

}

type G5SelfTestReport struct {
	Passed                   bool   `json:"passed"`
	ValidLargeSaveStatus     int    `json:"validLargeSaveStatus"`
	LargePayloadBytes        int    `json:"largePayloadBytes"`
	MissingTokenStatus       int    `json:"missingTokenStatus"`
	WrongContentTypeStatus   int    `json:"wrongContentTypeStatus"`
	MissingBaseRevStatus     int    `json:"missingBaseRevStatus"`
	ActiveTurnStatus         int    `json:"activeTurnStatus"`
	CrossPageBlocked         bool   `json:"crossPageBlocked"`
	CanvasBridgeBlocked      bool   `json:"canvasBridgeBlocked"`
	UntrustedBridgeBlocked   bool   `json:"untrustedBridgeBlocked"`
	ReloadRevokedTokenStatus int    `json:"reloadRevokedTokenStatus"`
	ReloadStaleDocGenBlocked bool   `json:"reloadStaleDocGenBlocked"`
	ReloadNewDocBridgeOK     bool   `json:"reloadNewDocBridgeOK"`
	WorkbenchBridgeOK        bool   `json:"workbenchBridgeOK"`
	Error                    string `json:"error,omitempty"`
}

func evalProbe(page *mygo.Page, script string) (any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return page.EvalContext(ctx, script)
}

func RunSelfTestG5() (G5SelfTestReport, error) {
	report := G5SelfTestReport{}
	if err := configureDesktopSchemeLimits(); err != nil {
		return report, err
	}
	gate := NewCanvasAccessGate()
	gate.UpdateFromDaemon(nil, nil)

	var saveCalls atomic.Int32
	host := NewDesignProtocolHostFromBytes(
		[]byte(`<!doctype html><html><body><div id="canvas">ready</div></body></html>`),
		gate,
		func(artworkID string, req DesignSaveRequest) (DesignSaveResult, error) {
			saveCalls.Add(1)
			return DesignSaveResult{RevisionID: fmt.Sprintf("rev-%d", saveCalls.Load())}, nil
		},
	)
	if err := mygo.Protocol.Handle("molly-design", host); err != nil {
		return report, err
	}

	bridge := NewMollyBridge(BridgeConfig{
		AppVersion: "0.2.0-g5-selftest",
		DesignHost: host,
		CanvasGate: gate,
	})
	installGlobalBridge(bridge)

	surface := host.CreateSurface("art-g5", json.RawMessage(`{"doc":{"canvas":{"width":400,"height":300}}}`), true)
	mygo.App.SetName("MollyG5SelfTest")

	var testErr error
	mygo.App.OnReady(func() {
		go func() {
			defer func() {
				mygo.App.Quit()
			}()

			wbLoaded := make(chan struct{}, 2)
			canvasLoaded := make(chan struct{}, 2)
			untrustedLoaded := make(chan struct{}, 2)
			signalLoad := func(ch chan struct{}) {
				select {
				case ch <- struct{}{}:
				default:
				}
			}

			gen := bridge.AdvanceDocGeneration()
			wbWin := mygo.NewWindow(mygo.WindowOptions{
				Title:  "WB",
				Width:  320,
				Height: 240,
				Hidden: true,
				Page: mygo.PageOptions{
					PreloadScript:        bridge.BuildPreloadScript(gen),
					BackgroundThrottling: mygo.ThrottlingOff,
				},
			})
			wbPage := wbWin.Page()
			wbGen := bridge.AttachWorkbenchPage(wbPage)
			var wbNavCount atomic.Int64
			wbPage.OnDidNavigate(func(_ string) {
				if wbNavCount.Add(1) > 1 {
					bridge.AdvanceDocGeneration()
				}
			})
			wbPage.OnDidFinishLoad(func() { signalLoad(wbLoaded) })
			wbPage.LoadHTML("<!doctype html><html><body>wb</body></html>", "mygo://localhost/")

			canvasWin := mygo.NewWindow(mygo.WindowOptions{
				Title:  "Canvas",
				Width:  320,
				Height: 240,
				Hidden: true,
				Page: mygo.PageOptions{
					BackgroundThrottling: mygo.ThrottlingOff,
				},
			})
			host.BindSurfaceLifecycle(canvasWin, surface)
			canvasWin.Page().OnDidFinishLoad(func() { signalLoad(canvasLoaded) })
			canvasWin.Page().LoadURL(surface.URL)

			untrustedWin := mygo.NewWindow(mygo.WindowOptions{
				Title:  "Untrusted",
				Width:  320,
				Height: 240,
				Hidden: true,
				Page: mygo.PageOptions{
					Untrusted:            true,
					BackgroundThrottling: mygo.ThrottlingOff,
				},
			})
			untrustedWin.Page().OnDidFinishLoad(func() { signalLoad(untrustedLoaded) })
			untrustedWin.Page().LoadHTML("<!doctype html><html><body>untrusted</body></html>", "https://untrusted.example/")

			waitLoad := func(name string, ch chan struct{}) error {
				select {
				case <-ch:
					return nil
				case <-time.After(15 * time.Second):
					return fmt.Errorf("timed out waiting for %s load", name)
				}
			}
			if err := waitLoad("workbench", wbLoaded); err != nil {
				testErr = err
				return
			}
			if err := waitLoad("canvas", canvasLoaded); err != nil {
				testErr = err
				return
			}
			if err := waitLoad("untrusted", untrustedLoaded); err != nil {
				testErr = err
				return
			}

			wbCheck, err := evalProbe(wbPage, fmt.Sprintf(`(async () => {
				const res = await window.mygo.call("MollyBridge.Invoke", %d, "updater.getState", []);
				return res && res.phase === "disabled";
			})()`, wbGen))
			if err != nil {
				testErr = fmt.Errorf("workbench bridge eval failed: %w", err)
				return
			}
			if ok, _ := wbCheck.(bool); ok {
				report.WorkbenchBridgeOK = true
			}

			saveURL := surface.Origin + "/ws/" + surface.ArtworkID + "/save"
			evalStatus := func(page *mygo.Page, js string) (int, error) {
				v, err := evalProbe(page, js)
				if err != nil {
					return 0, err
				}
				switch n := v.(type) {
				case float64:
					return int(n), nil
				case int:
					return n, nil
				case int64:
					return int(n), nil
				default:
					return 0, fmt.Errorf("unexpected status type %T (%v)", v, v)
				}
			}

			largePadLen := 5 * 1024 * 1024
			report.LargePayloadBytes = largePadLen
			st, err := evalStatus(canvasWin.Page(), fmt.Sprintf(`(async () => {
				const body = JSON.stringify({ baseRevisionId: "rev-0", doc: { pad: "a".repeat(%d) }, assets: {} });
				const r = await fetch(%q, {
					method: "POST",
					headers: { "Content-Type": "application/json", %q: %q },
					body
				});
				return r.status;
			})()`, largePadLen, saveURL, security.CapabilityTokenHeader, surface.CapabilityToken))
			if err != nil {
				testErr = fmt.Errorf("large save eval failed: %w", err)
				return
			}
			report.ValidLargeSaveStatus = st

			st, err = evalStatus(canvasWin.Page(), fmt.Sprintf(`(async () => {
				const r = await fetch(%q, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ baseRevisionId: "rev-1", doc: {}, assets: {} })
				});
				return r.status;
			})()`, saveURL))
			if err != nil {
				testErr = fmt.Errorf("missing token eval failed: %w", err)
				return
			}
			report.MissingTokenStatus = st

			st, err = evalStatus(canvasWin.Page(), fmt.Sprintf(`(async () => {
				const r = await fetch(%q, {
					method: "POST",
					headers: { "Content-Type": "text/plain", %q: %q },
					body: JSON.stringify({ baseRevisionId: "rev-1", doc: {}, assets: {} })
				});
				return r.status;
			})()`, saveURL, security.CapabilityTokenHeader, surface.CapabilityToken))
			if err != nil {
				testErr = fmt.Errorf("wrong content-type eval failed: %w", err)
				return
			}
			report.WrongContentTypeStatus = st

			st, err = evalStatus(canvasWin.Page(), fmt.Sprintf(`(async () => {
				const r = await fetch(%q, {
					method: "POST",
					headers: { "Content-Type": "application/json", %q: %q },
					body: JSON.stringify({ baseRevisionId: "", doc: {}, assets: {} })
				});
				return r.status;
			})()`, saveURL, security.CapabilityTokenHeader, surface.CapabilityToken))
			if err != nil {
				testErr = fmt.Errorf("missing baseRev eval failed: %w", err)
				return
			}
			report.MissingBaseRevStatus = st

			gate.UpdateFromDaemon([]DesignCanvasState{{ArtworkID: surface.ArtworkID, TurnID: "turn-1", Preparing: false}}, nil)
			st, err = evalStatus(canvasWin.Page(), fmt.Sprintf(`(async () => {
				const r = await fetch(%q, {
					method: "POST",
					headers: { "Content-Type": "application/json", %q: %q },
					body: JSON.stringify({ baseRevisionId: "rev-1", doc: {}, assets: {} })
				});
				return r.status;
			})()`, saveURL, security.CapabilityTokenHeader, surface.CapabilityToken))
			if err != nil {
				testErr = fmt.Errorf("active turn eval failed: %w", err)
				return
			}
			report.ActiveTurnStatus = st
			gate.UpdateFromDaemon(nil, nil)

			crossBlocked, err := evalProbe(untrustedWin.Page(), fmt.Sprintf(`(async () => {
				try {
					const r = await fetch(%q, {
						method: "POST",
						headers: { "Content-Type": "application/json", %q: %q },
						body: JSON.stringify({ baseRevisionId: "rev-1", doc: {}, assets: {} })
					});
					return r.status === 403;
				} catch (e) {
					return true;
				}
			})()`, saveURL, security.CapabilityTokenHeader, surface.CapabilityToken))
			if err != nil {
				testErr = fmt.Errorf("cross-page eval failed: %w", err)
				return
			}
			report.CrossPageBlocked, _ = crossBlocked.(bool)

			canvasBridgeBlocked, err := evalProbe(canvasWin.Page(), fmt.Sprintf(`(async () => {
				try {
					await window.mygo.call("MollyBridge.Invoke", %d, "updater.getState", []);
					return false;
				} catch (e) {
					return true;
				}
			})()`, wbGen))
			if err != nil {
				testErr = fmt.Errorf("canvas bridge guard eval failed: %w", err)
				return
			}
			report.CanvasBridgeBlocked, _ = canvasBridgeBlocked.(bool)

			untrustedBridgeBlocked, err := evalProbe(untrustedWin.Page(), fmt.Sprintf(`(async () => {
				try {
					if (!window.mygo || !window.mygo.call) return true;
					await window.mygo.call("MollyBridge.Invoke", %d, "updater.getState", []);
					return false;
				} catch (e) {
					return true;
				}
			})()`, wbGen))
			if err != nil {
				testErr = fmt.Errorf("untrusted bridge guard eval failed: %w", err)
				return
			}
			report.UntrustedBridgeBlocked, _ = untrustedBridgeBlocked.(bool)

			canvasWin.Page().Reload()
			if err := waitLoad("canvas-reload", canvasLoaded); err != nil {
				testErr = err
				return
			}
			st, err = evalStatus(canvasWin.Page(), fmt.Sprintf(`(async () => {
				const r = await fetch(%q, {
					method: "POST",
					headers: { "Content-Type": "application/json", %q: %q },
					body: JSON.stringify({ baseRevisionId: "rev-1", doc: {}, assets: {} })
				});
				return r.status;
			})()`, saveURL, security.CapabilityTokenHeader, surface.CapabilityToken))
			if err != nil {
				testErr = fmt.Errorf("reload revoked token eval failed: %w", err)
				return
			}
			report.ReloadRevokedTokenStatus = st

			wbPage.LoadHTML("<!doctype html><html><body>wb-reloaded</body></html>", "mygo://localhost/")
			if err := waitLoad("workbench-reload", wbLoaded); err != nil {
				testErr = err
				return
			}
			staleBlocked, err := evalProbe(wbPage, fmt.Sprintf(`(async () => {
				try {
					await window.mygo.call("MollyBridge.Invoke", %d, "updater.getState", []);
					return false;
				} catch (e) {
					return true;
				}
			})()`, wbGen))
			if err != nil {
				testErr = fmt.Errorf("stale docGen reload eval failed: %w", err)
				return
			}
			report.ReloadStaleDocGenBlocked, _ = staleBlocked.(bool)

			newDocOK, err := evalProbe(wbPage, `(async () => {
				const res = await window.ipc.invoke("updater.getState");
				return Boolean(res && res.phase === "disabled");
			})()`)
			if err != nil {
				testErr = fmt.Errorf("reloaded workbench bridge eval failed: %w", err)
				return
			}
			report.ReloadNewDocBridgeOK, _ = newDocOK.(bool)

			report.Passed = report.WorkbenchBridgeOK &&
				report.ValidLargeSaveStatus == 200 &&
				report.MissingTokenStatus == 403 &&
				report.WrongContentTypeStatus == 415 &&
				report.MissingBaseRevStatus == 409 &&
				report.ActiveTurnStatus == 423 &&
				report.CrossPageBlocked &&
				report.CanvasBridgeBlocked &&
				report.UntrustedBridgeBlocked &&
				report.ReloadRevokedTokenStatus == 403 &&
				report.ReloadStaleDocGenBlocked &&
				report.ReloadNewDocBridgeOK
		}()
	})

	if err := mygo.App.Run(); err != nil {
		return report, err
	}
	if testErr != nil {
		report.Error = testErr.Error()
		return report, testErr
	}
	if !report.Passed {
		return report, errors.New("G5 self-test assertions failed")
	}
	return report, nil
}

type G3SelfTestReport struct {
	HostNativeDPR  float64 `json:"hostNativeDPR"`
	CaptureDPR     float64 `json:"captureDPR"`
	TargetScale    int     `json:"targetScale"`
	ResamplingMode string  `json:"resamplingMode"`
	Passed         bool    `json:"passed"`
	Width          int     `json:"width"`
	Height         int     `json:"height"`
	BleedPx        int     `json:"bleedPx"`
	TileCount      int     `json:"tileCount"`
	OutputBytes    int     `json:"outputBytes"`
	DurationMs     int64   `json:"durationMs"`
	OutputPath     string  `json:"outputPath"`
	Error          string  `json:"error,omitempty"`
}

func RunSelfTestG3(designDir, samplePath, outputPNG string) (G3SelfTestReport, error) {
	started := time.Now()
	report := G3SelfTestReport{OutputPath: outputPNG}
	sampleRaw, err := os.ReadFile(samplePath)
	if err != nil {
		return report, err
	}
	var payload struct {
		Association struct {
			SessionID string `json:"sessionId"`
		} `json:"association"`
		Doc struct {
			Canvas struct {
				Width  int `json:"width"`
				Height int `json:"height"`
			} `json:"canvas"`
		} `json:"doc"`
	}
	if err := json.Unmarshal(sampleRaw, &payload); err != nil {
		return report, err
	}
	width := payload.Doc.Canvas.Width
	height := payload.Doc.Canvas.Height
	if width <= 0 || height <= 0 {
		return report, errors.New("sample payload missing doc.canvas width/height")
	}
	artworkID := payload.Association.SessionID
	if artworkID == "" {
		artworkID = "g3-sample"
	}

	bleed := ComputeDynamicBleedPx(sampleRaw)
	tiles, err := PlanExportTiles(width, height, 1, DefaultTileEdge, bleed)
	if err != nil {
		return report, err
	}
	report.Width = width
	report.Height = height
	report.BleedPx = bleed
	report.TileCount = len(tiles)

	host, err := NewDesignProtocolHost(designDir, NewCanvasAccessGate(), nil)
	if err != nil {
		return report, err
	}
	if err := mygo.Protocol.Handle("molly-design", host); err != nil {
		return report, err
	}
	mygo.App.SetName("MollyG3SelfTest")

	var renderErr error
	mygo.App.OnReady(func() {
		go func() {
			defer mygo.App.Quit()
			scale := 1
			if os.Getenv("MOLLY_G3_SCALE") == "2" {
				scale = 2
			}
			outBytes, w, h, bleed, tileCount, err := renderDesignOffscreen(host, artworkID, sampleRaw, "png", scale, &report)
			if err != nil {
				renderErr = err
				return
			}
			if err := os.MkdirAll(filepath.Dir(outputPNG), 0o755); err != nil {
				renderErr = err
				return
			}
			if err := os.WriteFile(outputPNG, outBytes, 0o644); err != nil {
				renderErr = err
				return
			}
			report.Width = w
			report.Height = h
			report.BleedPx = bleed
			report.TileCount = tileCount
			report.OutputBytes = len(outBytes)
			report.DurationMs = time.Since(started).Milliseconds()
			report.Passed = true
		}()
	})

	if err := mygo.App.Run(); err != nil {
		return report, err
	}
	if renderErr != nil {
		report.Error = renderErr.Error()
		return report, renderErr
	}
	return report, nil
}

type RendererSelfTestReport struct {
	Passed              bool   `json:"passed"`
	StartupMs           int64  `json:"startupMs"`
	MollyElectronFlag   bool   `json:"mollyElectronFlag"`
	MollyMyGoFlag       bool   `json:"mollyMyGoFlag"`
	UpdaterPhase        string `json:"updaterPhase"`
	PublicBrowserWebMCP bool   `json:"publicBrowserWebMCP"`
	RootMounted         bool   `json:"rootMounted"`
	GoAllocBytes        uint64 `json:"goAllocBytes"`
	GoPID               int    `json:"goPid"`
	Error               string `json:"error,omitempty"`
}

func RunSelfTestRenderer(rendererDir string) (RendererSelfTestReport, error) {
	started := time.Now()
	report := RendererSelfTestReport{GoPID: os.Getpid()}

	bridge := NewMollyBridge(BridgeConfig{
		AppVersion: "0.2.0-renderer-selftest",
	})
	installGlobalBridge(bridge)

	mygo.App.SetName("MollyRendererSelfTest")
	mygo.SetFrontend(os.DirFS(rendererDir))

	var testErr error
	mygo.App.OnReady(func() {
		go func() {
			defer func() {
				mygo.App.Quit()
			}()

			loadedCh := make(chan struct{}, 1)
			gen := bridge.CurrentDocGeneration()
			win := mygo.NewWindow(mygo.WindowOptions{
				Title:  "MollyRendererSelfTest",
				Width:  1200,
				Height: 800,
				Hidden: true,
				Page: mygo.PageOptions{
					PreloadScript:        bridge.BuildPreloadScript(gen),
					BackgroundThrottling: mygo.ThrottlingOff,
				},
			})
			page := win.Page()
			bridge.AttachWorkbenchPage(page)
			page.OnDidFinishLoad(func() {
				select {
				case loadedCh <- struct{}{}:
				default:
				}
			})
			win.Page().LoadURL("/")
			select {
			case <-loadedCh:
			case <-time.After(15 * time.Second):
				testErr = errors.New("timed out waiting for renderer load")
				return
			}

			val, err := evalProbe(page, `(async () => {
				const deadline = Date.now() + 12000;
				while (Date.now() < deadline) {
					const root = document.getElementById('root');
					if (window.__MOLLY_ELECTRON__ && window.ipc && root && root.childElementCount > 0) break;
					await new Promise(r => setTimeout(r, 50));
				}
				const updater = await window.ipc.invoke('updater.getState');
				const pb = await window.ipc.invoke('publicBrowser.getCapabilities');
				const root = document.getElementById('root');
				return {
					mollyElectron: window.__MOLLY_ELECTRON__ === true,
					mollyMyGo: window.__MOLLY_MYGO__ === true,
					updaterPhase: updater && updater.phase || '',
					webmcp: Boolean(pb && pb.hasNativeWebMCP),
					rootMounted: Boolean(root && root.childElementCount > 0)
				};
			})()`)
			if err != nil {
				testErr = fmt.Errorf("renderer self-test eval failed: %w", err)
				return
			}
			raw, _ := json.Marshal(val)
			var parsed struct {
				MollyElectron bool   `json:"mollyElectron"`
				MollyMyGo     bool   `json:"mollyMyGo"`
				UpdaterPhase  string `json:"updaterPhase"`
				WebMCP        bool   `json:"webmcp"`
				RootMounted   bool   `json:"rootMounted"`
			}
			if err := json.Unmarshal(raw, &parsed); err != nil {
				testErr = err
				return
			}
			var mem runtime.MemStats
			runtime.ReadMemStats(&mem)
			report.StartupMs = time.Since(started).Milliseconds()
			report.MollyElectronFlag = parsed.MollyElectron
			report.MollyMyGoFlag = parsed.MollyMyGo
			report.UpdaterPhase = parsed.UpdaterPhase
			report.PublicBrowserWebMCP = parsed.WebMCP
			report.RootMounted = parsed.RootMounted
			report.GoAllocBytes = mem.Alloc
			report.Passed = parsed.MollyElectron && parsed.MollyMyGo && parsed.UpdaterPhase == "disabled" && !parsed.WebMCP && parsed.RootMounted
		}()
	})

	if err := mygo.App.Run(); err != nil {
		return report, err
	}
	if testErr != nil {
		report.Error = testErr.Error()
		return report, testErr
	}
	if !report.Passed {
		return report, errors.New("renderer self-test failed")
	}
	return report, nil
}
