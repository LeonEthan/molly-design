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
