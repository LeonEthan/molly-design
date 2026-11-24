package mcp

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

type stubIPResolver struct {
	addrs []netip.Addr
}

func (r stubIPResolver) LookupNetIP(_ context.Context, _, _ string) ([]netip.Addr, error) {
	return r.addrs, nil
}

func samplePNGBytes(t *testing.T, w, h int, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestOpenAIGenerateAndEditAndZeroRetries(t *testing.T) {
	outPNG := samplePNGBytes(t, 16, 16, color.RGBA{R: 20, G: 120, B: 220, A: 255})
	var hits atomic.Int32
	var lastPath string
	var lastBody map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		lastPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&lastBody)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]string{
				{"b64_json": base64.StdEncoding.EncodeToString(outPNG)},
			},
		})
	}))
	defer server.Close()

	workdir := t.TempDir()
	client := &ImageClient{}
	conn := Connection{
		Protocol: ProtocolOpenAIImages,
		BaseURL:  server.URL + "/v1",
		APIKey:   "sk-secret-key-1234567890",
		Model:    "gpt-image-1",
	}

	asset, err := client.Generate(context.Background(), GenerateRequest{
		Workdir:    workdir,
		Connection: conn,
		Prompt:     "blue square icon",
		Size:       "1024x1024",
	})
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}
	if hits.Load() != 1 || lastPath != "/v1/images/generations" {
		t.Fatalf("unexpected hits=%d path=%s", hits.Load(), lastPath)
	}
	if asset.Width != 16 || asset.Height != 16 || asset.MIME != "image/png" {
		t.Fatalf("unexpected asset: %+v", asset)
	}
	if !strings.HasPrefix(asset.Path, "media/") {
		t.Fatalf("unexpected asset path: %s", asset.Path)
	}

	srcFile := filepath.Join(workdir, "input.png")
	maskFile := filepath.Join(workdir, "mask.png")
	if err := os.WriteFile(srcFile, samplePNGBytes(t, 16, 16, color.RGBA{R: 255, G: 0, B: 0, A: 255}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(maskFile, samplePNGBytes(t, 16, 16, color.RGBA{R: 0, G: 0, B: 0, A: 0}), 0o600); err != nil {
		t.Fatal(err)
	}

	editAsset, err := client.Edit(context.Background(), EditRequest{
		Workdir:    workdir,
		Connection: conn,
		Prompt:     "make it blue",
		ImagePaths: []string{"input.png"},
		MaskPath:   "mask.png",
	})
	if err != nil {
		t.Fatalf("Edit failed: %v", err)
	}
	if lastPath != "/v1/images/edits" || editAsset.SHA256 != asset.SHA256 {
		t.Fatalf("unexpected edit result: path=%s sha=%s", lastPath, editAsset.SHA256)
	}
}

func TestDashScopeAndPreflightValidation(t *testing.T) {
	outPNG := samplePNGBytes(t, 12, 12, color.RGBA{R: 10, G: 200, B: 80, A: 255})
	var server *httptest.Server
	var seenSize string
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/services/aigc/multimodal-generation/generation":
			var body struct {
				Parameters struct {
					Size string `json:"size"`
				} `json:"parameters"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			seenSize = body.Parameters.Size
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"output": map[string]any{
					"choices": []map[string]any{
						{
							"message": map[string]any{
								"content": []map[string]string{
									{"image": server.URL + "/result.png"},
								},
							},
						},
					},
				},
			})
		case "/result.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(outPNG)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	workdir := t.TempDir()
	client := &ImageClient{}
	conn := Connection{
		Protocol: ProtocolDashScope,
		BaseURL:  server.URL + "/api/v1",
		APIKey:   "sk-dashscope-secret-9999",
		Model:    "qwen-image",
	}

	asset, err := client.Generate(context.Background(), GenerateRequest{
		Workdir:    workdir,
		Connection: conn,
		Prompt:     "green badge",
		Size:       "1024x1024",
	})
	if err != nil {
		t.Fatalf("DashScope Generate failed: %v", err)
	}
	if seenSize != "1024*1024" || asset.Width != 12 {
		t.Fatalf("unexpected dashscope size=%q asset=%+v", seenSize, asset)
	}

	_, err = client.Generate(context.Background(), GenerateRequest{
		Workdir:    workdir,
		Connection: Connection{Protocol: ProtocolOpenAIImages, BaseURL: server.URL, APIKey: "sk-1234567890"},
		Prompt:     "missing model",
	})
	var imgErr *ImageError
	if !errors.As(err, &imgErr) || imgErr.Dispatched {
		t.Fatalf("expected non-dispatched error for missing model, got %v", err)
	}

	_, err = client.Generate(context.Background(), GenerateRequest{
		Workdir:      workdir,
		Connection:   Connection{Protocol: ProtocolOpenAIImages, BaseURL: server.URL, APIKey: "sk-1234567890", Model: "m"},
		Prompt:       "bad combo",
		Background:   "transparent",
		OutputFormat: "jpeg",
	})
	if !errors.As(err, &imgErr) || imgErr.Dispatched {
		t.Fatalf("expected non-dispatched error for transparent jpeg, got %v", err)
	}

	_, err = client.Edit(context.Background(), EditRequest{
		Workdir:    workdir,
		Connection: conn,
		Prompt:     "mask not supported",
		ImagePaths: []string{"a.png"},
		MaskPath:   "mask.png",
	})
	if !errors.As(err, &imgErr) || imgErr.Dispatched {
		t.Fatalf("expected non-dispatched error for dashscope mask, got %v", err)
	}
}

func TestSecretRedactionNoRetryAndSSRFBlockOnReturnedURL(t *testing.T) {
	secretKey := "my-ultra-secret-token-xyz"
	var hits atomic.Int32
	errorServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"invalid Authorization: Bearer ` + secretKey + ` and sk-abcdefgh123456"}}`))
	}))
	defer errorServer.Close()

	client := &ImageClient{}
	_, err := client.Generate(context.Background(), GenerateRequest{
		Workdir: t.TempDir(),
		Connection: Connection{
			Protocol: ProtocolOpenAIImages,
			BaseURL:  errorServer.URL,
			APIKey:   secretKey,
			Model:    "gpt-image-1",
		},
		Prompt: "test redaction",
	})
	if err == nil {
		t.Fatal("expected error from 401 server")
	}
	if hits.Load() != 1 {
		t.Fatalf("expected zero retries (1 hit), got %d", hits.Load())
	}
	if strings.Contains(err.Error(), secretKey) || strings.Contains(err.Error(), "sk-abcdefgh123456") {
		t.Fatalf("secret leaked in error message: %s", err.Error())
	}

	ssrfServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]string{
				{"url": "https://private-target.example.com/result.png"},
			},
		})
	}))
	defer ssrfServer.Close()

	ssrfClient := &ImageClient{
		PublicResolver: stubIPResolver{addrs: []netip.Addr{netip.MustParseAddr("192.168.1.50")}},
	}
	_, err = ssrfClient.Generate(context.Background(), GenerateRequest{
		Workdir: t.TempDir(),
		Connection: Connection{
			Protocol: ProtocolOpenAIImages,
			BaseURL:  ssrfServer.URL,
			APIKey:   "sk-1234567890",
			Model:    "gpt-image-1",
		},
		Prompt: "ssrf returned url",
	})
	if err == nil || !strings.Contains(err.Error(), "non-public destination") {
		t.Fatalf("expected SSRF non-public destination error, got %v", err)
	}

	malformedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]string{
				{"url": "http://bad host/" + secretKey + "\x7f"},
			},
		})
	}))
	defer malformedServer.Close()

	_, err = client.Generate(context.Background(), GenerateRequest{
		Workdir: t.TempDir(),
		Connection: Connection{
			Protocol: ProtocolOpenAIImages,
			BaseURL:  malformedServer.URL,
			APIKey:   secretKey,
			Model:    "gpt-image-1",
		},
		Prompt: "malformed returned url",
	})
	if err == nil {
		t.Fatal("expected malformed returned URL to fail")
	}
	if strings.Contains(err.Error(), secretKey) {
		t.Fatalf("secret leaked via malformed returned URL error: %s", err.Error())
	}

	presignedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]string{
				{"url": "https://signed.example.com/result.png?X-Amz-Signature=TOP_SECRET_SIG_999&token=PRESIGNED_TOK_888"},
			},
		})
	}))
	defer presignedServer.Close()

	_, err = ssrfClient.Generate(context.Background(), GenerateRequest{
		Workdir: t.TempDir(),
		Connection: Connection{
			Protocol: ProtocolOpenAIImages,
			BaseURL:  presignedServer.URL,
			APIKey:   secretKey,
			Model:    "gpt-image-1",
		},
		Prompt: "presigned download failure",
	})
	if err == nil {
		t.Fatal("expected presigned download error")
	}
	if strings.Contains(err.Error(), "TOP_SECRET_SIG_999") || strings.Contains(err.Error(), "PRESIGNED_TOK_888") {
		t.Fatalf("presigned URL query token leaked in error: %s", err.Error())
	}
	if !strings.Contains(err.Error(), "do not retry automatically") {
		t.Fatalf("expected billing/no-retry guidance, got: %s", err.Error())
	}

	badJSONServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("not-valid-json"))
	}))
	defer badJSONServer.Close()

	_, err = client.Generate(context.Background(), GenerateRequest{
		Workdir: t.TempDir(),
		Connection: Connection{
			Protocol: ProtocolOpenAIImages,
			BaseURL:  badJSONServer.URL,
			APIKey:   secretKey,
			Model:    "gpt-image-1",
		},
		Prompt: "invalid json after paid post",
	})
	if err == nil || !strings.Contains(err.Error(), "may have been billed; do not retry automatically") {
		t.Fatalf("expected post-dispatch billing-safety message on parse failure, got: %v", err)
	}

	signedBodyErrServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"cannot fetch HTTPS://signed.example.com/user's-asset(1).png?X-Amz-Signature=UPSTREAM_SIG_777&token=UPSTREAM_TOK_666 (see 'https://signed.example.com/alt.png?sig=PAREN_SIG_555')"}}`))
	}))
	defer signedBodyErrServer.Close()

	_, err = client.Generate(context.Background(), GenerateRequest{
		Workdir: t.TempDir(),
		Connection: Connection{
			Protocol: ProtocolOpenAIImages,
			BaseURL:  signedBodyErrServer.URL,
			APIKey:   secretKey,
			Model:    "gpt-image-1",
		},
		Prompt: "upstream body signed url",
	})
	if err == nil {
		t.Fatal("expected upstream 400 error")
	}
	if strings.Contains(err.Error(), "UPSTREAM_SIG_777") || strings.Contains(err.Error(), "UPSTREAM_TOK_666") || strings.Contains(err.Error(), "PAREN_SIG_555") {
		t.Fatalf("signed URL query leaked from upstream error body: %s", err.Error())
	}
	if !strings.Contains(err.Error(), "may have been billed; do not retry automatically") {
		t.Fatalf("expected billing-safety guidance on non-2xx POST response, got: %s", err.Error())
	}
}

func TestWriteGeneratedImageAssetIdempotentAndCollisionRefusal(t *testing.T) {
	workdir := t.TempDir()
	pngBytes := samplePNGBytes(t, 8, 8, color.RGBA{R: 50, G: 60, B: 70, A: 255})

	first, err := WriteGeneratedImageAsset(workdir, pngBytes)
	if err != nil {
		t.Fatalf("first write failed: %v", err)
	}
	second, err := WriteGeneratedImageAsset(workdir, pngBytes)
	if err != nil {
		t.Fatalf("idempotent rewrite failed: %v", err)
	}
	if first.SHA256 != second.SHA256 {
		t.Fatalf("sha mismatch: %s vs %s", first.SHA256, second.SHA256)
	}

	if err := os.WriteFile(first.AbsolutePath, []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := WriteGeneratedImageAsset(workdir, pngBytes); err == nil {
		t.Fatal("expected collision with unrelated file to be refused")
	}
}

func TestImageClientUsesEnvironmentProxyForConfiguredEndpoint(t *testing.T) {
	pngBytes := samplePNGBytes(t, 16, 16, color.RGBA{R: 10, G: 120, B: 220, A: 255})
	var proxied atomic.Int32
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxied.Add(1)
		if r.Host != "192.168.10.20" {
			t.Errorf("proxy saw host %q, want 192.168.10.20", r.Host)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]string{
				{"b64_json": base64.StdEncoding.EncodeToString(pngBytes)},
			},
		})
	}))
	defer proxyServer.Close()

	t.Setenv("HTTP_PROXY", proxyServer.URL)
	t.Setenv("http_proxy", proxyServer.URL)
	t.Setenv("NO_PROXY", "")
	t.Setenv("no_proxy", "")

	client := &ImageClient{}
	asset, err := client.Generate(context.Background(), GenerateRequest{
		Workdir: t.TempDir(),
		Connection: Connection{
			Protocol: ProtocolOpenAIImages,
			BaseURL:  "http://192.168.10.20/v1",
			APIKey:   "sk-proxy-test-key",
			Model:    "gpt-image-1",
		},
		Prompt: "proxy routed",
	})
	if err != nil {
		t.Fatalf("expected proxied Generate to succeed, got %v", err)
	}
	if proxied.Load() != 1 {
		t.Fatalf("expected proxy hit count 1, got %d", proxied.Load())
	}
	if asset.Width != 16 || asset.Height != 16 {
		t.Fatalf("unexpected asset dimensions: %+v", asset)
	}
}

func TestImageClientNeverLeaksMalformedProxyCredentials(t *testing.T) {
	t.Setenv("HTTP_PROXY", "socks5://proxyuser:TOP_SECRET_PROXY_PASS@bad host:1080")
	t.Setenv("http_proxy", "socks5://proxyuser:TOP_SECRET_PROXY_PASS@bad host:1080")
	t.Setenv("NO_PROXY", "")
	t.Setenv("no_proxy", "")

	client := &ImageClient{}
	_, err := client.Generate(context.Background(), GenerateRequest{
		Workdir: t.TempDir(),
		Connection: Connection{
			Protocol: ProtocolOpenAIImages,
			BaseURL:  "http://192.168.10.20/v1",
			APIKey:   "sk-proxy-cred-test",
			Model:    "gpt-image-1",
		},
		Prompt: "malformed proxy cred check",
	})
	if err == nil {
		t.Fatal("expected error for malformed proxy URL")
	}
	if strings.Contains(err.Error(), "TOP_SECRET_PROXY_PASS") || strings.Contains(err.Error(), "proxyuser") {
		t.Fatalf("proxy credentials leaked in error message: %s", err.Error())
	}
}
