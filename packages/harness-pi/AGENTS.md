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
  native and host tool names; preserve approved hook order.
- Load the published adapter as a normal Pi extension, including its registrations.
  Native command dispatch requires explicit host-state mappings.
  Keep implicit SDK command/template dispatch disabled for model prompts. Command
  completion must not be presented as native inference completion.
- Curated source changes require reviewed provenance/hash updates and packaged license
  resources. Negotiate question UI explicitly; bind requests to run/epoch and await
  host dismissal before returning answers. UI failures end inference; timeout/cancel/
  late replies confer no answer or approval. Terminal presentation uses the SDK headless defaults.
- Bind SDK hook failures even without question UI. Latch failure per native context,
  fence subsequent model transport and reject context reuse. Only the owning context
  may fail an active run; retain static error codes, never extension diagnostics.
- Credentials remain in memory. Tool children receive a separate sanitized
  environment; only the selected connection may receive its model credential.
- Advanced model metadata belongs to the connection revision. Register only declared
  Chat Completions models; reject unsupported tools/thinking without fallback. SDK
  zero-price placeholders are not invoices; absent streaming usage stays unmeasured.
- Selected MCP credentials bind the session/worker epoch, workspace, server,
  destination and revision. Pass the in-memory config to unmodified
  `pi-mcp-adapter`; revoke the worker when its selection or credentials change.
  The adapter owns discovery, schemas, results, connections and cancellation.
  Use its public approval event for the existing host permission policy.
  Never patch dependencies, intercept transport, rebuild per turn, or add a
  second MCP client, operation journal, image mapping or result-import callback.
- A native execution boundary, complete assistant result and settled tools must
  agree before success. Cancellation, missing evidence and transport resolution
  cannot manufacture completion or authorize replay.
- Only the journal's exclusive-open collision signals an already dispatched run;
  expose a bounded restore diagnostic before credentials or inference, preserving the record.
- Persist the SDK-owned empty session header before acknowledging a new ACP ID;
  reopen through public APIs. Existing missing/corrupt native history stays untouched.
- Journal every provider HTTP attempt before transport, compaction included.
  Restore cumulative Core accounting by request identity; unknown cost stays unknown.
- MCP errors return through the adapter's ordinary results. The Agent chooses
  subsequent actions. Add no host replay, exactly-once claim or automatic paid
  retry; cancellation does not establish that a remote request was unbilled.
- The host freezes `auto-review` into every new run; Ask is retired and offered to no one.
  Auto-review applies only to runs whose snapshot freezes it. Shell runs
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
  first public site grant goes through the classifier.
  Site grants do not authorize purchases, publishing or account changes. A site
  task grant lives only in the active run/epoch, grows by approved site at most
  eight times, and is recorded as authorization provenance in the run journal.
  Do not restore a live grant from history or reuse `session/set_mode` for it.
- Molly image MCP tools save validated files in the Session's design directory
  and return ordinary paths. File reads and design commit/CAS remain independent.
  External tools keep their native schemas and standard results.
  Preserve existing history, drafts, assets and old operation files on disk.
- Tests use synthetic messages and injected transports. Keep filesystem pollution
  fixtures inside owned temporary directories and preserve failed native history.

`CLAUDE.md` is a symlink to this file.
