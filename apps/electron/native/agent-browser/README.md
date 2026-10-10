# Embedded agent-browser

Molly builds agent-browser 0.39.0 from the commit and archive SHA-256 in
[source.json](source.json), using Rust 1.99.0 and upstream `Cargo.lock`.
[embedded.patch](embedded.patch) records the downstream host changes; this is not
an unchanged official executable. The upstream Apache-2.0 license is in [LICENSE](LICENSE); the packaged notices also cover the embedded axe-core payload.

`pnpm --dir apps/electron build:browser-driver` fetches the archive, verifies it,
applies the patch and stages one target program plus licenses, notices and manifest in
`resources/agent-browser/`. Install the Rust target for the build machine first
(for Apple Silicon: `rustup target add aarch64-apple-darwin --toolchain 1.99.0`).
Use Rust 1.99.0 in PATH. The normal build and dev entry points also prepare this
resource; the application itself never downloads a driver or browser.

The ignored `.cache/agent-browser` contains source and Cargo output. Neither the
cache nor this native source directory enters the application package. Staged
resources and source caches are also excluded from automatic formatting.
Git keeps the tracked native inputs on LF and permits the patch's blank context markers.
The manifest records the source archive, patch digest, compiler, target, file hashes
and build identity. Collection verifies it, and the existing macOS signing hook
reseals only verified signature changes before the root app's resource seal.
Changing source, patch, compiler or target invalidates the staged artifact.

Molly starts an owned daemon with `AGENT_BROWSER_EMBEDDED=1`, an isolated explicit
config, session/socket directory and random `AGENT_BROWSER_EMBEDDED_TOKEN`.
The CLI authenticates its command envelope to that daemon. The embedded mode:

- Uses one send attempt, refuses daemon auto-spawn/restart and reports unknown
  outcomes without replay. Automatic browser launch/reconnect is disabled. A literal `--` separates host flags from command data.
- Disables the upstream dashboard/stream listener. Parent stdin closure terminates
  the daemon; Molly tracks its own child handle for normal shutdown.
- Makes `webmcp result` poll immediately without cancelling or changing pending
  status, and makes `webmcp cancel` return after the cancellation acknowledgement.
  Cancellation reads the existing CDP session without renderer evaluation, and an already terminal record is returned directly. These semantics apply only to embedded mode; no new public upstream MCP catalog
  is exposed. They replace the proposal's provisional `--poll`/`--detach` syntax.
- Adds `get element-info <ref>`, reusing upstream reference resolution for fixed
  tag/input type/document URL/currentSrc/loading metadata, with password guards
  on the exposed input paths. Embedded refs reject stale nodes instead of rebinding by role/name in a replacement document.
- Gives accessibility image nodes refs through the existing snapshot map, and
  waits for ref visibility through the same frame-aware resolver with a deadline.
- Checks checkbox state after one click. If the state is still unconfirmed, it
  reports that outcome without the upstream JavaScript click fallback.
- Reuses successful WebMCP subscriptions instead of replaying `enable` on each
  listing/invocation, drains lifecycle events before returning tools, and rejects
  catalogs after a known event-stream gap until the connection is replaced.

Electron owns the page and private CDP WebSocket. The daemon receives no user
profile, plugin, provider, auto-connect, storage export or browser installation
options. Revocation cuts CDP before waiting for process/file cleanup. WebMCP
cancellation cannot roll back effects already sent by the website.
The host invalidates tool handles and a single-use invocation permit on catalog,
document, frame and session changes. Its existing CDP interceptor validates and
consumes the permit synchronously before sending `WebMCP.invokeTool`. The browser
protocol has no atomic expected-registration parameter; this guard covers changes
received by the host before dispatch, not changes still in transit or after dispatch.

The supported release target is macOS arm64. Cross-target artifacts need the
corresponding Rust target and linker; a missing target fails the build explicitly.
No native browser integration, website, installer, signing or size acceptance was
performed for this migration. Compilation and resource validation are separate
from those checks.
