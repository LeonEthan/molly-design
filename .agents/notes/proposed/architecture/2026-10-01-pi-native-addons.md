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

- Profile keys are plaintext (owner-only file) under Molly data. Connections sharing a Pi
  provider ID share one entry; deleting a connection does not yet remove it.
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
