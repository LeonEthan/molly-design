# Sidebar follow uses turn identity, not timestamps

Status: implemented
Translation: pending

## Abstract

A second review found that reopening the right panel was not registered as a manual action, timestamp migration could both lose suppression in the current turn and carry it into a queued turn, and an uncleared processing pointer could replay an old receipt. The final model binds manual actions to the currently claimed user message ID using history and the shared pending-activation resolver, never time comparisons. Receipt baselines use the initial canvas revision/turn and actual canvas activity, while accepted steer candidates remain independent. A third review showed that identical resubmission must not be swallowed by those baselines; a fourth showed that identical global-event snapshots must not manufacture that activity. Deterministic tests and native Electron scenarios verify reopening, queued turns, steer receipts, both history/release orders, and identical resubmission without changing the approved sidebar contract.

## Findings

- The right-panel toggle recorded only when the panel was already visible, so reopening a collapsed panel left live preview free to select Design. The same handler serves buttons, shortcuts and menus.
- The accepted-turn migration ran neither after a manual action nor after a turn ID change, leaving suppression on the old ID. Its timestamp comparison also treated an earlier queued message as the current turn when it was later promoted.
- A receipt committed before mount could have the same revision and canvas turn as the initial snapshot but still have a stale processing pointer. Rejecting the baseline solely because that pointer matched the receipt let the canvas release reveal it again.
- Queue promotion preserves the enqueue timestamp (`session-dispatch-watcher.ts:2222`), so timestamp ordering is not execution ordering. No new protocol or timestamp is needed.
- Explicit resubmission can create a new turn and receipt without changing the store revision or emitting another revision-changing `design.state` activity. Matching the mount revision/turn therefore cannot prove that a receipt is old, whether the mounted history was empty or already held an older receipt.
- A global `design.state` notification is not itself canvas activity. Re-querying the same revision and ownership after an unrelated artwork event must not veto the old-receipt baseline and reopen a delayed receipt.

## Decision

1. A non-retired `processing` user row in the projected history is the execution claim. Execution writes that row before updating the Meta processing pointer (`session-execution-service.ts:3471`). Otherwise the resolver uses `getPendingUserTurnActivationId` for Meta and the latest accepted, unhandled user row, comparing their positions in history rather than timestamps. A pointer absent from that history is newer than the available accepted row; otherwise the later history position wins.
2. `isSessionHistoryPendingForDispatch` and `pending_apply` retain accepted steer candidates. Manual suppression uses the current execution ID directly and has no migration effect: a queued next turn starts clear, while an applied steer receipt keeps its candidate through pending canvas queries. This covers the accepted-history race, queued promotion and the previous deferred-steer finding with one model.
3. Every right-panel toggle records manual interaction, whether it opens or collapses the panel. Automatic reveals do not take that path.
4. A receipt is already handled only when the mount history contains it, or when late history matches the mount revision/turn and no matching post-mount canvas activity exists. A late receipt outside all current accepted/running candidates is baselined before pending canvas queries, preventing a newer receipt from erasing it; same-turn candidates still await activity evidence. Synced history establishes either an existing-receipt or no-receipt baseline; after that, a different receipt at the mount revision is new even without another `design.state` activity, including when an older receipt exists. Activity turns are recorded only when the last observed canvas snapshot changes revision or ownership; the mount query reconciles an activity snapshot that resolves first, and an event or identical re-query is never activity. Post-mount activity also vetoes a late old baseline, while other revisions keep the existing activity gate. This preserves both history/release orders and permits explicit identical resubmission without replaying late history.

## Reuse ladder

The existing reveal callback, receipt derivation, preview events and bounded LRU remain unchanged. The implementation reuses the shared pending-activation and history-status predicates rather than duplicating pointer rules, and adapts the existing follow hook and initial `design.state` baseline. No IPC, storage, execution event, timestamp or second follow policy was added.

## Verification

- Red-first regressions cover accepted-history/manual ordering, an older queued turn promoted after a manual action, uncleared processing receipts in both history/release orders, unchanged global snapshots in both orders, and genuinely new same-revision receipts after mount, after an older receipt, and before the initial canvas query resolves. The policy suite now has 35 deterministic cases using fake timers and observable panel state, not mock call counts. `pnpm --filter @molly/components typecheck` and full `pnpm check` pass.
- Native scenario `run-rMNXMe` proves a second turn can reopen the collapsed panel and remain on Browser through ready preview, with committed Design reveal afterwards. `run-jS6Osa`'s queue scenario proves `1 queued`, A's manual suppression, and C's new browsing and preview follows. Both used real Electron/main/preload/renderer/IPC, bundled CLI and Bento with only the external model wire scripted and isolated random endpoints.
- Second-review round `run-yoAsNr` repeats the original five scenarios plus reopening and queued-turn behavior; all seven pass with clean process and endpoint teardown. `pnpm format` and `pnpm run docs check` also pass.
- Third-review round `run-XTW6Gu` passes all seven prior scenarios and identical resubmission. The new scenario re-enters a running Session, collapses the panel, and uses the real `molly_resubmit_draft` tool; two committed receipts have distinct turn IDs and the same revision, followed by one visible Design reveal. Process and endpoint teardown pass.
- Fourth-review round `run-Wl4kmK` passes all eight native scenarios, with recommit evidence waiting for visible Design rather than an already-selected hidden tab. A separate delayed-history/global-event native scenario was not added because the harness cannot gate Session history independently without a product-only delay or wall-clock race; the exact two orders and pending-query baseline are covered by deterministic hook regressions.
- Earlier failed fixture rounds remain uncommitted under `e2e/artifacts/sidebar-follow-agent/`. They distinguish selector and fixture mistakes from the reproduced product failures. Live DeepSeek/visual acceptance remains outside this evidence, as recorded in the [owning sidebar-follow note](../feature/2026-10-24-sidebar-follow-agent.md).

PR: [#239](https://github.com/LeonEthan/molly-design/pull/239)
