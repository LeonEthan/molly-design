package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/LeonEthan/molly-design/internal/browserfetch"
	"github.com/LeonEthan/molly-design/internal/design"
	"github.com/LeonEthan/molly-design/internal/fonts"
	"github.com/LeonEthan/molly-design/internal/gitstore"
	"github.com/LeonEthan/molly-design/internal/imaging"
	"github.com/LeonEthan/molly-design/internal/ipc"
	"github.com/LeonEthan/molly-design/internal/mcp"
	"github.com/LeonEthan/molly-design/internal/memory"
	"github.com/LeonEthan/molly-design/internal/platform"
)

const coreVersion = "0.2.0-m2.1"

type localCompositionReport struct {
	Name        string               `json:"name"`
	Version     string               `json:"version"`
	GoVersion   string               `json:"goVersion"`
	GOOS        string               `json:"goos"`
	GOARCH      string               `json:"goarch"`
	Composition platform.Composition `json:"composition"`
}

type viewImageInspectParams struct {
	Scope  imaging.Scope    `json:"scope"`
	Path   string           `json:"path,omitempty"`
	Paths  []string         `json:"paths,omitempty"`
	Region *imaging.Region  `json:"region,omitempty"`
	Fonts  []fonts.FontSpec `json:"fonts,omitempty"`
	Text   string           `json:"text,omitempty"`
}

type viewImageInspectResult struct {
	MIMEType string         `json:"mimeType"`
	Data     string         `json:"data"`
	Metadata map[string]any `json:"metadata"`
}

type browserFetchParams struct {
	URL        string                `json:"url"`
	PageOrigin string                `json:"pageOrigin,omitempty"`
	CookieSite string                `json:"cookieSite,omitempty"`
	Cookies    []browserfetch.Cookie `json:"cookies,omitempty"`
	ProxyURL   string                `json:"proxyUrl,omitempty"`
	TimeoutMs  int                   `json:"timeoutMs,omitempty"`
	MaxBytes   int64                 `json:"maxBytes,omitempty"`
}

type browserFetchResult struct {
	Data        string `json:"data"`
	ContentType string `json:"contentType"`
	FinalURL    string `json:"finalUrl"`
	Bytes       int    `json:"bytes"`
}

type memoryRegistry struct {
	mu     sync.Mutex
	stores map[string]*memory.Store
}

func newMemoryRegistry() *memoryRegistry {
	return &memoryRegistry{stores: make(map[string]*memory.Store)}
}

func (r *memoryRegistry) get(dbPath string) (*memory.Store, error) {
	key := strings.TrimSpace(dbPath)
	if key == "" {
		return nil, errors.New("dbPath is required")
	}
	if key != ":memory:" {
		abs, err := filepath.Abs(key)
		if err != nil {
			return nil, err
		}
		key = abs
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.stores[key]; ok {
		return s, nil
	}
	s, err := memory.Open(key)
	if err != nil {
		return nil, err
	}
	r.stores[key] = s
	return s, nil
}

func (r *memoryRegistry) closeAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for k, s := range r.stores {
		_ = s.Close()
		delete(r.stores, k)
	}
}

