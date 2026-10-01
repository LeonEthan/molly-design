# Embedded Pi on native packages, without permission checks

Status: proposed (implemented on branch `feat/pi-native-addons`)
Date: 2026-10-01
Translation: pending

## Abstract

The owner asked to rebuild Molly's embedded harness on the Pi SDK plus unmodified Pi
packages with as little custom glue as possible, keeping Pi's generic agent capability
as a hard requirement and using [openpi](https://github.com/heyhuynhgiabuu/openpi) as the
reference. The worker now runs Pi 0.99.2 in Molly's own Pi profile with six published
packages, Pi's native MCP and no permission checks; the curated question/classifier
copies, OS sandbox, approval policy and HTTP request journal are deleted.

## Decisions (owner, 2026-09-30)

1. **No permission checks.** Runs use Pi's default. Auto-review, its OS sandbox
   (`@anthropic-ai/sandbox-runtime`), the vendored `pi-auto-approval` classifier, the
   browser site grants and approval provenance are removed.
2. **Keys in Molly's Pi profile.** Background sub-agents run in detached processes after
   the turn, so in-memory credentials cannot serve them. The worker stores the granted
   key through Pi's native `login` in the profile `auth.json` and writes the connection's
   provider entry in `models.json`.
3. **Packages.** `pi-subagents`, `pi-skillful`, `@zigai/pi-mention-skill`, `@ff-labs/pi-fff`;
   `@juicesharp/rpiv-ask-user-question` replaces `@eko24ive/pi-ask` (which cancels outside
   the terminal UI); `pi-context-usage` is dropped (terminal-only footer).
4. **Safety floor.** `cc-safety-net` 2.4.14 blocks known destructive commands without UI,
   in the main agent and through `subagents.defaultExtensions` in every sub-agent.

## Reuse ladder

- **Reuse:** the Pi SDK's `DefaultResourceLoader`, package discovery, native MCP/codemode/
  tool-search, `login`, `SessionManager`; the six packages unmodified; the existing host
  fd-3 credential/MCP grants, run snapshot, Core usage and question dialog contracts.
- **Reuse with adaptation:** the ACP lifecycle of `victor-software-house/pi-acp` 0.17.1,
  already adapted on the unmerged owned-adapter branch, with translation files copied.
  Direct use was rejected: it targets Pi `^0.75`, lacks non-TUI UI binding and ACP MCP.
- **Borrowed pattern:** openpi's non-TUI UI bridge (dialogs work, terminal UI is absent).
  Its native event rendering without ACP was rejected because Molly's host, history and
  design transactions are built on ACP; `svkozak/pi-acp` over `pi --mode rpc` was rejected
  for its extra process and missing host contracts.
- **Custom:** profile settings writer, profile credential persistence, host hooks (system
  prompt, time, reminder, personal memory), the run fence and history-layout restore.

Guard plugins surveyed: the `gotgenes` permission chain (auto-review variants, classifiers)
inherits [gotgenes/pi-packages#997](https://github.com/gotgenes/pi-packages/issues/997);
`@aliou/pi-guardrails` path rules need terminal UI; `@pify/yolo` writes refs into the
user's repository; sandbox/approval-heavy packages contradict decision 1.

## Limits and follow-ups

- Profile keys are plaintext (owner-only file) under Molly data. Worker epochs now have
  separate native profiles; deleting a connection does not yet remove those copies or
  revoke detached children's keys. Trust grants and package state are also scoped to the
  worker profile and are not inherited by a fresh worker.
- Background sub-agents can keep editing after a turn ends, outside the canvas read-only
  window; design commits still check versions and CAS. Their usage is not counted.
- Without permission checks, untrusted content can steer any command the user can run.
- Codex review (gpt-6-astra, high, read-only) found two P1s, both fixed: `pi-subagents`
  built-ins driving installed Codex/Claude/Cursor CLIs ran on other accounts without the
  safety floor (now disabled), and history locks left by killed workers blocked restore
  (locks now record their owner process and are taken over once it has exited). A reused
  process ID can still make a stale lock look held.
- [Pi #10249](https://github.com/earendil-works/pi/issues/10249): an MCP server still
  starting at shutdown can outlive it. Not patched.
- Evidence: real-SDK package tests (all six load; safety floor blocks without prompting;
  question answered through the GUI dialog), host tests, a bundled smoke with a loopback
  model, and `pnpm check`. One desktop design run on the locally built app (DeepSeek V4.1
  Flash, text-and-shape poster brief) completed natively in 5m41s with zero permission
  prompts: 69 tool calls including MCP through codemode, three ordinary tool errors the
  Agent handled, a rendered and autosaved artwork. Human visual review, background
  sub-agents, image generation and other providers remain unverified.

## PR #55 review follow-up

- The Settings inventory now verifies the staged `@juicesharp/rpiv-ask-user-question`
  `package.json` and `LICENSE` through the existing sealed resource manifest. It no
  longer expects the retired `pi-ask-question` manifest or reports its tool name.
- Opening arbitrary workdirs no longer grants executable project trust. The managed
  profile defaults to `never`; native saved explicit grants still apply. The SDK's
  `additionalSkillPaths` loads materialized `.agents/skills` text independently. This
  changes the harness Spec's trust intent; both translations return to draft.
- Reuse: existing capability IPC, resource digests, native trust store and skill
  loader. No replacement inventory projection, trust protocol or package patch.
- Codex second opinion (`gpt-6-astra`, high, read-only) recommends removing
  `pi-subagents` 0.74.0 until it supplies child mutation settlement. Its native
  `agent_end` drain skips GUI contexts and does not join children on every failure
  exit; foreground cancellation also has a timed settlement fallback. Defaulting
  `async` to false or wrapping model tool calls does not close all launch routes.
  Removing the package would reduce the approved delegation capability; owner
  direction on that tradeoff is pending.
- Restoring tool approvals or an OS sandbox conflicts with the explicit owner
  decision and linked approval above; this review follow-up retains that intent.
- Verification: `pnpm check`, `pnpm format` and `pnpm run docs check` pass; the
  focused harness tests (10), capability UI tests (5) and Electron service tests
  (25) pass. A freshly staged bundle verifies all 20,801 resources and its Settings
  inventory reports the live question package. No interactive desktop acceptance
  or live model inference was run for these fixes.

### Concurrent profile writers

Two subsequent P1 review findings reproduced with deterministic I/O barriers: stale
history recovery admitted two writers, and atomic catalog replacement lost a different
provider's simultaneous update. Both paths now use one harness-local process-owned
directory lock. Publication stages a nonempty directory before rename; reclamation and
release unlink only the observed owner's unique filename and remove only an empty
directory. History keeps its existing PID marker behind a lifetime guard; release is
idempotent. Profile login and catalog read-merge-publish hold the same profile lock,
preserving unrelated providers while retaining same-provider replacement semantics.

Reuse ladder: native `login`, history layout, hard-linked legacy markers and atomic
catalog publication remain. The shared file lock repeats the check/unlink race, and
the design lock uses age-based recovery and an unchecked rename. Adapting either
would replace its protocol and broaden scope. Pi's file storage backend is private,
writes in place and uses time-based leases; `proper-lockfile` also cannot guarantee
that a live history writer keeps its lock. The new primitive supplies only the missing
process ownership boundary, without a dependency, storage engine or Pi patch.

A read-only Codex second opinion (`gpt-6-astra`, high) independently confirmed both
races and supported the nonempty-directory algorithm. Its compatibility finding is
applied explicitly: unidentified legacy markers fail closed, and only `ESRCH` permits
PID recovery. Empty abandoned guard directories remain recoverable. A reused PID can
conservatively block recovery. The protocol coordinates current workers; an already
running pre-fix worker cannot be retroactively fenced and must exit before adoption.

Verification uses real filesystem operations with explicit barriers for both original
races, competing reapers and delayed release, plus an IPC-signaled worker killed with
SIGKILL. The focused suite including managed-host coverage passes 45 tests, and harness
typechecking passes. No live inference or interactive desktop acceptance was run for
these concurrency fixes.

### Connection credentials, Node floor and extraction accounting

[Three later review findings](https://github.com/LeonEthan/molly-design/pull/55#discussion_r4156220458)
identified a same-provider credential collision, an advertised Node range below Pi's
requirement, and unaccounted personal-memory inference. A read-only Codex second opinion
(`gpt-6-astra`, high) confirmed that a foreground child's copied provider configuration
could use A's endpoint with B's overwritten key; detached children reconstruct both from
the shared files. The advice was reviewed and the following changes applied explicitly.

Reuse ladder: retain native provider IDs, file-backed `ModelRuntime`, `login`, fd-3 grants
and the existing epoch binding, deriving an ordinary `PI_CODING_AGENT_DIR` for each epoch
at CLI launch and before SDK import. Provider aliases were rejected because the public
registration API does not copy executable built-in provider behavior for detached
children. A connection/revision directory handles the current Settings save path, but
cannot distinguish different keys granted against one secret-free snapshot. Epoch
isolation plus an immutable first key closes that case without another identity or
credential store. A changed grant retires the worker before either key is replaced;
rotation needs a fresh worker and no fenced run is automatically replayed.

Old profiles remain untouched and are not imported, so saved native trust grants and
package state no longer carry across workers. This is an explicit cost of isolation;
materialized workdir text skills and native shared skills continue to load. Product
history partitions and native UUID restoration remain independent of profiles. This
does not reclaim plaintext keys, revoke an old child or settle detached mutations.
The harness Spec already remains draft; both translations document the changed scope.

The workspace and CLI manifests, preinstall/startup guards and contributor guidance now
use `>=22.19.0 <23 || >=23.6.0` with Node-API 10. Pi 0.99.2 needs Node 22.19 even though
22.14 meets SQLite's ABI requirement. The existing guards and boundary-test pattern are
reused; the independent SQLite backend retains its actual Node-API requirement. The
upstream-adoption Spec's changed minimum returns both translations to draft, retaining
the previous approval reference.

Memory extraction reuses the owning `ModelRuntime` and public
`SessionManager.appendUsage`, then the existing Core usage projector. The result is
accounted before abort, stop-reason or JSON validation; no extracted text or synthetic
assistant receipt is stored. Malformed responses, cancellation and capture failures
preserve measured usage and the completed main receipt. The second opinion also found
that failed notification delivery advanced the accumulator without a retryable update;
the projector now retains its cumulative snapshot until a later successful flush,
without duplicating a native usage entry, delta or paid inference.

Verification uses real native runtimes with two same-preset workers and reconstructed
foreground/detached child credentials, a changed-grant rejection, Node boundary cases,
and extraction success, malformed JSON, cancellation, restore and delivery failure.
No paid inference or interactive desktop acceptance was run for these changes.

The 63 focused harness tests and 20 Node guard tests pass. Full `pnpm check`,
`pnpm format`, `pnpm run docs check` and `pnpm install` pass; engine-only manifest
changes leave the regenerated lockfile unchanged. A fresh sealed bundle verifies
20,801 resources and passes its loopback synthetic turn. Injected bundled-worker
version probes reject 22.18/23.5 and accept 22.19/23.6; the actual local Node is 22.22.0.

### Caller cancellation, native retries and custom MCP headers

[The next review](https://github.com/LeonEthan/molly-design/pull/55#discussion_r4157000690)
identified that the earlier worker-only cancellation test did not establish receipt
delivery through the CLI. `AgentClient` rejected immediately on abort, and the control
layer independently rejected after receipt delivery. The managed caller now sends ACP
cancel and retains raw settlement; the worker persists native completion before memory
extraction. Control accepts only matching run/epoch/native outcomes from a live worker
whose frozen connection and image catalog are still current. This final catalog check
matters because a user abort removes the model lease and its revocation subscription.
Pre-dispatch cancellation, invalid receipts and catalog revocation still fail closed.

Reuse ladder: reuse raw ACP completion, the existing cancellation drain/escalation,
run journal, catalog comparison and memory-save cancellation fences. Returning before
extraction was rejected because it would require independent ownership for credentials,
usage, history writing and shutdown. No auxiliary protocol or new outcome ledger is
introduced. A read-only Codex second opinion (`gpt-6-astra`, high) supported this option
and identified the post-abort catalog gap; its advice was reviewed and applied explicitly.
The trade-off remains that extraction delays ACP settlement and can reach the existing
Stop escalation. A native completed receipt does not override explicit Stop's durable
dispatch pause or cancelled artifact finalization. No stopped design task is promoted
to successful completion, and no task is automatically replayed.

The managed profile restores `retry.enabled: false`, `retry.maxRetries: 0` and explicit
provider `maxRetries: 0`. The second opinion found that native overflow/length compaction
recovery bypasses that setting. The existing host extension now cancels the public
`session_before_compact` event only when `willRetry` is true, preserving ordinary
compaction instead of disabling it globally. Native omission edits can precede that
hook; raw history is retained, while no summary or continuation inference is issued.
The unmodified sub-agent package's separate recovery and lifecycle policies are not
changed by this main-host hook; the existing sub-agent discussion remains open.

Protected HTTP credentials now accept custom fields such as `X-API-Key` without an
Authorization field. The existing schema, fd-3 binding, case-insensitive replacement,
duplicate rejection and literal escaping remain authoritative. The old guard inferred
OAuth intent from the header name and rejected valid catalog entries. No replacement
MCP transport or synthetic Authorization header is needed. Pi can still follow its
native OAuth fallback after a 401 and read/write its own OAuth state; the protected
custom header is neither forwarded as OAuth credentials nor written into that state.

Verification reuses the managed real-SDK fixture across harness and CLI tests. The new
integration traverses `Session.promptEmbeddedHarness`, the real ACP client/connection,
control and worker, cancels at an explicit extraction-usage barrier, and checks durable
native completion, no memory capture and a reusable worker. Control tests cover
post-cancel catalog mutation and existing revoked/invalid receipts. Production-profile
tests exercise a transient provider error, and both overflow and truncated-response
recovery with a summarizable synthetic history. A second read-only opinion confirmed
why the initial fixture missed compaction: the retained whole message left no prefix
to summarize. Native HTTP tests use in-memory fetch responses and confirm the literal
custom header on actual MCP initialization/tool requests without network or paid calls.
No interactive desktop or real-provider acceptance is claimed for these fixes.

Full `pnpm check` passes, including 135 harness tests, 3,054 CLI tests, typechecking,
lint and platform/public-boundary checks. `pnpm install`, `pnpm format` and documentation
checks pass. A fresh Pi 0.99.2 bundle verifies 20,801 resources and passes the loopback
synthetic smoke turn with 33 commands and native tools available.

The first CI run hit Vitest's default five-second timeout in the first full-profile
recovery case; the next case completed in 788 ms and all other harness tests passed.
A cold-cache local probe spent 644 ms opening the native session and another 52 ms
settling the prompt. Both recovery cases now use an explicit 30-second integration
budget for native package loading. Their event, provider-request and history assertions
remain unchanged; no sleeps, timing-based success criteria or runtime changes were added.
