package shell

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

var (
	ErrCanvasReadOnly       = errors.New("canvas is read-only; edits are retained")
	ErrDesignWorkerStopping = errors.New("design service is shutting down")
)

type DesignCanvasState struct {
	ArtworkID string `json:"artworkId"`
	TurnID    string `json:"turnId"`
	Preparing bool   `json:"preparing"`
}

type DesignCanvasReport struct {
	ArtworkID string `json:"artworkId"`
	TurnID    string `json:"turnId"`
	OK        bool   `json:"ok"`
	Error     string `json:"error,omitempty"`
}

type CanvasInstance interface {
	ArtworkID() string
	SetReadonly(readonly bool, reason string) error
	Flush(permit string) error
}

type CanvasAccessGate struct {
	mu        sync.Mutex
	known     bool
	updating  bool
	active    map[string]DesignCanvasState
	permits   map[string]string
	reported  map[string]struct{}
	instances map[CanvasInstance]struct{}
	inFlight  map[string]*sync.WaitGroup
}

func NewCanvasAccessGate() *CanvasAccessGate {
	return &CanvasAccessGate{
		active:    make(map[string]DesignCanvasState),
		permits:   make(map[string]string),
		reported:  make(map[string]struct{}),
		instances: make(map[CanvasInstance]struct{}),
		inFlight:  make(map[string]*sync.WaitGroup),
	}
}

func (g *CanvasAccessGate) isReadonlyLocked(artworkID string) bool {
	if g.updating || !g.known {
		return true
	}
	if _, busy := g.active[artworkID]; busy {
		return true
	}
	if _, flushing := g.permits[artworkID]; flushing {
		return true
	}
	return false
}

func (g *CanvasAccessGate) IsReadonly(artworkID string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.isReadonlyLocked(artworkID)
}

func (g *CanvasAccessGate) State(artworkID string) map[string]any {
	g.mu.Lock()
	defer g.mu.Unlock()
	st, ok := g.active[artworkID]
	out := map[string]any{
		"readonly":  g.isReadonlyLocked(artworkID),
		"known":     g.known,
		"preparing": ok && st.Preparing,
	}
	if ok && st.TurnID != "" {
		out["turnId"] = st.TurnID
	}
	return out
}

func (g *CanvasAccessGate) Register(inst CanvasInstance) error {
	g.mu.Lock()
	g.instances[inst] = struct{}{}
	g.mu.Unlock()
	return inst.SetReadonly(true, "checking")
}

func (g *CanvasAccessGate) Unregister(inst CanvasInstance) {
	g.mu.Lock()
	delete(g.instances, inst)
	g.mu.Unlock()
}

func (g *CanvasAccessGate) Disconnected() {
	g.mu.Lock()
	g.known = false
	g.permits = make(map[string]string)
	instances := g.snapshotInstancesLocked()
	g.mu.Unlock()
	for _, inst := range instances {
		_ = inst.SetReadonly(true, "checking")
	}
}

func (g *CanvasAccessGate) snapshotInstancesLocked() []CanvasInstance {
	out := make([]CanvasInstance, 0, len(g.instances))
	for inst := range g.instances {
		out = append(out, inst)
	}
	return out
}

func (g *CanvasAccessGate) refresh() {
	g.mu.Lock()
	instances := g.snapshotInstancesLocked()
	known := g.known
	updating := g.updating
	activeCopy := make(map[string]DesignCanvasState, len(g.active))
	for k, v := range g.active {
		activeCopy[k] = v
	}
	permitsCopy := make(map[string]string, len(g.permits))
	for k, v := range g.permits {
		permitsCopy[k] = v
	}
	g.mu.Unlock()

	for _, inst := range instances {
		id := inst.ArtworkID()
		_, isActive := activeCopy[id]
		_, hasPermit := permitsCopy[id]
		readonly := updating || !known || isActive || hasPermit
		reason := "locked"
		if !known {
			reason = "checking"
		} else if isActive || hasPermit || updating {
			reason = "processing"
		}
		_ = inst.SetReadonly(readonly, reason)
	}
}

