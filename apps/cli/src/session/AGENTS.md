# apps/cli/src/session

Edit `AGENTS.md`; `CLAUDE.md` symlinks here.

[Ownership](README.md), [worktree rules](worktree/AGENTS.md),
[design rules](../design/AGENTS.md).

## Authorization and identity

- Authorize machines via the access capability and source CLI token. MCP uses the frozen
  Turn requester; Operation rules: [../mcp/AGENTS.md](../mcp/AGENTS.md).
- Never send an untrusted requester through workspace Machine RPC: it authenticates no member
  identity.
- Read live status from target-daemon Machine RPC, never durable metadata.
- Derive the human identity from the active dispatch/execution runtime and fail closed when none
  exists; retries and recovery never reread mutable history.
- Credentials stay execution-host scoped; attribution, auth, GitHub/Git use frozen
  identity, never the Session owner.
- Commit identity MUST resolve through `CloudPort.access.resolveWorkspaceUser` before host git
  config; a missing-email placeholder is never one, and every minting path resolves it.

## Dispatch

- Queue-to-history promotion preserves every frozen Turn field, `agentRoleId` and
  `agentRoleRevision` included.
- Absent session meta is "unknown", not foreign: hold the TTL-bounded RPC stash until meta lands;
  drop it only on a definitive verdict.
- Subscribe to RPC offers BEFORE awaiting Doc Room join/sync and never dispatch from the RPC
  handler; history sync is the durable fallback, not a fast path.
- Missing-history recovery never advances `lastHandledUserMsgId`: set the permanent one-shot
  `lastMissingHistoryUserMsgId` ack for that turn and surface `chat_failed`.
- Retire an already-terminal stale activation into `settledActivationUserMsgId`; never claim the
  marker or rewrite `latestUserMsgId`, and report settled only if none survives.
- Never re-dispatch a late-arriving history entry; recovery is a fresh send.
- `hasPendingUserTurnActivation` is the ONLY pending-turn predicate; never compare those two
  pointers in a consumer.
- Metadata indexes activation: never open history to infer work or mutate active presence
  here (`../lib/loro/session-active-presence.ts`).
- Keep bootstrap and live reconciliation bounded as README describes; add no per-trigger scan or
  extra throttle.

## Turn execution

- Gate turn-scoped history LIST writes on user-entry sync (`turn-history-gate.ts`, 20s);
  never gate status or meta writes.
- An `active` session goal must not suppress turn completion or its notification.
- No second visible turn while `TurnRuntimeState` is registered; derive assistant
  entry ids from `userTurnId`. `invocation` atomically owns source Turn, requester, and input
  config; steer replaces it before tool execution.
- Only producers publish `latestUserMsgId`, after validated append. Retain queued input
  until activation succeeds; repair partial commits without duplicates or pointer rewind.
  Renderer/queue retain missing-history tombstones; CLI producers keep their marker policy.
- Ordinary turn execution writes only `processingUserMsgId` and `lastHandledUserMsgId`; no start
  or terminal path may read-await-rewrite the other slots.
- Classify steer as applied, proven not applied, or `delivery_unknown`. Retain exact input
  identity in recovery metadata; never requeue unknown delivery, including on Continue.
  Only matching native application evidence can settle it; never rewind newer activation.
- Resume reopens only the in-progress assistant entry: clear `finished`/`endedAt`/`permissionWaitMs`;
  teardown never writes `finished=false`.
- Keep JSON-RPC/transport matching in `acp-error-classification.ts`: disposed/stale `-32603` is
  `agent_disconnected`, Harness compression mismatch is `acp_session_storage_incompatible`.
- Legacy: retry once before ACP output. Embedded Molly: exact native restore/settlement;
  never replay prompts or history.
- No ACP output: read `turnProducedVisibleOutput` before finalization, then use
  `recordSilentTurnFailure`, finalize, advance pointer and fail open. Prompt resolution
  alone never proves success.
