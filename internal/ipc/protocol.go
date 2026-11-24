package ipc

import (
	"bufio"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"time"
)

const (
	MaxRequestBytes    = 32 << 20
	MaxResponseBytes   = 96 << 20
	MaxMessageBytes    = MaxRequestBytes
	MaxConcurrentConns = 64
	ChallengeMethod    = "ipc.challenge"
	HandshakeMethod    = "ipc.hello"
	HandshakeTimeout   = 5 * time.Second
)

type Request struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params,omitempty"`
}

type RPCError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *RPCError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("%s: %s", e.Code, e.Message)
	}
	return e.Message
}

type Response struct {
	ID     string          `json:"id"`
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *RPCError       `json:"error,omitempty"`
}

type challengeResult struct {
	ServerNonce string `json:"serverNonce"`
}

type helloParams struct {
	ClientNonce string `json:"clientNonce"`
	ClientMAC   string `json:"clientMac"`
}

type helloResult struct {
	ServerMAC string `json:"serverMac"`
}

type HandlerFunc func(ctx context.Context, params json.RawMessage) (any, error)

type Server struct {
	addr             string
	authToken        string
	handshakeTimeout time.Duration
	listener         net.Listener
	mu               sync.RWMutex
	handlers         map[string]HandlerFunc
	conns            map[net.Conn]struct{}
	connSem          chan struct{}
	closed           chan struct{}
	once             sync.Once
	wg               sync.WaitGroup
}

func DialLocal(ctx context.Context, endpoint string) (net.Conn, error) {
	return dialLocal(ctx, endpoint)
}

func NewServer(address string) (*Server, error) {
	return newServer(address, "")
}

func NewServerWithAuth(address string, authToken string) (*Server, error) {
	if authToken == "" {
		return nil, errors.New("ipc auth token must not be empty")
	}
	return newServer(address, authToken)
}

func newServer(address string, authToken string) (*Server, error) {
	ln, err := listenLocal(address)
	if err != nil {
		return nil, err
	}
	return &Server{
		addr:             address,
		authToken:        authToken,
		handshakeTimeout: HandshakeTimeout,
		listener:         ln,
		handlers:         make(map[string]HandlerFunc),
		conns:            make(map[net.Conn]struct{}),
		connSem:          make(chan struct{}, MaxConcurrentConns),
		closed:           make(chan struct{}),
	}, nil
}

func (s *Server) RequiresAuth() bool {
	return s.authToken != ""
}

func (s *Server) SetHandshakeTimeout(d time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if d > 0 {
		s.handshakeTimeout = d
	}
}

func (s *Server) Addr() string {
	return s.addr
}

func (s *Server) Handle(method string, fn HandlerFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.handlers[method] = fn
}

func (s *Server) Serve(ctx context.Context) error {
	go func() {
		select {
		case <-ctx.Done():
			_ = s.Close()
		case <-s.closed:
		}
	}()

	for {
		conn, err := s.listener.Accept()
		if err != nil {
			select {
			case <-s.closed:
				s.wg.Wait()
				return nil
			default:
				if errors.Is(err, net.ErrClosed) {
					s.wg.Wait()
					return nil
				}
				return err
			}
		}
		if err := verifyPeer(conn); err != nil {
			_ = conn.Close()
			continue
		}
		select {
		case s.connSem <- struct{}{}:
		default:
			_ = conn.Close()
			continue
		}
		s.mu.Lock()
		s.conns[conn] = struct{}{}
		s.mu.Unlock()
		s.wg.Add(1)
		go func(c net.Conn) {
			defer s.wg.Done()
			defer func() { <-s.connSem }()
			defer func() {
				s.mu.Lock()
				delete(s.conns, c)
				s.mu.Unlock()
				_ = c.Close()
			}()
			s.serveConn(ctx, c)
		}(conn)
	}
}

