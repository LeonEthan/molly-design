package security

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"sync"
	"time"
)

type PublicEgressProxy struct {
	URL, Username, Password string
	auth                    [32]byte
	server                  *http.Server
	serveDone               chan struct{}
	cancel                  context.CancelFunc
	resolver                IPResolver
	dial                    func(context.Context, string, string) (net.Conn, error)
	mu                      sync.Mutex
	closed                  bool
	handlers                sync.WaitGroup
}

func NewPublicEgressProxy(resolver IPResolver) (*PublicEgressProxy, error) {
	return NewPublicEgressProxyWithDialer(resolver, (&net.Dialer{Timeout: 15 * time.Second}).DialContext)
}

func startEgressProxy(resolver IPResolver, dial func(context.Context, string, string) (net.Conn, error)) (*PublicEgressProxy, error) {
	return NewPublicEgressProxyWithDialer(resolver, dial)
}

func NewPublicEgressProxyWithDialer(resolver IPResolver, dial func(context.Context, string, string) (net.Conn, error)) (*PublicEgressProxy, error) {
	if dial == nil {
		return nil, errors.New("public egress dialer is required")
	}
	var key [32]byte
	rand.Read(key[:])
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	ctx, cancel := context.WithCancel(context.Background())
	p := &PublicEgressProxy{serveDone: make(chan struct{}), URL: "http://" + l.Addr().String(), Username: "molly", Password: hex.EncodeToString(key[:]), resolver: resolver, dial: dial, cancel: cancel}
	p.auth = sha256.Sum256([]byte("Basic " + base64.StdEncoding.EncodeToString([]byte(p.Username+":"+p.Password))))
	p.server = &http.Server{Handler: http.HandlerFunc(p.serve), BaseContext: func(net.Listener) context.Context { return ctx }, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: time.Minute}
	go func() { defer close(p.serveDone); _ = p.server.Serve(l) }()
	return p, nil
}

func (p *PublicEgressProxy) Close() error {
	p.mu.Lock()
	p.closed = true
	p.cancel()
	p.mu.Unlock()
	err := p.server.Close()
	<-p.serveDone
	p.handlers.Wait()
	return err
}

func (p *PublicEgressProxy) serve(w http.ResponseWriter, r *http.Request) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		w.WriteHeader(503)
		return
	}
	p.handlers.Add(1)
	p.mu.Unlock()
	defer p.handlers.Done()
	auth := sha256.Sum256([]byte(r.Header.Get("Proxy-Authorization")))
	if subtle.ConstantTimeCompare(auth[:], p.auth[:]) != 1 {
		w.Header().Set("Proxy-Authenticate", `Basic realm="public-egress"`)
		w.WriteHeader(407)
		return
	}
	host, port := r.URL.Hostname(), r.URL.Port()
	tunnel := r.Method == http.MethodConnect
	if tunnel {
		var err error
		host, port, err = net.SplitHostPort(r.RequestURI)
		if err != nil || (port != "443" && port != "80") {
			w.WriteHeader(403)
			return
		}
	} else {
		if r.URL.User != nil || (r.URL.Scheme != "http" && r.URL.Scheme != "https") {
			w.WriteHeader(403)
			return
		}
		if port == "" {
			port = "80"
			if r.URL.Scheme == "https" {
				port = "443"
			}
		}
	}
	ip, err := p.destination(r.Context(), host)
	if err != nil {
		var denied *NonPublicDestinationError
		if errors.As(err, &denied) {
			w.WriteHeader(403)
		} else {
			w.WriteHeader(502)
		}
		return
	}
	dial := func(ctx context.Context, network, _ string) (net.Conn, error) {
		return p.dial(ctx, network, net.JoinHostPort(ip.String(), port))
	}
	if tunnel {
		upstream, err := dial(r.Context(), "tcp", "")
		if err != nil {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		relayTunnel(w, r, upstream)
		return
	}

	transport := &http.Transport{DialContext: dial, DisableKeepAlives: true, DisableCompression: true, TLSHandshakeTimeout: 15 * time.Second, ResponseHeaderTimeout: time.Minute}
	proxy := httputil.ReverseProxy{Transport: transport, Rewrite: func(req *httputil.ProxyRequest) {
		req.Out.Host = req.In.URL.Host
		req.Out.Trailer = nil
	}}
	proxy.ServeHTTP(w, r)
}

