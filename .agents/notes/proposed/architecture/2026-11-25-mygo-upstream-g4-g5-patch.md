# Stage 3B upstream MyGo patch

Status: proposed
Date: 2026-11-25
Translation: pending

## Abstract

Molly needs to bound custom-scheme uploads before MyGo copies the body into Go memory and to check public browser destinations at connection time. The proposed MyGo patch adds request and aggregate byte limits and gives a desktop session its own proxy configuration. Local tests cover byte accounting, proxy destination pinning and installation on a macOS data store. The macOS native transport passed its opt-in test. The remaining G4 gates are recorded below.

## Patch identity

The initial fork patch on `feat/scheme-body-limits-and-session-proxy` was commit `3a0110a8ee88f29aa9a827279cf6d4c4c71019a3`, based on `v0.10.0` (`ebde9399baf2734b3361856a53f4036859973d1d`). The diff changes 18 files with 560 insertions and 53 deletions. The exported email patch is `g4-g5.patch` in the temporary clone. Its SHA-256 is `37b25540d8dee51de3b1001ad499da4524ffaf26c6fef7e7008cee89324a6a22`.

## Draft upstream PR

**Bound desktop custom-scheme request bodies and configure per-session HTTP proxies**

Desktop backends currently buffer custom-scheme request bodies before dispatching a Go handler. Applications that need upload bounds can configure per-request and process-wide in-flight payload limits. The streaming readers use a fixed 64 KiB scratch buffer. All three backends reserve payload bytes before copying them into retained storage. A rejected request receives 413 for its own limit or 503 for aggregate pressure. Reservations return on rejection or handler exit, including error and cancellation paths. A handler that keeps running after cancellation continues to hold its reservation.

```go
type SchemeBodyLimits struct {
    MaxRequestBodyBytes         int64
    MaxInFlightRequestBodyBytes int64
}
func (*ProtocolModule) SetBodyLimits(SchemeBodyLimits) error

type SessionProxyConfig struct {
    HTTPProxy string
    Username  string
    Password  string
}
func NewProxiedSession(name string, config SessionProxyConfig) (*Session, error)
```

Zero disables the corresponding byte limit. A proxy endpoint takes a numeric IP address and explicit port in an HTTP URL. Credentials are supplied separately. An empty session name selects an ephemeral store. Reopening a named session with a conflicting configuration returns an error.

On macOS, the store installs a Network.framework HTTP CONNECT configuration with credentials, direct failover disabled and excluded domains cleared. An older system lacking the API returns an unsupported error when the store opens. Windows creates a separate WebView2 environment and user data directory for the proxied session and disables the implicit loopback bypass. It matches Basic challenges to the configured endpoint using the event URI. WebKitGTK uses the existing per-session website data manager and its proxy authentication signal. [WebView2 Basic authentication event arguments](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2basicauthenticationrequestedeventargs)

## Verification and gate status

On macOS 27.0.1 with Go 1.27.3 and cgo disabled, the complete suite reported 115 passing packages, 64 packages without runnable tests, and one failing package. Individual test and subtest events comprised 17,140 passes, 63 skips and one failure. The failure in `plugins/permissionflow.TestPermissionTitlesFollowLocale` also reproduces on the unmodified tag. It expects an older Chinese accessibility title. Running from the physical checkout path resolves a separate CLI test mismatch between the macOS paths `/tmp` and `/private/tmp`.

The tests cover 5 MiB request and 32 MiB aggregate limits, reservation recovery after handler completion, panic and cooperative cancellation, session option conflicts, and installation on a real ephemeral WKWebsiteDataStore. Windows and Linux amd64 builds and vet passed. Stripped macOS example sizes increased by 144 bytes for counter-native and 336 bytes for hello in the local comparison.

## Molly integration

Reuse the existing hostname/IP classifications and resolver interface. The existing public dialer pins DNS answers, but its concrete dialer prevents local transport substitution and its IP policy permits some IPv6 transition addresses. The loopback proxy therefore validates a request's complete answer set and passes only the selected numeric endpoint to its dial transport. Go's reverse proxy handles HTTP header forwarding and removal of hop-by-hop credentials. Both new listeners and credentials belong to one proxy instance.

Step 2 opened an upstream draft (`egoist/mygo#2360`, now closed and superseded). That work has been split into two Ready upstream PRs awaiting maintainer API review:
- [egoist/mygo#2372](https://github.com/egoist/mygo/pull/2372): custom-scheme request and aggregate in-flight body limits (`SetBodyLimits`).
- [egoist/mygo#2373](https://github.com/egoist/mygo/pull/2373): per-session HTTP CONNECT proxy (`SessionOptions.Proxy`), including Windows WebView2 CDP `Fetch.authRequired` proxy auth, loopback routing tests across macOS/Linux/Windows, and explicit documentation of Linux `libsoup` CVE-2026-66339 (unpatched Debian 13 `libsoup 3.6.5-3` credential forwarding) and WebKit macOS/Linux WebRTC UDP boundaries.

`go.mod` in this branch continues to pin `github.com/LeonEthan/mygo v0.10.1-0.20261125154445-f1967691cfde` (`feat/scheme-body-limits-proxy-rules`) until upstream merges and releases `#2372` and `#2373`.

The desktop installs scheme limits before registering handlers. Live macOS WKWebView tests received HTTP 413 for a request one byte above 5 MiB and HTTP 503 for one byte above 32 MiB in flight. Neither rejection reached the design handler. A second batch held the full 32 MiB simultaneously after success, HTTP 500 and cancellation released the first batch.

The opt-in macOS arm64 WKWebView test passed with WKContentRuleList and PublicEgressProxy. Requests to `http://127.0.0.1`, `http://localhost`, `http://[::1]` and `http://rebind.test:80` produced zero private-server hits. The simulated public page loaded, its origin received no `Proxy-Authorization`, and a controlled-account cookie injected into the isolated public browser session reached the simulated public origin without leaking into `mygo.DefaultSession()`.

Windows `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` and `WEBVIEW2_USER_DATA_FOLDER` override fail-closed rejection is verified in `internal/shell/g4_browser_proxy_windows_test.go` on `windows-latest` CI. Full authenticated Windows WebView2 proxy E2E remains pending `egoist/mygo#2373` adoption in `go.mod`. Default desktop builds keep `publicBrowser.navigate` disabled.

Step 3B adds the [macOS release workflow](../../../../.github/workflows/release-mygo-macos.yml), inside-out `Sparkle.framework` embedding/signing and Ed25519 archive signature tests in [the packaging script](../../../../scripts/package-mygo-desktop.mjs), pure-Go macOS Sparkle and Windows NSIS updaters in `internal/shell/updater*.go`, and Electron `drainOAuthForHandoff()` cross-process vault migration verification. CI Apple notarization on `main` and live signed Electron -> MyGo -> MyGo upgrade drills remain pending. [Sparkle updater parity](2026-11-25-mygo-sparkle-updater-parity.zh.md)
