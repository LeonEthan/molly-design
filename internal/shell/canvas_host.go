package shell

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
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
	SetReadonly(context.Context, uint64, bool, string) error
	Flush(permit string) error
}

type artworkRefresher struct {
	ctx                   context.Context
	cancel                context.CancelFunc
	targetSeq, appliedSeq uint64
	appliedErr            error
	appliedCond           *sync.Cond
	refreshCh, stopCh     chan struct{}
}

type CanvasAccessGate struct {
	stateSeq        uint64
	refreshers      map[string]*artworkRefresher
	closeFreezes    map[string]map[string]string
	owns            func() bool
	onWritable      func(string)
	mu              sync.Mutex
	known           bool
	updating        bool
	daemonTurns     map[string]string
	active          map[string]DesignCanvasState
	permits         map[string]string
	inFlightPrepare map[string]struct{}
	instances       map[CanvasInstance]struct{}
	inFlight        map[string]map[chan struct{}]struct{}
}

func NewCanvasAccessGate() *CanvasAccessGate {
	return &CanvasAccessGate{
		refreshers: make(map[string]*artworkRefresher), closeFreezes: make(map[string]map[string]string),
		active:          make(map[string]DesignCanvasState),
		permits:         make(map[string]string),
		inFlightPrepare: make(map[string]struct{}),
		instances:       make(map[CanvasInstance]struct{}),
		inFlight:        make(map[string]map[chan struct{}]struct{}),
	}
}

func (g *CanvasAccessGate) isReadonlyLocked(artworkID string) bool {
	if g.updating || !g.known || (g.owns != nil && !g.owns()) || len(g.closeFreezes[artworkID]) > 0 {
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

func (g *CanvasAccessGate) SetUpdating(value bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.updating != value {
		g.updating = value
		g.signalLocked("")
	}
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
	defer g.mu.Unlock()
	id := inst.ArtworkID()
	g.instances[inst] = struct{}{}
	if g.refreshers[id] == nil {
		ctx, cancel := context.WithCancel(context.Background())
		r := &artworkRefresher{ctx: ctx, cancel: cancel, appliedCond: sync.NewCond(&g.mu), refreshCh: make(chan struct{}, 1), stopCh: make(chan struct{})}
		g.refreshers[id] = r
		go g.refreshArtwork(id, r)
	}
	g.signalLocked(id)
	return nil
}

func (g *CanvasAccessGate) signalLocked(id string) uint64 {
	g.stateSeq++
	for key, r := range g.refreshers {
		if id != "" && key != id {
			continue
		}
		r.targetSeq = g.stateSeq
		select {
		case r.refreshCh <- struct{}{}:
		default:
		}
	}
	return g.stateSeq
}

func (g *CanvasAccessGate) instancesLocked(id string) []CanvasInstance {
	var out []CanvasInstance
	for inst := range g.instances {
		if inst.ArtworkID() == id {
			out = append(out, inst)
		}
	}
	return out
}

func (g *CanvasAccessGate) refreshArtwork(id string, r *artworkRefresher) {
	for {
		select {
		case <-r.stopCh:
			return
		case <-r.refreshCh:
		}
		g.mu.Lock()
		if g.refreshers[id] != r {
			g.mu.Unlock()
			return
		}
		seq, ro := r.targetSeq, g.isReadonlyLocked(id)
		reason := "locked"
		if !g.known {
			reason = "checking"
		} else if ro {
			reason = "processing"
		}
		instances := g.instancesLocked(id)
		g.mu.Unlock()
		var err error
		for _, inst := range instances {
			ctx, cancel := context.WithTimeout(r.ctx, 3*time.Second)
			e := inst.SetReadonly(ctx, seq, ro, reason)
			cancel()
			err = errors.Join(err, e)
		}
		g.mu.Lock()
		r.appliedSeq, r.appliedErr = seq, err
		r.appliedCond.Broadcast()
		g.mu.Unlock()
	}
}

func (g *CanvasAccessGate) WaitApplied(ctx context.Context, seq uint64, id string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	for {
		r := g.refreshers[id]
		if r == nil {
			return nil
		}
		if r.appliedSeq >= seq {
			return r.appliedErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		stop := context.AfterFunc(ctx, func() { g.mu.Lock(); r.appliedCond.Broadcast(); g.mu.Unlock() })
		r.appliedCond.Wait()
		stop()
	}
}

func (g *CanvasAccessGate) Unregister(inst CanvasInstance) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.instances, inst)
	id := inst.ArtworkID()
	if r := g.refreshers[id]; r != nil && len(g.instancesLocked(id)) == 0 {
		delete(g.refreshers, id)
		r.cancel()
		close(r.stopCh)
		r.appliedCond.Broadcast()
	}
	g.signalLocked(id)
}

func (g *CanvasAccessGate) Disconnected() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.known {
		return
	}
	g.known = false
	clear(g.permits)
	g.signalLocked("")
}