func (g *CanvasAccessGate) UpdateFromDaemon(
	states []DesignCanvasState,
	beforeRelease func(artworkID string) error,
) []DesignCanvasReport {
	g.mu.Lock()
	next := make(map[string]DesignCanvasState, len(states))
	for _, st := range states {
		next[st.ArtworkID] = st
	}
	var releasing []DesignCanvasState
	for id, prev := range g.active {
		if _, stillActive := next[id]; !stillActive {
			releasing = append(releasing, prev)
		}
	}
	g.mu.Unlock()

	for _, prev := range releasing {
		if beforeRelease != nil {
			if err := beforeRelease(prev.ArtworkID); err != nil {
				prev.Preparing = false
				next[prev.ArtworkID] = prev
			}
		}
	}

	g.mu.Lock()
	g.active = next
	g.known = true
	g.mu.Unlock()
	g.refresh()

	var reports []DesignCanvasReport
	live := make(map[string]struct{}, len(states))
	for _, st := range states {
		live[st.TurnID] = struct{}{}
		if !st.Preparing {
			continue
		}
		g.mu.Lock()
		_, already := g.reported[st.TurnID]
		updating := g.updating
		g.mu.Unlock()
		if already {
			continue
		}
		var flushErr error
		if updating {
			flushErr = errors.New("Molly is preparing an update; try again after updating")
		} else {
			flushErr = g.Flush(st.ArtworkID)
		}
		if flushErr != nil {
			msg := flushErr.Error()
			if len(msg) > 500 {
				msg = msg[:500]
			}
			reports = append(reports, DesignCanvasReport{
				ArtworkID: st.ArtworkID,
				TurnID:    st.TurnID,
				OK:        false,
				Error:     msg,
			})
		} else {
			reports = append(reports, DesignCanvasReport{
				ArtworkID: st.ArtworkID,
				TurnID:    st.TurnID,
				OK:        true,
			})
		}
		g.mu.Lock()
		g.reported[st.TurnID] = struct{}{}
		g.mu.Unlock()
	}

	g.mu.Lock()
	for turnID := range g.reported {
		if _, ok := live[turnID]; !ok {
			delete(g.reported, turnID)
		}
	}
	g.mu.Unlock()
	return reports
}

func (g *CanvasAccessGate) Flush(artworkID string) error {
	raw := make([]byte, 16)
	_, _ = io.ReadFull(rand.Reader, raw)
	permit := hex.EncodeToString(raw)

	g.mu.Lock()
	if !g.known || g.updating {
		g.mu.Unlock()
		return ErrCanvasReadOnly
	}
	g.permits[artworkID] = permit
	wg := g.inFlight[artworkID]
	instances := g.snapshotInstancesLocked()
	g.mu.Unlock()

	g.refresh()
	defer func() {
		g.mu.Lock()
		if g.permits[artworkID] == permit {
			delete(g.permits, artworkID)
		}
		g.mu.Unlock()
		g.refresh()
	}()

	if wg != nil {
		wg.Wait()
	}
	for _, inst := range instances {
		if inst.ArtworkID() != artworkID {
			continue
		}
		if err := inst.Flush(permit); err != nil {
			return err
		}
	}
	return nil
}

func (g *CanvasAccessGate) PrepareForSend(artworkID string) error {
	g.mu.Lock()
	if g.updating {
		g.mu.Unlock()
		return errors.New("Molly is preparing an update; try again after updating")
	}
	if g.known {
		if _, active := g.active[artworkID]; active {
			g.mu.Unlock()
			return nil
		}
	}
	if g.isReadonlyLocked(artworkID) {
		g.mu.Unlock()
		return errors.New("Canvas execution state is unknown or saving; retry when connected")
	}
	g.mu.Unlock()
	return g.Flush(artworkID)
}

func (g *CanvasAccessGate) Write(artworkID string, permit string, action func() error) error {
	g.mu.Lock()
	if !g.known || g.updating {
		g.mu.Unlock()
		return ErrCanvasReadOnly
	}
	readonly := g.isReadonlyLocked(artworkID)
	allowedPermit := permit != "" && g.permits[artworkID] == permit
	if readonly && !allowedPermit {
		g.mu.Unlock()
		return ErrCanvasReadOnly
	}
	wg := g.inFlight[artworkID]
	if wg == nil {
		wg = &sync.WaitGroup{}
		g.inFlight[artworkID] = wg
	}
	wg.Add(1)
	g.mu.Unlock()
	defer wg.Done()
	return action()
}

type workerResponse struct {
	value json.RawMessage
	err   error
}

type workerProcess struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	stdout  io.ReadCloser
	lines   chan workerResponse
	exited  chan struct{}
	waitErr error
	closeMu sync.Mutex
	closed  bool
}

func (p *workerProcess) kill() {
	p.closeMu.Lock()
	if p.closed {
		p.closeMu.Unlock()
		return
	}
	p.closed = true
	p.closeMu.Unlock()
	_ = p.stdin.Close()
	if p.stdout != nil {
		_ = p.stdout.Close()
	}
	killWorkerProcessGroup(p.cmd)
}

type DesignWorkerClient struct {
	nodeBin      string
	entryJS      string
	dataDir      string
	drainTimeout time.Duration
	killTimeout  time.Duration
	onDispatched func()

	semOnce  sync.Once
	sem      chan struct{}
	procMu   sync.Mutex
	proc     *workerProcess
	stopping bool
}

func NewDesignWorkerClient(nodeBin, entryJS string) *DesignWorkerClient {
	return NewDesignWorkerClientWithDataDir(nodeBin, entryJS, "")
}

