# apps/cli/src/agent

The in-progress embedded Molly branch uses `embedded-harness-runtime.ts` for a fixed
packaged sibling entry, `embedded-harness-control.ts` for public ACP/run validation and
private fd-3 credential handoff, and `harness-credential-broker.ts` for main-host leases.
It does not discover a global Pi executable. The engine boundary and current enablement
gates are documented in [harness-pi](../../../../packages/harness-pi/README.md).
Process resolution and Session startup now reject every legacy target. The generic
ACP spawn helper is a refusal boundary, including when supplied an explicit command;
Molly launches only through its Session-owned private channel and run lease.
Old launch metadata builders, runtime download/update code and session-created
legacy catalog writes are removed. Stored catalogs and history remain readable;
the protected embedded publisher owns Molly's connection-aware catalog. Builds omit
retired ACP adapters, presets, Pi shims and design hooks, and reject stale artifacts
before staging/packaging.
The generic local ACP runner is now a pre-environment refusal boundary, not a
disabled spawn behind launch preparation. Its Codex config/credential copying and
npx recovery/cache cleanup implementation are removed. Session-owned embedded
startup makes one attempt through the existing gate and retains failed-process
cleanup and stderr diagnostics; no retry or cache mutation follows startup failure.

`embedded-harness-catalog.ts` registers the available Molly identity from authoritative
local machine Flock (no cloud confirmation) and publishes a checksummed, offline SDK model projection into the existing
ACP capability cache. Connection-qualified model IDs prevent same-model cross-account
ambiguity; the initial placeholder is not a default model. Public catalog publication
never reads credentials, tests inference or changes the user's existing Agent selection.

Embedded Molly title generation uses the first local user sentence without spawning
a title worker or requesting model inference.

`session-mcp-resolver.ts` binds embedded workers to selected catalog snapshots and live
invalidation guards. Shared catalog writers assign revisions in both CLI and renderer.
AgentClient rechecks after permission delivery; Session retires only the captured worker.
Protected external MCP credentials remain an open gate.

ACP client side of the CLI: spawning coding agents, talking the Agent Client Protocol to
them, resolving their runtimes, and authenticating them. Binding rules for this directory
live in [AGENTS.md](AGENTS.md); this file is the responsibility index and the background a
reader needs to place a change.

Protocol reference: context/acp-protocol.md. Per-agent edit-payload quirks:
context/acp-agent-edit-evidence.md. Adapter source repositories and builtin provenance:
[apps/cli/AGENTS.md](../../AGENTS.md). Where updates go after they arrive:
context/message-flow.md "Upstream".

Design launches carry a fresh producer ID for optional MCP resubmission; the
embedded worker owns reminders and native settlement. [Design ownership](../design/README.md)
describes the per-client/turn fence and independent terminal validation, not read proofs.

## Files

- `agent-client.ts` — the ACP connection: initialize/session lifecycle, client
  capabilities (fs, elicitation), permission/fs request handling, update callbacks. Lody
  ACP extensions are consumed through `acp-extension-core`, so capability discovery lives
  at `agentCapabilities._meta.lody`, session metadata at `_meta.lody`, and custom methods
  use the Core `_lody/...` names.
- `acp-runner.ts` — ACP client construction, generic-launch refusal and retained
  shutdown support for historical consumers. Actual workers belong to Session.
- `acp-session-start-gate.ts` — process-wide start semaphore used by
  `Session.createAgent`; old catalog code also holds a slot before its refused spawn.
- `setting.ts` — Molly-only asynchronous launch resolution and shared environment helpers.
- `acp-authentication.ts` — fixed refusal responses for retired CLI login/status/input
  RPCs; Molly directs users to protected model connections. No subprocesses or CLI
  credential reads remain. `acp-authentication-output.ts` retains historical output parsing.
- `acp-capabilities.ts` / `acp-startup-monitor.ts` / `acp-analytics.ts` — capability cache,
  startup health, analytics.
- `login-shell-env.ts` — login-shell env capture for spawned agents.
- `fixtures/` — synthetic test fixtures.

## Background

### Grok native file reads

Builtin Grok negotiates `fs.readTextFile: false`: its native file reader handles both
images and text. Advertising the standard host UTF-8 read RPC makes Grok route PNGs
through text decoding and reject the result as binary. Host `writeTextFile`, permission
handling, and other providers retain their existing behavior. The standard text RPC
remains text-only; no binary extension or runtime patch is introduced.

### Grok permission handling

Grok's TUI combines the runtime YOLO setting with client-side `AllowOnce` responses.
`lody-acp-extension.ts` owns this compatibility rule for builtin Grok only;
`agent-client.ts` evaluates it against the accepted session config and exposes config
subscriptions. `MessageHandler` persists the selected outcome in the existing permission
history. Enabling Always Approve also drains already waiting requests and clears their UI
state and subscriptions. New requests without `allow_once` stay interactive; the queue
drain cancels such requests, matching the TUI without creating lasting grants. User
questions and other providers do not participate. The Grok adapter passes native requests
through so this durable flow remains their single owner.