func registerCoreHandlers(srv *ipc.Server, imageClient *mcp.ImageClient, fetcher *browserfetch.Fetcher, memReg *memoryRegistry) {
	srv.Handle("core.composition", func(_ context.Context, _ json.RawMessage) (any, error) {
		return localCompositionReport{
			Name:        "molly-core",
			Version:     coreVersion,
			GoVersion:   runtime.Version(),
			GOOS:        runtime.GOOS,
			GOARCH:      runtime.GOARCH,
			Composition: platform.DefaultComposition(),
		}, nil
	})

	srv.Handle("view_image.inspect", func(_ context.Context, params json.RawMessage) (any, error) {
		var in viewImageInspectParams
		if err := json.Unmarshal(params, &in); err != nil {
			return nil, &ipc.RPCError{Code: "invalid_params", Message: err.Error()}
		}
		res, err := handleViewImage(in)
		if err != nil {
			if errors.Is(err, imaging.ErrUnsupportedImageFormat) {
				return nil, &ipc.RPCError{Code: "unsupported_image_format", Message: err.Error()}
			}
			return nil, &ipc.RPCError{Code: "view_image_failed", Message: err.Error()}
		}
		return viewImageInspectResult{
			MIMEType: imaging.MimeJPEG,
			Data:     base64.StdEncoding.EncodeToString(res.JPEG),
			Metadata: res.Metadata,
		}, nil
	})

	srv.Handle("image_mcp.generate", func(ctx context.Context, params json.RawMessage) (any, error) {
		if !srv.RequiresAuth() {
			return nil, &ipc.RPCError{Code: "unauthorized", Message: "image_mcp.generate requires authenticated IPC"}
		}
		var in mcp.GenerateRequest
		if err := json.Unmarshal(params, &in); err != nil {
			return nil, &ipc.RPCError{Code: "invalid_params", Message: err.Error()}
		}
		res, err := imageClient.Generate(ctx, in)
		if err != nil {
			return nil, &ipc.RPCError{Code: "image_generate_failed", Message: err.Error()}
		}
		return res, nil
	})

	srv.Handle("image_mcp.edit", func(ctx context.Context, params json.RawMessage) (any, error) {
		if !srv.RequiresAuth() {
			return nil, &ipc.RPCError{Code: "unauthorized", Message: "image_mcp.edit requires authenticated IPC"}
		}
		var in mcp.EditRequest
		if err := json.Unmarshal(params, &in); err != nil {
			return nil, &ipc.RPCError{Code: "invalid_params", Message: err.Error()}
		}
		res, err := imageClient.Edit(ctx, in)
		if err != nil {
			var imgErr *mcp.ImageError
			if errors.As(err, &imgErr) && !imgErr.Dispatched && errors.Is(err, imaging.ErrUnsupportedImageFormat) {
				return nil, &ipc.RPCError{Code: "unsupported_image_format", Message: err.Error()}
			}
			return nil, &ipc.RPCError{Code: "image_edit_failed", Message: err.Error()}
		}
		return res, nil
	})

	srv.Handle("browser.fetch_image", func(ctx context.Context, params json.RawMessage) (any, error) {
		var in browserFetchParams
		if err := json.Unmarshal(params, &in); err != nil {
			return nil, &ipc.RPCError{Code: "invalid_params", Message: err.Error()}
		}
		req := browserfetch.Request{
			URL:        in.URL,
			PageOrigin: in.PageOrigin,
			CookieSite: in.CookieSite,
			Cookies:    in.Cookies,
			ProxyURL:   in.ProxyURL,
			MaxBytes:   in.MaxBytes,
		}
		if in.TimeoutMs > 0 {
			req.Timeout = time.Duration(in.TimeoutMs) * time.Millisecond
		}
		res, err := fetcher.FetchImage(ctx, req)
		if err != nil {
			return nil, &ipc.RPCError{Code: "browser_fetch_failed", Message: err.Error()}
		}
		return browserFetchResult{
			Data:        base64.StdEncoding.EncodeToString(res.Bytes),
			ContentType: res.ContentType,
			FinalURL:    res.FinalURL,
			Bytes:       len(res.Bytes),
		}, nil
	})

	srv.Handle("memory.read", func(ctx context.Context, params json.RawMessage) (any, error) {
		var in struct {
			DBPath string `json:"dbPath"`
		}
		if err := json.Unmarshal(params, &in); err != nil {
			return nil, &ipc.RPCError{Code: "invalid_params", Message: err.Error()}
		}
		store, err := memReg.get(in.DBPath)
		if err != nil {
			return nil, &ipc.RPCError{Code: "memory_open_failed", Message: err.Error()}
		}
		snap, err := store.Read(ctx)
		if err != nil {
			return nil, &ipc.RPCError{Code: "memory_read_failed", Message: err.Error()}
		}
		return snap, nil
	})

	srv.Handle("memory.set_enabled", func(ctx context.Context, params json.RawMessage) (any, error) {
		var in struct {
			DBPath   string `json:"dbPath"`
			Enabled  bool   `json:"enabled"`
			Revision string `json:"revision"`
		}
		if err := json.Unmarshal(params, &in); err != nil {
			return nil, &ipc.RPCError{Code: "invalid_params", Message: err.Error()}
		}
		store, err := memReg.get(in.DBPath)
		if err != nil {
			return nil, &ipc.RPCError{Code: "memory_open_failed", Message: err.Error()}
		}
		if err := store.SetEnabled(ctx, in.Enabled, in.Revision); err != nil {
			return nil, &ipc.RPCError{Code: "memory_write_failed", Message: err.Error()}
		}
		return map[string]bool{"ok": true}, nil
	})

	srv.Handle("memory.edit", func(ctx context.Context, params json.RawMessage) (any, error) {
		var in struct {
			DBPath   string `json:"dbPath"`
			ID       string `json:"id"`
			Text     string `json:"text"`
			Revision string `json:"revision"`
		}
		if err := json.Unmarshal(params, &in); err != nil {
			return nil, &ipc.RPCError{Code: "invalid_params", Message: err.Error()}
		}
		store, err := memReg.get(in.DBPath)
		if err != nil {
			return nil, &ipc.RPCError{Code: "memory_open_failed", Message: err.Error()}
		}
		if err := store.Edit(ctx, in.ID, in.Text, in.Revision); err != nil {
			return nil, &ipc.RPCError{Code: "memory_write_failed", Message: err.Error()}
		}
		return map[string]bool{"ok": true}, nil
	})

	srv.Handle("memory.remove", func(ctx context.Context, params json.RawMessage) (any, error) {
		var in struct {
			DBPath   string `json:"dbPath"`
			ID       string `json:"id"`
			Revision string `json:"revision"`
		}
		if err := json.Unmarshal(params, &in); err != nil {
			return nil, &ipc.RPCError{Code: "invalid_params", Message: err.Error()}
		}
		store, err := memReg.get(in.DBPath)
		if err != nil {
			return nil, &ipc.RPCError{Code: "memory_open_failed", Message: err.Error()}
		}
		if err := store.Remove(ctx, in.ID, in.Revision); err != nil {
			return nil, &ipc.RPCError{Code: "memory_write_failed", Message: err.Error()}
		}
		return map[string]bool{"ok": true}, nil
	})

	srv.Handle("memory.capture", func(ctx context.Context, params json.RawMessage) (any, error) {
		var in struct {
			DBPath   string          `json:"dbPath"`
			Revision string          `json:"revision"`
			Changes  []memory.Change `json:"changes"`
		}
		if err := json.Unmarshal(params, &in); err != nil {
			return nil, &ipc.RPCError{Code: "invalid_params", Message: err.Error()}
		}
		store, err := memReg.get(in.DBPath)
		if err != nil {
			return nil, &ipc.RPCError{Code: "memory_open_failed", Message: err.Error()}
		}
		if err := store.Capture(ctx, in.Revision, in.Changes); err != nil {
			return nil, &ipc.RPCError{Code: "memory_write_failed", Message: err.Error()}
		}
		return map[string]bool{"ok": true}, nil
	})

	gs := gitstore.New()

	srv.Handle("design.read", func(_ context.Context, params json.RawMessage) (any, error) {
		var in struct {
			DataRoot  string `json:"dataRoot"`
			SessionID string `json:"sessionId"`
		}
		if err := json.Unmarshal(params, &in); err != nil {
			return nil, &ipc.RPCError{Code: "invalid_params", Message: err.Error()}
		}
		res, err := design.ReadDesign(in.DataRoot, in.SessionID)
		if err != nil {
			return nil, &ipc.RPCError{Code: "design_read_failed", Message: err.Error()}
		}
		return res, nil
	})

	srv.Handle("design.canonical_digest", func(_ context.Context, params json.RawMessage) (any, error) {
		var in design.Content
		if err := json.Unmarshal(params, &in); err != nil {
			return nil, &ipc.RPCError{Code: "invalid_params", Message: err.Error()}
		}
		canon, err := design.CanonicalContentBytes(in.Doc, in.Assets)
		if err != nil {
			return nil, &ipc.RPCError{Code: "canonical_failed", Message: err.Error()}
		}
		return map[string]any{
			"digest": design.DigestHex(canon),
			"bytes":  len(canon),
		}, nil
	})

	srv.Handle("gitstore.list", func(ctx context.Context, params json.RawMessage) (any, error) {
		var in struct {
			DataRoot  string `json:"dataRoot"`
			SessionID string `json:"sessionId"`
		}
		if err := json.Unmarshal(params, &in); err != nil {
			return nil, &ipc.RPCError{Code: "invalid_params", Message: err.Error()}
		}
		res, err := gs.List(ctx, in.DataRoot, in.SessionID)
		if err != nil {
			return nil, &ipc.RPCError{Code: "gitstore_list_failed", Message: err.Error()}
		}
		return res, nil
	})

	srv.Handle("gitstore.read", func(ctx context.Context, params json.RawMessage) (any, error) {
		var in struct {
			DataRoot  string `json:"dataRoot"`
			SessionID string `json:"sessionId"`
			CommitID  string `json:"commitId"`
		}
		if err := json.Unmarshal(params, &in); err != nil {
			return nil, &ipc.RPCError{Code: "invalid_params", Message: err.Error()}
		}
		res, err := gs.Read(ctx, in.DataRoot, in.SessionID, in.CommitID)
		if err != nil {
			return nil, &ipc.RPCError{Code: "gitstore_read_failed", Message: err.Error()}
		}
		return res, nil
	})
}

