package browserfetch

import (
	"bytes"
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"github.com/LeonEthan/molly-design/internal/security"
)

type staticResolver struct {
	addrs []netip.Addr
}

func (r staticResolver) LookupNetIP(_ context.Context, _, _ string) ([]netip.Addr, error) {
	return r.addrs, nil
}

func TestHostMatchesSite(t *testing.T) {
	if !HostMatchesSite("i.pinimg.com", "pinimg.com") {
		t.Fatal("expected subdomain match")
	}
	if !HostMatchesSite("pinimg.com", "pinimg.com") {
		t.Fatal("expected exact domain match")
	}
	if HostMatchesSite("evilpinimg.com", "pinimg.com") {
		t.Fatal("expected suffix spoof not to match")
	}
}

func TestFetchImageRedirectsHeadersAndCaps(t *testing.T) {
	var seenAccept, seenReferer, seenCookie string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hop1":
			http.Redirect(w, r, "/final", http.StatusFound)
		case "/final":
			seenAccept = r.Header.Get("Accept")
			seenReferer = r.Header.Get("Referer")
			seenCookie = r.Header.Get("Cookie")
			w.Header().Set("Content-Type", "image/jpeg")
			_, _ = w.Write([]byte("fake-jpeg-bytes"))
		case "/loop":
			http.Redirect(w, r, "/loop", http.StatusFound)
		case "/huge":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(bytes.Repeat([]byte("a"), 1024))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	fetcher := &Fetcher{
		DialContext: (&net.Dialer{}).DialContext,
	}

	res, err := fetcher.FetchImage(context.Background(), Request{
		URL:        server.URL + "/hop1",
		PageOrigin: "https://www.pinterest.com",
		CookieSite: "127.0.0.1",
		Cookies:    []Cookie{{Name: "session", Value: "secret"}},
	})
	if err != nil {
		t.Fatalf("FetchImage failed: %v", err)
	}
	if string(res.Bytes) != "fake-jpeg-bytes" {
		t.Fatalf("unexpected body: %q", string(res.Bytes))
	}
	if seenAccept != AcceptHeader {
		t.Fatalf("Accept = %q, want %q", seenAccept, AcceptHeader)
	}
	if seenReferer != "https://www.pinterest.com/" {
		t.Fatalf("Referer = %q", seenReferer)
	}
	if seenCookie != "" {
		t.Fatalf("expected no cookies sent over plain HTTP, got %q", seenCookie)
	}

	if _, err := fetcher.FetchImage(context.Background(), Request{URL: server.URL + "/loop"}); err == nil {
		t.Fatal("expected redirect loop to fail after max redirects")
	}

	if _, err := fetcher.FetchImage(context.Background(), Request{
		URL:      server.URL + "/huge",
		MaxBytes: 128,
	}); err == nil {
		t.Fatal("expected oversized response to fail")
	}
}

func TestFetchImageRefusesProxyURL(t *testing.T) {
	fetcher := &Fetcher{}
	if _, err := fetcher.FetchImage(context.Background(), Request{
		URL:      "https://cdn.example.com/photo.jpg",
		ProxyURL: "http://127.0.0.1:7897",
	}); err == nil {
		t.Fatal("expected ProxyURL to be refused when target public-IP pinning cannot be enforced")
	}
}

func TestFetchImageBlocksPrivateIPByDefault(t *testing.T) {
	fetcher := &Fetcher{
		Resolver: staticResolver{addrs: []netip.Addr{netip.MustParseAddr("10.0.0.12")}},
	}
	_, err := fetcher.FetchImage(context.Background(), Request{
		URL: "https://cdn.example.com/photo.jpg",
	})
	if err == nil {
		t.Fatal("expected SSRF private IP to be blocked")
	}
	var nonPublic *security.NonPublicDestinationError
	if !errors.As(err, &nonPublic) {
		t.Fatalf("expected NonPublicDestinationError, got %v", err)
	}
}

func TestCookiePolicyHTTPSOnlyAndSizeCap(t *testing.T) {
	httpsURL, _ := parseFetchURL("https://i.pinimg.com/736x/a.jpg")
	httpURL, _ := parseFetchURL("http://i.pinimg.com/736x/a.jpg")
	otherURL, _ := parseFetchURL("https://other.example.com/a.jpg")

	if !shouldAttachCookies(httpsURL, "pinimg.com", "a=1") {
		t.Fatal("expected HTTPS same-site cookie to attach")
	}
	if shouldAttachCookies(httpURL, "pinimg.com", "a=1") {
		t.Fatal("expected HTTP cookie to be blocked")
	}
	if shouldAttachCookies(otherURL, "pinimg.com", "a=1") {
		t.Fatal("expected cross-site cookie to be blocked")
	}
	oversized := "k=" + strings.Repeat("v", MaxCookieHeaderBytes)
	if shouldAttachCookies(httpsURL, "pinimg.com", oversized) {
		t.Fatal("expected oversized cookie header to be blocked")
	}
}