### ACP start concurrency

Unbounded concurrent Codex starts each spawn a lody.exe adapter, a Codex app-server, and a
lody.exe MCP child; they contend on `~/.codex` and freeze every in-flight session until
Lody restarts. Hence the shared start gate (default 2,
`MOLLY_MAX_CONCURRENT_ACP_SESSION_STARTS`).

### The built-in `lody` MCP server has two transports

Agents whose initialize response advertises `mcpCapabilities.http` get a shared HTTP
endpoint served by ONE host subprocess per daemon (`src/mcp/molly-mcp-http-host.ts`,
supervised by `src/mcp/molly-mcp-http-server.ts`); everything else keeps the per-session
stdio entry. The supervisor keeps token and port stable across host restarts because
sessions bake the endpoint into their MCP config at creation; while the host is down, new
sessions silently fall back to stdio.

MCP tools do synchronous SQLite work (`orchestration/operation-store.ts` restricts that to
subprocess boundaries) and one-shot workspace-manager work, either of which would stall the
daemon event loop — which is why they never run inside the daemon process.

On Linux the HTTP host proves the peer socket's uid via `/proc/net/tcp{,6}` because the
bearer token leaks through the agent runtime's `/proc` cmdline there, so failing open would
void it.

Builtin DeepSeek Harness mounts the stdio server per ACP session through the extension's
native `dsh-mcp-client` bridge; the bridge owns namespace collision handling and releases
the MCP child with `session/close` or Agent teardown.

### Workspace MCP resolution is two phases

`loadExternalMcpServers` (catalog sync + document read) runs BEFORE `initialize` so its
remote round trip overlaps spawn and the handshake, and the selector it resolves to applies
the agent's advertised `http` capability at `newSession`. Awaiting the load between
`initialize` and `newSession` would put a remote sync — up to its 5s budget — on the
critical path of every session establishment while the agent process sits idle.

### Steer delivery classification

The applied-waiter must wait for the steer request's own answer before giving up on the
upstream turn's response: the Codex adapter drains session notifications before refusing,
so the turn's response routinely wins that race and would otherwise mask the refusal. A
closed connection, a dead agent process, or an internal error may have left the prompt
inside the live turn, and the caller re-sends an undelivered steer — so widening the
"not delivered" classification sends the user's message twice.

### Retired runtime services

External managed-runtime and registry installers, ZIP extraction, background updates,
DeepSeek config/launch preparation, and CLI login/status execution are removed.
Historical archive manifests remain source records, not install authority.
No CLI SDK or DSH profile dependency is needed to read stored catalogs or history.
Authentication RPCs return fixed refusals; Molly credentials use protected model
connections. User runtime caches, DSH configs and native histories remain untouched.

### Capability cache

Stored legacy capability entries remain readable for historical display but confer
no execution authority. Session creation does not refresh those entries or replace
Molly's connection-aware catalog with one worker's model selection.

`machine/acp-capabilities-refresh` rejects legacy engines and all launch overrides
before reading capabilities. Molly reads the existing published catalog, validating
engine identity and cache version; absent/mismatched catalogs fail without a probe
or write. Concurrent requests share reads per config, with independent cancellation;
deduplication stores no environment/credential values. The background update coordinator
is removed; startup neither prepares nor prunes runtime caches. Explicit install/status
RPCs return `legacy_harness_installation_disabled`. Molly refresh reads its published
embedded catalog. AgentClient still normalizes session capabilities for the live protocol; this does
not publish a model catalog. The retained normalizer also understands historical
per-model reasoning ladders and Codex model[effort] identities.

### Session titles

Builtin Claude owns session title generation through ACP `session_info_update`. Builtin Codex
still uses the isolated generator in `title-generator.ts`, but its adapter tags every pushed
title with `_meta.lody.titleSource`. Other providers use `title-generator.ts` /
`response-utils.ts`. The shared `usesAcpProvidedSessionTitle()` predicate hides obsolete
provider title settings only for Claude.

Isolated title runs accept cancellation through the existing startup gate and finish
through the owned child shutdown barrier. MessageHandler drains both session-title
and branch-name callers before closing documents; cancellation cannot publish a title
or derive a fallback branch name.

Without a saved title model override, isolated title generation keeps the actual
new ACP session's current model; list order does not imply a cheaper model or the
same endpoint. Permission and reasoning defaults remain independent. Existing saved
overrides are retained because their provenance cannot be inferred; users can still
explicitly select another title model in the existing settings field.

Grok's explicit Stop uses public `session/close` and requires the native `closed` or
`notResident` result; the generic `closeSession` boolean is not a shutdown proof. Stopped or
failed residents reject prompts until the explicit restoration path loads them. This is owned
by the [Session lifecycle](../session/README.md#grok-stop-and-explicit-restoration), including
failed-close recovery and canvas release; ordinary ACP cancel remains a separate operation.
