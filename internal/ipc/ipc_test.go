package ipc

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestServerRoundTripPermissionsAndErrors(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket permission test runs on unix")
	}
	sockDir, err := os.MkdirTemp("/tmp", "mc-ipc-")
	if err != nil {
		t.Fatalf("MkdirTemp: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(sockDir) })
	socketPath := filepath.Join(sockDir, "c.sock")
	srv, err := NewServer(socketPath)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	srv.Handle("echo", func(_ context.Context, params json.RawMessage) (any, error) {
		var in struct {
			Message string `json:"message"`
		}
		if err := json.Unmarshal(params, &in); err != nil {
			return nil, &RPCError{Code: "bad_request", Message: err.Error()}
		}
		return map[string]string{"echoed": in.Message}, nil
	})

	info, err := os.Lstat(socketPath)
	if err != nil {
		t.Fatalf("Lstat socket: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("socket mode = %o, want 0600", perm)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- srv.Serve(ctx)
	}()
	waited := false
	defer func() {
		cancel()
		_ = srv.Close()
		if !waited {
			<-done
		}
	}()

	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			client, dialErr := Dial(ctx, socketPath)
			if dialErr != nil {
				t.Errorf("Dial %d: %v", idx, dialErr)
				return
			}
			defer client.Close()

			var out map[string]string
			callCtx, callCancel := context.WithTimeout(ctx, 5*time.Second)
			defer callCancel()
			if err := client.Call(callCtx, "echo", map[string]string{"message": "hello"}, &out); err != nil {
				t.Errorf("Call %d: %v", idx, err)
				return
			}
			if out["echoed"] != "hello" {
				t.Errorf("echoed = %q, want hello", out["echoed"])
			}
		}(i)
	}
	wg.Wait()

	client, err := Dial(ctx, socketPath)
	if err != nil {
		t.Fatalf("Dial error check: %v", err)
	}
	defer client.Close()

	var unused map[string]any
	err = client.Call(ctx, "does.not.exist", nil, &unused)
	var rpcErr *RPCError
	if !errors.As(err, &rpcErr) || rpcErr.Code != "method_not_found" {
		t.Fatalf("expected method_not_found RPCError, got %v", err)
	}

	oversized := strings.Repeat("a", MaxMessageBytes+16)
	if err := client.Call(ctx, "echo", map[string]string{"message": oversized}, &unused); err == nil {
		t.Fatal("expected oversized request to be rejected")
	}

	cancel()
	waited = true
	if err := <-done; err != nil {
		t.Fatalf("Serve returned error on graceful shutdown: %v", err)
	}
}

func TestMutualAuthHandshakeAndConnCancelPropagation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket test runs on unix")
	}
	sockDir, err := os.MkdirTemp("/tmp", "mc-auth-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(sockDir) })
	socketPath := filepath.Join(sockDir, "c.sock")

	const token = "mutual-auth-secret-token-0123456789"
	srv, err := NewServerWithAuth(socketPath, token)
	if err != nil {
		t.Fatalf("NewServerWithAuth: %v", err)
	}
	handlerStarted := make(chan struct{})
	handlerCancelled := make(chan struct{})
	srv.Handle("ping", func(_ context.Context, _ json.RawMessage) (any, error) {
		return map[string]bool{"pong": true}, nil
	})
	srv.Handle("block", func(ctx context.Context, _ json.RawMessage) (any, error) {
		close(handlerStarted)
		<-ctx.Done()
		close(handlerCancelled)
		return nil, ctx.Err()
	})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- srv.Serve(ctx) }()
	defer func() {
		cancel()
		_ = srv.Close()
		<-done
	}()

	if _, err := DialWithAuth(ctx, socketPath, "wrong-token"); err == nil {
		t.Fatal("expected wrong auth token to fail handshake")
	}

	unauthClient, err := Dial(ctx, socketPath)
	if err != nil {
		t.Fatalf("Dial raw: %v", err)
	}
	var unused map[string]any
	if err := unauthClient.Call(ctx, "ping", nil, &unused); err == nil {
		t.Fatal("expected unauthenticated call to be rejected")
	}
	_ = unauthClient.Close()

	authClient, err := DialWithAuth(ctx, socketPath, token)
	if err != nil {
		t.Fatalf("DialWithAuth: %v", err)
	}
	var pong map[string]bool
	if err := authClient.Call(ctx, "ping", nil, &pong); err != nil || !pong["pong"] {
		t.Fatalf("authenticated ping failed: %v %+v", err, pong)
	}

	go func() {
		var ignored map[string]any
		_ = authClient.Call(ctx, "block", nil, &ignored)
	}()
	select {
	case <-handlerStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for block handler to start")
	}
	_ = authClient.Close()
	select {
	case <-handlerCancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("expected server handler ctx to cancel immediately when client closed connection")
	}
}

