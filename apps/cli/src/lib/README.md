# apps/cli/src/lib — file responsibilities

Binding rules live in [AGENTS.md](AGENTS.md) and in the scoped `AGENTS.md` of each
subdirectory; this file is the navigation index. Cross-module explanations live in
[`.agents/docs/`](../../../../.agents/docs/AGENTS.md).

## Message hub and transports

- `message-handler.ts` — the CLI's central message hub (largest file): session chat
  handling (`handleSessionChat`), ACP update buffering/flush, Code Collab v2 machine
  RPC wiring, local project control, session file upload/send, and the turn cloud
  side-effect gate. Turn execution itself lives in
  `../session/session-execution-service.ts`.
  Explicit legacy-design preparation is routed to
  [the continuation service](../session/README.md); its local RPC creates a durable
  receipt and inspects attachments without publishing or running the target.
- `machine-runtime.ts` — local machine runtime bootstrap, session dispatch and
  local control/Machine RPC. Remote bridge attach/detach/revoke was removed.
- `machine-lifecycle.ts` — remote restart verification against the auth site.
  Remote upgrade (npm self-install) was removed: the `lody` npm package is
  third-party, and updates ship through the desktop release channel.
  `../commands/daemon-runner.ts` owns the restart respawn.
- `cloud-cli-port.ts` — inherited cloud composition still used by remaining one-shot
  command paths. The embedded `start.ts` now constructs only the local port and
  injects it through Fleet → Lody → MachineRuntime → MessageHandler/Loro/session services.
- `molly-fleet.ts` — starts the implicit workspace from the local catalog, owns
  local IPC/Loro/terminal services, and rejects nonlocal ports. Hosted workspace
  subscriptions and remote-bridge orchestration have been removed.
- `local-loro-data-plane-server.ts` — Electron renderer ↔ CLI local Loro data plane
  (protocol v7). Design:
  [`.agents/docs/cli-lib-local-loro-data-plane.md`](../../../../.agents/docs/cli-lib-local-loro-data-plane.md).
- `local-ipc-socket-server.ts`, `local-control-handler.ts`, `local-session-control.ts`,
  `local-project-control-service.ts`, `local-project-control-client.ts` — the local
  daemon socket surface and its clients.

## Sessions, files, and attachments

- `session-image-download.ts` — CLI-side prompt image download through the injected
  attachment capability, including short retries before converting bytes to ACP image
  blocks.
- `session-file-blob-store.ts`, `session-file-attachments.ts`,
  `acp-agent-attachments.ts` — the local attachment lifecycle;
  see
  [`.agents/docs/cli-lib-session-files.md`](../../../../.agents/docs/cli-lib-session-files.md).
- `session-gc-manager.ts` — idle cleanup plus memory-pressure reclamation. Per-OS
  measurement rationale:
  [`.agents/docs/cli-lib-memory-pressure.md`](../../../../.agents/docs/cli-lib-memory-pressure.md).
- `session-transient-store.ts` — buffered ACP updates and their turn ownership.
- `session-activity-status.ts`, `session-live-status.ts` — derived busy/idle state.

## Projects, providers, and tasks

- `local-project-history-sync-service.ts` / `local-project-history-precheck.ts` —
  builtin Codex local-project history import.
- `local-project-removal.ts` — local project deletion, session archiving, and optional
  Lody-created worktree cleanup.
- `provider-setup-manager.ts` — durable default managed-builtin agent config creation.
- `task-doc.ts` — every CLI-side read/write of a Task document, plus
  `listWorkspaceTaskIds` and the index-only listing (`listTasksFromIndex` / pure
  `selectTaskIndexRows`). Normative contract: specs/tasks.md.

## Subdirectories

- `acp/` — ACP notification → session history pipeline ([AGENTS.md](acp/AGENTS.md)).
- `code-collab/` — unified Code Collab v2 filesystem RPC service
  ([AGENTS.md](code-collab/AGENTS.md)).
- `file-preview/` — the `file/preview` (File Preview v3) read path
  ([AGENTS.md](file-preview/AGENTS.md)).
- `loro/` — Loro repo/runtime layer, presence, machine flock rooms, and connection
  recovery ([AGENTS.md](loro/AGENTS.md)).
- PR polling and automatic code review/merge were retired from Molly; no scheduler,
  credential harvest, or dedicated scheduling database is opened. Existing records remain on disk.

- `task-automation/` — delegated task automation: `planTaskAutomation` is a pure
  policy holding every gate that keeps it from spending tokens by surprise, the
  scheduler is a thin orchestrator, and the per-workspace handle watches the task
  index and re-evaluates on `onStreamsOnline` so work held while offline still
  starts. The scheduler excludes retired/overridden engines without rewriting Task
  records; its boot baseline still includes those records. `task-automation-start.ts`
  re-reads the entrusted target, owner and status, validates the persisted Molly
  model projection, and passes those exact controls to Session creation with Task
  tools enabled. Command acceptance then validates the current target/model catalog.
  Once dispatch returns, the scheduler owns a separate status-only settlement callback.
  A failed local write retains the Agent slot and started-task identity; an owned retry
  timer and ordinary index/reconnect evaluations retry only that callback. The guarded
  Task mutation preserves subsequent completion, reassignment and owner changes. Index
  publication flushes unchanged rows too, because equal memory state does not prove an
  earlier flush succeeded. `task-automation-recovery.ts` reconstructs status-only work
  from the receipt published with the Session's first dispatch pointer. A prepared
  receipt is flushed before publication, then the dispatched receipt is flushed;
  prepared-only recovery retains an unknown outcome without executing anything.
  Post-publication persistence errors retain the Session. Recovery filters
  Session metadata by machine/user before opening only referenced existing Tasks;
  no Session histories are opened. A canonical hash of Task meta/body/timeline
  excludes dispatch-owned link bookkeeping and preserves later decisions. Task/index
  durability precedes clearing and flushing the receipt; retries flush pending clears
  even if memory already reports no receipt. Boot and the rate-limited metadata catch-up
  edge trigger recovery; unavailable/corrupt evidence holds new automation and owns
  a 30-second retry. Disposal cancels the retry and drains owned recovery. Legacy
  dispatches without receipts are not guessed or replayed; the boot baseline remains.
- `analytics/`, `git/`, `notifications/`, `session-export/`, `usage/` — supporting
  services.

## Local reference images

`message-handler.ts` accepts local attachment staging under the landing composer's
reserved Session ID without creating a Session. Sent PNG/JPEG/WebP/GIF file blocks
retain their existing resource links and additionally supply ACP image bytes and the
same bytes/hash to the design turn reference snapshot. Image MCP configuration is
independent. Other file formats keep the file resource path.

The local `file/resolve-local` attachment variant resolves only a matching persisted
history identity to its blob, verifies its hash, and hands the result to Electron's
existing local resource service. It does not create an alternative download server.

Design canvas preparation reuses the local machine RPC dispatcher: `canvas-host`
reports belong to the existing execution owner, and `MessageHandler` supplies the
Session's artwork identity. An unavailable desktop never implies an empty canvas;
see [execution](../session/README.md#design-canvas-preparation).
