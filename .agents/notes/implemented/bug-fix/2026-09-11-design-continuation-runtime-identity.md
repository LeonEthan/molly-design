# Design continuation follows the actual Agent runtime

Status: implemented
Translation: pending

## Abstract

The design hook service previously cached read evidence by source turn alone, so
recreating an Agent during the same visible turn could retain another client's
reads and attempts. Native hook requests also carried no producer identity, which
allowed delayed messages to reach a replacement service. The existing Session now
registers a fresh ID for each actual spawn and carries it through native hooks and
both existing MCP transports. The daemon checks that ID and current client before
using read evidence, preserving normal explicit continuation without introducing
recovery storage or automatic model calls.

## Decision and boundaries

This implements the runtime identity repair within [T21](https://github.com/LeonEthan/Folio/issues/23).
[Serial editing](../architecture/2026-09-11-canvas-serial-execution.zh.md),
[workspace paths](../architecture/2026-09-11-design-workspace-paths.md),
[Pi hooks](../architecture/2026-09-11-pi-design-hooks.md),
[Claude hooks](../architecture/2026-09-11-claude-design-hooks.md), and
[explicit resubmission](../simplification/2026-09-11-explicit-design-resubmission.md)
retain their responsibilities. Canonical state remains BentoDoc; current projection
and authoring draft remain separate. Root Spec remains draft.

A Session UUID alone identifies the conversation, not its running producer. A
source turn alone also survives ordinary startup recovery. Therefore the launch
owner assigns an ephemeral spawn ID before spawning, forwards it to Pi/Claude
hooks and optional MCP resubmission, and independently compares the current
AgentClient and source/canvas turn when accessing the cached service. The ID is
not a credential and adds no file or wire authority. Unsupported/missing launch
context fails closed for design hooks; ordinary tools and files retain their
existing contracts.

The same-client continuation retains native generation semantics; a new turn or
replacement obtains a fresh service and rereads the current design. Earlier
manifests, drafts, media and diagnostic receipts are preserved. Reopening remains
an existing association/read/execution-state operation, never a prompt dispatch.
Final collection still performs independent structure, assets and atomic version
checks. Missed history notifications replay existing receipts, while the known
store-write-before-receipt crash window remains a preserved conflict rather than
an invented success. No candidate workflow, checkpoint, scheduler or paid retry
was added, and manual exceptional save-copy remains independent.

## Explicit supported Agent switch

The existing main-session composer had no Agent-change callback and locked the
selector after the first message. It now exposes Pi/Claude choices only for idle
desktop design sessions. Ordinary conversations retain their existing rule.
Selection records desired configuration without launching anything. The next
explicit Turn freezes `agentConfigId`; normalization, queueing and the existing
watcher preserve it. A changed or unavailable provider fails visibly.

`SessionMeta.acpSessionAgentConfigId` pairs the existing native ACP session ID
with the provider that actually created it, independently of desired selection.
This prevents a cold restore from passing Pi's native ID to Claude. During live
replacement, the already-owned turn retires its idle Session and uses Lody's
existing restore and history replay path. Retiring callbacks, including deferred
ACP updates and delayed exit/terminated events, cannot finalize or delete the new
runtime. Actual generation/read facts still originate from the new runtime's
supported hook path. No native history or read evidence is transplanted.

Composer selection state is keyed by the exact design provider. Durable model,
mode, permission and Role defaults are scoped to their Turn provider; ACP
defaults additionally match the saved native session/provider pair. Even identical
option names cannot transfer old pinned values. Roles still require exact
machine/provider binding; a known other-provider Role cannot use the syncing
catalog fallback to claim the new Turn. Existing transient Role overrides and
hydration caches also carry their exact machine/provider key, so an unsent choice
from the old provider cannot cross while its catalog row is temporarily unknown.

## Native failure evidence

The first actual recovery probe passed cancellation, UI reload while running,
retained-draft continuation and idle reload. It then exposed a second defect:
HTTP 400 after successful native draft writes produced a committed receipt.
Inspection of `pi-acp@0.0.33` showed `agent_settled` resolving `end_turn` regardless
of native failure, with an additional prompt fallback mapping `error` to
`end_turn`. This is an ACP loss of execution semantics, not a valid design commit.

Pi `0.85.1` awaits its extension `agent_settled` callback after retries and
compaction settle. The thin extension retains only the last assistant's native
stop reason and forwards it at that event. It resets on each assistant start;
failed/missing proof cannot borrow a previous successful message. The service
accepts terminal proof only for the latest generation and current launch. The
existing Session failure path handles native error/missing proof; collection also
independently refuses any Pi result without explicit native success. This does
not add retry policy or forward provider error contents, and the original draft,
assets, frozen manifest and receipt remain the persistence model.

## Runtime preparation boundary

One cold-cache native run failed before the journey: npm extraction reported
`TAR_ENTRY_ERROR ENOENT` within the isolated Pi ACP cache, the main ACP connection
closed, and a subsequent startup recovery purged/retried that cache. The ordering
is retained outside Git and handed to T28 for installed discovery investigation;
it does not by itself prove which concurrent operation caused the extraction
failure. The functional probe now installs the pinned Pi ACP package into its
private cache before configuring Agents. This prevents runtime installation from
racing the measured hook/switch journey, and is explicitly not cold-installation
acceptance. The native version guard also correctly rejected an old host Claude
2.1.70; supported switching requires the verified 2.1.258 executable.

## Verification

The complete `corepack pnpm check` passed, including type checking, lint,
deterministic tests and public/platform boundary guards. Root formatting passed.
Docs validation passed before inheriting the T28 harness prerequisite; the final
isolated worktree reports only its three links to T18/T19/T20 notes absent from
this base. Combined integration must validate those prerequisite links.
Production-RPC regressions cover same-source-turn client
replacement, delayed native events and fresh Pi-to-Claude read evidence. Execution
and manager tests cover restore history, replacement callback isolation, terminal
failure and retained assets; shared/UI tests cover frozen provider and Role history,
queue and transient-state boundaries. Existing conflict and manual save-copy tests
remain passing.

The source-built Electron journey passed with Pi 0.85.1 / pi-acp 0.0.33 and Claude
2.1.258 / SDK 0.3.258 / ACP 0.70.0. Run the existing
`apps/cli/scripts/probe-pi-design-desktop.mjs` with `FOLIO_PROBE_RECOVERY=1`,
`FOLIO_PROBE_PI` and `FOLIO_PROBE_CLAUDE` pointing to those native binaries. Each
cancelled, failed and conflicted turn preserved the expected canonical document
and draft digest, reopened without model calls or duplicate commits, then explicitly
continued unchanged retained work. The real composer switched Pi to Claude without
starting a call; explicit Send acquired Claude generation/read evidence, rejected
a same-generation write, and committed the subsequent valid write. Reopening during
execution remained read-only. Diagnostic harness teardown completed all phases and
verified owned processes before removing the isolated directories.

The passing run is recorded outside Git in `/tmp/t21-clean-native.log`, with
synthetic receipts, final canvas, screenshots, native CLI logs and teardown evidence
under the run's reported evidence directory. External model responses are synthetic;
the actual CLI/ACP/hooks/IPC/collector are retained. This proves the functional
source-built journey with a prepared private runtime cache, not installed-package
cold discovery, paid-provider behavior or human visual quality. The earlier cache
failure remains a separate T28 investigation; no installation repair is claimed.