func (s *Server) Close() error {
	var closeErr error
	s.once.Do(func() {
		close(s.closed)
		closeErr = s.listener.Close()
		s.mu.Lock()
		for c := range s.conns {
			_ = c.Close()
		}
		s.mu.Unlock()
	})
	return closeErr
}

func (s *Server) serveConn(parentCtx context.Context, conn net.Conn) {
	connCtx, connCancel := context.WithCancel(parentCtx)
	defer connCancel()

	reader := bufio.NewReader(conn)
	var writeMu sync.Mutex
	authenticated := s.authToken == ""
	serverNonce := ""

	if !authenticated {
		var nonceBytes [16]byte
		if _, err := rand.Read(nonceBytes[:]); err != nil {
			return
		}
		serverNonce = hex.EncodeToString(nonceBytes[:])
		s.mu.RLock()
		hsTimeout := s.handshakeTimeout
		s.mu.RUnlock()
		if hsTimeout <= 0 {
			hsTimeout = HandshakeTimeout
		}
		_ = conn.SetDeadline(time.Now().Add(hsTimeout))
		encodedChallenge, _ := json.Marshal(challengeResult{ServerNonce: serverNonce})
		if err := writeFrame(conn, &writeMu, Response{
			ID:     ChallengeMethod,
			OK:     true,
			Result: encodedChallenge,
		}); err != nil {
			return
		}
	}

	type readResult struct {
		line []byte
		err  error
	}
	readCh := make(chan readResult, 1)
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		for {
			line, err := readBoundedLine(reader, MaxRequestBytes)
			if err != nil {
				if errors.Is(err, io.EOF) || errors.Is(err, net.ErrClosed) {
					connCancel()
					return
				}
				select {
				case readCh <- readResult{err: err}:
				case <-connCtx.Done():
				}
				connCancel()
				return
			}
			select {
			case readCh <- readResult{line: line}:
			case <-connCtx.Done():
				return
			}
		}
	}()
	defer func() {
		connCancel()
		_ = conn.Close()
		<-readDone
	}()

	for {
		select {
		case <-connCtx.Done():
			return
		case res := <-readCh:
			if res.err != nil {
				var netErr net.Error
				if errors.As(res.err, &netErr) && netErr.Timeout() {
					return
				}
				resp := Response{
					OK: false,
					Error: &RPCError{
						Code:    "invalid_frame",
						Message: res.err.Error(),
					},
				}
				_ = writeFrame(conn, &writeMu, resp)
				return
			}
			if len(res.line) == 0 {
				continue
			}
			var req Request
			if err := json.Unmarshal(res.line, &req); err != nil {
				resp := Response{
					OK: false,
					Error: &RPCError{
						Code:    "invalid_json",
						Message: "invalid JSON request",
					},
				}
				if writeErr := writeFrame(conn, &writeMu, resp); writeErr != nil {
					return
				}
				continue
			}

			if req.Method == HandshakeMethod {
				resp, ok := s.handleHandshake(req, serverNonce)
				if writeErr := writeFrame(conn, &writeMu, resp); writeErr != nil {
					return
				}
				if !ok {
					return
				}
				authenticated = true
				_ = conn.SetDeadline(noDeadline)
				continue
			}
			if !authenticated {
				resp := Response{
					ID: req.ID,
					OK: false,
					Error: &RPCError{
						Code:    "unauthorized",
						Message: "ipc mutual authentication handshake required",
					},
				}
				_ = writeFrame(conn, &writeMu, resp)
				return
			}

			resp := s.dispatch(connCtx, req)
			if connCtx.Err() != nil {
				return
			}
			if err := writeFrame(conn, &writeMu, resp); err != nil {
				return
			}
		}
	}
}

