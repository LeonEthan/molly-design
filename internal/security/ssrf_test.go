package security

import (
	"context"
	"errors"
	"net/netip"
	"testing"
)

type stubResolver struct {
	addrs []netip.Addr
	err   error
}

func (r stubResolver) LookupNetIP(_ context.Context, _, _ string) ([]netip.Addr, error) {
	return r.addrs, r.err
}

func TestClassifyIP(t *testing.T) {
	cases := []struct {
		addr string
		want HostClass
	}{
		{"8.8.8.8", ClassPublic},
		{"1.1.1.1", ClassPublic},
		{"2606:4700:4700::1111", ClassPublic},
		{"127.0.0.1", ClassLoopback},
		{"127.0.1.5", ClassLoopback},
		{"::1", ClassLoopback},
		{"::ffff:127.0.0.1", ClassLoopback},
		{"10.0.0.1", ClassPrivateLAN},
		{"172.16.5.4", ClassPrivateLAN},
		{"172.31.255.254", ClassPrivateLAN},
		{"192.168.1.10", ClassPrivateLAN},
		{"::ffff:192.168.1.10", ClassPrivateLAN},
		{"fc00::1", ClassPrivateLAN},
		{"fd12:3456::1", ClassPrivateLAN},
		{"169.254.169.254", ClassProhibited},
		{"100.64.0.1", ClassProhibited},
		{"0.0.0.0", ClassProhibited},
		{"224.0.0.1", ClassProhibited},
		{"255.255.255.255", ClassProhibited},
		{"::", ClassProhibited},
		{"fe80::1", ClassProhibited},
		{"ff02::1", ClassProhibited},
		{"2001:db8::1", ClassProhibited},
		{"64:ff9b::127.0.0.1", ClassLoopback},
		{"64:ff9b::10.0.0.1", ClassPrivateLAN},
		{"64:ff9b:1::1", ClassProhibited},
		{"2002:0a00:0001::1", ClassPrivateLAN},
		{"2002:7f00:0001::1", ClassLoopback},
		{"::10.0.0.1", ClassPrivateLAN},
		{"::127.0.0.1", ClassLoopback},
		{"192.0.2.1", ClassProhibited},
		{"198.18.0.1", ClassProhibited},
		{"198.51.100.5", ClassProhibited},
		{"203.0.113.5", ClassProhibited},
	}
	for _, tc := range cases {
		ip := netip.MustParseAddr(tc.addr)
		got := ClassifyIP(ip)
		if got != tc.want {
			t.Errorf("ClassifyIP(%s) = %q, want %q", tc.addr, got, tc.want)
		}
	}
}

func TestValidateImageEndpointURL(t *testing.T) {
	valid := []struct {
		in   string
		want string
	}{
		{"https://api.openai.com/v1/", "https://api.openai.com/v1"},
		{"https://dashscope.aliyuncs.com/api/v1", "https://dashscope.aliyuncs.com/api/v1"},
		{"http://localhost:8080/v1/", "http://localhost:8080/v1"},
		{"http://127.0.0.1:9000/v1", "http://127.0.0.1:9000/v1"},
		{"http://[::1]:9000/v1", "http://[::1]:9000/v1"},
		{"http://192.168.1.25:8000/v1", "http://192.168.1.25:8000/v1"},
		{"http://10.0.0.5/v1", "http://10.0.0.5/v1"},
		{"http://172.20.0.2:8080", "http://172.20.0.2:8080"},
	}
	for _, tc := range valid {
		got, err := ValidateImageEndpointURL(tc.in)
		if err != nil {
			t.Errorf("ValidateImageEndpointURL(%q) unexpected error: %v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("ValidateImageEndpointURL(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}

	invalid := []string{
		"",
		"http://api.openai.com/v1",
		"http://mybox.local/v1",
		"http://169.254.169.254/latest",
		"https://user:pass@api.openai.com/v1",
		"https://api.openai.com/v1?foo=bar",
		"https://api.openai.com/v1#frag",
		"ftp://api.openai.com/v1",
		"http://010.0.0.1/v1",
	}
	for _, raw := range invalid {
		if _, err := ValidateImageEndpointURL(raw); err == nil {
			t.Errorf("ValidateImageEndpointURL(%q) succeeded, expected error", raw)
		}
	}
}

func TestNewPublicDialContextBlocksNonPublic(t *testing.T) {
	ctx := context.Background()

	dial := NewPublicDialContext(stubResolver{
		addrs: []netip.Addr{
			netip.MustParseAddr("93.184.216.34"),
			netip.MustParseAddr("10.0.0.5"),
		},
	}, nil)
	if _, err := dial(ctx, "tcp", "mixed.example.com:443"); err == nil {
		t.Fatal("expected mixed public+private DNS result to be rejected")
	} else {
		var nonPublic *NonPublicDestinationError
		if !errors.As(err, &nonPublic) {
			t.Fatalf("expected NonPublicDestinationError, got %T: %v", err, err)
		}
	}

	literalDial := NewPublicDialContext(stubResolver{}, nil)
	for _, addr := range []string{
		"127.0.0.1:80",
		"[::1]:80",
		"169.254.169.254:80",
		"localhost:80",
		"printer.local:443",
		"[::ffff:192.168.1.1]:443",
	} {
		if _, err := literalDial(ctx, "tcp", addr); err == nil {
			t.Errorf("expected %s to be blocked", addr)
		}
	}
}

func TestValidatePublicHTTPURLResolvesDNSAndBlocksPrivateTargets(t *testing.T) {
	ctx := context.Background()
	publicResolver := stubResolver{addrs: []netip.Addr{netip.MustParseAddr("93.184.216.34")}}
	if err := ValidatePublicHTTPURLWithResolver(ctx, "https://example.com/gallery", publicResolver); err != nil {
		t.Fatalf("expected public domain to pass, got %v", err)
	}

	privateResolver := stubResolver{addrs: []netip.Addr{netip.MustParseAddr("127.0.0.1")}}
	if err := ValidatePublicHTTPURLWithResolver(ctx, "https://rebind.example.com/", privateResolver); err == nil {
		t.Fatal("expected domain resolving to loopback IP to be rejected")
	} else {
		var nonPublic *NonPublicDestinationError
		if !errors.As(err, &nonPublic) {
			t.Fatalf("expected NonPublicDestinationError, got %T: %v", err, err)
		}
	}

	mixedResolver := stubResolver{addrs: []netip.Addr{
		netip.MustParseAddr("93.184.216.34"),
		netip.MustParseAddr("10.0.0.8"),
	}}
	if err := ValidatePublicHTTPURLWithResolver(ctx, "https://mixed.example.com/", mixedResolver); err == nil {
		t.Fatal("expected domain resolving to mixed public+private IPs to be rejected")
	}

	emptyResolver := stubResolver{}
	if err := ValidatePublicHTTPURLWithResolver(ctx, "https://empty.example.com/", emptyResolver); err == nil {
		t.Fatal("expected domain with no resolved IPs to be rejected")
	}
}