func handleViewImage(in viewImageInspectParams) (imaging.ViewResult, error) {
	hasPath := strings.TrimSpace(in.Path) != ""
	hasPaths := len(in.Paths) > 0
	hasFonts := len(in.Fonts) > 0
	hasText := in.Text != ""

	if hasFonts {
		if hasPaths {
			return imaging.ViewResult{}, errors.New("fonts mode cannot be combined with paths")
		}
		return fonts.RenderFontSampleRows(fonts.SampleRequest{
			Scope:           in.Scope,
			Fonts:           in.Fonts,
			Text:            in.Text,
			ReferencePath:   in.Path,
			ReferenceRegion: in.Region,
		})
	}
	if hasText {
		return imaging.ViewResult{}, errors.New("text is only valid in fonts mode")
	}
	if hasPath && hasPaths {
		return imaging.ViewResult{}, errors.New("specify either path or paths, not both")
	}
	if hasPaths {
		if in.Region != nil {
			return imaging.ViewResult{}, errors.New("region cannot be used with paths")
		}
		return imaging.ViewContactSheet(in.Scope, in.Paths)
	}
	if hasPath {
		return imaging.ViewSingleOrRegion(in.Scope, in.Path, in.Region)
	}
	return imaging.ViewResult{}, errors.New("specify path, paths, or fonts")
}