func (s *Server) handleHandshake(req Request, serverNonce string) (Response, bool) {
	if s.authToken == "" {
		encoded, _ := json.Marshal(helloResult{ServerMAC: ""})
		return Response{ID: req.ID, OK: true, Result: encoded}, true
	}
	var in helloParams
	if err := json.Unmarshal(req.Params, &in); err != nil || len(in.ClientNonce) < 16 || len(serverNonce) < 16 {
		return Response{
			ID: req.ID,
			OK: false,
			Error: &RPCError{
				Code:    "unauthorized",
				Message: "invalid ipc handshake payload",
			},
		}, false
	}
	expectedClientMAC := computeHandshakeMAC(s.authToken, "client:"+serverNonce+":"+in.ClientNonce)
	if !hmac.Equal([]byte(in.ClientMAC), []byte(expectedClientMAC)) {
		return Response{
			ID: req.ID,
			OK: false,
			Error: &RPCError{
				Code:    "unauthorized",
				Message: "ipc client authentication failed",
			},
		}, false
	}
	serverMAC := computeHandshakeMAC(s.authToken, "server:"+in.ClientNonce+":"+serverNonce)
	encoded, _ := json.Marshal(helloResult{ServerMAC: serverMAC})
	return Response{ID: req.ID, OK: true, Result: encoded}, true
}

func (s *Server) dispatch(ctx context.Context, req Request) Response {
	s.mu.RLock()
	fn, ok := s.handlers[req.Method]
	s.mu.RUnlock()
	if !ok {
		return Response{
			ID: req.ID,
			OK: false,
			Error: &RPCError{
				Code:    "method_not_found",
				Message: fmt.Sprintf("unknown method: %s", req.Method),
			},
		}
	}
	res, err := fn(ctx, req.Params)
	if err != nil {
		var rpcErr *RPCError
		if !errors.As(err, &rpcErr) {
			rpcErr = &RPCError{Code: "internal_error", Message: err.Error()}
		}
		return Response{
			ID:    req.ID,
			OK:    false,
			Error: rpcErr,
		}
	}
	encoded, err := json.Marshal(res)
	if err != nil {
		return Response{
			ID: req.ID,
			OK: false,
			Error: &RPCError{
				Code:    "encode_error",
				Message: err.Error(),
			},
		}
	}
	return Response{
		ID:     req.ID,
		OK:     true,
		Result: encoded,
	}
}

type Client struct {
	conn   net.Conn
	reader *bufio.Reader
	mu     sync.Mutex
	nextID int64
}

func Dial(ctx context.Context, address string) (*Client, error) {
	return DialWithAuth(ctx, address, "")
}

func DialWithAuth(ctx context.Context, address string, authToken string) (*Client, error) {
	conn, err := dialLocal(ctx, address)
	if err != nil {
		return nil, err
	}
	client := &Client{
		conn:   conn,
		reader: bufio.NewReader(conn),
	}
	if authToken != "" {
		hsCtx, cancel := context.WithTimeout(ctx, HandshakeTimeout)
		defer cancel()
		if err := client.authenticate(hsCtx, authToken); err != nil {
			_ = client.Close()
			return nil, err
		}
	}
	return client, nil
}

func (c *Client) authenticate(ctx context.Context, authToken string) error {
	if deadline, ok := ctx.Deadline(); ok {
		_ = c.conn.SetDeadline(deadline)
		defer func() { _ = c.conn.SetDeadline(noDeadline) }()
	}
	challengeLine, err := readBoundedLine(c.reader, MaxRequestBytes)
	if err != nil {
		return fmt.Errorf("read ipc challenge: %w", err)
	}
	var challengeResp Response
	if err := json.Unmarshal(challengeLine, &challengeResp); err != nil || !challengeResp.OK || challengeResp.ID != ChallengeMethod {
		return errors.New("invalid ipc server challenge")
	}
	var ch challengeResult
	if err := json.Unmarshal(challengeResp.Result, &ch); err != nil || len(ch.ServerNonce) < 16 {
		return errors.New("invalid ipc server nonce")
	}

	var nonceBytes [16]byte
	if _, err := rand.Read(nonceBytes[:]); err != nil {
		return err
	}
	nonce := hex.EncodeToString(nonceBytes[:])
	var res helloResult
	if err := c.Call(ctx, HandshakeMethod, helloParams{
		ClientNonce: nonce,
		ClientMAC:   computeHandshakeMAC(authToken, "client:"+ch.ServerNonce+":"+nonce),
	}, &res); err != nil {
		return fmt.Errorf("ipc handshake failed: %w", err)
	}
	expectedServerMAC := computeHandshakeMAC(authToken, "server:"+nonce+":"+ch.ServerNonce)
	if !hmac.Equal([]byte(res.ServerMAC), []byte(expectedServerMAC)) {
		return errors.New("ipc server identity verification failed")
	}
	return nil
}

