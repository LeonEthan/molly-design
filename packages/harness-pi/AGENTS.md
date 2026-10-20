# Embedded Pi SDK boundary

Read [README](README.md) before changing session construction, packages or the build.

- Use the pinned public SDK and unmodified published Pi packages. Never patch, fork or
  vendor Pi or a package; add a package by pinning it in catalog `pi`, listing it in
  shared `MOLLY_PI_PACKAGES` and giving it settings copy. Record known upstream defects
  instead of working around them.
- Each runtime epoch has its own Molly `PI_CODING_AGENT_DIR`, derived identically at
  launch and before SDK import. Never reuse another epoch's auth or model files or open
  the user's `~/.pi/agent`. Keep native discovery, skills, context files and hooks; Molly owns
  `settings.json`. Project code defaults to untrusted; discover materialized text skills
  through the SDK's explicit skill paths independently of executable project trust.
- Tools run without permission checks; the main session loads `cc-safety-net` as its
  destructive-command floor with `CC_SAFETY_NET_PROJECT_TIGHTEN_ONLY=1`. The managed package set is single-session: `pi-subagents`
  and its launch/configuration surfaces are retired (#72). Preserve shared task history.
  Never infer an answer from timeout, cancellation or a late reply; terminal-only UI stays unavailable.
- Compatible Anthropic Messages/Chat Completions empty keys use the same run grant;
  resolve only stored credentials, omit Authorization and never use ambient keys.
  Responses/Gemini require nonempty keys before persistence, admission or transport.
- Model keys arrive on fd 3 per run and stay in the worker's in-memory credential store;
  model catalogs/configuration also stay in memory. The managed runtime neither reads
  nor publishes profile auth/model files. Reject a changed key before runtime mutation;
  rotation requires a fresh worker. Keys never enter ACP, argv, environment, native
  history or diagnostics; errors carry static codes only. Preserve old profiles untouched.
- Pi applies a provider endpoint override to every model of that provider. A connection on
  its preset's default endpoint registers none, so each model keeps its SDK endpoint
  (OpenRouter's Anthropic-protocol models use `/api`); a custom endpoint replaces every
  model's. The host checks the selected model's resolved endpoint. A connection's
  `models`, when present, is the only native catalog it offers; refuse any other model.
  `PROVIDER_PRESET_CHECKS` must match each preset's SDK protocol (tested).
  Compatible Responses/Gemini reuse shared URL normalization and native Pi adapters;
  their explicit Settings check must verify the selected model response.
  Their native stream/streamSimple options refuse redirects; complete/extraction inherit
  that policy. Pi 1.3.0 resolves scoped Google SDK 2.23.0 for its public fetch hook;
  update the override and staging version assertion together when reviewing compatibility.
  Compatible endpoints request streaming usage only when explicitly declared; preserve
  saved `usageInStreaming` values and default unknown support to false.
- A run is fenced by exclusive creation of its run record before credentials or
  inference. An existing record means already dispatched: report
  `harness_run_already_dispatched` and never replay.
- Success requires native settlement, no unfinished tools and the final assistant entry.
  Cancellation, truncation, handled commands and extension failures never become
  completed inference.
- Serialize session construction; one managed worker owns one session, connection, model
  and thinking level. Hold the history writer guard through shutdown and legacy-marker
  removal. Reclaim only an identified owner whose PID probe returns `ESRCH`; preserve
  unidentified legacy markers. Per-worker `TMPDIR` directories follow the same ownership
  check: remove one only after its owner exits. Reclamation and release remove only that owner's token
  and an empty guard directory, never a successor's nonempty guard.
- Preserve the partitioned history layout and validate restored histories without
  rewriting them. Missing or corrupt history stays untouched.
- MCP uses Pi's native MCP, codemode and tool search. Main-session codemode exposes no
  `models` global: images go only through the user's image connection. Protected MCP values stay literal,
  bind the workspace/server/revision and are never written to config files. HTTP header
  credentials do not require an `Authorization` field. Preserve valid native server names;
  adapt other display labels through the existing catalog identity, retaining the label
  in the native description and refusing duplicate native identities. Never rewrite saved
  names or credential bindings for this adaptation.
- The managed profile enables Pi's native agent retry using its classifier:
  three retries, bounded backoff, provider retries off (#137). It repeats only the failed
  request, never a tool. The host's public `session_before_compact` hook cancels recovery
  with `willRetry`; ordinary compaction remains. Final model errors carry a static category.
  Three upstream classification/delay defects are deferred in [#143](https://github.com/LeonEthan/molly-design/issues/143)
  pending released upstream fixes; keep the no-workaround boundary above.
- `before_agent_start` serves only Molly-dispatched user prompts; any other `messageType`
  or undispatched run retires the worker.
- Build the full host system prompt once per session through `before_agent_start`,
  sampling host time and personal memory once per toolset. Persist its exact bytes in
  native session metadata with the toolset/plugin-set hashes and reuse them across turns
  and worker reloads; reminder and host-section changes apply to new sessions. A reload
  whose hashes differ, a legacy v1 entry or a well-formed later integer version rebuilds once
  and appends a new entry. The latest entry wins; any malformed entry fails with
  `pi_acp_host_invalid_system_prompt_snapshot`. Hashes sort by code unit, never locale.
  A revert of #159 must keep the v2 reader, or sessions holding v2 entries fail setup. Keep per-run memory reads for extraction
  revision fences without rewriting the session prompt. Memory extraction never retries, restarts inference or changes a
  completed outcome; persist native completion before extraction and let the caller
  retain its validated receipt after cancellation. Cancellation fences saves. Append measured extraction usage to
  native history before abort/response validation; retain failed publication for the
  next cumulative flush without repeating inference or a usage delta.
  Extraction fails soft: fenced or near-JSON replies are tolerated; prose, unfinished or
  failed replies save nothing (`unchanged`). Only a rejected read or store write reports
  `recall_failed`/`capture_failed`. Every failure leaves a static code on stderr and in
  `_meta.mollyPersonalMemoryDiagnostic`, never model output.
- First-turn naming reuses the selected runtime and current credential grant. Keep it
  tool-free, concurrent with main inference, bounded and drained before run release.
  Publish only model-generated short titles; failure/empty/timeout leaves the draft,
  without paid retries or prompt fallback. See [CLI title ownership](../../apps/cli/src/agent/README.md#session-titles).
- Tests use the real SDK with synthetic providers in owned temporary profiles. No paid
  inference, captured transcripts or machine-local records.

`CLAUDE.md` is a symlink to this file.
