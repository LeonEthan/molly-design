# apps/cli/src/lib — Index

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only. File index:
[README.md](README.md). Scoped rules: [acp](acp/AGENTS.md),
[code-collab](code-collab/AGENTS.md), [file-preview](file-preview/AGENTS.md),
[loro](loro/AGENTS.md), [pr-poller](pr-poller/AGENTS.md),
[review-automation](review-automation/AGENTS.md).

**Before touching message dispatch/sync here, read context/message-flow.md**, the
end-to-end map. The WS/DO control-plane path is DEPRECATED; do not add to it.

## Composition and transports

- `LodyFleet` accepts a local port only. Its workspace lifecycle comes entirely
  from the local catalog; startup must fail if that catalog cannot be read.
  Fleet must not subscribe to cloud workspace access or attach a remote bridge.
- Local daemon composition uses only the local port. Daemon modules must not
  construct cloud SDK clients or read product-cloud endpoint variables; optional
  unavailable operations fail at their public boundary. The platform boundary
  guard and local zero-cloud test enforce this.
- Client-visible RPC references come from public `@molly/cloud-api`; generated server
  declarations and private workspace packages are forbidden. Prime the token provider
  before reading `getGatewayBaseUrl()`, and never let runtime transports or Machine RPC
  require `MOLLY_LORO_STREAMS_BASE_URL` as a parallel hidden composition path.
- Local session control preserves every intermediate response: new clients negotiate
  NDJSON, legacy clients keep the buffered JSON envelope. `MachineRuntime` may collect
  responses for completion, but must also forward each to the streaming observer as it
  is sent.
- `Molly.start()` initializes the runtime and joins machine Flock. Embedded Agent
  registration belongs to the protected desktop catalog publisher, not startup
  discovery or a deferred legacy-registration queue.
- **Dual-author (no write intents)**: the renderer direct-authors user/UI durable
  writes against its own repo over its own Streams connection; the CLI authors only
  agent-produced data. The v4-v6 write-intent envelope (`WorkspaceWriteIntentAuthor`,
  `intent`/`intent-ack` frames, CLI preview-comment mirror) is REMOVED; never
  reintroduce a proxy-authoring path (invariants in `specs/local-first-two-plane.md`).
  Local dispatch triggers off the renderer-authored `latestUserMsgId` doc-meta write
  plus the local Machine RPC fast path.

## Local Loro data plane

Read [loro/AGENTS.md](loro/AGENTS.md) before enumerating rooms, publishing presence,
writing machine Flock rows, or reacting to reconnection. Before changing
`local-loro-data-plane-server.ts` (protocol v7, push, peer-scoped) read its
[rules and design](../../../../.agents/docs/cli-lib-local-loro-data-plane.md): named
`LoroDocumentManager` options, scheduler and bulk-writer limits, sender-enforced
framing, the RAW-chunk `createJsonLineSplitter` requirement, renderer room lifetime.
Two are never negotiable: a renderer joining a Session Doc room must not call
`getOrCreateSessionDoc` or retain a live cloud room, and the CLI's cloud room status is
never pushed to renderers as local room health.

## Sessions and turns

- PTY close is idempotent until native exit; failed close retains its record for explicit retry.

- `session-gc-manager.ts`: `evaluateMemoryPressure` returns TWO verdicts, `evict` and
  `block`, which must not share a threshold. Every probe fails OPEN, and `null`
  (UNDETERMINED) Windows commit growth must never collapse to `0`. Do not let the
  periodic sweep force the cached commit probe; never act on a cached sample once
  anything looks like pressure; re-check with a short delay before failing a turn; keep
  eviction bounded per call. The threshold is a safety MARGIN, never "what a turn
  needs". [Per-OS signals](../../../../.agents/docs/cli-lib-memory-pressure.md).
- **Session file attachments**: read the
  [local lifecycle](../../../../.agents/docs/cli-lib-session-files.md) before changing
  staging or dispatch materialization. Dispatch sends ACP `resource_link` blocks
  with `file://` URIs; never degrade this to text-only paths. Agent-shared paths
  and `resource_link file://...` output stay inside the session workspace. New
  attachments remain local; do not restore relay backfill.
- Upload replies use local blocks without URLs and preserve workspace containment.
- [acp/AGENTS.md](acp/AGENTS.md) specifies ACP buffering/flush in `message-handler.ts`,
  turn-evidence persistence, shutdown ordering, the non-expiring late-ACP target in
  `session-transient-store.ts`, and the `awaitTurnHistoryGate` requirement for
  turn-scoped history LIST writes. Read it before changing any of them. The
  `replay-prompt-builder` resume fallback is in `context/hotspots.md`.

## Projects, providers, tasks

- Builtin Codex local-project history import is read-only: require
  `_meta.lody.sessionHistory` v1 and call the Core-defined history method; never fall
  back to `loadSession`, which resumes the thread. Publish an imported Session only
  after history and its cursor are durable; legacy `metadata_only` shells stay
  selectable so a later import finishes hydration.
- Removing a local project archives every unarchived Session for that machine/project
  before deleting the project row, found through the existence and metadata indexes
  rather than by opening every Session document; a failed archive keeps the delete
  command queued for a later scan. Worktree cleanup covers only Lody-created Session
  worktrees of that project: inspect every worktree before submission and again
  immediately before deletion, never force-delete or backup-commit a dirty worktree, and
  record per-worktree deleted/kept/failed results. The original project directory is
  never a deletion target, and cleanup failures must complete the command with a visible
  result rather than leave removal pending.
- Before changing `provider-setup-manager.ts`, read its
  [rules](../../../../.agents/docs/cli-lib-provider-setup.md): row ownership and the
  single publish commit, cancellation, when the queue may start in cloud versus OSS
  local mode, and the rule that a setup row never carries authorization URLs, codes,
  tokens, or raw provider output.
- `task-doc.ts`: only creation passes `initialState` to the Mirror
  (`seedEmptyDocument`); every other path must treat an absent document as absent, or
  `readTask` answers with a placeholder meta and TASK_NOT_FOUND stops existing. Each
  write republishes the index row from the document's post-write state. Persisted Task
  documents get a repo `e/task-<id>` existence entry and no duplicated `m/*` business
  meta. **Never write the agent field here**: it is the automation consent, so
  `applyAgentTaskUpdate` covers every other scalar without an `agent` branch. Anything
  needing every visible Task uses `listWorkspaceTaskIds`, which merges existence with
  index rows, repairs a missing projection, and never revives an index tombstone.
  `status`/`ownerId`/`projects` writes here can make a task automation-eligible and
  start a session. Contract: specs/tasks.md.
- `task-automation/`: Molly-only dispatch rechecks consent and freezes explicit
  model/thinking with Task tools; baseline includes retired records to prevent replay.
  Hold Agent slots through dispatch, settlement and in-progress work. Repair writes
  only, preserving later decisions and flushing identical index rows. Boot/meta-sync
  filters Session receipts before opening Tasks, never history. State hashes guard
  repair; failures or prepared-only evidence hold new dispatch. Clear receipts after Task/index durability or
  a superseding decision, never recreate a Session.
- Historical design file reads reuse workspace metadata for unloaded/archived
  Sessions, never deleted Sessions or Agent startup. Keep Code Collab archive
  restrictions for other consumers.
- **A `file-preview/` preview must never activate Code Collab**: no workspace watch, no
  All Changes recompute, no Flock publish.

- Cleanup stops new isolated titles, aborts and drains owned title runs before document
  close, and blocks cancelled title/branch-name publication, including fallback runs.
