package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/LeonEthan/molly-design/internal/browserfetch"
	"github.com/LeonEthan/molly-design/internal/fonts"
	"github.com/LeonEthan/molly-design/internal/imaging"
	"github.com/LeonEthan/molly-design/internal/ipc"
	"github.com/LeonEthan/molly-design/internal/mcp"
)

func TestCheckLocalCompositionOutput(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run([]string{"--check-local-composition"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("run returned %d, stderr=%q", code, stderr.String())
	}
	var report localCompositionReport
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		t.Fatalf("unmarshal report: %v", err)
	}
	if report.Name != "molly-core" {
		t.Fatalf("expected name molly-core, got %q", report.Name)
	}
	if !report.Composition.Capabilities.LocalOnly || report.Composition.Capabilities.TelemetryEnabled {
		t.Fatalf("unexpected composition: %+v", report.Composition)
	}
}

func TestServeIPCRequiresToken(t *testing.T) {
	t.Setenv("MOLLY_CORE_IPC_TOKEN", "")
	var stdout, stderr bytes.Buffer
	code := run([]string{"--serve-ipc", filepath.Join(t.TempDir(), "c.sock")}, &stdout, &stderr)
	if code == 0 {
		t.Fatal("expected --serve-ipc without MOLLY_CORE_IPC_TOKEN to fail closed")
	}
	if !strings.Contains(stderr.String(), "MOLLY_CORE_IPC_TOKEN") {
		t.Fatalf("expected stderr to mention MOLLY_CORE_IPC_TOKEN, got %q", stderr.String())
	}
}

func TestServeIPCExitsOnStdinEOF(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket stdin EOF test runs on unix")
	}
	sockDir, err := os.MkdirTemp("/tmp", "mc-eof-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(sockDir) })
	socketPath := filepath.Join(sockDir, "c.sock")
	const token = "stdin-eof-parent-death-token-0123456789"
	t.Setenv("MOLLY_CORE_IPC_TOKEN", token)

	pr, pw := io.Pipe()
	var stdout, stderr bytes.Buffer
	exitCh := make(chan int, 1)
	go func() {
		exitCh <- runWithInput([]string{"--serve-ipc", socketPath, "--watch-stdin"}, pr, &stdout, &stderr)
	}()

	deadline := time.Now().Add(3 * time.Second)
	var client *ipc.Client
	for time.Now().Before(deadline) {
		c, dialErr := ipc.DialWithAuth(context.Background(), socketPath, token)
		if dialErr == nil {
			client = c
			break
		}
		time.Sleep(15 * time.Millisecond)
	}
	if client == nil {
		_ = pw.Close()
		t.Fatalf("timed out waiting for --serve-ipc socket: stderr=%q", stderr.String())
	}
	_ = client.Close()

	_ = pw.Close()
	select {
	case code := <-exitCh:
		if code != 0 {
			t.Fatalf("expected clean exit 0 on stdin EOF, got %d stderr=%q", code, stderr.String())
		}
	case <-time.After(3 * time.Second):
		t.Fatal("molly-core did not exit promptly after stdin EOF")
	}
}

