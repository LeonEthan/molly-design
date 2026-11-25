package shell

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/LeonEthan/molly-design/internal/security"
)

type fakeCanvasInstance struct {
	id         string
	mu         sync.Mutex
	readonly   bool
	reason     string
	flushCalls int
	onFlush    func(permit string) error
}

func (f *fakeCanvasInstance) ArtworkID() string { return f.id }

func (f *fakeCanvasInstance) SetReadonly(_ context.Context, _ uint64, ro bool, reason string) error {
	f.mu.Lock()
	f.readonly = ro
	f.reason = reason
	f.mu.Unlock()
	return nil
}

func (f *fakeCanvasInstance) Flush(permit string) error {
	f.mu.Lock()
	f.flushCalls++
	fn := f.onFlush
	f.mu.Unlock()
	if fn != nil {
		return fn(permit)
	}
	return nil
}

func TestCanvasAccessGateSerialTurnLifecycle(t *testing.T) {
	gate := NewCanvasAccessGate()
	inst := &fakeCanvasInstance{id: "art-1"}
	if err := gate.Register(inst); err != nil {
		t.Fatal(err)
	}
	if !gate.IsReadonly("art-1") {
		t.Fatal("unknown daemon state must start read-only")
	}
	if err := gate.Write("art-1", "", func() error { return nil }); !errors.Is(err, ErrCanvasReadOnly) {
		t.Fatalf("expected ErrCanvasReadOnly while unknown, got %v", err)
	}

	gate.UpdateFromDaemon(nil, nil)
	if gate.IsReadonly("art-1") {
		t.Fatal("idle known daemon state must unlock editing")
	}

	wroteDuringFlush := false
	inst.onFlush = func(permit string) error {
		if err := gate.Write("art-1", "", func() error { return nil }); !errors.Is(err, ErrCanvasReadOnly) {
			t.Fatalf("expected write without flush permit to fail, got %v", err)
		}
		return gate.Write("art-1", permit, func() error {
			wroteDuringFlush = true
			return nil
		})
	}

	reports := gate.UpdateFromDaemon([]DesignCanvasState{{
		ArtworkID: "art-1",
		TurnID:    "turn-1",
		Preparing: true,
	}}, nil)
	if len(reports) != 1 || !reports[0].OK {
		t.Fatalf("expected preparing flush report ok=true, got %+v", reports)
	}
	if !wroteDuringFlush {
		t.Fatal("expected permitted flush write to run")
	}
	if !gate.IsReadonly("art-1") {
		t.Fatal("active turn must hold artwork read-only")
	}

	gate.Disconnected()
	if !gate.IsReadonly("art-1") {
		t.Fatal("disconnected daemon must revert to read-only")
	}

	gate.UpdateFromDaemon(nil, nil)
	permitCh := make(chan string, 1)
	resumeFlush := make(chan struct{})
	inst.onFlush = func(permit string) error {
		permitCh <- permit
		<-resumeFlush
		return gate.Write("art-1", permit, func() error { return nil })
	}
	flushErrCh := make(chan error, 1)
	go func() {
		flushErrCh <- gate.Flush("art-1")
	}()
	issuedPermit := <-permitCh
	gate.Disconnected()
	close(resumeFlush)
	if err := <-flushErrCh; !errors.Is(err, ErrCanvasReadOnly) {
		t.Fatalf("expected write with old flush permit after Disconnected to fail with ErrCanvasReadOnly, got %v", err)
	}
	if err := gate.Write("art-1", issuedPermit, func() error { return nil }); !errors.Is(err, ErrCanvasReadOnly) {
		t.Fatalf("expected stale permit rejected after Disconnected, got %v", err)
	}
}