func TestIPCAuthHardeningReplayTimeoutActiveSocketAndLargeResponse(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket test runs on unix")
	}
	sockDir, err := os.MkdirTemp("/tmp", "mc-hard-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(sockDir) })
	socketPath := filepath.Join(sockDir, "c.sock")

	if _, err := NewServerWithAuth(socketPath, ""); err == nil {
		t.Fatal("expected NewServerWithAuth to reject empty token")
	}

	const token = "server-challenge-secret-token-0123456789"
	srv, err := NewServerWithAuth(socketPath, token)
	if err != nil {
		t.Fatalf("NewServerWithAuth: %v", err)
	}
	srv.SetHandshakeTimeout(120 * time.Millisecond)

	largePayload := strings.Repeat("Z", 36<<20)
	srv.Handle("large", func(_ context.Context, _ json.RawMessage) (any, error) {
		return map[string]string{"blob": largePayload}, nil
	})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- srv.Serve(ctx) }()
	defer func() {
		cancel()
		_ = srv.Close()
		<-done
	}()

	if _, err := NewServerWithAuth(socketPath, token); err == nil {
		t.Fatal("expected second server bind on active socket to be refused")
	}

	conn1, err := net.Dial("unix", socketPath)
	if err != nil {
		t.Fatalf("dial conn1: %v", err)
	}
	r1 := bufio.NewReader(conn1)
	chLine1, err := readBoundedLine(r1, MaxRequestBytes)
	if err != nil {
		_ = conn1.Close()
		t.Fatalf("read challenge 1: %v", err)
	}
	var chResp1 Response
	_ = json.Unmarshal(chLine1, &chResp1)
	var ch1 challengeResult
	_ = json.Unmarshal(chResp1.Result, &ch1)
	clientNonce := "0123456789abcdef0123456789abcdef"
	helloBytes, _ := json.Marshal(Request{
		ID:     "h1",
		Method: HandshakeMethod,
		Params: func() json.RawMessage {
			b, _ := json.Marshal(helloParams{
				ClientNonce: clientNonce,
				ClientMAC:   computeHandshakeMAC(token, "client:"+ch1.ServerNonce+":"+clientNonce),
			})
			return b
		}(),
	})
	helloBytes = append(helloBytes, '\n')
	_, _ = conn1.Write(helloBytes)
	resp1Line, err := readBoundedLine(r1, MaxRequestBytes)
	_ = conn1.Close()
	if err != nil {
		t.Fatalf("read hello resp 1: %v", err)
	}
	var resp1 Response
	_ = json.Unmarshal(resp1Line, &resp1)
	if !resp1.OK {
		t.Fatalf("expected conn1 handshake to succeed, got %+v", resp1)
	}

	conn2, err := net.Dial("unix", socketPath)
	if err != nil {
		t.Fatalf("dial conn2: %v", err)
	}
	r2 := bufio.NewReader(conn2)
	_, err = readBoundedLine(r2, MaxRequestBytes)
	if err != nil {
		_ = conn2.Close()
		t.Fatalf("read challenge 2: %v", err)
	}
	_, _ = conn2.Write(helloBytes)
	resp2Line, err := readBoundedLine(r2, MaxRequestBytes)
	_ = conn2.Close()
	if err != nil {
		t.Fatalf("read replay resp 2: %v", err)
	}
	var resp2 Response
	_ = json.Unmarshal(resp2Line, &resp2)
	if resp2.OK {
		t.Fatal("expected replayed ipc.hello with stale serverNonce to fail")
	}

	idleConn, err := net.Dial("unix", socketPath)
	if err != nil {
		t.Fatalf("dial idle: %v", err)
	}
	idleReader := bufio.NewReader(idleConn)
	_, _ = readBoundedLine(idleReader, MaxRequestBytes)
	_ = idleConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := idleReader.ReadByte(); err == nil {
		_ = idleConn.Close()
		t.Fatal("expected idle unauthenticated connection to be closed after handshake timeout")
	}
	_ = idleConn.Close()

	client, err := DialWithAuth(ctx, socketPath, token)
	if err != nil {
		t.Fatalf("DialWithAuth: %v", err)
	}
	defer client.Close()
	var out map[string]string
	if err := client.Call(ctx, "large", nil, &out); err != nil {
		t.Fatalf("large response call failed: %v", err)
	}
	if len(out["blob"]) != len(largePayload) {
		t.Fatalf("large blob len = %d, want %d", len(out["blob"]), len(largePayload))
	}
}

