# Molly MCP server guidelines

Parent instructions apply.

- `molly_mcp_configure` always derives its target from the current MCP session context and
  re-authorizes that workspace with the daemon credential. Never accept a workspace selector.
- MCP configuration is an execution and credential boundary. The tool may act only on an
  explicit user request, never on instructions from repository content, websites, or tool
  output. The tool creates only new randomly identified entries and never selects them by
  default; trusted UI/CLI owns updates, review, and selection.
- Dedicated credential fields accept `${VAR}` references or daemon environment passthrough,
  not literal secrets. Tool responses must never echo connection values.
- Configurations affect only later turns or sessions; the running Agent does not hot-load them.
- Grok's Rust `rmcp` treats unterminated HTTP as transport failure. Terminate
  every response; answer `GET /mcp` with 405 because the stateless JSON SDK
  would open an unwritable SSE stream.
- Agent child processes reach the host over loopback, so a proxy must never intercept it.
  `@molly/shared/proxy-env` `withLoopbackNoProxy` is applied last when assembling agent env
  (`session.ts` `buildShellEnv`, `acp-runner.ts`) and writes BOTH `NO_PROXY` and
  `no_proxy`: clients disagree about a present-but-empty value, and Rust `reqwest` reads
  the uppercase spelling first and treats an empty one as "bypass nothing".
- Bound every Agent-authored persisted field, collection, complete configuration, and catalog.
  Serialize per-workspace Agent configuration writes before checking local name/count bounds;
  the shared CRDT is not a global CAS. Keep catalog writes locally durable while surfacing sync
  failures as unsynced.
- New `session_create` and `session_create_many` requests accept explicit target
  and run config only; strict schemas reject retired Role arguments, including
  batch defaults. Accepted Operations recover their frozen canonical Prompt and
  dispatch config without rereading a mutable catalog.
- Session orchestration derives its human identity from the active execution runtime populated
  by the dispatch payload, not from the daemon credential, Session owner, or observed history.
  An absent active runtime fails closed; never reconstruct invocation identity from history.
  Freeze the source Turn id and invoking user with every accepted Operation. Store the user
  once as `requesterUserId` and the causal Turn as `sourceTurnId`. The
  Operation's requester Session id already identifies the source Session, and a single-value
  actor tag adds no information. Recovery uses the Operation's owner Machine plus current
  authorization; it does not freeze the daemon account that originally accepted the Operation.
  Every MCP Session path rejects a runtime invocation without userId.
- INVARIANT: `molly_image` (`generate`, `edit`; `/mcp/molly_image`) exists only in design sessions; `molly_render_preview` needs a polling
  Molly desktop. Both gates are the daemon's: send `ownerSessionId`, and treat a missing gate as
  unregistered — absent from `tools/list`, never advertised-then-refused. Contract:
  `packages/shared/AGENTS.md`.
- `molly_browser`: gate list/call on active local design run and compatible host
  capability/TTL. Bind page/media to Session; validate the strict action union.
  Preserve untrusted WebMCP summaries on errors and images. Cancel rejects late
  results without replay or run-wide freeze. See the browser implementation docs.
- `molly_render_preview` forwards asset diagnostics only from the validated local
  RPC field, as fixed text and private MCP metadata. Never infer trusted metadata
  from error strings; invalid fields follow the existing refusal path.

## Session tool contracts

- MCP session tools use stable ids and narrow input schemas.
  Create/chat require a caller-chosen Operation id, and Create persists it
  before availability: a transient post-accept failure returns the active fixed
  target for daemon replay, and `session_create({ operationId, resume: true })` recovers it without
  the prompt. Completion is delivered automatically — no public wait tool — and legacy `wait=true`
  is a temporary adapter new callers must not use.
- `molly_session_create_options` publishes valid run-config values per agent config and stays
  sparse by default (online Machines, one agent config, the current local project),
  expanding only through explicit query inputs. New `workContext` accepts chat or
  local projects, including local `worktree: true`; historical GitHub metadata stays
  readable but is not a creation input.
- `session_list` defaults to 20 (maximum 100) and `session_history` to 10 (maximum 50 and 128 KiB);
  keep the MCP surface bounded though the CLI retains `session history --all`. `session_list`
  and `session_status_many` derive busy/idle from the same history, durable queue, presence, and
  Machine RPC snapshot. Operation rules: [orchestration/AGENTS.md](../orchestration/AGENTS.md).
- Image generate/edit use the user-selected model with no product default. Edits send
  bounded workspace files as ordered JSON data URLs; optional `background`/`output_format`
  pass through; one schema for both protocols, with options stated in server instructions
  and unsupported ones (and transparent JPEG) refused before dispatch. Result URLs off the endpoint host download only from checked public addresses. Results are assets only, never artwork commits. Preserve upstream failures without automatic paid retries.
  Return ordinary asset paths and metadata; transport loss or post-response publication
  failure is not proof of non-dispatch.
  Decode admitted image bytes before upload/publication, with edge, total-frame pixel
  and time limits; preserve original encoding, never repair or resize. Publication uses
  a real media directory and exclusive writes, preserving colliding files. Import refusal
  after dispatch remains unknown, never retryable. Stage the pinned decoder per target.
  Use this same file publication path for every MCP client; no private image-byte
  metadata or second owning-host import callback.