func TestDesignWorkerClientCancelQueuedCallerAndLiveClose(t *testing.T) {
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("/bin/sh unavailable")
	}
	scriptPath := filepath.Join(t.TempDir(), "hang-worker.sh")
	if err := os.WriteFile(scriptPath, []byte("#!/bin/sh\nsleep 30\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	dispatched := make(chan struct{}, 1)
	client := NewDesignWorkerClient("/bin/sh", scriptPath)
	client.drainTimeout = 80 * time.Millisecond
	client.killTimeout = 500 * time.Millisecond
	client.onDispatched = func() {
		select {
		case dispatched <- struct{}{}:
		default:
		}
	}

	firstCtx, firstCancel := context.WithCancel(context.Background())
	firstDone := make(chan error, 1)
	go func() {
		_, err := client.Request(firstCtx, map[string]string{"operation": "read"})
		firstDone <- err
	}()

	select {
	case <-dispatched:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for first worker request dispatch")
	}

	secondCtx, secondCancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer secondCancel()
	start := time.Now()
	if _, err := client.Request(secondCtx, map[string]string{"operation": "read"}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected queued caller to cancel with DeadlineExceeded, got %v", err)
	}
	if time.Since(start) > time.Second {
		t.Fatal("queued caller did not cancel promptly")
	}

	closeStart := time.Now()
	if err := client.Close(); err != nil && !strings.Contains(err.Error(), "signal") && !strings.Contains(err.Error(), "killed") {
		t.Fatalf("unexpected live Close error: %v", err)
	}
	if time.Since(closeStart) > time.Second {
		t.Fatal("live Close exceeded bounded drain+kill timeout")
	}
	firstCancel()
	<-firstDone
}

func TestDesignProtocolHostEnforcesGateAndIntegrity(t *testing.T) {
	gate := NewCanvasAccessGate()
	gate.UpdateFromDaemon(nil, nil)

	savedCount := 0
	host := NewDesignProtocolHostFromBytes(
		[]byte("<html>editor</html>"),
		gate,
		func(artworkID string, req DesignSaveRequest) (DesignSaveResult, error) {
			savedCount++
			return DesignSaveResult{RevisionID: "rev-next"}, nil
		},
	)
	surface := host.CreateSurface("art-42", json.RawMessage(`{"doc":{"canvas":{"width":100,"height":100}}}`), true)

	doPost := func(path, contentType, token, origin, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, surface.Origin+path, strings.NewReader(body))
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		if token != "" {
			req.Header.Set(security.CapabilityTokenHeader, token)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		rec := httptest.NewRecorder()
		host.ServeHTTP(rec, req)
		return rec
	}

	validBody := `{"baseRevisionId":"rev-0","doc":{"x":1},"assets":{}}`
	if rec := doPost("/ws/art-42/save", "application/json", surface.CapabilityToken, surface.Origin, validBody); rec.Code != http.StatusForbidden {
		t.Fatalf("unbound request without CallerPage must be rejected with 403, got %d", rec.Code)
	}

	host.SetRequireOwnerPageForTest(false)
	if rec := doPost("/ws/art-42/save", "application/json", surface.CapabilityToken, surface.Origin, validBody); rec.Code != http.StatusOK {
		t.Fatalf("valid save status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if savedCount != 1 {
		t.Fatalf("savedCount = %d, want 1", savedCount)
	}

	if rec := doPost("/ws/art-42/save", "application/json", "bad-token", surface.Origin, validBody); rec.Code != http.StatusForbidden {
		t.Fatalf("bad token status = %d, want 403", rec.Code)
	}
	if rec := doPost("/ws/art-42/save", "text/plain", surface.CapabilityToken, surface.Origin, validBody); rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("text/plain status = %d, want 415", rec.Code)
	}
	if rec := doPost("/ws/art-42/save", "application/json", surface.CapabilityToken, surface.Origin, `{"baseRevisionId":"","doc":{}}`); rec.Code != http.StatusConflict {
		t.Fatalf("missing baseRevisionId status = %d, want 409", rec.Code)
	}
	if rec := doPost("/ws/art-42/save", "application/json", surface.CapabilityToken, "https://evil.example", validBody); rec.Code != http.StatusForbidden {
		t.Fatalf("wrong origin status = %d, want 403", rec.Code)
	}

	gate.UpdateFromDaemon([]DesignCanvasState{{ArtworkID: "art-42", TurnID: "turn-9", Preparing: false}}, nil)
	if rec := doPost("/ws/art-42/save", "application/json", surface.CapabilityToken, surface.Origin, validBody); rec.Code != http.StatusLocked {
		t.Fatalf("active turn save status = %d, want 423", rec.Code)
	}
	gate.UpdateFromDaemon(nil, nil)

	host.RevokeSurface(surface.Host)
	if rec := doPost("/ws/art-42/save", "application/json", surface.CapabilityToken, surface.Origin, validBody); rec.Code != http.StatusForbidden {
		t.Fatalf("revoked surface status = %d, want 403", rec.Code)
	}

	badDir := t.TempDir()
	_ = os.WriteFile(filepath.Join(badDir, "editor.html"), []byte("tampered"), 0o644)
	_ = os.WriteFile(filepath.Join(badDir, "build.json"), []byte(`{"shellSha256":"0000000000000000"}`), 0o644)
	if _, err := NewDesignProtocolHost(badDir, gate, nil); err == nil {
		t.Fatal("expected corrupted editor.html sha256 to fail")
	}
}

func TestLoroRelayBoundedFramesAndSynthesizedDetach(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()

	receivedCh := make(chan string, 8)
	statusCh := make(chan bool, 4)

	relay := NewLoroRelay(LoroRelayConfig{
		Dial: func(context.Context, string) (net.Conn, error) {
			return clientConn, nil
		},
		PingInterval:  5 * time.Second,
		IdleTimeout:   15 * time.Second,
		MaxFrameBytes: 128,
		MaxQueueBytes: 1024,
		OnEvent: func(raw json.RawMessage) {
			receivedCh <- string(raw)
		},
		OnStatus: func(connected bool) {
			statusCh <- connected
		},
	})
	defer relay.Close()

	if err := relay.Connect(context.Background()); err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	if got := <-statusCh; !got {
		t.Fatal("expected initial connected status=true")
	}

	serverLineCh := make(chan string, 4)
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := serverConn.Read(buf)
			if err != nil {
				return
			}
			for _, line := range strings.Split(strings.TrimSpace(string(buf[:n])), "\n") {
				if line != "" {
					serverLineCh <- line
				}
			}
		}
	}()

	joinMsg := json.RawMessage(`{"type":"join","protocolVersion":7,"workspaceId":"ws-1","peerId":"peer-a"}`)
	if err := relay.Send("wb-1", joinMsg); err != nil {
		t.Fatalf("Send join failed: %v", err)
	}
	select {
	case firstLine := <-serverLineCh:
		if !strings.Contains(firstLine, `"type":"join"`) || !strings.Contains(firstLine, `"peerId":"peer-a"`) {
			t.Fatalf("expected join frame first, got %q", firstLine)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for join frame")
	}

	relay.ReleaseSender("wb-1")

	select {
	case secondLine := <-serverLineCh:
		if !strings.Contains(secondLine, `"type":"detach"`) || !strings.Contains(secondLine, `"peerId":"peer-a"`) {
			t.Fatalf("expected synthesized detach frame, got %q", secondLine)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for synthesized detach frame")
	}

	oversized := bytes.Repeat([]byte("x"), 256)
	_, _ = serverConn.Write(append(oversized, '\n'))
	_, _ = serverConn.Write([]byte(`{"type":"update","ok":true}` + "\n"))

	select {
	case ev := <-receivedCh:
		if ev != `{"type":"update","ok":true}` {
			t.Fatalf("expected oversized frame dropped and valid frame delivered, got %q", ev)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for valid frame after oversized drop")
	}

	if err := relay.Send("wb-1", json.RawMessage(`{"type":"update","pad":"`+strings.Repeat("a", 200)+`"}`)); err == nil {
		t.Fatal("expected oversized outbound frame rejected before enqueue")
	}
}

func TestLoroRelayDropsFramesWhileDisconnectedAndDoesNotReplayAfterRelease(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()

	relay := NewLoroRelay(LoroRelayConfig{
		Dial: func(context.Context, string) (net.Conn, error) {
			return clientConn, nil
		},
		PingInterval: 5 * time.Second,
		IdleTimeout:  15 * time.Second,
	})
	defer relay.Close()

	if err := relay.Send("stale-doc", json.RawMessage(`{"type":"join","protocolVersion":7,"workspaceId":"ws-1","peerId":"phantom-peer"}`)); err != nil {
		t.Fatalf("unexpected error dropping disconnected frame: %v", err)
	}
	relay.ReleaseSender("stale-doc")
	if relay.PendingBytes() != 0 {
		t.Fatalf("expected 0 pending bytes while disconnected, got %d", relay.PendingBytes())
	}

	if err := relay.Connect(context.Background()); err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	freshFrame := json.RawMessage(`{"type":"join","protocolVersion":7,"workspaceId":"ws-1","peerId":"live-peer"}`)
	if err := relay.Send("live-doc", freshFrame); err != nil {
		t.Fatalf("Send fresh frame failed: %v", err)
	}

	buf := make([]byte, 1024)
	_ = serverConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	n, err := serverConn.Read(buf)
	if err != nil {
		t.Fatalf("server read failed: %v", err)
	}
	got := string(buf[:n])
	if strings.Contains(got, "phantom-peer") {
		t.Fatalf("disconnected/released peer frame was replayed after connect: %q", got)
	}
	if !strings.Contains(got, "live-peer") {
		t.Fatalf("expected live-peer frame, got %q", got)
	}
}

func TestLoroRelayPreservesQueuedDetachOnReleaseSender(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()

	relay := NewLoroRelay(LoroRelayConfig{
		Dial: func(context.Context, string) (net.Conn, error) {
			return clientConn, nil
		},
		PingInterval: 5 * time.Second,
		IdleTimeout:  15 * time.Second,
	})
	defer relay.Close()

	if err := relay.Connect(context.Background()); err != nil {
		t.Fatalf("Connect failed: %v", err)
	}

	// 1) Deliver join to server so peer-a is live on daemon.
	if err := relay.Send("wb-1", json.RawMessage(`{"type":"join","protocolVersion":7,"workspaceId":"ws-1","peerId":"peer-a"}`)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 4096)
	_ = serverConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	n, err := serverConn.Read(buf)
	if err != nil || !strings.Contains(string(buf[:n]), `"type":"join"`) {
		t.Fatalf("expected server to receive join first, err=%v got=%q", err, string(buf[:n]))
	}

	// 2) Enqueue an update (which may block writeLoop on net.Pipe) and an explicit detach,
	// then immediately call ReleaseSender("wb-1").
	if err := relay.Send("wb-1", json.RawMessage(`{"type":"update","protocolVersion":7,"workspaceId":"ws-1","peerId":"peer-a"}`)); err != nil {
		t.Fatal(err)
	}
	if err := relay.Send("wb-1", json.RawMessage(`{"type":"detach","protocolVersion":7,"workspaceId":"ws-1","peerId":"peer-a"}`)); err != nil {
		t.Fatal(err)
	}
	relay.ReleaseSender("wb-1")

	sawDetach := false
	var received []string
	deadline := time.Now().Add(2 * time.Second)
	for !sawDetach && time.Now().Before(deadline) {
		_ = serverConn.SetReadDeadline(deadline)
		rn, rErr := serverConn.Read(buf)
		if rErr != nil {
			t.Fatalf("server read failed waiting for detach: %v (got %v)", rErr, received)
		}
		for _, line := range strings.Split(strings.TrimSpace(string(buf[:rn])), "\n") {
			if line == "" {
				continue
			}
			received = append(received, line)
			if strings.Contains(line, `"type":"detach"`) && strings.Contains(line, `"peerId":"peer-a"`) {
				sawDetach = true
			}
		}
	}
	if !sawDetach {
		t.Fatalf("queued detach frame was lost on ReleaseSender: %v", received)
	}
}

func TestLoroRelayAutoRedialsAfterIdleTimeout(t *testing.T) {
	var mu sync.Mutex
	var dialCount int
	var serverConns []net.Conn
	defer func() {
		mu.Lock()
		for _, c := range serverConns {
			_ = c.Close()
		}
		mu.Unlock()
	}()

	reconnected := make(chan struct{}, 2)
	relay := NewLoroRelay(LoroRelayConfig{
		Dial: func(context.Context, string) (net.Conn, error) {
			s, c := net.Pipe()
			go func() {
				buf := make([]byte, 1024)
				for {
					if _, err := s.Read(buf); err != nil {
						return
					}
				}
			}()
			mu.Lock()
			dialCount++
			serverConns = append(serverConns, s)
			mu.Unlock()
			return c, nil
		},
		PingInterval: 20 * time.Millisecond,
		IdleTimeout:  45 * time.Millisecond,
		RedialMin:    20 * time.Millisecond,
		RedialMax:    50 * time.Millisecond,
		OnStatus: func(connected bool) {
			if connected {
				select {
				case reconnected <- struct{}{}:
				default:
				}
			}
		},
	})
	defer relay.Close()

	if err := relay.Connect(context.Background()); err != nil {
		t.Fatal(err)
	}
	<-reconnected

	select {
	case <-reconnected:
		if relay.ConnectionGeneration() < 2 {
			t.Fatalf("expected connection generation >= 2 after idle redial, got %d", relay.ConnectionGeneration())
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for LoroRelay auto-redial after idle timeout")
	}
}

func TestExporterDynamicBleedTilingStitchAndPixelDiff(t *testing.T) {
	docWithLargeShadow := []byte(`{
		"elements": [
			{"id":"el1","shadow":{"offsetX":40,"offsetY":30,"blur":48,"spread":12}}
		]
	}`)
	bleed := ComputeDynamicBleedPx(docWithLargeShadow)
	if bleed <= MinBleedPx {
		t.Fatalf("expected dynamic bleed > %d for large shadow, got %d", MinBleedPx, bleed)
	}

	tiles, err := PlanExportTiles(3000, 2000, 1, 1536, bleed)
	if err != nil {
		t.Fatalf("PlanExportTiles failed: %v", err)
	}
	if len(tiles) != 4 {
		t.Fatalf("expected 4 tiles for 3000x2000, got %d", len(tiles))
	}
	if _, err := PlanExportTiles(9000, 9000, 2, 1536, 64); err == nil {
		t.Fatal("expected >16384px scaled export to be rejected")
	}

	smallTiles, err := PlanExportTiles(100, 100, 1, 50, 10)
	if err != nil {
		t.Fatal(err)
	}
	captured := make([]CapturedTile, 0, len(smallTiles))
	for _, tr := range smallTiles {
		img := image.NewNRGBA(image.Rect(0, 0, tr.CaptureWidth, tr.CaptureHeight))
		for y := 0; y < tr.CaptureHeight; y++ {
			for x := 0; x < tr.CaptureWidth; x++ {
				gx := tr.CaptureX + x
				gy := tr.CaptureY + y
				img.SetNRGBA(x, y, color.NRGBA{R: uint8(gx), G: uint8(gy), B: 200, A: 255})
			}
		}
		captured = append(captured, CapturedTile{Rect: tr, Image: img})
	}
	stitched, err := StitchCapturedTiles(100, 100, 1, captured)
	if err != nil {
		t.Fatalf("StitchCapturedTiles failed: %v", err)
	}
	ref := image.NewNRGBA(image.Rect(0, 0, 100, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 100; x++ {
			ref.SetNRGBA(x, y, color.NRGBA{R: uint8(x), G: uint8(y), B: 200, A: 255})
		}
	}
	diff, err := CompareImagesPixelDiff(stitched, ref)
	if err != nil {
		t.Fatal(err)
	}
	if diff.DifferingPixels != 0 || diff.MaxChannelDiff != 0 {
		t.Fatalf("expected lossless tile stitch, got %+v", diff)
	}
}

func TestMollyBridgeAllowlistDocGenAndConservativeGates(t *testing.T) {
	dataDir := t.TempDir()
	badCatalog := `{"identity":{"userId":"local-user:1"},"workspaces":[{"workspaceId":"local-ws:1","name":"Bad","slug":null,"role":"owner","state":"active"}]}`
	if err := os.WriteFile(filepath.Join(dataDir, "workspace-catalog.json"), []byte(badCatalog), 0o600); err != nil {
		t.Fatal(err)
	}
	if snap, err := readLocalPlatformSnapshot(dataDir); err != nil || snap != nil {
		t.Fatalf("expected non-standard local-user:/local-ws: prefixes to return nil snapshot, got %#v (err=%v)", snap, err)
	}

	catalog := `{"identity":{"userId":"local:user-1"},"workspaces":[{"workspaceId":"lw_1","name":"Local","slug":null,"role":"owner","state":"active"}]}`
	if err := os.WriteFile(filepath.Join(dataDir, "workspace-catalog.json"), []byte(catalog), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("MOLLY_INSTALLATION_CHANNEL", "")
	ctrl, probe, loro := resolveDaemonSocketPaths(dataDir, DesktopOptions{})
	if !strings.HasSuffix(ctrl, filepath.Join("run", "molly-control.sock")) && !strings.Contains(ctrl, `\\.\pipe\molly-control-`) {
		t.Fatalf("unexpected control socket path: %s", ctrl)
	}
	if !strings.HasSuffix(probe, filepath.Join("run", "molly-probe.sock")) && !strings.Contains(probe, `\\.\pipe\molly-probe-`) {
		t.Fatalf("unexpected probe socket path: %s", probe)
	}
	if !strings.HasSuffix(loro, filepath.Join("run", "molly-loro-data-plane.sock")) && !strings.Contains(loro, `\\.\pipe\molly-loro-data-plane-`) {
		t.Fatalf("unexpected loro socket path: %s", loro)
	}

	t.Setenv("MOLLY_INSTALLATION_CHANNEL", "preview")
	prevCtrl, _, _ := resolveDaemonSocketPaths(dataDir, DesktopOptions{})
	if !strings.Contains(prevCtrl, "molly-preview-control") {
		t.Fatalf("expected preview namespace in control socket, got %s", prevCtrl)
	}

	t.Setenv("MOLLY_MYGO_ENABLE_UNTRUSTED_BROWSER", "1")
	b := newDesktopBridge(DesktopOptions{EnablePublicBrowser: true, AppVersion: "0.2.0-test"}, BridgeConfig{DataDir: dataDir})
	gen := b.CurrentDocGeneration()
	syncedGen, err := b.SyncDocGen(context.Background())
	if err != nil || syncedGen != gen {
		t.Fatalf("SyncDocGen = %d (err=%v), want %d", syncedGen, err, gen)
	}

	if _, err := b.Invoke(context.Background(), gen+1, "updater.getState", nil); !errors.Is(err, ErrStaleDocGeneration) {
		t.Fatalf("expected ErrStaleDocGeneration, got %v", err)
	}
	if _, err := b.Invoke(context.Background(), gen, "unknownGroup.exec", nil); !errors.Is(err, ErrBlockedIpcChannel) {
		t.Fatalf("expected ErrBlockedIpcChannel, got %v", err)
	}

	snap, err := b.Invoke(context.Background(), gen, "localPlatform.getSnapshot", nil)
	if err != nil {
		t.Fatalf("localPlatform.getSnapshot failed: %v", err)
	}
	snapMap, ok := snap.(map[string]any)
	wsMap, _ := snapMap["workspace"].(map[string]any)
	if !ok || snapMap["userId"] != "local:user-1" || wsMap["workspaceId"] != "lw_1" {
		t.Fatalf("unexpected localPlatform snapshot: %#v", snap)
	}

	openRes, err := b.Invoke(context.Background(), gen, "app.openExternal", []json.RawMessage{json.RawMessage(`"file:///etc/passwd"`)})
	if err != nil {
		t.Fatal(err)
	}
	if openMap, _ := openRes.(map[string]any); openMap["opened"] != false || openMap["error"] != "disallowed_scheme" {
		t.Fatalf("expected file:// openExternal blocked, got %#v", openRes)
	}

	pbCaps, err := b.Invoke(context.Background(), gen, "publicBrowser.getCapabilities", nil)
	if err != nil {
		t.Fatal(err)
	}
	if m, _ := pbCaps.(map[string]any); m["hasNativeWebMCP"] != false {
		t.Fatalf("expected hasNativeWebMCP=false, got %#v", pbCaps)
	}

	if _, err := b.Invoke(context.Background(), gen, "modelConnections.save", nil); err == nil {
		t.Fatal("expected modelConnections write to be conservatively blocked")
	}

	if _, err := b.Invoke(context.Background(), gen, "machineRpc.previewFile", []json.RawMessage{json.RawMessage(`{"method":"file/resolve-local"}`)}); err == nil {
		t.Fatal("expected machineRpc.previewFile to be disabled in experimental shell")
	}

	for _, blocked := range []string{"harness/host", "mcp/catalog-entry", "design/image-connection", "design/canvas-host", "browser/open"} {
		payload, _ := json.Marshal(map[string]any{"method": blocked})
		if _, err := b.Invoke(context.Background(), gen, "machineRpc.send", []json.RawMessage{payload}); err == nil || !strings.Contains(err.Error(), "main_process_only_method") {
			t.Fatalf("expected machineRpc.send(%s) blocked with main_process_only_method, got %v", blocked, err)
		}
	}

	navRes, err := b.Invoke(context.Background(), gen, "publicBrowser.navigate", []json.RawMessage{json.RawMessage(`{"browserId":"b1","url":"https://example.com"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if m, _ := navRes.(map[string]any); m["ok"] != false || m["error"] != "public_browser_disabled_pending_g4" {
		t.Fatalf("expected honest public_browser_disabled_pending_g4 without host, got %#v", navRes)
	}
}

type stubDesignController struct {
	attachedID     string
	attachedHost   string
	attachedBounds DesignBounds
	exportedID     string
	exportedFormat string
	exportedTitle  string
	exportedScale  int
}

func (s *stubDesignController) Attach(_ context.Context, artworkID string, bounds DesignBounds, hostID string) error {
	s.attachedID = artworkID
	s.attachedBounds = bounds
	s.attachedHost = hostID
	return nil
}

func (s *stubDesignController) Hide(_, _ string) error { return nil }

func (s *stubDesignController) PresentToolbar(_, _ string, _ json.RawMessage) error { return nil }

func (s *stubDesignController) SyncFromStore(_ context.Context, _, _ string) error { return nil }

func (s *stubDesignController) Export(_ context.Context, artworkID, format, title string, scale int) error {
	s.exportedID = artworkID
	s.exportedFormat = format
	s.exportedTitle = title
	s.exportedScale = scale
	return nil
}

func TestSessionControlSendStreamsNDJSONAndUnwrapsJSONEnvelope(t *testing.T) {
	sockDir, err := os.MkdirTemp("/tmp", "molly-sc-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(sockDir)
	sockPath := filepath.Join(sockDir, "ctrl.sock")

	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		t.Skipf("unix socket listen unavailable: %v", err)
	}
	defer ln.Close()

	var seenBody map[string]any
	var seenAccept string
	firstEmitted := make(chan struct{}, 1)
	allowComplete := make(chan struct{})
	modeJSON := false

	srv := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/session-control" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			seenAccept = r.Header.Get("Accept")
			_ = json.NewDecoder(r.Body).Decode(&seenBody)
			if modeJSON {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"ok":true,"responses":[{"type":"json_ack","id":9}]}`))
				return
			}
			flusher, _ := w.(http.Flusher)
			w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
			_, _ = w.Write([]byte("{\"kind\":\"response\",\"response\":{\"type\":\"ack\",\"id\":1}}\n"))
			if flusher != nil {
				flusher.Flush()
			}
			<-allowComplete
			_, _ = w.Write([]byte("{\"kind\":\"response\",\"response\":{\"type\":\"done\",\"ok\":true}}\n"))
			_, _ = w.Write([]byte("{\"kind\":\"complete\"}\n"))
			if flusher != nil {
				flusher.Flush()
			}
		}),
	}
	go func() { _ = srv.Serve(ln) }()
	defer srv.Close()

	var mu sync.Mutex
	var emitted []map[string]any
	b := NewMollyBridge(BridgeConfig{
		ControlSocketPath: sockPath,
		OnEmitPush: func(channel string, payload any) {
			if channel != "sessionControl.response" {
				return
			}
			if m, ok := payload.(map[string]any); ok {
				mu.Lock()
				emitted = append(emitted, m)
				count := len(emitted)
				mu.Unlock()
				if count == 1 {
					select {
					case firstEmitted <- struct{}{}:
					default:
					}
				}
			}
		},
	})
	gen := b.CurrentDocGeneration()

	badRes, err := b.Invoke(context.Background(), gen, "sessionControl.send", []json.RawMessage{json.RawMessage(`{"requestId":"","message":{"type":"ping"}}`)})
	if err != nil {
		t.Fatal(err)
	}
	if m, _ := badRes.(map[string]any); m["ok"] != false || m["error"] != "invalid_request" {
		t.Fatalf("expected invalid_request for empty requestId, got %#v", badRes)
	}

	doneCh := make(chan any, 1)
	go func() {
		res, _ := b.Invoke(context.Background(), gen, "sessionControl.send", []json.RawMessage{
			json.RawMessage(`{"requestId":"req-42","message":{"type":"session/start","sessionId":"s-1"}}`),
		})
		doneCh <- res
	}()

	select {
	case <-firstEmitted:
		close(allowComplete)
	case <-time.After(3 * time.Second):
		close(allowComplete)
		t.Fatal("first NDJSON response frame was not emitted incrementally before stream completion")
	}

	res := <-doneCh
	if !strings.Contains(seenAccept, "application/x-ndjson") {
		t.Fatalf("expected Accept header to negotiate application/x-ndjson, got %q", seenAccept)
	}
	if seenBody["type"] != "session/start" || seenBody["requestId"] != nil {
		t.Fatalf("expected unwrapped message posted to /session-control, got %#v", seenBody)
	}
	resMap, _ := res.(map[string]any)
	frames, _ := resMap["responses"].([]any)
	if resMap["ok"] != true || len(frames) != 2 {
		t.Fatalf("expected 2 unwrapped NDJSON responses, got %#v", res)
	}
	mu.Lock()
	if len(emitted) != 2 {
		t.Fatalf("expected 2 pushed sessionControl.response events, got %d", len(emitted))
	}
	firstResp, _ := emitted[0]["response"].(map[string]any)
	if emitted[0]["requestId"] != "req-42" || firstResp["type"] != "ack" {
		t.Fatalf("expected unwrapped response payload without kind envelope, got %#v", emitted[0])
	}
	emitted = nil
	mu.Unlock()

	modeJSON = true
	jsonRes, err := b.Invoke(context.Background(), gen, "sessionControl.send", []json.RawMessage{
		json.RawMessage(`{"requestId":"req-99","message":{"type":"session/ping"}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if m, _ := jsonRes.(map[string]any); m["ok"] != true {
		t.Fatalf("expected JSON fallback ok=true, got %#v", jsonRes)
	}
	mu.Lock()
	if len(emitted) != 1 {
		t.Fatalf("expected 1 unwrapped JSON response pushed, got %#v", emitted)
	}
	jsonRespPayload, _ := emitted[0]["response"].(map[string]any)
	if jsonRespPayload["type"] != "json_ack" {
		t.Fatalf("expected unwrapped JSON response item, got %#v", emitted[0])
	}
	mu.Unlock()
}

func TestDesignAttachExportPositionalArgsAndCanvasHostEmptyReportsArray(t *testing.T) {
	body, err := buildCanvasHostRPCBody("m-1", "lw_1", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `"reports":[]`) {
		t.Fatalf("expected non-null empty reports array, got %s", string(body))
	}

	ctrl := &stubDesignController{}
	b := NewMollyBridge(BridgeConfig{DesignController: ctrl})
	gen := b.CurrentDocGeneration()

	if _, err := b.Invoke(context.Background(), gen, "design.attach", []json.RawMessage{
		json.RawMessage(`"art-1"`),
		json.RawMessage(`{"x":10,"y":20,"width":800,"height":600}`),
		json.RawMessage(`"host-1"`),
	}); err != nil {
		t.Fatalf("design.attach failed: %v", err)
	}
	if ctrl.attachedID != "art-1" || ctrl.attachedHost != "host-1" || ctrl.attachedBounds.Width != 800 {
		t.Fatalf("unexpected attach args: %+v", ctrl)
	}

	if _, err := b.Invoke(context.Background(), gen, "design.export", []json.RawMessage{
		json.RawMessage(`"art-1"`),
		json.RawMessage(`"png"`),
		json.RawMessage(`"Poster v1"`),
		json.RawMessage(`2`),
	}); err != nil {
		t.Fatalf("design.export failed: %v", err)
	}
	if ctrl.exportedID != "art-1" || ctrl.exportedFormat != "png" || ctrl.exportedTitle != "Poster v1" || ctrl.exportedScale != 2 {
		t.Fatalf("unexpected export args: %+v", ctrl)
	}

	if _, err := b.Invoke(context.Background(), gen, "design.unknownMethod", nil); err == nil {
		t.Fatal("expected unsupported design method to reject with an error rather than resolve an error object")
	}
}

func TestProfileIsolationWindowsPipeHashAndDirtyReloadGuard(t *testing.T) {
	t.Setenv("MOLLY_DATA_DIR", "")
	t.Setenv("MOLLY_INSTALLATION_CHANNEL", "")
	defaultDir := resolveDefaultDataDir("")
	if !strings.HasSuffix(defaultDir, ".molly-mygo-experimental") {
		t.Fatalf("expected isolated experimental default dataDir, got %q", defaultDir)
	}

	gotScope := windowsUserPipeScopeFor(`WORKSTATION\alice`, `C:\Users\alice`)
	wantHash := sha256.Sum256([]byte(`-1:alice:C:\Users\alice`))
	wantScope := hex.EncodeToString(wantHash[:8])
	if gotScope != wantScope {
		t.Fatalf("windowsUserPipeScopeFor = %q, want Node os.userInfo() hash %q", gotScope, wantScope)
	}

	if err := validateCanvasStateCleanForReload(nil); err == nil {
		t.Fatal("expected nil canvas editor state to refuse reload")
	}
	if err := validateCanvasStateCleanForReload(&canvasEditorState{Dirty: true}); err == nil {
		t.Fatal("expected dirty canvas to refuse reload")
	}
	if err := validateCanvasStateCleanForReload(&canvasEditorState{Saving: true}); err == nil {
		t.Fatal("expected saving canvas to refuse reload")
	}
	if err := validateCanvasStateCleanForReload(&canvasEditorState{Composing: true}); err == nil {
		t.Fatal("expected composing canvas to refuse reload")
	}
	if err := validateCanvasStateCleanForReload(&canvasEditorState{Ready: true, Readonly: true}); err != nil {
		t.Fatalf("expected clean canvas state to allow reload, got %v", err)
	}
}

func TestLocalProjectsPositionalForwardingAndMachineIDInjection(t *testing.T) {
	sockDir, err := os.MkdirTemp("/tmp", "molly-lp-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(sockDir)
	ctrlSock := filepath.Join(sockDir, "ctrl.sock")
	probeSock := filepath.Join(sockDir, "probe.sock")

	ctrlLn, err := net.Listen("unix", ctrlSock)
	if err != nil {
		t.Skipf("unix socket listen unavailable: %v", err)
	}
	defer ctrlLn.Close()
	probeLn, err := net.Listen("unix", probeSock)
	if err != nil {
		t.Skipf("unix socket listen unavailable: %v", err)
	}
	defer probeLn.Close()

	var probeMu sync.Mutex
	currentMachineID := "mach-old"
	probeSrv := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			probeMu.Lock()
			id := currentMachineID
			probeMu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"machineId":"` + id + `"}`))
		}),
	}
	go func() { _ = probeSrv.Serve(probeLn) }()
	defer probeSrv.Close()

	var mu sync.Mutex
	var requests []map[string]any
	ctrlSrv := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			w.Header().Set("Content-Type", "application/json")
			mid, _ := body["machineId"].(string)
			if strings.TrimSpace(mid) == "" {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"ok":false,"error":"invalid_request","message":"missing machineId"}`))
				return
			}
			mu.Lock()
			requests = append(requests, body)
			mu.Unlock()
			if mid == "mach-old" {
				probeMu.Lock()
				currentMachineID = "mach-fresh"
				probeMu.Unlock()
				_, _ = w.Write([]byte(`{"ok":false,"error":"machine_mismatch","message":"stale machineId"}`))
				return
			}
			switch body["type"] {
			case "local-project/list-dir":
				_, _ = w.Write([]byte(`{"ok":true,"type":"local-project/list-dir","result":{"entries":[{"name":"src","kind":"directory"}]}}`))
			case "local-project/list-files":
				_, _ = w.Write([]byte(`{"ok":true,"type":"local-project/list-files","result":{"files":["README.md"]}}`))
			case "local-project/read-file":
				_, _ = w.Write([]byte(`{"ok":true,"type":"local-project/read-file","result":{"content":"hello","encoding":"utf8"}}`))
			default:
				_, _ = w.Write([]byte(`{"ok":false,"message":"unknown"}`))
			}
		}),
	}
	go func() { _ = ctrlSrv.Serve(ctrlLn) }()
	defer ctrlSrv.Close()

	b := NewMollyBridge(BridgeConfig{ControlSocketPath: ctrlSock, ProbeSocketPath: probeSock})
	gen := b.CurrentDocGeneration()

	dirRes, err := b.Invoke(context.Background(), gen, "localProjects.listDir", []json.RawMessage{
		json.RawMessage(`"lw_1"`),
		json.RawMessage(`"proj-1"`),
		json.RawMessage(`"src"`),
		json.RawMessage(`{"limit":50}`),
	})
	if err != nil {
		t.Fatalf("localProjects.listDir failed: %v", err)
	}
	if dirMap, _ := dirRes.(map[string]any); dirMap["entries"] == nil {
		t.Fatalf("unexpected listDir result: %#v", dirRes)
	}

	filesRes, err := b.Invoke(context.Background(), gen, "localProjects.listFiles", []json.RawMessage{
		json.RawMessage(`"lw_1"`),
		json.RawMessage(`"proj-1"`),
		json.RawMessage(`{"maxFiles":100}`),
	})
	if err != nil {
		t.Fatalf("localProjects.listFiles failed: %v", err)
	}
	if filesMap, _ := filesRes.(map[string]any); filesMap["files"] == nil {
		t.Fatalf("unexpected listFiles result: %#v", filesRes)
	}

	readRes, err := b.Invoke(context.Background(), gen, "localProjects.readFile", []json.RawMessage{
		json.RawMessage(`"lw_1"`),
		json.RawMessage(`"proj-1"`),
		json.RawMessage(`"README.md"`),
		json.RawMessage(`{"maxBytes":4096}`),
	})
	if err != nil {
		t.Fatalf("localProjects.readFile failed: %v", err)
	}
	if readMap, _ := readRes.(map[string]any); readMap["content"] != "hello" {
		t.Fatalf("unexpected readFile result: %#v", readRes)
	}

	mu.Lock()
	if len(requests) != 4 ||
		requests[0]["machineId"] != "mach-old" ||
		requests[1]["machineId"] != "mach-fresh" ||
		requests[1]["type"] != "local-project/list-dir" || requests[1]["relativePath"] != "src" ||
		requests[2]["machineId"] != "mach-fresh" || requests[2]["type"] != "local-project/list-files" ||
		requests[3]["machineId"] != "mach-fresh" || requests[3]["type"] != "local-project/read-file" || requests[3]["relativePath"] != "README.md" {
		t.Fatalf("unexpected forwarded /project-control requests: %#v", requests)
	}
	mu.Unlock()
}