func TestVersionFlag(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run([]string{"--version"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("run returned %d, stderr=%q", code, stderr.String())
	}
	if !strings.HasPrefix(stdout.String(), "molly-core "+coreVersion) {
		t.Fatalf("unexpected version output: %q", stdout.String())
	}
}

func makeTestPNG(t *testing.T, w, h int, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	imaging.FillRect(img, img.Bounds(), c)
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestIPCServerEndToEndHandlers(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket end-to-end test runs on unix")
	}

	root := t.TempDir()
	workdir := filepath.Join(root, "session")
	if err := os.MkdirAll(workdir, 0o755); err != nil {
		t.Fatal(err)
	}
	samplePNG := makeTestPNG(t, 64, 48, color.RGBA{R: 30, G: 90, B: 200, A: 255})
	if err := os.WriteFile(filepath.Join(workdir, "canvas.png"), samplePNG, 0o600); err != nil {
		t.Fatal(err)
	}
	fixtureFont, err := os.ReadFile(filepath.Join("..", "..", "apps", "cli", "src", "mcp", "fixtures", "fonts", "MollyTestSerif-Regular.ttf"))
	if err != nil {
		t.Fatalf("read fixture font: %v", err)
	}
	fontPath := filepath.Join(workdir, "MollyTestSerif-Regular.ttf")
	if err := os.WriteFile(fontPath, fixtureFont, 0o600); err != nil {
		t.Fatal(err)
	}

	mockUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/images/generations":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]string{
					{"b64_json": base64.StdEncoding.EncodeToString(samplePNG)},
				},
			})
		case "/photo.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(samplePNG)
		default:
			http.NotFound(w, r)
		}
	}))
	defer mockUpstream.Close()

	sockDir, err := os.MkdirTemp("/tmp", "mc-e2e-")
	if err != nil {
		t.Fatalf("MkdirTemp: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(sockDir) })
	socketPath := filepath.Join(sockDir, "c.sock")
	const testToken = "cmd-molly-core-e2e-test-token-0123456789"
	srv, err := ipc.NewServerWithAuth(socketPath, testToken)
	if err != nil {
		t.Fatalf("NewServerWithAuth: %v", err)
	}
	memReg := newMemoryRegistry()
	defer memReg.closeAll()
	registerCoreHandlers(srv, &mcp.ImageClient{}, &browserfetch.Fetcher{
		DialContext: (&net.Dialer{}).DialContext,
	}, memReg)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- srv.Serve(ctx)
	}()
	defer func() {
		cancel()
		_ = srv.Close()
		<-done
	}()

	client, err := ipc.DialWithAuth(ctx, socketPath, testToken)
	if err != nil {
		t.Fatalf("ipc.Dial: %v", err)
	}
	defer client.Close()

	var comp localCompositionReport
	if err := client.Call(ctx, "core.composition", nil, &comp); err != nil {
		t.Fatalf("core.composition: %v", err)
	}
	if !comp.Composition.Capabilities.LocalOnly {
		t.Fatalf("expected LocalOnly composition")
	}

	var viewRes viewImageInspectResult
	if err := client.Call(ctx, "view_image.inspect", viewImageInspectParams{
		Scope: imaging.Scope{Workdir: workdir},
		Path:  "canvas.png",
	}, &viewRes); err != nil {
		t.Fatalf("view_image.inspect single: %v", err)
	}
	if viewRes.MIMEType != imaging.MimeJPEG || viewRes.Data == "" {
		t.Fatalf("unexpected view_image result: %+v", viewRes)
	}

	var fontRes viewImageInspectResult
	if err := client.Call(ctx, "view_image.inspect", viewImageInspectParams{
		Scope: imaging.Scope{Workdir: workdir},
		Fonts: []fonts.FontSpec{{File: fontPath, Face: "Molly Test Serif"}},
		Text:  "Molly",
	}, &fontRes); err != nil {
		t.Fatalf("view_image.inspect fonts: %v", err)
	}
	if _, ok := fontRes.Metadata["rows"]; !ok {
		t.Fatalf("expected rows metadata in font result: %+v", fontRes.Metadata)
	}

	var genRes mcp.AssetResult
	if err := client.Call(ctx, "image_mcp.generate", mcp.GenerateRequest{
		Workdir: workdir,
		Connection: mcp.Connection{
			Protocol: mcp.ProtocolOpenAIImages,
			BaseURL:  mockUpstream.URL + "/v1",
			APIKey:   "sk-test-1234567890",
			Model:    "gpt-image-1",
		},
		Prompt: "blue banner",
	}, &genRes); err != nil {
		t.Fatalf("image_mcp.generate: %v", err)
	}
	if genRes.Width != 64 || genRes.Height != 48 {
		t.Fatalf("unexpected generated asset: %+v", genRes)
	}

	var fetchRes browserFetchResult
	if err := client.Call(ctx, "browser.fetch_image", browserFetchParams{
		URL:        mockUpstream.URL + "/photo.png",
		PageOrigin: "https://www.pinterest.com",
	}, &fetchRes); err != nil {
		t.Fatalf("browser.fetch_image: %v", err)
	}
	if fetchRes.Bytes != len(samplePNG) {
		t.Fatalf("fetched bytes = %d, want %d", fetchRes.Bytes, len(samplePNG))
	}
}
