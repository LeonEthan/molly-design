# apps/cli/src/commands

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.

Command entrypoints, the daemon runner, and session dispatch from the CLI/MCP boundary.
[apps/cli/AGENTS.md](../../AGENTS.md) applies; session-side rules are in
[../session/AGENTS.md](../session/AGENTS.md).

## Process and daemon lifecycle

- Local one-shot commands use `../lib/command-runtime.ts` (`runOneShotCommand`) for exit codes
  and stream flushing; they must not initialize telemetry or sync time with product cloud.
- Process entrypoints, command-owned boundaries, global process-error handlers, and generated
  standalone shims may force exit after their own cleanup policy: `start.ts` owns startup, fatal,
  and signal exits; `daemon-runner.ts` owns watchdog fatal and signal exits. Never force exit from
  reusable libraries, session/agent internals, TUI/watch flows, or worker code — expose cleanup
  and let the process boundary decide.
- Remote daemon restart: after a bounded ACK attempt, even on delivery failure,
  accepted work asks `start.ts` to exit with the reserved lifecycle code; the watchdog
  restarts after exit. See [ACK contract](../../../../specs/machine-lifecycle-ack.md).
- `start.ts` and `molly daemon start` compose only the local installation identity and
  Agent service. The daemon foreground command rejects `--auth`; the runner's ready
  handshake remains the startup success signal.
- `start` has no CLI selector, external credential detection or managed-runtime
  update/cache-preparation lifecycle. Bundled Molly needs the protected desktop host.
- The runner's fd 3 launch handshake reports success only after its supervised Worker reaches
  `startupStage=ready`. An initial Worker exit returns bounded output and terminates the runner
  instead of claiming success; retryable startup exits keep the handshake pending, and a timeout
  terminates and awaits the exact spawned runner before reporting failure.
- `molly daemon status` reports local runtime health from the probe; it omits product-cloud
  authorization and workspace-connection fields.
- Connection-age fields preserve one continuous non-connected interval across
  connecting/disconnected transitions and clear only on connected. Keep them in the top-level
  `connectionAges` v1 extension: older consumers reject unknown keys inside the strict
  backend/workspace objects. Status reports a red connection error at 60 seconds.

## Local command boundary

- Public commands do not expose cloud workspace sync, remote machine operations, hosted export,
  account management, or feedback submission. Local Task discovery still combines the physical
  document existence index with visible Task Index rows and honors tombstones.

## `molly app`

- `app.ts` registers the directory as a local project through the daemon (`local-project/add`,
  idempotent — the id is a sha256 of the resolved root path), then opens the local installation
  profile's deep link (`molly-design://chat/new?…`). Link shape lives
  in `../lib/desktop-deep-link.ts` and both sides pin the URL in unit tests.
- INVARIANT: registration happens only in the CLI. The deep link carries ids, never a path, and
  the app must never register a project from one — any web page can navigate the OS to either
  registered protocol, so a path-carrying link would let a site hand agents an arbitrary
  directory. An unknown project id just stays unselected.
- `workspaceSlug` is present only when the daemon reported workspace candidates.
- Daemon down is not a failure: the deterministic project id is computed locally and the app still
  opens, with a warning that a brand-new directory was not registered.
- Local-project control transport and the workspace picker are shared with `molly project`
  (`../lib/local-project-control-client.ts`).
- `molly app` and `molly project` use the installation-scoped local machine ID;
  neither command requires or reads a product-cloud login.

## Session create and dispatch (`session.ts`)

- Create requires same-machine Molly and a current runtime catalog; validate merged
  controls without dropping unsupported fields. Requester defaults and Role IDs bind
  exact targets. Chat validates target history defaults and freezes its exact config,
  model/thinking, MCP selection and invoking Task gate before acceptance; replay uses
  that snapshot. MCP creates freeze the invoking Turn's selected ids, including `[]`;
  Roles do not own MCP choices. Semantic model conversion preserves non-model controls.
  Structured model selections validate their ACP aliases before inheritance; freeze
  the resulting selection in Operation configs and history, including explicit retries.
- `--local-project … --worktree` sets `ProjectRef.useWorktree`; daemon startup consumes it in
  `../session/session-execution-service.ts` and worktree creation happens in
  `../session/session-manager.ts`.
- Local create resolves `ProjectRef.githubRepoFullName` from the project's `origin` for direct AND
  worktree sessions, exactly like desktop creation, because `repoFullName`, PR actions, and
  post-turn PR detection all read it. Bind only a repository the workspace enables, recording the
  workspace's spelling; an unauthorized, absent, or unreadable one leaves the Session local rather
  than failing create.
- Dispatch point-of-no-rollback (`createSessionResult` / `sendSessionChatResult`):
  `writeDispatchPointer` publishes `latestUserMsgId` locally, after which the daemon may already be
  executing the turn. `confirmDispatchSyncedBestEffort` is AWAITED so the push completes before
  the one-shot `withWorkspaceManager` transport is torn down, but it must NEVER throw — the
  durable pointer plus the SQLite Operation own delivery. The create/chat `catch` may only unwind
  when the pointer was NOT yet written (`if (!dispatched)`); rolling back after dispatch deletes an
  already-running session out from under the daemon. Do not reintroduce a hard-fail Streams ack on
  the dispatch write.
- Delegated Task creation flushes a prepared receipt before publishing its first
  pointer and dispatched receipt, then flushes again. A post-publication flush
  failure retains the Session; prepared-only recovery means outcome unknown, not
  permission to retry. Receipts authorize status repair only; chat preserves them.
- MCP create takes run config semantically (`modelId`/`reasoningEffort`/`fastMode`/`planMode`),
  never raw ACP option ids. `@molly/shared` `acp-run-config.ts` owns the mapping onto each agent's
  advertised option ids, `applyAgentRunConfigSelection` applies it once the target agent's cached
  capabilities are read, and `validateSessionCreateOptions({ dispatchConfig })` rejects
  unsupported selections before the Operation is accepted. Durable create acceptance stores each
  target's resolved effective dispatch config; recovery must use it instead of inheriting again
  from mutable requester history.
- Local daemon IPC sends the real control request once; do not restore a health preflight. Native
  `LocalDaemonAvailabilityError` must be thrown outside the Effect runtime boundary so MCP can
  preserve `DAEMON_NOT_RUNNING` versus retryable `DAEMON_BUSY`: a connection refusal means not
  running, timeout/408/429/5xx means busy.
- A renderer joining a local data-plane Session Doc room must not call
  `LoroDocumentManager.getOrCreateSessionDoc` or retain a live cloud room; use the bounded raw-doc
  one-shot reconciliation in `../lib/loro/doc.ts`, cancel it on local leave or Session activation,
  and unload renderer-only docs after the last peer leaves. Session metadata/RPC activation owns
  persistent CLI cloud joins; Flock room bridging stays paired to local Flock join/leave.
