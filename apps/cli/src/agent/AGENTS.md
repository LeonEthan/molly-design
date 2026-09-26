# apps/cli/src/agent

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.

[ACP ownership](README.md); [design launch rules](../design/AGENTS.md).
Protocol: context/acp-protocol.md; edit-payload quirks:
context/acp-agent-edit-evidence.md; adapter repos: [apps/cli/AGENTS.md](../../AGENTS.md).

## `agent-client.ts`

- Consume Core extensions via `agentCapabilities._meta.lody`, session `_meta.lody`, and
  `_lody/...`. Provider/pre-Core readers stay in `lody-acp-extension.ts`; consumers stay neutral.
- Grok Always Approve uses `allow_once`, never lasting grants; pending calls drain through
  the durable permission flow on accepted config changes. Questions remain interactive.
- Builtin Grok uses native reads: advertise terminal/readTextFile false; retain host writes.
- Send the driving turn's config on every session establishment as `_meta.lody.sessionConfig`;
  provider-specific startup translation belongs in the ACP adapter. `session/set_config_option`
  stays the live-session switch, and a successful selection becomes a later replacement's
  startup state.
- Cache session `_meta.lody.modelReasoningEfforts`; Codex `model[effort]` only.
- Project config from setup, `set_config_option` responses, and `config_option_update`.
  Present `configOptions` (including `[]`) replaces the snapshot; only omission falls back
  to the requested value, updating both replacement startup state and `currentValue`.
- Convert Core `_meta.lody.goal` epoch seconds to durable milliseconds here, and normalize
  `limited` to the durable `blocked` status.
- Keep both built-in `molly` MCP transports. INVARIANT: MCP tools must not run inside the
  daemon process.
- MCP HTTP: loopback bind plus bearer token; on Linux prove the peer socket's uid via
  `/proc/net/tcp{,6}`, REJECT an unprovable peer, and refuse to start when it is
  unreadable. `MOLLY_MCP_HTTP_DISABLED=1` forces stdio. The stdio config is an explicit env
  allowlist, never inheritance: keep `MOLLY_AUTH_URL`, `MOLLY_AUTH_SITE_URL`, and
  `MOLLY_SERVER_URL` so cloud MCP orchestration uses the daemon's deployment, let local platform
  assembly clear them before agent startup, and never add CLI credentials or secrets.
- Pass the same MCP config on initial and replacement DeepSeek Harness sessions, and preserve
  the driving Turn's `taskToolsEnabled` bit (HTTP header or stdio allowlisted env) across
  replacement and restored sessions; missing/false keeps the server mounted but drops every
  `lody_task_*` tool.
- Load workspace MCP before `initialize`; apply capabilities at `newSession`.
  Molly watches the frozen catalog, retires changed workers, and rechecks after approval.
- Managed questions belong to the pending native prompt's run/epoch. Reuse durable
  permission history; acknowledge dismissal only after cancellation settles. Prompt
  termination and connection closure abort their questions; late answers grant nothing.
- Private image import/recovery needs the matching host `allow_once` prompt, except while
  the active run's frozen mode is `auto-review`: the worker approved it, and the embedded
  control still checks run, epoch and connection ownership.
- Acknowledged steer is inject-or-refuse. `AgentSteerNotDeliveredError` requires local pre-write
  failure or agent JSON-RPC `invalid request`. Await the steer answer before abandoning the
  turn response; never classify uncertain delivery as refusal.

## Launch and runtimes

- Session-owned spawn + initialize + `newSession`/`loadSession` go through
  `acp-session-start-gate.ts` (default 2, `MOLLY_MAX_CONCURRENT_ACP_SESSION_STARTS`).
  Each startup gets one attempt and owned failure cleanup; no npx cache repair/retry.
  Generic `acp-runner.ts` launch helpers refuse before environment or runtime access.
- `setting.ts` resolves only bundled Molly asynchronously. `Session.createAgent`
  independently rejects legacy targets before environment/hook setup. Generic
  ACP spawn cannot bypass the Session-owned private channel and run lease.
  Historical launch metadata is not execution authority; no runtime fallback flag.
- Embedded design reminders belong to the worker resource loader. ACP startup,
  restore and replacement must not inject retired CLI hooks or reload native plugins.
  Preserve the launch ID used by the existing exact-resubmission MCP contract.
- External runtime download, update, authentication and launch-metadata writers are
  retired. Preserve stored catalogs and user runtime/config/session files; history
  readers do not require rebuilding external runtime versions or loading their SDKs.
  Bundled Molly's protected publisher alone owns its connection-aware catalog.
- Preserve historical npm/runtime caches when retiring launch paths; the embedded
  worker neither inspects nor purges external npx installations.

## Authentication retirement

- `acp-authentication.ts` returns fixed refusals for historical login/input RPCs.
  Molly credentials use protected model connections; probing never reads external
  CLI stores, spawns login/status commands or captures a login-shell environment.
- Historical authentication/output DTOs remain decodable. They do not authorize
  execution, and late authorization-code/form replies cannot start work.

## Capabilities and titles

- Capability refresh rejects legacy targets and launch overrides before catalog access.
  Molly reads the existing embedded catalog with exact engine/cache identity; it
  neither probes a runtime nor chooses a default model. Concurrent readers own
  independent cancellation; failed/cancelled reads never write catalog state.
  Machine Flock writes ignore `fetchedAt` when comparing entries.
- Builtin Claude owns session titles through ACP `session_info_update`; store them only after
  `sanitizeLodyInternalInstructions`, and never start `title-generator.ts`'s isolated session
  for Claude. For Codex accept only `explicit` `_meta.lody.titleSource` names, ignore its
  first-prompt `fallback`, and require `_meta.lody.messagePhase === 'final_answer'`; untyped
  chunks, error/warning payloads, and internal-instruction tails are never candidates.
  Each isolated run owns and removes a unique temp directory; concurrent session-title and
  branch-name work reuses one in-flight result. Cleanup cancels and drains title runs.
