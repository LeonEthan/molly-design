package shell

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"sync"
	"time"

	"github.com/LeonEthan/molly-design/internal/ipc"
)

const (
	LoroProtocolVersion      = 7
	LoroMaxFrameBytes        = 32 * 1024 * 1024
	LoroMaxPendingQueueBytes = 64 * 1024 * 1024
	LoroDefaultPingInterval  = 15 * time.Second
	LoroDefaultIdleTimeout   = 45 * time.Second
	LoroDefaultRedialMin     = 1 * time.Second
	LoroDefaultRedialMax     = 30 * time.Second
)

type LoroRelayConfig struct {
	SocketPath    string
	Dial          func(ctx context.Context, addr string) (net.Conn, error)
	PingInterval  time.Duration
	IdleTimeout   time.Duration
	RedialMin     time.Duration
	RedialMax     time.Duration
	MaxFrameBytes int
	MaxQueueBytes int
	OnEvent       func(raw json.RawMessage)
	OnStatus      func(connected bool)
}

type queuedLoroFrame struct {
	senderID string
	isDetach bool
	data     []byte
}

type LoroRelay struct {
	cfg LoroRelayConfig

	mu            sync.Mutex
	conn          net.Conn
	connGen       uint64
	connected     bool
	closed        bool
	autoRedial    bool
	redialAttempt int
	redialTimer   *time.Timer
	cancelConn    context.CancelFunc
	lastInboundAt time.Time
	queue         []queuedLoroFrame
	queueBytes    int
	writeWake     chan struct{}
	senderPeers   map[string]map[string]string
	wg            sync.WaitGroup
	redialWg      sync.WaitGroup
}

func NewLoroRelay(cfg LoroRelayConfig) *LoroRelay {
	if cfg.PingInterval <= 0 {
		cfg.PingInterval = LoroDefaultPingInterval
	}
	if cfg.IdleTimeout <= 0 {
		cfg.IdleTimeout = LoroDefaultIdleTimeout
	}
	if cfg.RedialMin <= 0 {
		cfg.RedialMin = LoroDefaultRedialMin
	}
	if cfg.RedialMax <= 0 {
		cfg.RedialMax = LoroDefaultRedialMax
	}
	if cfg.MaxFrameBytes <= 0 {
		cfg.MaxFrameBytes = LoroMaxFrameBytes
	}
	if cfg.MaxQueueBytes <= 0 {
		cfg.MaxQueueBytes = LoroMaxPendingQueueBytes
	}
	if cfg.Dial == nil {
		cfg.Dial = func(ctx context.Context, addr string) (net.Conn, error) {
			return ipc.DialLocal(ctx, addr)
		}
	}
	return &LoroRelay{
		cfg:         cfg,
		writeWake:   make(chan struct{}, 1),
		senderPeers: make(map[string]map[string]string),
	}
}

func (r *LoroRelay) IsConnected() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.connected
}

func (r *LoroRelay) ConnectionGeneration() uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.connGen
}

func (r *LoroRelay) Connect(ctx context.Context) error {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return errors.New("loro relay closed")
	}
	r.autoRedial = true
	if r.conn != nil {
		r.mu.Unlock()
		return nil
	}
	r.mu.Unlock()

	conn, err := r.cfg.Dial(ctx, r.cfg.SocketPath)
	if err != nil {
		r.scheduleRedial()
		return err
	}

	connCtx, cancel := context.WithCancel(context.Background())
	r.mu.Lock()
	if r.closed || r.conn != nil {
		r.mu.Unlock()
		cancel()
		_ = conn.Close()
		return nil
	}
	r.conn = conn
	r.connGen++
	gen := r.connGen
	r.connected = true
	r.redialAttempt = 0
	if r.redialTimer != nil {
		if r.redialTimer.Stop() {
			r.redialWg.Done()
		}
		r.redialTimer = nil
	}
	r.cancelConn = cancel
	r.lastInboundAt = time.Now()
	r.mu.Unlock()

	if r.cfg.OnStatus != nil {
		r.cfg.OnStatus(true)
	}

	r.wg.Add(3)
	go r.readLoop(connCtx, conn, gen)
	go r.writeLoop(connCtx, conn, gen)
	go r.pingLoop(connCtx, conn, gen)
	return nil
}