func relayTunnel(w http.ResponseWriter, r *http.Request, upstream net.Conn) {
	defer upstream.Close()
	client, buf, err := http.NewResponseController(w).Hijack()
	if err != nil {
		return
	}
	defer client.Close()
	stop := context.AfterFunc(r.Context(), func() { client.Close(); upstream.Close() })
	defer stop()
	if _, err = io.WriteString(client, "HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		return
	}
	activity := func() {
		deadline := time.Now().Add(2 * time.Minute)
		client.SetDeadline(deadline)
		upstream.SetDeadline(deadline)
	}
	activity()
	done := make(chan struct{})
	go func() {
		io.Copy(activityWriter{upstream, activity}, buf.Reader)
		if c, ok := upstream.(*net.TCPConn); ok {
			c.CloseWrite()
		}
		close(done)
	}()
	io.Copy(activityWriter{client, activity}, upstream)
	client.Close()
	upstream.Close()
	<-done
}

type activityWriter struct {
	io.Writer
	activity func()
}

func (w activityWriter) Write(b []byte) (int, error) {
	w.activity()
	return w.Writer.Write(b)
}

var globalIPv6 = netip.MustParsePrefix("2000::/3")
var sixToFour = netip.MustParsePrefix("2002::/16")

func (p *PublicEgressProxy) destination(ctx context.Context, host string) (netip.Addr, error) {
	deny := &NonPublicDestinationError{Host: host}
	if ClassifyHostname(host) != ClassPublic {
		return netip.Addr{}, deny
	}
	ip, err := netip.ParseAddr(host)
	ips := []netip.Addr{ip}
	if err != nil {
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		ips, err = p.resolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return netip.Addr{}, err
		}
	} else if ip.Is4In6() {
		return netip.Addr{}, deny
	}
	if len(ips) == 0 {
		return netip.Addr{}, deny
	}
	for _, addr := range ips {
		ip := addr.Unmap()
		if !IsPublicIP(ip) || ip.Zone() != "" || ip.Is6() && (!globalIPv6.Contains(ip) || sixToFour.Contains(ip)) {
			deny.Addr = addr.String()
			return netip.Addr{}, deny
		}
	}
	return ips[0].Unmap(), nil
}

type browserBlockRule struct {
	Trigger struct {
		URLFilter string `json:"url-filter"`
	} `json:"trigger"`
	Action struct {
		Type string `json:"type"`
	} `json:"action"`
}

func PublicBrowserContentRulesJSON() string {
	var rules []browserBlockRule
	add := func(filter string) {
		var r browserBlockRule
		r.Trigger.URLFilter = filter
		r.Action.Type = "block"
		rules = append(rules, r)
	}
	for _, filter := range []string{"^[^h]", "^h[^t]", "^ht[^t]", "^htt[^p]", "^http[^s:]", "^https[^:]"} {
		add(filter)
	}
	octet := `[0-9]+`
	two := octet + `\.` + octet
	three := two + `\.` + octet
	for _, host := range []string{
		`127\.` + three, `10\.` + three, `0\.0\.0\.0`,
		`169\.254\.` + two, `192\.168\.` + two,
		`172\.1[6-9]\.` + two, `172\.2[0-9]\.` + two, `172\.3[01]\.` + two,
		`100\.6[4-9]\.` + two, `100\.[7-9][0-9]\.` + two, `100\.1[01][0-9]\.` + two, `100\.12[0-7]\.` + two,
		`([^./:@?#]+\.)*localhost`, `([^./:@?#]+\.)+local`, `host\.docker\.internal`,
		`\[::1?\]`, `\[fe[89ab][0-9a-f]:[0-9a-f:.]*\]`, `\[f[cd][0-9a-f][0-9a-f]:[0-9a-f:.]*\]`, `\[::ffff:[0-9a-f:.]+\]`,
	} {
		add(`^https?://([^/@?#]*@)?` + host + `\.?[:/?#]`)
		add(`^https?://([^/@?#]*@)?` + host + `\.?$`)
	}
	encoded, err := json.Marshal(rules)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}