func run(args []string, stdout io.Writer, stderr io.Writer) int {
	return runWithInput(args, os.Stdin, stdout, stderr)
}

func runWithInput(args []string, stdin io.Reader, stdout io.Writer, stderr io.Writer) int {
	fs := flag.NewFlagSet("molly-core", flag.ContinueOnError)
	fs.SetOutput(stderr)
	showVersion := fs.Bool("version", false, "print molly-core version")
	checkLocal := fs.Bool("check-local-composition", false, "print local composition JSON and exit")
	serveIPC := fs.String("serve-ipc", "", "serve local authenticated IPC on unix socket or windows named pipe")
	watchStdin := fs.Bool("watch-stdin", false, "exit when stdin reaches EOF (parent-death signal)")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *showVersion {
		_, _ = fmt.Fprintf(stdout, "molly-core %s (%s %s/%s)\n", coreVersion, runtime.Version(), runtime.GOOS, runtime.GOARCH)
		return 0
	}
	if *checkLocal {
		comp := platform.DefaultComposition()
		if !comp.Capabilities.LocalOnly || comp.Capabilities.TelemetryEnabled || len(comp.Capabilities.Cloud) != 0 {
			_, _ = fmt.Fprintln(stderr, "invalid non-local default composition")
			return 1
		}
		report := localCompositionReport{
			Name:        "molly-core",
			Version:     coreVersion,
			GoVersion:   runtime.Version(),
			GOOS:        runtime.GOOS,
			GOARCH:      runtime.GOARCH,
			Composition: comp,
		}
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(report); err != nil {
			_, _ = fmt.Fprintf(stderr, "encode report: %v\n", err)
			return 1
		}
		return 0
	}
	if strings.TrimSpace(*serveIPC) != "" {
		authToken := strings.TrimSpace(os.Getenv("MOLLY_CORE_IPC_TOKEN"))
		if authToken == "" {
			_, _ = fmt.Fprintln(stderr, "MOLLY_CORE_IPC_TOKEN is required when running --serve-ipc")
			return 1
		}
		srv, err := ipc.NewServerWithAuth(strings.TrimSpace(*serveIPC), authToken)
		if err != nil {
			_, _ = fmt.Fprintf(stderr, "start ipc server: %v\n", err)
			return 1
		}
		defer srv.Close()
		memReg := newMemoryRegistry()
		defer memReg.closeAll()
		registerCoreHandlers(srv, &mcp.ImageClient{}, &browserfetch.Fetcher{}, memReg)
		sigCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		ctx, cancel := context.WithCancel(sigCtx)
		defer cancel()
		if *watchStdin && stdin != nil {
			go func() {
				_, _ = io.Copy(io.Discard, stdin)
				cancel()
			}()
		}
		if err := srv.Serve(ctx); err != nil {
			_, _ = fmt.Fprintf(stderr, "serve ipc: %v\n", err)
			return 1
		}
		return 0
	}
	_, _ = fmt.Fprintln(stderr, "usage: molly-core --version | --check-local-composition | --serve-ipc <socket-path> [--watch-stdin]")
	return 2
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}