func (r *LoroRelay) scheduleRedial() {
	r.mu.Lock()
	if r.closed || !r.autoRedial || r.conn != nil || r.redialTimer != nil {
		r.mu.Unlock()
		return
	}
	delay := r.cfg.RedialMin
	for i := 0; i < r.redialAttempt && delay < r.cfg.RedialMax; i++ {
		delay *= 2
	}
	if delay > r.cfg.RedialMax {
		delay = r.cfg.RedialMax
	}
	r.redialAttempt++
	r.redialWg.Add(1)
	var timer *time.Timer
	timer = time.AfterFunc(delay, func() {
		defer r.redialWg.Done()
		r.mu.Lock()
		if r.redialTimer == timer {
			r.redialTimer = nil
		}
		closed := r.closed
		r.mu.Unlock()
		if closed {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = r.Connect(ctx)
	})
	r.redialTimer = timer
	r.mu.Unlock()
}

func (r *LoroRelay) Send(senderID string, payload json.RawMessage) error {
	if len(payload) > r.cfg.MaxFrameBytes {
		return errors.New("loro outbound frame exceeds maximum frame size")
	}
	var meta struct {
		Type        string `json:"type"`
		PeerID      string `json:"peerId"`
		WorkspaceID string `json:"workspaceId"`
	}
	if err := json.Unmarshal(payload, &meta); err != nil {
		return err
	}

	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return errors.New("loro relay closed")
	}
	if !r.connected {
		r.mu.Unlock()
		return nil
	}
	if senderID != "" && meta.Type != "ping" && meta.PeerID != "" {
		peers := r.senderPeers[senderID]
		if peers == nil {
			peers = make(map[string]string)
			r.senderPeers[senderID] = peers
		}
		if meta.Type == "detach" {
			delete(peers, meta.PeerID)
		} else if meta.WorkspaceID != "" {
			peers[meta.PeerID] = meta.WorkspaceID
		}
	}
	err, dropConn := r.enqueueFrameLocked(senderID, meta.Type == "detach", payload)
	r.mu.Unlock()

	if dropConn != nil {
		r.dropConnection(dropConn)
	}
	return err
}

func (r *LoroRelay) ReleaseSender(senderID string) {
	r.mu.Lock()
	peers := r.senderPeers[senderID]
	delete(r.senderPeers, senderID)
	if senderID != "" && len(r.queue) > 0 {
		kept := r.queue[:0]
		newBytes := 0
		for _, item := range r.queue {
			if item.senderID == senderID && !item.isDetach {
				continue
			}
			kept = append(kept, item)
			newBytes += len(item.data)
		}
		r.queue = kept
		r.queueBytes = newBytes
	}
	connected := r.connected
	var dropConn net.Conn
	if connected && len(peers) > 0 {
		for peerID, workspaceID := range peers {
			frame, err := json.Marshal(map[string]any{
				"type":            "detach",
				"protocolVersion": LoroProtocolVersion,
				"workspaceId":     workspaceID,
				"peerId":          peerID,
			})
			if err == nil {
				_, c := r.enqueueFrameLocked("", true, frame)
				if c != nil {
					dropConn = c
					break
				}
			}
		}
	}
	r.mu.Unlock()

	if dropConn != nil {
		r.dropConnection(dropConn)
	}
}

func (r *LoroRelay) enqueueFrame(payload []byte) error {
	if len(payload) > r.cfg.MaxFrameBytes {
		return errors.New("loro outbound frame exceeds maximum frame size")
	}
	r.mu.Lock()
	if !r.connected {
		r.mu.Unlock()
		return nil
	}
	err, dropConn := r.enqueueFrameLocked("", false, payload)
	r.mu.Unlock()
	if dropConn != nil {
		r.dropConnection(dropConn)
	}
	return err
}

func (r *LoroRelay) enqueueFrameLocked(senderID string, isDetach bool, payload []byte) (error, net.Conn) {
	if r.closed {
		return errors.New("loro relay closed"), nil
	}
	frameLen := len(payload) + 1
	if r.queueBytes+frameLen > r.cfg.MaxQueueBytes {
		conn := r.conn
		r.queue = nil
		r.queueBytes = 0
		return errors.New("loro outbound queue exceeded 64 MiB limit; reconnecting"), conn
	}
	frame := make([]byte, frameLen)
	copy(frame, payload)
	frame[len(payload)] = '\n'
	r.queue = append(r.queue, queuedLoroFrame{senderID: senderID, isDetach: isDetach, data: frame})
	r.queueBytes += frameLen

	select {
	case r.writeWake <- struct{}{}:
	default:
	}
	return nil, nil
}

