package security

import (
	"bufio"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
)

type proxyResolver func(string) []netip.Addr

func (f proxyResolver) LookupNetIP(_ context.Context, _, h string) ([]netip.Addr, error) {
	return f(h), nil
}

func TestEgress(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Proxy-Authorization") != "" || r.Host != "site.test" {
			t.Errorf("unexpected forwarded host or credential")
			return
		}
		fmt.Fprint(w, "public response")
	}))
	defer origin.Close()
	public := netip.MustParseAddr("8.8.8.8")
	private := netip.MustParseAddr("127.0.0.1")
	first := true
	p, err := startEgressProxy(proxyResolver(func(h string) []netip.Addr {
		switch h {
		case "mixed.test":
			return []netip.Addr{public, private}
		case "site.test":
			if first {
				first = false
				return []netip.Addr{public}
			}
		}
		return []netip.Addr{private}
	}), func(ctx context.Context, network, addr string) (net.Conn, error) {
		if addr != "8.8.8.8:80" && addr != "8.8.8.8:443" {
			t.Errorf("invalid dial %q", addr)
			return nil, fmt.Errorf("invalid target")
		}
		return (&net.Dialer{}).DialContext(ctx, network, origin.Listener.Addr().String())
	})
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	auth := "Basic " + base64.StdEncoding.EncodeToString([]byte(p.Username+":"+p.Password))
	request := func(method, target, credential string) (net.Conn, *bufio.Reader, *http.Response) {
		c, e := net.Dial("tcp", strings.TrimPrefix(p.URL, "http://"))
		if e != nil {
			t.Fatal(e)
		}
		fmt.Fprintf(c, "%s %s HTTP/1.1\r\nHost: site.test\r\nProxy-Authorization: %s\r\n\r\n", method, target, credential)
		br := bufio.NewReader(c)
		res, e := http.ReadResponse(br, nil)
		if e != nil {
			t.Fatal(e)
		}
		return c, br, res
	}
	status := func(method, target, credential string, want int) {
		t.Helper()
		c, _, res := request(method, target, credential)
		defer c.Close()
		if res.StatusCode != want {
			t.Errorf("%s %s got %d want %d", method, target, res.StatusCode, want)
		}
	}
	for _, cred := range []string{"", "Basic wrong"} {
		status("GET", "http://site.test/", cred, 407)
		status("CONNECT", "8.8.8.8:443", cred, 407)
	}
	for _, url := range []string{"http://127.0.0.1", "http://10.0.0.1", "http://100.64.0.1", "http://169.254.169.254", "http://[fd00::1]", "http://[fe80::1]", "http://[64:ff9b::808:808]", "http://mixed.test", "http://private.test", "file://host/path", "ftp://host/", "gopher://host/"} {
		status("GET", url, auth, 403)
	}
	status("CONNECT", "mixed.test:443", auth, 403)
	status("CONNECT", "8.8.8.8:25", auth, 403)
	c, _, res := request("GET", "http://site.test/", auth)
	b, e := io.ReadAll(res.Body)
	c.Close()
	if e != nil || string(b) != "public response" {
		t.Fatalf("GET %q %v", b, e)
	}
	status("GET", "http://site.test/", auth, 403)
	c, br, res := request("CONNECT", "8.8.8.8:443", auth)
	defer c.Close()
	if res.StatusCode != 200 {
		t.Fatal(res.Status)
	}
	fmt.Fprint(c, "GET / HTTP/1.1\r\nHost: site.test\r\n\r\n")
	res, e = http.ReadResponse(br, nil)
	if e != nil {
		t.Fatal(e)
	}
	b, e = io.ReadAll(res.Body)
	if e != nil || string(b) != "public response" {
		t.Fatal(string(b), e)
	}
	if err = p.Close(); err != nil {
		t.Fatal(err)
	}
	if _, e = br.ReadByte(); e != io.EOF {
		t.Fatalf("expected closed tunnel: %v", e)
	}
}

func TestEgressTLSOverConnect(t *testing.T) {
	origin := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS.ServerName != "example.com" || r.Host != "example.com" || r.Header.Get("Proxy-Authorization") != "" {
			t.Error("unexpected tunneled request")
		}
		fmt.Fprint(w, "tls")
	}))
	defer origin.Close()
	p, err := startEgressProxy(proxyResolver(func(string) []netip.Addr { return []netip.Addr{netip.MustParseAddr("8.8.8.8")} }), func(ctx context.Context, network, target string) (net.Conn, error) {
		if target != "8.8.8.8:443" {
			return nil, fmt.Errorf("unexpected dial %s", target)
		}
		return (&net.Dialer{}).DialContext(ctx, network, origin.Listener.Addr().String())
	})
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	endpoint, err := url.Parse(p.URL)
	if err != nil {
		t.Fatal(err)
	}
	endpoint.User = url.UserPassword(p.Username, p.Password)
	transport := origin.Client().Transport.(*http.Transport).Clone()
	transport.Proxy = http.ProxyURL(endpoint)
	defer transport.CloseIdleConnections()
	resp, err := (&http.Client{Transport: transport}).Get("https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil || string(b) != "tls" {
		t.Fatal(string(b), err)
	}
}
