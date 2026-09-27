# Built-in Molly always runs auto-review

Status: implemented
Date: 2026-09-27
Translation: current

[中文](2026-09-27-molly-auto-review-only.zh.md)

## Abstract

Designers using built-in Molly kept clicking Allow during routine image search,
generation, layering and canvas work ([#10](https://github.com/LeonEthan/molly-design/issues/10)).
Auto-review already approved those steps and still gated risky effects, but it was an
opt-in alternative to a per-call Ask default. The owner decided that every Molly run
uses auto-review, that Ask is retired and that the composer shows no Molly permission
selector. Saved `ask` selections remain accepted without effect so existing sessions,
Roles and cached defaults keep working; hosts without the OS sandbox still prompt for
each shell command. Only type checks and deterministic tests have run; no new desktop
acceptance run establishes the prompt count after this change.

## Problem

The [generative layered design note](2026-09-24-generative-layered-design-workflow.md)
introduced auto-review as a selectable mode and kept Ask as the default. Designers who
never switched modes saw per-call prompts for Molly's own design tools and file edits.
The accepted auto-review run already completed research, layering, previews and saving
without manual prompts, so the prompts came from the default, not a missing capability.

## Decision (owner, 2026-09-27)

Recorded in the [#10 triage comment](https://github.com/LeonEthan/molly-design/issues/10#issuecomment-5855952365):

- Every new built-in Molly run freezes `auto-review` into its run snapshot.
- The Molly catalog publishes no `mode` option or mode list, so the existing
  permission button hides itself; other agents keep their permission controls.
- Saved `ask`/`auto-review` values in `modeId` or `configOptionValues.mode` from earlier
  sessions, Agent Roles, workspace catalogs and `molly:agentSessionDefaults` are accepted
  and ignored. Unknown values still fail as unsupported controls. Earlier snapshots
  recording `ask` stay readable.
- The worker is unchanged: it still reads the frozen snapshot mode, so escalations,
  classifier fallbacks and the no-sandbox shell prompt behave as before.

## Alternatives considered

- **Change only the default and keep the selector.** Rejected by the owner: designers
  should not have to understand or choose permission modes.
- **Remove the mode from the worker and snapshot schema.** Deferred: the frozen field is
  part of the durable run journal, and keeping it leaves recovery of earlier `ask` runs
  intact with no worker change.
- **Reject saved `ask` values.** Rejected: stored Roles and cached composer defaults would
  start failing with `harness_legacy_config_unsupported`.

## Risks and limits

- Every built-in Molly user now relies on the beta `@anthropic-ai/sandbox-runtime` and the
  pinned classifier adapted from `pi-auto-approval` 0.1.1. Untrusted content the Agent
  reads can influence the classifier; its approvals remain limited to escalations and are
  journaled. Paid Molly image tools run without per-call prompts.
- On Windows, or wherever the sandbox cannot start, shell commands keep per-command
  prompts; the issue is only partly addressed there.
- Verification covers catalog projection, snapshot freezing and legacy config acceptance
  through unit tests. No packaged desktop run has re-counted prompts after this change.