func (g *CanvasAccessGate) AcquireCloseFreeze(id, owner string) (string, bool, uint64, func()) {
	g.mu.Lock()
	defer g.mu.Unlock()
	writable := !g.isReadonlyLocked(id) || g.allowedLocked(id, g.closeFreezes[id][owner])
	p := randomHexToken(16)
	if g.closeFreezes[id] == nil {
		g.closeFreezes[id] = map[string]string{}
	}
	g.closeFreezes[id][owner] = p
	return p, writable, g.signalLocked(id), func() {
		g.mu.Lock()
		defer g.mu.Unlock()
		if g.closeFreezes[id][owner] == p {
			g.releaseLocked(id, owner)
		}
	}
}

func (g *CanvasAccessGate) releaseLocked(id, owner string) {
	delete(g.closeFreezes[id], owner)
	if len(g.closeFreezes[id]) == 0 {
		delete(g.closeFreezes, id)
	}
	g.signalLocked(id)
	g.notifyWritableLocked(id)
}

func (g *CanvasAccessGate) notifyWritableLocked(id string) {
	if g.onWritable != nil && !g.isReadonlyLocked(id) {
		go g.onWritable(id)
	}
}

func (g *CanvasAccessGate) ReleaseCloseFreezeByOwner(owner string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for id, m := range g.closeFreezes {
		if _, ok := m[owner]; ok {
			g.releaseLocked(id, owner)
		}
	}
}

func (g *CanvasAccessGate) allowedLocked(id, permit string) bool {
	if !g.known || g.updating || (g.owns != nil && !g.owns()) {
		return false
	}
	if permit == "" {
		return !g.isReadonlyLocked(id)
	}
	st, active := g.active[id]
	if g.permits[id] == permit {
		return !active || st.Preparing
	}
	for _, p := range g.closeFreezes[id] {
		if p == permit {
			return !active
		}
	}
	return false
}

func (g *CanvasAccessGate) IsWriteAllowed(id, permit string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.allowedLocked(id, permit)
}

func (g *CanvasAccessGate) UpdateFromDaemon(
	states []DesignCanvasState,
	beforeRelease func(artworkID string) error,
	emit ...func(DesignCanvasReport),
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
	changed := !g.known || !maps.Equal(g.active, next)
	g.daemonTurns = make(map[string]string, len(states))
	for _, st := range states {
		g.daemonTurns[st.ArtworkID] = st.TurnID
	}
	g.active = next
	g.known = true
	if changed {
		g.signalLocked("")
	}
	g.mu.Unlock()

	var reports []DesignCanvasReport
	live := make(map[string]struct{}, len(states))
	for _, st := range states {
		live[st.TurnID] = struct{}{}
		if !st.Preparing {
			continue
		}
		g.mu.Lock()
		_, already := g.inFlightPrepare[st.TurnID]
		if !already {
			g.inFlightPrepare[st.TurnID] = struct{}{}
		}
		g.mu.Unlock()
		if already {
			continue
		}
		prepare := func() DesignCanvasReport {
			err := g.Flush(st.ArtworkID)
			r := DesignCanvasReport{ArtworkID: st.ArtworkID, TurnID: st.TurnID, OK: err == nil}
			if err != nil {
				r.Error = err.Error()
				if len(r.Error) > 500 {
					r.Error = r.Error[:500]
				}
			}
			return r
		}
		if len(emit) > 0 {
			go func() { emit[0](prepare()) }()
		} else {
			reports = append(reports, prepare())
		}
	}

	g.mu.Lock()
	for turnID := range g.inFlightPrepare {
		if _, ok := live[turnID]; !ok {
			delete(g.inFlightPrepare, turnID)
		}
	}
	g.mu.Unlock()
	return reports
}

func (g *CanvasAccessGate) Flush(artworkID string) error {
	permit := randomHexToken(16)
	g.mu.Lock()
	if !g.known || g.updating || g.permits[artworkID] != "" || (g.owns != nil && !g.owns()) {
		g.mu.Unlock()
		return ErrCanvasReadOnly
	}
	g.permits[artworkID] = permit
	seq := g.signalLocked(artworkID)
	g.mu.Unlock()

	defer func() {
		g.mu.Lock()
		if g.permits[artworkID] == permit {
			delete(g.permits, artworkID)
			g.notifyWritableLocked(artworkID)
		}
		g.signalLocked(artworkID)
		g.mu.Unlock()
	}()

	return g.flushInstances(context.Background(), artworkID, permit, seq)
}