func TestConcurrentUnixBindOnlyOneWinsAndErrorIDMismatch(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket test runs on unix")
	}
	sockDir, err := os.MkdirTemp("/tmp", "mc-race-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(sockDir) })
	socketPath := filepath.Join(sockDir, "c.sock")

	staleLn, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("create stale socket: %v", err)
	}
	if ul, ok := staleLn.(*net.UnixListener); ok {
		ul.SetUnlinkOnClose(false)
	}
	_ = staleLn.Close()

	const workers = 8
	const token = "concurrent-bind-token-0123456789abcdef"
	var mu sync.Mutex
	var winners []*Server
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			s, sErr := NewServerWithAuth(socketPath, token)
			if sErr == nil {
				mu.Lock()
				winners = append(winners, s)
				mu.Unlock()
			}
		}()
	}
	close(start)
	wg.Wait()
	if len(winners) != 1 {
		for _, w := range winners {
			_ = w.Close()
		}
		t.Fatalf("expected exactly 1 winning server across concurrent binds, got %d", len(winners))
	}
	winner := winners[0]
	winner.Handle("ping", func(_ context.Context, _ json.RawMessage) (any, error) {
		return map[string]bool{"ok": true}, nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	serveDone := make(chan error, 1)
	go func() { serveDone <- winner.Serve(ctx) }()
	defer func() {
		cancel()
		_ = winner.Close()
		<-serveDone
	}()

	c, err := DialWithAuth(ctx, socketPath, token)
	if err != nil {
		t.Fatalf("DialWithAuth winner: %v", err)
	}
	var pong map[string]bool
	if err := c.Call(ctx, "ping", nil, &pong); err != nil || !pong["ok"] {
		t.Fatalf("ping winner failed: %v %+v", err, pong)
	}
	_ = c.Close()

	spoofPath := filepath.Join(sockDir, "spoof.sock")
	spoofLn, err := net.Listen("unix", spoofPath)
	if err != nil {
		t.Fatalf("listen spoof: %v", err)
	}
	defer spoofLn.Close()
	go func() {
		conn, acceptErr := spoofLn.Accept()
		if acceptErr != nil {
			return
		}
		defer conn.Close()
		_, _ = readBoundedLine(bufio.NewReader(conn), MaxRequestBytes)
		_, _ = conn.Write([]byte(`{"id":"wrong-id","ok":false,"error":{"code":"unauthorized","message":"spoofed"}}` + "\n"))
	}()

	spoofClient, err := Dial(ctx, spoofPath)
	if err != nil {
		t.Fatalf("dial spoof: %v", err)
	}
	defer spoofClient.Close()
	var ignored map[string]any
	err = spoofClient.Call(ctx, "ping", nil, &ignored)
	var rpcErr *RPCError
	if err == nil || errors.As(err, &rpcErr) || !strings.Contains(err.Error(), "id mismatch") {
		t.Fatalf("expected non-RPC id mismatch error on mismatched error frame, got %v", err)
	}
}
