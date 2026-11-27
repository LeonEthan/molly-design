//go:build darwin

package shell

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/LeonEthan/molly-design/internal/security"
	"github.com/egoist/mygo"
)

const nativeTestEnv = "MOLLY_TEST_NATIVE_SHELL"

func TestMain(m *testing.M) {
	if os.Getenv(nativeTestEnv) != "1" {
		os.Exit(m.Run())
	}
	code := make(chan int, 1)
	mygo.App.OnWindowAllClosed(func() {})
	mygo.App.OnReady(func() { go func() { code <- m.Run(); mygo.App.Quit() }() })
	if err := mygo.App.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Exit(<-code)
}
func nativeTestProcess(t *testing.T) bool {
	t.Helper()
	if os.Getenv(nativeTestEnv) == "1" {
		return true
	}
	ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^"+t.Name()+"$", "-test.v", "-test.timeout=75s")
	cmd.Env = append(os.Environ(), nativeTestEnv+"=1", "HOME="+t.TempDir())
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	t.Logf("%s", out)
	return false
}

type browserResolver func(string) ([]netip.Addr, error)

func (f browserResolver) LookupNetIP(_ context.Context, _, host string) ([]netip.Addr, error) {
	return f(host)
}

func TestG4PublicBrowserProxy(t *testing.T) {
	if !nativeTestProcess(t) {
		return
	}
	var deniedLookups, privateHits, publicHits atomic.Int32
	var seenControlledCookie atomic.Bool
	private := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { privateHits.Add(1); fmt.Fprint(w, "private") }))
	defer private.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Proxy-Authorization") != "" {
			t.Error("proxy credentials reached origin")
		}
		if c, err := r.Cookie("molly_controlled_account"); err == nil && c.Value == "isolated-oauth-fixture" {
			seenControlledCookie.Store(true)
		}
		publicHits.Add(1)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, "<title>Molly public fixture</title>")
	}))
	defer origin.Close()
	resolver := browserResolver(func(h string) ([]netip.Addr, error) {
		switch h {
		case "public.test":
			return []netip.Addr{netip.MustParseAddr("8.8.8.8")}, nil
		case "rebind.test":
			deniedLookups.Add(1)
			return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
		}
		return nil, fmt.Errorf("unexpected host %q", h)
	})
	p, err := security.NewPublicEgressProxyWithDialer(resolver, func(ctx context.Context, network, target string) (net.Conn, error) {
		addr := private.Listener.Addr()
		if target == "8.8.8.8:80" {
			addr = origin.Listener.Addr()
		} else {
			t.Errorf("unexpected validated endpoint %s", target)
		}
		return (&net.Dialer{}).DialContext(ctx, network, addr.String())
	})
	if err != nil {
		t.Fatal(err)
	}
	opts := DesktopOptions{EnablePublicBrowser: true}
	bridge := newDesktopBridge(opts, BridgeConfig{CanvasGate: NewCanvasAccessGate(), DataDir: t.TempDir()})
	defer p.Close()
	loaded := make(chan struct{}, 1)
	var h *mygoPublicBrowserHost
	mygo.RunOnMain(func() {
		bridge.enableDesktopPublicBrowser(opts, runtime.GOOS, func() (PublicBrowserHost, error) {
			return openMygoPublicBrowserSession(p, resolver)
		})
		var ok bool
		h, ok = bridge.cfg.PublicBrowserHost.(*mygoPublicBrowserHost)
		if !ok {
			err = fmt.Errorf("desktop opt-in did not activate protected host")
			return
		}
		if err = h.session.Cookies.Set(mygo.Cookie{
			Name:   "molly_controlled_account",
			Value:  "isolated-oauth-fixture",
			Domain: "8.8.8.8",
			Path:   "/",
		}); err != nil {
			err = fmt.Errorf("inject controlled cookie: %w", err)
			return
		}
		var result any
		result, err = bridge.Invoke(t.Context(), bridge.CurrentDocGeneration(), "publicBrowser.navigate", []json.RawMessage{json.RawMessage(`{"browserId":"g4","url":"http://8.8.8.8/"}`)})
		if err == nil && result.(map[string]any)["ok"] != true {
			err = fmt.Errorf("navigate: %v", result)
		}
		if err == nil {
			h.windows["g4"].Page().OnDidFinishLoad(func() {
				select {
				case loaded <- struct{}{}:
				default:
				}
			})
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	<-loaded
	var window *mygo.Window
	mygo.RunOnMain(func() { window = h.windows["g4"] })
	page := window.Page()
	title, err := page.Eval("document.title")
	if err != nil || title != "Molly public fixture" || publicHits.Load() == 0 {
		t.Fatalf("title %q, origin hits %d, error %v", title, publicHits.Load(), err)
	}
	if !seenControlledCookie.Load() {
		t.Fatal("controlled-account cookie injected into isolated public browser session did not reach public origin")
	}
	defaultCookies, err := mygo.DefaultSession().Cookies.List(mygo.CookieFilter{URL: "http://8.8.8.8/"})
	if err != nil {
		t.Fatalf("list default session cookies: %v", err)
	}
	for _, c := range defaultCookies {
		if c.Name == "molly_controlled_account" {
			t.Fatal("controlled-account cookie leaked from isolated public browser session into default app session")
		}
	}
	private6 := httptest.NewUnstartedServer(private.Config.Handler)
	private6.Listener.Close()
	private6.Listener, err = net.Listen("tcp6", "[::1]:0")
	if err != nil {
		t.Fatal(err)
	}
	private6.Start()
	defer private6.Close()
	port := private.Listener.Addr().(*net.TCPAddr).Port
	for _, target := range []string{private.URL, fmt.Sprintf("http://localhost:%d", port), private6.URL, "http://rebind.test:80"} {
		result, err := page.Eval(fmt.Sprintf("fetch(%q, {mode:'no-cors'}).then(()=> 'loaded',()=> 'blocked')", target+"/fixture"))
		if err != nil || result != "blocked" || privateHits.Load() != 0 {
			t.Fatalf("%s result %v, private origin hits %d, error %v", target, result, privateHits.Load(), err)
		}
		t.Logf("WKWebView %s %v, private origin hits %d", target, result, privateHits.Load())
	}
	if deniedLookups.Load() == 0 {
		t.Fatal("rebinding hostname did not reach proxy resolver")
	}
	bridge.shutdownDesktop(func() {})
	if !window.IsDestroyed() {
		t.Fatal("public window survived CloseAll")
	}
	conn, err := net.Dial("tcp", strings.TrimPrefix(p.URL, "http://"))
	if err == nil {
		conn.Close()
		t.Fatal("proxy listener survived CloseAll")
	}
	t.Logf("WKWebView loaded %q, private origin hits %d, proxy listener closed", title, privateHits.Load())
}
