# Embedded Pi SDK boundary

Read [README](README.md) before changing session construction, packages or the build.

- Use the pinned public SDK and unmodified published Pi packages. Never patch, fork or
  vendor Pi or a package; add a package by pinning it in catalog `pi` and listing it in
  `profile-settings.ts`. Record known upstream defects instead of working around them.
- The worker profile is Molly's own `PI_CODING_AGENT_DIR`. Never open the user's
  `~/.pi/agent`. Keep Pi's native discovery, skills, context files and hooks; Molly owns
  `settings.json` and trusts its session workdirs.
- Tools run without permission checks. `cc-safety-net` is the only floor and must stay in
  `subagents.defaultExtensions`. Never infer an answer from timeout, cancellation or a late
  reply; terminal-only UI stays explicitly unavailable.
- Model keys arrive on fd 3 per run, are pinned in memory and stored through native
  `login` in the profile for sub-agents. Keys never enter ACP, argv, environment, native
  history or diagnostics; errors carry static codes only.
- A run is fenced by exclusive creation of its run record before credentials or
  inference. An existing record means already dispatched: report
  `harness_run_already_dispatched` and never replay.
- Success requires native settlement, no unfinished tools and the final assistant entry.
  Cancellation, truncation, handled commands and extension failures never become
  completed inference.
- Serialize session construction; one managed worker owns one session, connection, model
  and thinking level. Hold the history writer lock until shutdown completes.
- Preserve the partitioned history layout and validate restored histories without
  rewriting them. Missing or corrupt history stays untouched.
- MCP uses Pi's native MCP, codemode and tool search. Protected MCP values stay literal,
  bind the workspace/server/revision and are never written to config files.
- Refresh host time, the read-before-edit reminder and personal memory through
  `before_agent_start`. Memory extraction never retries, restarts inference or changes a
  completed outcome; cancellation fences saves.
- Tests use the real SDK with synthetic providers in owned temporary profiles. No paid
  inference, captured transcripts or machine-local records.

`CLAUDE.md` is a symlink to this file.
