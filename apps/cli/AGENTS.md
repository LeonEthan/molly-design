# CLI Agent Guidelines

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.
Root `AGENTS.md` applies; this file adds CLI context. Build, PR-poller, and adapter background:
[.agents/docs/cli-overview.md](../../.agents/docs/cli-overview.md). Scoped rules live under
`src/{agent,commands,session,mcp,orchestration,preview,lib}`.

## Build and packaging

- The embedded CLI starts only on the local platform; an explicit `MOLLY_PLATFORM=cloud`
  fails before Agent service composition. Keep local telemetry disabled even when
  PostHog variables exist in the shell.
- INVARIANT: the dev output layout must match production's — `index.js` plus flat sibling
  `claude-acp.js` / `codex-acp.js` / `*-worker.js` — because worker owners resolve their child by
  FILENAME next to `import.meta.url`. Keep npm packages external by ABSOLUTE path, keep
  `splitting: true`, and keep the no-hoisting assertion.
- INVARIANT: every bundle of the vendored design contracts (`design-bento/vendor/packages/contracts`)
  must apply the identical MiSans→Inter text-default rewrite with the pinned-source assert — the Vite
  production build (`vite.config.ts` `molly-vendor-text-default`) AND the esbuild dev bundle
  (`scripts/dev-build.mjs` `molly-vendor-text-default` onLoad). Divergence makes an explicit
  `fontFamily: "Inter"` pass save validation in one build and fail with PPTD-E012 in the other.
  Rationale and the third (design-authoring helper) site: `packages/design-bento/README.md`.
- Import the CLI's own `version` from `@/pkg`, never a relative `../package.json`; the package
  `name` stays `lody` internally. This package is private, has no public bin, and is shipped only inside Molly.
- Keep `prepare:acp-adapters` before `dev-build.mjs` and Vite: skipping it can silently launch old
  adapter capabilities from a stale `dist/`.
- Keep `prepare:design-authoring` before `dev-build.mjs` and Vite, and `copy:design-skills` after
  the bundle: design sessions materialize skills from `design-skills/` beside the CLI entry
  (`src/design/skills.ts`), so a stale or missing staging silently downgrades agent capability.
- `engines.node` is pinned to `>=22.14.0` by better-sqlite3's `NAPI_VERSION=10`, and
  `src/utils/sqlite-runtime-support.ts` must stay the FIRST import in `src/index.ts` — older Node
  segfaults on the SQLite binding instead of throwing.
- Read [apps/electron/AGENTS.md](../electron/AGENTS.md) — embedded packaging, native deps/ABI,
  child runtime env, and the three places the Node pin moves together — before changing runtime
  deps, bundle externals, or spawning `process.execPath` with a filtered environment.

## Coding rules

- Prefer Effect TS idioms for new/refactored CLI code — services via `Context.Tag` + `Layer`,
  typed errors, structured concurrency, `Schedule` retries: context/cli-effect-ts.md.
- Keep the strict tsconfig, no `any` or non-null assertions, and Zod at every foreign boundary:
  context/cli-type-safety.md.
- After a remote prompt arrives, only correctness-critical setup may block before ACP
  `agent.prompt`; never await notifications, analytics, or UI summaries
  (context/cli-prompt-hot-path.md).
- Startup order and timing traces: context/cli-startup.md. Local logs: context/cli-logs.md.
- Read context/local-agent-ownership.md before changing local ports/sockets, daemon PID state,
  Electron/daemon startup, Supervisor retries, or Worker shutdown; health probes are observation
  only and never authorize PID killing.
- Read context/terminal-output-lifecycle.md before changing ACP terminal notification handling or
  history compaction.

## Cross-entry agent contracts

Before changing MCP tools, their callers, or delegated Task automation, read
[src/mcp/AGENTS.md](src/mcp/AGENTS.md) for Session acceptance, reply bounds, and
execution/consent rules. These rules also bind CLI callers outside that directory.

- Child Sessions are one level deep. An independent Session created inside another persists exact
  provenance in `openedBySessionId`, plus `openedByRootSessionId` when the opener is a child Tab;
  never rewrite the exact opener to the root or treat either as `parentSessionId`.
- INVARIANT: reasoning effort and fast mode are per MODEL, because an ACP probe's `configOptions`
  describe only the model current at probe time. Validate effort against the TARGET model using
  `AcpCapabilityCacheEntry.modelReasoningEfforts` and skip the resulting `validatedConfigIds` in
  `validateTurnConfigOptionValues`; dispatch what cannot be checked offline as requested. Keep
  runtime rejections in debug diagnostics: Codex/Claude mismatches for model, effort, Fast, or Plan
  never become visible `agent_warning` notices, while other rejections still do. Claude Fable
  models omit Fast, so `fast=false` is skipped as a no-op while `fast=true` is dispatched.
- The public local runtime exposes no product-cloud feedback submission command or MCP tool.

## Agents, GitHub, and PR status

- ACP authentication rules: [src/agent/AGENTS.md](src/agent/AGENTS.md). A capability refresh after
  login proves credentials became usable and must finish inside the renderer's 300-second deadline.
- Agent `gh` auth for GitHub repo sessions is set up in `src/session/session-manager.ts`; the
  host-side credential-broker INVARIANT is in [worktree](src/session/worktree/AGENTS.md).
- Built-in provider auto-registration (`src/lib/lody.ts`) must wait for initial meta sync and a
  confirmed `syncMachineFlockDoc()` before `hasAgentConfig`/`createAgentConfig`, or a stale local
  doc creates duplicate configs; unconfirmed sync keeps a deferred backoff retry.
- `DEEPSEEK_BASE_URL` is a capability-bearing launch input: digest its exact value into the
  DeepSeek capability source version and thread the Agent config environment through every
  probe/session source-version derivation, so two endpoint catalogs never share a cache identity.
  Never put the API key or a derivative of it in that cache key.
- Molly does not start PR reconciliation or automatic code-review/merge engines. Preserve
  generic task dispatch, file watchers, and existing session/history records when changing fleet wiring.

## Design workspace files

- Use `src/design/workspace.ts` to resolve design paths from the live Session cwd
  and existing artwork/session identity. Manifest paths are dispatch facts, never
  filesystem authority. Preserve legacy turn inputs; reject changed workspace
  facts without moving drafts. Only the resolved draft is collectible; application
  projections must remain separate. See [design files](src/design/README.md).
