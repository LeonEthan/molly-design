# Deterministic model wire for desktop E2E after the legacy-harness retirement

Status: implemented
Translation: pending

## Abstract

The desktop smoke suite failed on `main` because its scenarios still configured a
custom ACP agent through a Settings UI that no longer exists, and its work
journey executed turns through the retired external-harness path
(`legacy_harness_execution_disabled`). The harness now simulates the one wire
the E2E boundary allows — the external model API — with a scripted
OpenAI-completions loopback server, seeds the connection through the real
`modelConnections.save` IPC, and drives every scenario through the real
composer. The worktree journey was rescoped to what the design product can
actually create: fork-to-worktree is unreachable (session creation has no
worktree selector and the embedded engine advertises no `sessionFork`
capability, so the fork destination menu never renders), so LODY-WORK-001 now
proves permanent delete releases Session terminals while preserving the project
directory, and the backlog fork row is blocked with that evidence. The full
suite (4 scenarios) passes locally in ~40 seconds; issue #51 stays open until a
full Daily passes on CI.

## Problem

Issue #51: both P0 lifecycle scenarios died in their `Given`, waiting for an
"Add provider" button that the redesigned model-connections settings no longer
renders. Beyond the stale selector, the old harness's premise had retired:
custom ACP command lines are rejected at dispatch
(`assertEmbeddedHarnessTarget`), so the scripted ACP server could never execute
a turn again. The old WORK-001 additionally seeded a worktree Session through
internal data-plane machinery — a construction no shipping surface can produce.

## What changed

- **Scripted model server** (`e2e/fixtures/scripted-model-server.mjs`): an
  OpenAI-completions loopback endpoint keyed on the last user message —
  `[SCOUT:HOLD]` streams a first chunk and holds the turn open, anything else
  completes with a canned reply, and title-generation prompts get a short
  title. Every request, completion, cancellation, and signal lands in a JSONL
  event log, so steps await observable wire events instead of timing. Stop
  cancellation is observed on the response stream's `close` (the keep-alive
  request side does not fire reliably for aborted SSE).
- **Seeding through the product**: `SessionPage.seedDeterministicModelConnection`
  saves a loopback connection with one custom model via
  `window.ipc.invoke('modelConnections.save', …)`; saving never probes the
  endpoint. The model must declare `toolCalls: true` — the design Session
  always registers host tools and the engine rejects tool-incapable catalog
  models (`harness_model_tools_unsupported`). Selection goes through the real
  composer menu (option accessible names append the raw model id on a second
  line).
- **Journey rescope**: SESSION-001 (stop a held turn → archive → permanent
  delete) and REVIEW-001 keep their shapes on the new wire. WORK-001 no longer
  forks: create a completed Session in the synthetic Git project, open a
  Terminal and run a marker, archive, permanently delete, then assert the
  Session's terminals are gone and the project directory still exists
  (permanent delete must never delete the user's project). The registry row,
  checkpoints, coverage, and fingerprints were recomputed; LODY-FORK-001 is
  blocked with the unreachability evidence rather than deleted, so the gap
  stays visible if a product worktree path returns.
- **Fixture hygiene**: the event log lives in the retained artifact directory,
  so `startModelServer` truncates it before spawning — a previous run's
  `server-start` entry otherwise satisfies the wait with a dead port.

## Alternatives considered

- **Seed a legacy worktree Session via the data plane and execute it as
  builtin/molly**: preserves the original worktree-cleanup dimension but
  reconstructs internal session documents no product path can create, and the
  control-socket create validator rejects the builtin agent shape outright.
- **Drop WORK-001 instead of rescoping**: rejected — terminal release on
  permanent delete is a real resource-leak guard (`onSessionTerminated` →
  `terminalPtyService.closeSession`), and the registry has an explicit
  blocked-gap mechanism for the lost worktree dimension.

## Verification

- `pnpm --filter @molly/e2e check` passes (suite contract, tsc, unit tests).
- Local smoke: 3/3 P0 scenarios pass; full local suite: 4/4 pass (~40 s,
  against `apps/electron` built from this branch).
- Failure-driven evidence during repair: `harness_model_tools_unsupported` in
  the CLI backlog pinned the toolCalls requirement; a retained artifact log
  reproduced the stale-port flake.

## Limits

- Issue #51 is **not** closed by this change: only a successful full Daily may
  close it, and the Daily runs the complete matrix on CI.
- Scout soak journeys were updated to the same flows but not soak-run here.
- The installed-acceptance lane is untouched; it consumes the same harness but
  was not exercised.
- Worktree-session cleanup for historical documents remains live product code
  with Node-level coverage only.
