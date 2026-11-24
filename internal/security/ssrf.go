package security

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
)

type HostClass string

const (
	ClassPublic     HostClass = "public"
	ClassLoopback   HostClass = "loopback"
	ClassPrivateLAN HostClass = "private-lan"
	ClassProhibited HostClass = "prohibited"
)

const MaxImageEndpointURLLength = 2048

var privateLANHTTPLiteralPattern = regexp.MustCompile(`(?i)^http://(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}(?::\d+)?(?:/|$)`)

type NonPublicDestinationError struct {
	Host string
	Addr string
}

func (e *NonPublicDestinationError) Error() string {
	if e.Addr != "" {
		return fmt.Sprintf("refusing non-public destination %s (%s)", e.Host, e.Addr)
	}
	return fmt.Sprintf("refusing non-public destination %s", e.Host)
}

type IPResolver interface {
	LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error)
}

func StripIPv6Brackets(host string) string {
	normalized := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	if strings.HasPrefix(normalized, "[") && strings.HasSuffix(normalized, "]") {
		return normalized[1 : len(normalized)-1]
	}
	return normalized
}

func ClassifyIP(addr netip.Addr) HostClass {
	if !addr.IsValid() {
		return ClassProhibited
	}
	addr = addr.Unmap()
	if addr.Is4() {
		b := addr.As4()
		return classifyIPv4(b[0], b[1], b[2], b[3])
	}
	return classifyIPv6(addr.As16())
}

func classifyIPv4(a, b, c, d byte) HostClass {
	if a == 127 {
		return ClassLoopback
	}
	if a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) {
		return ClassPrivateLAN
	}
	if a == 0 ||
		a >= 224 ||
		(a == 100 && b >= 64 && b <= 127) ||
		(a == 169 && b == 254) ||
		(a == 192 && b == 0 && c == 0) ||
		(a == 192 && b == 0 && c == 2) ||
		(a == 198 && (b == 18 || b == 19)) ||
		(a == 198 && b == 51 && c == 100) ||
		(a == 203 && b == 0 && c == 113) ||
		(a == 255 && b == 255 && c == 255 && d == 255) {
		return ClassProhibited
	}
	return ClassPublic
}

func classifyIPv6(b [16]byte) HostClass {
	allZero := true
	for i := 0; i < 16; i++ {
		if b[i] != 0 {
			allZero = false
			break
		}
	}
	if allZero {
		return ClassProhibited
	}
	prefix96Zero := true
	for i := 0; i < 12; i++ {
		if b[i] != 0 {
			prefix96Zero = false
			break
		}
	}
	if prefix96Zero {
		if b[12] == 0 && b[13] == 0 && b[14] == 0 && b[15] == 1 {
			return ClassLoopback
		}
		return classifyIPv4(b[12], b[13], b[14], b[15])
	}
	// NAT64 well-known prefix 64:ff9b::/96 and local-use 64:ff9b:1::/48.
	if b[0] == 0x00 && b[1] == 0x64 && b[2] == 0xff && b[3] == 0x9b {
		if b[4] == 0 && b[5] == 0 && b[6] == 0 && b[7] == 0 && b[8] == 0 && b[9] == 0 && b[10] == 0 && b[11] == 0 {
			return classifyIPv4(b[12], b[13], b[14], b[15])
		}
		if b[4] == 0 && b[5] == 1 {
			return ClassProhibited
		}
	}
	// 6to4 2002::/16 embeds IPv4 in bytes 2..5.
	if b[0] == 0x20 && b[1] == 0x02 {
		if c := classifyIPv4(b[2], b[3], b[4], b[5]); c != ClassPublic {
			return c
		}
	}
	// Teredo 2001:0000::/32.
	if b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x00 && b[3] == 0x00 {
		return ClassProhibited
	}
	first := uint16(b[0])<<8 | uint16(b[1])
	if (first & 0xfe00) == 0xfc00 {
		return ClassPrivateLAN
	}
	if (first&0xffc0) == 0xfe80 || (first&0xff00) == 0xff00 {
		return ClassProhibited
	}
	if b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8 {
		return ClassProhibited
	}
	return ClassPublic
}

func ClassifyHostname(hostname string) HostClass {
	host := StripIPv6Brackets(hostname)
	if host == "" {
		return ClassProhibited
	}
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return ClassLoopback
	}
	if host == "host.docker.internal" || strings.HasSuffix(host, ".local") {
		return ClassPrivateLAN
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return ClassifyIP(addr)
	}
	return ClassPublic
}

func IsPublicIP(addr netip.Addr) bool {
	return ClassifyIP(addr) == ClassPublic
}

func NormalizeImageEndpointURL(raw string) (string, *url.URL, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || len(trimmed) > MaxImageEndpointURLLength {
		return "", nil, errors.New("image connection endpoint URL must be non-empty and at most 2048 characters")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", nil, fmt.Errorf("invalid image connection endpoint URL: %w", err)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return "", nil, errors.New("image connection endpoint URL must use http or https")
	}
	if parsed.Host == "" {
		return "", nil, errors.New("image connection endpoint URL must include a host")
	}
	if parsed.User != nil {
		return "", nil, errors.New("image connection endpoint URL must not contain embedded credentials")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" || strings.Contains(trimmed, "?") || strings.Contains(trimmed, "#") {
		return "", nil, errors.New("image connection endpoint URL must not contain query or fragment")
	}
	cleanPath := strings.TrimRight(parsed.EscapedPath(), "/")
	normalized := fmt.Sprintf("%s://%s%s", parsed.Scheme, parsed.Host, cleanPath)
	return normalized, parsed, nil
}

func ValidateImageEndpointURL(raw string) (string, error) {
	normalized, parsed, err := NormalizeImageEndpointURL(raw)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "https" {
		return normalized, nil
	}
	host := StripIPv6Brackets(parsed.Hostname())
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return normalized, nil
	}
	if privateLANHTTPLiteralPattern.MatchString(strings.TrimSpace(raw)) && ClassifyHostname(host) == ClassPrivateLAN {
		return normalized, nil
	}
	return "", errors.New("image connection endpoint must use HTTPS, or HTTP with localhost or a literal RFC1918 IPv4 address")
}

func NewPublicDialContext(resolver IPResolver, baseDialer *net.Dialer) func(ctx context.Context, network, addr string) (net.Conn, error) {
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	if baseDialer == nil {
		baseDialer = &net.Dialer{}
	}
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, fmt.Errorf("invalid dial address %q: %w", addr, err)
		}
		cleanHost := StripIPv6Brackets(host)
		if ip, parseErr := netip.ParseAddr(cleanHost); parseErr == nil {
			if !IsPublicIP(ip) {
				return nil, &NonPublicDestinationError{Host: cleanHost, Addr: ip.String()}
			}
			return baseDialer.DialContext(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
		}
		if ClassifyHostname(cleanHost) != ClassPublic {
			return nil, &NonPublicDestinationError{Host: cleanHost}
		}
		addrs, lookupErr := resolver.LookupNetIP(ctx, "ip", cleanHost)
		if lookupErr != nil {
			return nil, lookupErr
		}
		if len(addrs) == 0 {
			return nil, &NonPublicDestinationError{Host: cleanHost}
		}
		for _, ip := range addrs {
			if !IsPublicIP(ip) {
				return nil, &NonPublicDestinationError{Host: cleanHost, Addr: ip.String()}
			}
		}
		var lastErr error
		for _, ip := range addrs {
			conn, dialErr := baseDialer.DialContext(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
			if dialErr == nil {
				return conn, nil
			}
			lastErr = dialErr
		}
		return nil, lastErr
	}
}