func NewDesignWorkerClientWithDataDir(nodeBin, entryJS, dataDir string) *DesignWorkerClient {
	return &DesignWorkerClient{
		nodeBin:      nodeBin,
		entryJS:      entryJS,
		dataDir:      strings.TrimSpace(dataDir),
		drainTimeout: 3 * time.Second,
		killTimeout:  2 * time.Second,
		sem:          make(chan struct{}, 1),
	}
}

func (w *DesignWorkerClient) acquireSlot(ctx context.Context) error {
	w.semOnce.Do(func() {
		if w.sem == nil {
			w.sem = make(chan struct{}, 1)
		}
	})
	select {
	case w.sem <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (w *DesignWorkerClient) releaseSlot() {
	<-w.sem
}

func (w *DesignWorkerClient) startLocked() (*workerProcess, error) {
	if w.proc != nil {
		return w.proc, nil
	}
	if strings.TrimSpace(w.nodeBin) == "" || strings.TrimSpace(w.entryJS) == "" {
		return nil, errors.New("design worker runtime not configured")
	}
	cmd := exec.Command(w.nodeBin, w.entryJS)
	if w.dataDir != "" {
		cmd.Env = append(os.Environ(), "MOLLY_DATA_DIR="+w.dataDir)
	}
	configureWorkerProcessGroup(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	proc := &workerProcess{
		cmd:    cmd,
		stdin:  stdin,
		stdout: stdout,
		lines:  make(chan workerResponse, 1),
		exited: make(chan struct{}),
	}
	go func() {
		defer close(proc.exited)
		defer close(proc.lines)
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 64*1024), 64*1024*1024)
		for scanner.Scan() {
			var resp struct {
				OK    bool            `json:"ok"`
				Value json.RawMessage `json:"value"`
				Error string          `json:"error"`
			}
			if unmarshalErr := json.Unmarshal(scanner.Bytes(), &resp); unmarshalErr != nil {
				proc.lines <- workerResponse{err: fmt.Errorf("invalid design worker response: %w", unmarshalErr)}
				continue
			}
			if !resp.OK {
				proc.lines <- workerResponse{err: errors.New(resp.Error)}
				continue
			}
			proc.lines <- workerResponse{value: resp.Value}
		}
		if scanErr := scanner.Err(); scanErr != nil {
			select {
			case proc.lines <- workerResponse{err: scanErr}:
			default:
			}
		}
		proc.waitErr = cmd.Wait()
	}()

	w.proc = proc
	return proc, nil
}

func (w *DesignWorkerClient) dropProcess(proc *workerProcess, kill bool) {
	w.procMu.Lock()
	if w.proc == proc {
		w.proc = nil
	}
	w.procMu.Unlock()
	if kill && proc != nil {
		proc.kill()
	}
}

func (w *DesignWorkerClient) Request(ctx context.Context, req any) (json.RawMessage, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := w.acquireSlot(ctx); err != nil {
		return nil, err
	}
	defer w.releaseSlot()

	if err := ctx.Err(); err != nil {
		return nil, err
	}

	w.procMu.Lock()
	if w.stopping {
		w.procMu.Unlock()
		return nil, ErrDesignWorkerStopping
	}
	proc, err := w.startLocked()
	w.procMu.Unlock()
	if err != nil {
		return nil, err
	}

	line, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	payload := append(line, '\n')
	writeErrCh := make(chan error, 1)
	go func() {
		_, wErr := proc.stdin.Write(payload)
		writeErrCh <- wErr
	}()
	select {
	case wErr := <-writeErrCh:
		if wErr != nil {
			w.dropProcess(proc, true)
			return nil, wErr
		}
		if w.onDispatched != nil {
			w.onDispatched()
		}
	case <-ctx.Done():
		w.dropProcess(proc, true)
		return nil, ctx.Err()
	}

	select {
	case resp, ok := <-proc.lines:
		if !ok {
			w.dropProcess(proc, false)
			return nil, errors.New("design service stopped; retry to check the saved drawing")
		}
		return resp.value, resp.err
	case <-ctx.Done():
		w.dropProcess(proc, true)
		return nil, ctx.Err()
	}
}

func (w *DesignWorkerClient) Close() error {
	w.procMu.Lock()
	w.stopping = true
	proc := w.proc
	w.proc = nil
	w.procMu.Unlock()

	if proc == nil {
		return nil
	}
	_ = proc.stdin.Close()
	timeout := w.drainTimeout
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	killWait := w.killTimeout
	if killWait <= 0 {
		killWait = 2 * time.Second
	}
	select {
	case <-proc.exited:
		return proc.waitErr
	case <-time.After(timeout):
		proc.kill()
		select {
		case <-proc.exited:
			return proc.waitErr
		case <-time.After(killWait):
			return errors.New("design worker did not exit within bounded kill timeout")
		}
	}
}
