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
  credentials do not require an `Authorization` field.
- Disable native agent/provider retries in the managed profile. The host's public
  `session_before_compact` hook cancels recovery with `willRetry`; ordinary compaction remains.
- Refresh host time, the read-before-edit reminder and personal memory through
  `before_agent_start`. Memory extraction never retries, restarts inference or changes a
  completed outcome; persist native completion before extraction and let the caller
  retain its validated receipt after cancellation. Cancellation fences saves. Append measured extraction usage to
  native history before abort/response validation; retain failed publication for the
  next cumulative flush without repeating inference or a usage delta.
- Tests use the real SDK with synthetic providers in owned temporary profiles. No paid
  inference, captured transcripts or machine-local records.

`CLAUDE.md` is a symlink to this file.
