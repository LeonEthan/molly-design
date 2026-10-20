# Design sessions are named by the selected model

Status: implemented
Translation: pending

## Abstract

New designs stayed "Untitled design" after the first turn: the Pi harness
migration had dropped the dispatch-time title request, and models do not
reliably write `design.yaml` `title`. The fix first restored naming with a
local first-sentence generator; in PR #208 review the owner rejected prompt
text as the session name. The locked rule: the first user message of a
draft-sourced "Untitled design" session asks the user's currently selected
model for a short title. Until it lands — and on failure, an empty result or
a timeout — the name stays exactly "Untitled design", and a failed generation
never fails the turn. A manual rename is never overwritten, and a committed
artwork `title` still renames a draft or generated name.

## Decision

The Pi harness migration (`2977792`) stopped calling title generation for
Molly and left a local first-sentence generator in place. PR #146 restored
the call in `88959b4`, then `81bdd8f` removed it again so a design would stay
untitled until `design.yaml` carried a title. Models do not reliably write
that field, so every new design kept the draft name.

`a2d6d753` re-asked for a title at dispatch using the first user sentence,
and `85f45b6c` recorded that rule in the Spec and the chat invariant. In
review, 正亮 made the final call at 17:30 (Beijing) on 2026-10-20 that a
draft title must not be the raw prompt text — the first-sentence path is
rejected. Instead, the first user message of a draft-sourced session triggers one short-title generation by the user's currently
selected model. Approval is recorded on
[PR #208](https://github.com/LeonEthan/molly-design/pull/208#issuecomment-6288140215)
and covers this naming rule only. The PR's runtime implementation reuses the
session's embedded harness for this generation rather than a separate title
worker — an implementation choice, not part of the approved rule.

Correction to the earlier constraint recorded here: the rejection of a second
model request, made when Molly titles were first made local, is lifted for
exactly this one call — it is the rule's own title request to the selected
model, not a spawned title worker. The existing guard
`setTitleIfSourceIn(..., 'generated', ['draft'])` still gates the write, so a
manual rename is never overwritten. Custom-size and other internal scaffolding
added to the durable first-turn text is excluded from the title-generation
prompt. The brief is the composer text from before `$skill`, session, and
element mentions expand into paths and tool instructions, with a large-paste
placeholder restored to the pasted text. A title timeout or cancellation
aborts that provider call, and the run stays held until the call settles or
the worker is retired, so a late result cannot overlap the next turn or drop
measured usage. A committed artwork `title` renames draft or generated names
exactly as before.

## Verification

The runtime change landed in PR #208 as `1cc168f`. Per the implementation
report, its deterministic checks pass — CLI 2984, harness 281, components 3186
and Electron 407 tests, plus `pnpm check`, `pnpm format` and
`pnpm run docs check` — while live screenshot acceptance for text, image+text
and custom-size first turns remains pending. The documentation update itself
ran `pnpm run docs status`, `pnpm run docs check`, `pnpm check` and
`pnpm format` in this worktree.
