# Non-invasive read reminder hooks after autosave

Status: proposed
Translation: current

[中文](2026-09-12-noninvasive-design-hooks.zh.md)

## Abstract

The user confirmed that human edits automatically write back to PPTD, and explicitly
kept a reminder hook that says "read an existing file before editing it." Synchronization
is handled by Molly Design's ordinary design save adapter; public hooks/extensions deliver the
reminder, and existing native file-tool protections continue to be reused. There is no
runtime patch or per-sampling generation read proof. The native read-before-write behavior
of the five agents is not uniform, so internal tool reads, text matching, or prompt text
cannot be treated as a universal hard check. This record updates the design and source
research; new adapter wiring and packaged acceptance have not yet been completed.

## Confirmed boundaries

- [Human autosave](../../implemented/simplification/2026-09-12-editor-owned-pptd-save.zh.md)
  updates the current PPTD and assets. Hooks do not perform synchronization and do not
  require the Agent to call a mandatory sync tool.
- Keep a thin reminder hook. The rule is: read current disk content before modifying an
  existing file; read the complete content before replacing a whole file; re-read and
  adjust after changes or conflicts; new files do not require reading a non-existent
  target. When continuing to edit an existing artwork, read the latest current design,
  do not rely only on memory from the previous turn.
- Deliver the reminder through an actual public event that can put the rule into the
  Agent context, following a plugin form like Ponytail. Prefer reusing native read/write
  checks and existing extension loading; do not add an independent read ledger,
  generation/attempt proof service, shell parser, model proxy, or runtime patch.
- "Must read first" is a behavioral requirement in the reminder; the reminder itself is
  not proof of execution order. When PreToolUse fires, write arguments usually already
  exist; if the event only adds context and lets execution continue, it cannot be claimed
  to force the current write to wait for a Read. When blocking is required, describe it
  only by the native interface's real reject/retry semantics; do not treat prompt output
  as blocking. Native support and new Molly Design wiring are accepted separately.
- Using only a static skill/project description without actually loading the hook does
  not complete this item. If an adapter has no suitable public event, record the gap,
  do not silently degrade or patch the runtime; do not deny its other creation abilities
  for that reason.
- Final submission independently checks structure, assets, provenance, and current
  version. A missing reminder does not invalidate the artifact, and a successful reminder
  gives no submission authority. Security is not attributed to model compliance with the
  reminder.

## Native capability review for the five agents

The following is a 2026-09-12 static review. Pinned source versions, rolling official
documentation, and actual installed packages are different kinds of evidence; this review
ran no models or tool probes.

| Agent / review scope | Native behavior | Implication for Molly Design |
| --- | --- | --- |
| Claude Code official current tool docs | Edit/Write has read-before-write rules, but differs by model and version; newer models may edit unread files when permissions and Read availability are met. | Reuse existing checks; cannot claim all models hard-require Read; still keep the project reminder. |
| Codex `rust-v0.153.4` / `3d2ee51` | The inspected apply_patch path validates patches, reads disk, and matches content; no observed "this session must have called a read tool first" as a general precondition. | Patch matching is not a model read proof; the public hook reminder has independent value. |
| Pi `v0.85.1` | The read tool suggests using read to inspect files, edit matches original content, write is for new files / full rewrite; the inspected edit/write paths have no session read-history gate. | Use the public extension reminder; do not treat internal tool disk reads as the Agent having read. |
| Kimi: Molly Design-hosted `f255222661c9`; also checked Moonshot official current source | The hosted adapter's Edit instruction explicitly reads before each edit, Write instruction requires reading before replacement; the inspected implementation performs file replacement/write, with no observed read-history gate. The official WriteFile/StrReplaceFile cannot infer a read constraint from internal disk reads or generated diffs. | Prefer reusing existing instructions and public hooks; the hosted adapter and the Moonshot official product must not be conflated as the same implementation. |
| Grok Build public source `37949780` | SearchReplace's `skip_read_before_edit` is marked runtime-invalid compatibility; when the setting is kept, it requires a Read tool to exist, but execution is matching/write oriented and can prompt re-read on mismatch. | A configuration name does not prove forced read; the source conclusion does not automatically override the installed 1.0.13 binary. |

Primary sources:

- [Claude tool behavior](https://code.claude.com/docs/en/tools-reference#edit-tool-behavior) and the Write section on the same page. Checking file content and checking user read permission are not the same condition.
- Codex [apply_patch handler](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/handlers/apply_patch.rs) and [patch application implementation](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/apply-patch/src/lib.rs). Conclusion is limited to the inspected standard path; it does not assert that no custom tool has protection.
- Pi [read](https://github.com/badlogic/pi-mono/blob/v0.85.1/packages/coding-agent/src/core/tools/read.ts), [edit](https://github.com/badlogic/pi-mono/blob/v0.85.1/packages/coding-agent/src/core/tools/edit.ts), [write](https://github.com/badlogic/pi-mono/blob/v0.85.1/packages/coding-agent/src/core/tools/write.ts). Custom system prompts or replacement tools can change behavior; do not rely on old-version prompt impressions.
- Kimi hosted [Edit instruction](https://github.com/LodyAI/acp-extension-kimi/blob/f255222661c9cc2842901858fd28e554d7796a51/packages/agent-core-v2/src/agent/tools/edit/edit.md), [Write instruction](https://github.com/LodyAI/acp-extension-kimi/blob/f255222661c9cc2842901858fd28e554d7796a51/packages/agent-core-v2/src/agent/tools/os/write/write.md); Moonshot official [write.py](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/tools/file/write.py), [replace.py](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/tools/file/replace.py). The latter two are rolling main; this review's conclusion is not evidence for the hosted package version.
- Grok [SearchReplace](https://github.com/xai-org/grok-build/blob/37949780c144e37df692e3d669051a21fec24f20/crates/codegen/xai-grok-tools/src/implementations/grok_build/search_replace/mod.rs#L96). The public source is not claimed to reproduce the installed distribution.

None of these checks uniformly cover Shell, scripts, or arbitrary MCP file writes. Keep
the natural file-work paradigm; do not invent an execution sandbox just to claim full
coverage.

## Ponytail reuse and pending verification

Static review of `356918eba965ee1ac64bd3a7f0dd02108350de5`; no installation or execution:

- [Claude/Codex config](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1ac64bd3a7f0dd02108350de5/hooks/claude-codex-hooks.json) registers SessionStart, SubagentStart, UserPromptSubmit; the [script](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1ac64bd3a7f0dd02108350de5/hooks/ponytail-activate.js) outputs rule context.
- [Pi extension](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1ac64bd3a7f0dd02108350de5/pi-extension/index.js) uses `before_agent_start` to add rules.
- [Grok instructions](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1ac64bd3a7f0dd02108350de5/README.md#L265) use skills, not lifecycle hooks; no Kimi-specific adapter was found. Therefore copying one configuration does not claim all five are wired.

Subsequent verification by actual hosted version and ACP launch mode: extension loading,
model actually receiving the reminder, new-file exception, continuing to edit existing
files, reminder retention after agent switch / restore, coexistence with user config,
failure feedback. If a native hard check exists, separately test reject → re-read → edit;
for paths that only have a reminder, honestly record that a single compliant model run is
not a hard guarantee.

## Replaced plans and migration status

The earlier plan put synchronization before dispatch; the user rejected that. Then a
read-hook synchronized sync was restored, and an attempt was made to build a read baseline
on tool events. The latest confirmation changed to independent editor autosave, but
explicitly rejected "delete all hooks." Therefore read-sync hooks and per-generation proof
exit the target; read-first-file reminders remain; dispatch only waits for the existing
save queue and does not add a new design-preparation flow.

The [old on-demand sync record](../../rejected/architecture/2026-09-10-design-sync-hooks.zh.md),
[Codex](../../rejected/architecture/2026-09-11-codex-design-hook-boundary.md),
[Kimi](../../rejected/architecture/2026-09-11-kimi-design-hook-boundary.md), and
[Grok](../../rejected/architecture/2026-09-11-grok-design-hook-runtime-gap.md) retain the
historical facts of the old contract and measured failures. T18–T20 must be re-accepted
under the reminder contract above; do not directly turn the old blockers into done. The
existing collection's dependence on generation proof must also be converged; do not delete
write checks in a way that leaves final collection permanently rejecting.

This update covers only the plan, phase plan, and rules; it does not change runtime code,
issue tickets, enable new hooks, or call real models. PPTD same-version save,
cancellation/recovery, formal submission, and real-image acceptance still need their own
evidence.