func (g *CanvasAccessGate) flushInstances(ctx context.Context, artworkID, permit string, seq uint64) error {
	g.mu.Lock()
	flights := maps.Clone(g.inFlight[artworkID])
	g.mu.Unlock()
	if err := g.WaitApplied(ctx, seq, artworkID); err != nil {
		return err
	}
	for done := range flights {
		<-done
	}
	g.mu.Lock()
	instances := g.instancesLocked(artworkID)
	g.mu.Unlock()
	for _, inst := range instances {
		if inst.ArtworkID() != artworkID {
			continue
		}
		if err := inst.Flush(permit); err != nil {
			g.mu.Lock()
			_, live := g.instances[inst]
			g.mu.Unlock()
			if live {
				return err
			}
		}
	}
	return nil
}

func (g *CanvasAccessGate) PrepareForSend(artworkID string) error {
	g.mu.Lock()
	if g.updating || (g.owns != nil && !g.owns()) {
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
	if !g.allowedLocked(artworkID, permit) {
		g.mu.Unlock()
		return ErrCanvasReadOnly
	}
	done := make(chan struct{})
	if g.inFlight[artworkID] == nil {
		g.inFlight[artworkID] = map[chan struct{}]struct{}{}
	}
	g.inFlight[artworkID][done] = struct{}{}
	g.mu.Unlock()
	defer func() {
		g.mu.Lock()
		delete(g.inFlight[artworkID], done)
		if len(g.inFlight[artworkID]) == 0 {
			delete(g.inFlight, artworkID)
		}
		close(done)
		g.mu.Unlock()
	}()
	return action()
}

const workerFrameLimit = 68 << 20

type DesignWorkerError struct {
	Message    string
	Code       string
	RevisionID string
}

func (e *DesignWorkerError) Error() string { return e.Message }

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
	stderr       io.Writer
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
	cmd.Env = scrubSensitiveChildEnv(os.Environ())
	if w.dataDir != "" {
		cmd.Env = append(cmd.Env, "MOLLY_DATA_DIR="+w.dataDir, "MOLLY_ISOLATED_DATA_ROOT_STRICT=1")
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
	cmd.Stderr = w.stderr
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
		scanner.Buffer(make([]byte, 64*1024), workerFrameLimit+1)
		for scanner.Scan() {
			var resp struct {
				OK         bool            `json:"ok"`
				Value      json.RawMessage `json:"value"`
				Error      string          `json:"error"`
				Code       string          `json:"code"`
				RevisionID string          `json:"revisionId"`
			}
			if unmarshalErr := json.Unmarshal(scanner.Bytes(), &resp); unmarshalErr != nil {
				proc.lines <- workerResponse{err: fmt.Errorf("invalid design worker response: %w", unmarshalErr)}
				continue
			}
			if !resp.OK {
				proc.lines <- workerResponse{err: &DesignWorkerError{resp.Error, resp.Code, resp.RevisionID}}
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

func (w *DesignWorkerClient) Request(ctx context.Context, req any, beforeSend ...func() error) (json.RawMessage, error) {
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

	var frame bytes.Buffer
	enc := json.NewEncoder(&frame)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(req); err != nil {
		return nil, err
	}
	if frame.Len()-1 > workerFrameLimit {
		return nil, errors.New("design worker request exceeds 68 MiB")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	for _, check := range beforeSend {
		if check != nil {
			if err := check(); err != nil {
				return nil, err
			}
		}
	}
	payload := frame.Bytes()
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
		var workerErr *DesignWorkerError
		if resp.err != nil && !errors.As(resp.err, &workerErr) {
			w.dropProcess(proc, true)
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
	timeout := w.drainTimeout
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	if err := w.acquireSlot(ctx); err == nil {
		defer w.releaseSlot()
		_ = proc.stdin.Close()
	} else {
		proc.kill()
	}
	killWait := w.killTimeout
	if killWait <= 0 {
		killWait = 2 * time.Second
	}
	select {
	case <-proc.exited:
		return proc.waitErr
	case <-ctx.Done():
		proc.kill()
		select {
		case <-proc.exited:
			return proc.waitErr
		case <-time.After(killWait):
			return errors.New("design worker did not exit within bounded kill timeout")
		}
	}
}
