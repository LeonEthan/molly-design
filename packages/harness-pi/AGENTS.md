# Embedded Pi SDK boundary

Read [README](README.md) before changing session construction or packaged resources.

- Import the pinned public SDK. This package owns model context, resource loading
  and native outcome mapping; the CLI owns dispatch, permissions and design commits.
- Construct every SDK dependency explicitly. Load only host-approved resources;
  private settings, credentials, model cache and sessions never use Pi defaults.
- Refresh host-clock UTC, local date/time and IANA timezone through the public
  `before_agent_start` hook for each prompt; keep that snapshot stable within its
  model/tool loop and preserve approved hooks and the read-before-edit reminder.
  Host time is not the task date, and host timezone does not establish location.
- Validate extension tool identities and collisions before SDK construction. Reserve
  native and host tool names plus Molly/MCP namespaces; preserve approved hook order.
- Native commands require explicit host-state mappings; reject unmapped registrations.
  Keep implicit SDK command/template dispatch disabled for model prompts. Command
  completion must not be presented as native inference completion.
- Curated source changes require reviewed provenance/hash updates and packaged license
  resources. Negotiate question UI explicitly; bind requests to run/epoch and await
  host dismissal before returning answers. UI failures end inference; timeout/cancel/
  late replies confer no answer or approval. Unsupported terminal UI fails.
- Bind SDK hook failures even without question UI. Latch failure per native context,
  fence subsequent model transport and reject context reuse. Only the owning context
  may fail an active run; retain static error codes, never extension diagnostics.
- Credentials remain in memory. Tool children receive a separate sanitized
  environment; only the selected connection may receive its model credential.
- Advanced model metadata belongs to the connection revision. Register only declared
  Chat Completions models; reject unsupported tools/thinking without fallback. SDK
  zero-price placeholders are not invoices; absent streaming usage stays unmeasured.
- Protected MCP discovery starts only with a run/epoch-bound private grant. Bind
  workspace, server, destination and revision before injecting headers or child env;
  freeze the resulting toolset before inference. Close and drop protected clients
  at settlement; another turn needs a new grant over the same native history.
- A native execution boundary, complete assistant result and settled tools must
  agree before success. Cancellation, missing evidence and transport resolution
  cannot manufacture completion or authorize replay.
- Persist the SDK-owned empty session header before acknowledging a new ACP ID;
  reopen through public APIs. Existing missing/corrupt native history stays untouched.
- Journal every provider HTTP attempt before transport, compaction included.
  Restore cumulative Core accounting by request identity; unknown cost stays unknown.
- Unknown MCP delivery and dispatched image failures reach Pi as ordinary tool
  results/errors; the Agent chooses any next call. Add no run stop, cross-call fence
  or host retry. A dispatched tool-call ID never replays after crash or restart.
  Asset receipts confer recovery identity, not commit authority.
  Operation failure diagnostics contain only fixed stage names, never raw errors,
  response bodies, headers or credentials; absent diagnostics remain unknown.
- Auto-review applies only to runs whose snapshot freezes `auto-review`. Shell runs
  in the pinned OS sandbox (workspace/temp writes, credential and Molly private-data
  reads denied, pre-allowed domains); Molly design tools, local attachment sharing
  and in-boundary file tools run. Sharing retains host workspace checks and local
  storage. Escalations go to the vendored classifier on the journaled session model;
  deny, failure or timeout asks the user. Record every decision in the run journal;
  a failed record denies. Classifier diagnostics use bounded outcome categories,
  never raw rationale, provider errors or arguments. Cancellation does not prompt.
  No sandbox means shell keeps its prompt. Sandbox denials may be incidental;
  preserve command errors without claiming every failure requires escalation.
- Native macOS tools may write only the canonical current-user temp directory
  reported by `getconf DARWIN_USER_TEMP_DIR`, alongside the worker-owned temp.
  Never widen this exception to `/tmp` or `/var/folders` ancestors; delete only
  worker-owned temporary files at shutdown.
- Built-in browser calls use the existing MCP approval path. In auto-review, the
  first public site grant goes through the classifier; ask mode remains manual.
  Site grants do not authorize purchases, publishing or account changes. A site
  task grant lives only in the active run/epoch, grows by approved site at most
  eight times, and is recorded as authorization provenance in the tool journal.
  Do not restore a live grant from history or reuse `session/set_mode` for it.
- Resolve MCP resource links only through the producing connection, with separate
  approval and dispatch receipts. Verify returned URI identity; never dereference
  them through host fetch or filesystem APIs. Image-result reads remain inside the
  live parent's dispatch fence; the scoped callback fixes run/server/tool identity,
  drains child reads before parent settlement and expires afterwards. Resource content
  becomes an asset only through owning-host import.
- Only built-in `molly_render_preview` may classify exact Molly-owned font and
  native-render failures, or strictly validated asset-admission metadata. Asset
  errors expose fixed categories, a bounded single-file `media/` path, and validated
  size/kind fields; never infer them from raw error text. Keep unknown server text
  and transport diagnostics redacted; errors never authorize retries or artwork repair.
- Image mappings use the selected catalog revision and explicit image model. Approve
  the mapped native arguments; validate before dispatch. External private receipts
  confer no asset authority. Unsupported paid results settle as failed, without assets.
- Keep managed built-in and external image imports within that dispatch fence;
  only the owning host's verified response supplies asset digests. Built-in MCP
  returns bytes privately for host publication, bound to the frozen image connection.
  Import never commits artwork.
- Offer local image recovery only with the host's design capability; bind its exact
  approved query and active run. Readback never dispatches MCP or settles paid state.
- Tests use synthetic messages and injected transports. Keep filesystem pollution
  fixtures inside owned temporary directories and preserve failed native history.

`CLAUDE.md` is a symlink to this file.