func (r *LoroRelay) readLoop(ctx context.Context, conn net.Conn, gen uint64) {
	defer r.wg.Done()
	defer r.dropConnection(conn)

	reader := bufio.NewReaderSize(conn, 64*1024)
	var lineBuf []byte
	discarding := false

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		frag, isPrefix, err := reader.ReadLine()
		if err != nil {
			return
		}
		r.mu.Lock()
		if r.connGen == gen {
			r.lastInboundAt = time.Now()
		}
		r.mu.Unlock()

		if discarding {
			if !isPrefix {
				discarding = false
			}
			continue
		}
		if len(lineBuf)+len(frag) > r.cfg.MaxFrameBytes {
			lineBuf = lineBuf[:0]
			if isPrefix {
				discarding = true
			}
			continue
		}
		lineBuf = append(lineBuf, frag...)
		if isPrefix {
			continue
		}
		if len(lineBuf) > 0 {
			frame := append(json.RawMessage(nil), lineBuf...)
			lineBuf = lineBuf[:0]
			var kind struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(frame, &kind) == nil && kind.Type != "pong" && r.cfg.OnEvent != nil {
				r.cfg.OnEvent(frame)
			}
		}
	}
}

func (r *LoroRelay) writeLoop(ctx context.Context, conn net.Conn, gen uint64) {
	defer r.wg.Done()
	for {
		r.mu.Lock()
		if r.conn != conn || r.connGen != gen {
			r.mu.Unlock()
			return
		}
		if len(r.queue) == 0 {
			r.mu.Unlock()
			select {
			case <-ctx.Done():
				return
			case <-r.writeWake:
				continue
			}
		}
		item := r.queue[0]
		r.queue = r.queue[1:]
		r.queueBytes -= len(item.data)
		r.mu.Unlock()

		if _, err := conn.Write(item.data); err != nil {
			r.dropConnection(conn)
			return
		}
	}
}

func (r *LoroRelay) pingLoop(ctx context.Context, conn net.Conn, gen uint64) {
	defer r.wg.Done()
	ticker := time.NewTicker(r.cfg.PingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.mu.Lock()
			if r.conn != conn || r.connGen != gen {
				r.mu.Unlock()
				return
			}
			idle := time.Since(r.lastInboundAt)
			r.mu.Unlock()
			if idle > r.cfg.IdleTimeout {
				r.dropConnection(conn)
				return
			}
			pingFrame, _ := json.Marshal(map[string]any{
				"type":            "ping",
				"protocolVersion": LoroProtocolVersion,
			})
			_ = r.enqueueFrame(pingFrame)
		}
	}
}

func (r *LoroRelay) dropConnection(conn net.Conn) {
	r.mu.Lock()
	if r.conn != conn {
		r.mu.Unlock()
		return
	}
	cancel := r.cancelConn
	r.conn = nil
	r.cancelConn = nil
	wasConnected := r.connected
	r.connected = false
	r.queue = nil
	r.queueBytes = 0
	shouldRedial := !r.closed && r.autoRedial
	r.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	_ = conn.Close()
	if wasConnected && r.cfg.OnStatus != nil {
		r.cfg.OnStatus(false)
	}
	if shouldRedial {
		r.scheduleRedial()
	}
}

func (r *LoroRelay) Close() error {
	r.mu.Lock()
	r.closed = true
	r.autoRedial = false
	if r.redialTimer != nil {
		if r.redialTimer.Stop() {
			r.redialWg.Done()
		}
		r.redialTimer = nil
	}
	conn := r.conn
	r.mu.Unlock()
	if conn != nil {
		r.dropConnection(conn)
	}
	r.redialWg.Wait()
	r.wg.Wait()
	return nil
}

func (r *LoroRelay) PendingBytes() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.queueBytes
}

var _ io.Closer = (*LoroRelay)(nil)