func (c *Client) Close() error {
	return c.conn.Close()
}

func (c *Client) Call(ctx context.Context, method string, params any, out any) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if deadline, ok := ctx.Deadline(); ok {
		_ = c.conn.SetDeadline(deadline)
		defer func() { _ = c.conn.SetDeadline(noDeadline) }()
	}

	c.nextID++
	req := Request{
		ID:     fmt.Sprintf("%d", c.nextID),
		Method: method,
	}
	if params != nil {
		raw, err := json.Marshal(params)
		if err != nil {
			return fmt.Errorf("marshal params: %w", err)
		}
		req.Params = raw
	}
	line, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}
	if len(line) > MaxRequestBytes {
		return fmt.Errorf("request exceeds maximum message size (%d bytes)", MaxRequestBytes)
	}
	line = append(line, '\n')
	if _, err := c.conn.Write(line); err != nil {
		return err
	}

	respLine, err := readBoundedLine(c.reader, MaxResponseBytes)
	if err != nil {
		return err
	}
	var resp Response
	if err := json.Unmarshal(respLine, &resp); err != nil {
		return fmt.Errorf("unmarshal response: %w", err)
	}
	if resp.ID != req.ID {
		if !resp.OK && resp.ID == "" && resp.Error != nil && (resp.Error.Code == "invalid_frame" || resp.Error.Code == "invalid_json") {
			return resp.Error
		}
		return fmt.Errorf("ipc response id mismatch: got %q, want %q", resp.ID, req.ID)
	}
	if !resp.OK {
		if resp.Error != nil {
			return resp.Error
		}
		return errors.New("ipc call failed")
	}
	if out != nil && len(resp.Result) > 0 {
		if err := json.Unmarshal(resp.Result, out); err != nil {
			return fmt.Errorf("unmarshal result: %w", err)
		}
	}
	return nil
}

func computeHandshakeMAC(token string, msg string) string {
	m := hmac.New(sha256.New, []byte(token))
	_, _ = m.Write([]byte(msg))
	return hex.EncodeToString(m.Sum(nil))
}

func readBoundedLine(r *bufio.Reader, maxBytes int) ([]byte, error) {
	var buf []byte
	for {
		chunk, err := r.ReadSlice('\n')
		if len(buf)+len(chunk) > maxBytes+1 {
			return nil, fmt.Errorf("message exceeds %d bytes", maxBytes)
		}
		buf = append(buf, chunk...)
		if err == nil {
			if len(buf) > 0 && buf[len(buf)-1] == '\n' {
				buf = buf[:len(buf)-1]
			}
			if len(buf) > 0 && buf[len(buf)-1] == '\r' {
				buf = buf[:len(buf)-1]
			}
			if len(buf) > maxBytes {
				return nil, fmt.Errorf("message exceeds %d bytes", maxBytes)
			}
			return buf, nil
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if errors.Is(err, io.EOF) && len(buf) > 0 {
			return buf, nil
		}
		return nil, err
	}
}

func writeFrame(w io.Writer, mu *sync.Mutex, resp Response) error {
	payload, err := json.Marshal(resp)
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	mu.Lock()
	defer mu.Unlock()
	_, err = w.Write(payload)
	return err
}
