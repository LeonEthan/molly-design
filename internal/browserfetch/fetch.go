package browserfetch

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/LeonEthan/molly-design/internal/security"
)

const (
	MaxBytes             = 5 << 20
	MaxRedirects         = 5
	DefaultTimeout       = 15 * time.Second
	MaxCookieHeaderBytes = 16_000
	AcceptHeader         = "image/png,image/jpeg,image/gif,image/webp,image/avif;q=0.8"
)

type Cookie struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type Request struct {
	URL        string        `json:"url"`
	PageOrigin string        `json:"pageOrigin,omitempty"`
	CookieSite string        `json:"cookieSite,omitempty"`
	Cookies    []Cookie      `json:"cookies,omitempty"`
	ProxyURL   string        `json:"proxyUrl,omitempty"`
	Timeout    time.Duration `json:"-"`
	MaxBytes   int64         `json:"-"`
}

type Result struct {
	Bytes       []byte `json:"-"`
	ContentType string `json:"contentType"`
	FinalURL    string `json:"finalUrl"`
}

type Fetcher struct {
	Resolver    security.IPResolver
	DialContext func(ctx context.Context, network, addr string) (net.Conn, error)
}

func HostMatchesSite(hostname, site string) bool {
	host := security.StripIPv6Brackets(hostname)
	normalizedSite := security.StripIPv6Brackets(site)
	if host == "" || normalizedSite == "" {
		return false
	}
	return host == normalizedSite || strings.HasSuffix(host, "."+normalizedSite)
}

func FormatCookieHeader(cookies []Cookie) string {
	parts := make([]string, 0, len(cookies))
	for _, c := range cookies {
		name := strings.TrimSpace(c.Name)
		if name == "" {
			continue
		}
		if strings.ContainsAny(name, "\r\n;") || strings.ContainsAny(c.Value, "\r\n;") {
			continue
		}
		parts = append(parts, name+"="+c.Value)
	}
	return strings.Join(parts, "; ")
}

func (f *Fetcher) FetchImage(ctx context.Context, req Request) (Result, error) {
	if strings.TrimSpace(req.ProxyURL) != "" {
		return Result{}, errors.New("proxy mode is refused because target public-IP pinning cannot be enforced through an HTTP proxy")
	}
	currentURL, err := parseFetchURL(req.URL)
	if err != nil {
		return Result{}, err
	}
	timeout := req.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	maxBytes := req.MaxBytes
	if maxBytes <= 0 || maxBytes > MaxBytes {
		maxBytes = MaxBytes
	}

	referer := formatReferer(req.PageOrigin)
	cookieHeader := FormatCookieHeader(req.Cookies)

	dialFn := f.DialContext
	if dialFn == nil {
		dialFn = security.NewPublicDialContext(f.Resolver, &net.Dialer{Timeout: timeout})
	}
	transport := &http.Transport{
		Proxy:               nil,
		DialContext:         dialFn,
		TLSHandshakeTimeout: timeout,
		ForceAttemptHTTP2:   true,
	}
	defer transport.CloseIdleConnections()

	client := &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	for hops := 0; hops <= MaxRedirects; hops++ {
		httpReq, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, currentURL.String(), nil)
		if reqErr != nil {
			return Result{}, fmt.Errorf("create image request: %w", reqErr)
		}
		httpReq.Header.Set("Accept", AcceptHeader)
		if referer != "" {
			httpReq.Header.Set("Referer", referer)
		}
		if shouldAttachCookies(currentURL, req.CookieSite, cookieHeader) {
			httpReq.Header.Set("Cookie", cookieHeader)
		}

		resp, doErr := client.Do(httpReq)
		if doErr != nil {
			return Result{}, fmt.Errorf("fetch image failed: %w", doErr)
		}

		if isRedirectStatus(resp.StatusCode) {
			location := strings.TrimSpace(resp.Header.Get("Location"))
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			_ = resp.Body.Close()
			if location == "" {
				return Result{}, fmt.Errorf("redirect %d missing Location header", resp.StatusCode)
			}
			if hops >= MaxRedirects {
				return Result{}, fmt.Errorf("image fetch exceeded maximum %d redirects", MaxRedirects)
			}
			ref, refErr := url.Parse(location)
			if refErr != nil {
				return Result{}, fmt.Errorf("invalid redirect target: %w", refErr)
			}
			nextURL, validateErr := parseFetchURL(currentURL.ResolveReference(ref).String())
			if validateErr != nil {
				return Result{}, validateErr
			}
			currentURL = nextURL
			continue
		}

		if resp.StatusCode != http.StatusOK {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			_ = resp.Body.Close()
			return Result{}, fmt.Errorf("image fetch returned HTTP %d", resp.StatusCode)
		}

		body, readErr := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
		_ = resp.Body.Close()
		if readErr != nil {
			return Result{}, fmt.Errorf("read image response: %w", readErr)
		}
		if len(body) == 0 {
			return Result{}, errors.New("image fetch returned empty body")
		}
		if int64(len(body)) > maxBytes {
			return Result{}, fmt.Errorf("image fetch exceeded %d bytes", maxBytes)
		}

		return Result{
			Bytes:       body,
			ContentType: strings.TrimSpace(resp.Header.Get("Content-Type")),
			FinalURL:    currentURL.String(),
		}, nil
	}

	return Result{}, fmt.Errorf("image fetch exceeded maximum %d redirects", MaxRedirects)
}

func parseFetchURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("invalid image URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("unsupported image URL scheme: %s", parsed.Scheme)
	}
	if parsed.Host == "" {
		return nil, errors.New("image URL must include host")
	}
	if parsed.User != nil {
		return nil, errors.New("image URL must not contain embedded credentials")
	}
	return parsed, nil
}

func formatReferer(origin string) string {
	trimmed := strings.TrimSpace(origin)
	if trimmed == "" {
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
		return ""
	}
	return fmt.Sprintf("%s://%s/", parsed.Scheme, parsed.Host)
}

func shouldAttachCookies(target *url.URL, cookieSite string, cookieHeader string) bool {
	if target.Scheme != "https" {
		return false
	}
	if cookieHeader == "" || len(cookieHeader) > MaxCookieHeaderBytes {
		return false
	}
	return HostMatchesSite(target.Hostname(), cookieSite)
}

func isRedirectStatus(code int) bool {
	switch code {
	case http.StatusMovedPermanently,
		http.StatusFound,
		http.StatusSeeOther,
		http.StatusTemporaryRedirect,
		http.StatusPermanentRedirect:
		return true
	default:
		return false
	}
}