- Diff content comes only from the CLI-local ACP evidence store; GitHub `diffStats` use PR compare
  semantics, and `session-diff-stats-target.ts` skips rather than overwrites a good total.

## Lifecycle

- Stop flushes exact-turn `dispatchPause`; only explicit Continue resumes it, never late
  completion/reconnect. Internal rewrites retain their barrier without a user pause.
- Cancel ACK is not completion. Keep prompt/config ownership through settlement or verified
  exit plus artifacts. Failed 5s escalation retains ownership/retry. Grok requires raw load
  settlement and native `closed`/`notResident`: keep transport/raw close, share waits, accept
  late evidence, retry explicitly; never kill or replay its stopped prompt.
- Native task Stop requires capability and exact parent/task ids; never pause/release parent.

- `Session.createAgent` acquires the shared ACP start gate before spawn. ACP terminal creation
  passes the protocol's executable and argv straight to `SessionSandbox.spawn`, never a rebuilt
  shell command.
- Child tabs reuse parent workspaces. `MachineMeta` publishes `dotlodyPath`, never
  per-session paths; frontends derive them.
- `sandbox.spawn` returning output uses `captureOutput: true`, capped at 4 MiB; ACP stdio does not.
- Shutdown is two-phase: `cleanUp({ keepWorkspaceDocumentOpen: true })`, then plain `cleanUp()`
  after MessageHandler's final flush. Never tear the document down first.

## Sagas

- `session-preparation-service.ts`: peek and claim never delay cold fallback, peek never transfers
  ownership, and the resource is published BEFORE its `start()` hook. Preparation may create the
  final marked worktree and complete `newSession`, but must not create a session doc, run setup,
  append history, or publish events before adoption.
- Dispatch and claim rescan the current row and reject changed compatibility under canonical
  `buildSessionLaunchConfig` semantics; a published incompatible resource cleans up first.
- Nested child Sessions are rejected: ownership resolves one parent hop only.
- Fork commits at `LoroDocumentManager.persistPendingChanges()`; cloud `waitUntilSynced()` is
  never a success condition. Persist the target placeholder before ACP; a failed final commit
  terminates the fork and durably deletes the target.
- Fork an active source turn only on an advertised `_meta.lody.forkAtTurn = { version: 1 }`, pass
  the adapter's `_meta.lody.turnId` through unchanged as `acpTurnId`, and reuse the source Git
  identity only on an exact requester match. New-worktree forks also require native fork support,
  persist a target-doc `forkOperation` before returning, publish no target meta before the final
  commit, clean up ACP and the worktree/branch with a durable failed receipt, and stay idempotent
  on retry.
- Fork recovery fail-closes interrupted operations and finds them ONLY in the machine-local marker
  store under `withForkOperationLock`. Never enumerate rooms or open docs to find candidates, and
  never `cleanSessionDoc` a doc you do not own.
- Edit-and-resend prepares provider `forkAtTurn` (`session/new` for the first User), cancels the
  exact active turn, waits for ownership release, then one durable history/meta commit.
  Its rewrite barrier excludes queue promotion and blocks dispatch and steer; the queue is never
  rewritten. Keep the original User attribution, config, and attachments, use new turn ids and ACP
  identity, and never replay transcript or roll back files.

## Access

- Never persist `sessionLaunchConfig`: the first `session/create` payload is transient,
  resume and dispatch resolve from agent config/project, and the legacy row is fallback only.
- Dispatch access is local policy first, optional-cloud three-state second: owner-cached policy
  may allow offline, `remote_missing` and a definitive `denied` fail the turn, `indeterminate`
  leaves it pending behind `verifyMachineAccessWithRetry()`. Never collapse a thrown check into
  denial.
- Owner-allowed dispatch calls `fireOwnerAccessRecheck` with `forceBackendVerification`.
  Only online allow writes access/`verifiedAt`; deny clears, indeterminate leaves unchanged.
