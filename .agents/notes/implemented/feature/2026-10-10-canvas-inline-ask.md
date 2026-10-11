# Canvas inline ask: Ask Molly at the selection

Status: implemented
Translation: current

[中文](2026-10-10-canvas-inline-ask.zh.md)

## Abstract

"Ask Molly" on the canvas selection toolbar now opens a prompt beside the
selection. Enter (or Send) dispatches it immediately as an ordinary
conversation turn carrying the element reference; "Add to chat" only places the
prompt and reference in the composer draft, which was the previous behavior.
This is phase A of the canvas click-to-edit proposal, approved by the owner on
2026-10-10.

## Problem and evidence

Every AI action on a selection inserted a template prompt into the composer
and stopped there (decided 2026-09-11 in
[design context actions](2026-09-11-design-context-actions.zh.md)). The person
had to leave the canvas, finish the sentence in the conversation panel and
press Send. Lovart (Mark / Quick Edit), Higgsfield (Draw-to-Edit) and the Codex
app (browser annotation comments) all keep the request at the target; the
competitive research and the five-phase proposal were delivered in the chat
reply of the same day.

## Decision

- **Reuse ladder.** Reused the toolbar's existing popup (the "Edit wording"
  pattern: field, Enter-to-submit, IME guard, Escape), the host-bound toolbar
  endpoint and selection epoch, the existing `DesignElementReference` mention
  and the composer's `onSendMessage` path. Rejected: a separate quick-edit
  runner that calls the image tool directly (bypasses the Agent, adds a second
  image-job path) and a new IPC channel (the existing `design.selectionAction`
  event gains an `ask` variant).
- **Contract.** `DesignToolbarRequestSchema` gains
  `{ type: 'ask', selectionEpoch, prompt (trimmed, 1–4000), send }`. Electron
  captures the reference exactly as for other actions (no image-kind check) and
  forwards `{ action: 'ask', prompt, send }`.
- **Send path.** `sendDesignSelection` builds `prompt + @Selected elements` with
  the same mention expansion the composer uses and calls `onSendMessage` with a
  single text block. It never reads or clears the composer draft, attachments or
  the mirrored selection chip. When the composer would refuse (config not
  ready, machine removed, history refreshing, turn limit, a send in flight) or
  the send is rejected or throws, the prompt and reference fall back into the
  draft through the existing `referenceDesignSelection`, so text is never lost.
- **Keys.** Enter sends, Shift+Enter inserts a newline (matching the composer),
  Escape closes. The proposal's "Shift+Enter opens in chat" was dropped in
  favour of an explicit "Add to chat" button, because it would conflict with
  the composer's newline convention. Tab presets are deferred to phase E.
- **Draft safety.** The unsent prompt is kept for the same selection epoch, so
  reopening after a failed request restores it; a new selection starts empty.
  Archived Sessions get no reference callbacks, so Ask and the other selection
  actions are disabled instead of accepting text the composer would refuse.
- Readonly, hidden-view and stale-selection checks are unchanged: the toolbar
  is hidden while an Agent runs, and the CLI still validates artwork, revision
  and IDs before dispatch.

## Validation

- Unit: schema bounds (`packages/shared/tests/design-selection-commands.test.ts`),
  toolbar keys/IME/add-to-chat/draft retention
  (`packages/components/tests/design-selection-toolbar.test.ts`), canvas event
  routing (`design-canvas-selection-ask.test.tsx`), composer send and fallbacks
  (`session-chat-input-submission.test.tsx`).
- Real Electron app on a cloned data directory (2026-10-10): the popup renders
  in light and dark themes and accepts IME input; "Add to chat" fills the
  composer with the prompt and a selection chip. In a forked session whose run
  config never became ready, Enter fell back into the draft as designed. On a
  fresh design (Kimi For Coding HighSpeed), Enter on "Make this headline
  warmer: use a deep terracotta color" dispatched an ordinary turn carrying
  `@Selected elements (1)`; the Agent recoloured only the headline and saved
  the artwork. Restoring an old session in a cloned data directory fails at
  ACP resume before any model call, which is unrelated to this change.
- Only one text element was exercised live; other element kinds rely on the
  unit tests. Human visual acceptance is pending; the Spec revision stays draft.
