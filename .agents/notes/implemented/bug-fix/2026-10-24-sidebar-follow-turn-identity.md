# Sidebar follow uses claimed turns and receipt timestamps

Status: implemented
Translation: pending

## Abstract

Early sidebar-follow fixes bound manual actions to claimed user message IDs and used canvas/history activity to infer receipt freshness. Repeated order-dependent failures showed that the inference was unsound: initial canvas reads can include post-mount commits, superseded queries discard evidence, and one reveal can starve another. The final model keeps claimed IDs for manual suppression but uses the committed receipt timestamp for freshness. A per-view timestamp check and deduplicated receipt key replace all canvas-query and history-baseline machinery. Deterministic behavioral tests and native Electron scenarios verify the same sidebar contract with a much smaller implementation.

## Findings

- The right-panel toggle recorded only when the panel was already visible, so reopening a collapsed panel left live preview free to select Design. The same handler serves buttons, shortcuts and menus.
- Timestamp migration for manual suppression both lost current-turn actions and carried them into queued turns. Queue promotion preserves the enqueue timestamp (`session-dispatch-watcher.ts:2222`), so it cannot represent execution order.
- Explicit resubmission can create a new turn and receipt without changing the store revision or emitting another revision-changing `design.state` activity. Matching mount revision/turn therefore cannot prove that a receipt is old.
- A global `design.state` notification is not itself canvas activity. Re-querying the same revision and ownership after an unrelated artwork event must not veto the old-receipt baseline and reopen a delayed receipt.
- An empty synced history observed during the initial canvas query was previously discarded by the pending guard. More fundamentally, the initial query can already include a post-mount commit, superseded queries can discard needed evidence, and clearing revision evidence after one reveal can starve the next candidate. History/revision/ownership inference is the wrong model.

## Decision

1. A non-retired `processing` user row in the projected history is the execution claim. Execution writes that row before updating the Meta processing pointer (`session-execution-service.ts:3471`). Otherwise the resolver uses `getPendingUserTurnActivationId` for Meta and the latest accepted, unhandled user row, comparing their positions in history rather than timestamps. A pointer absent from that history is newer than the available accepted row; otherwise the later history position wins.
2. `isSessionHistoryPendingForDispatch` and `pending_apply` retain accepted steer candidates. Manual suppression uses the current execution ID directly and has no migration effect: a queued next turn starts clear, while an applied steer receipt keeps its candidate through pending canvas queries. This covers the accepted-history race, queued promotion and the previous deferred-steer finding with one model.
3. Every right-panel toggle records manual interaction, whether it opens or collapses the panel. Automatic reveals do not take that path.
4. Each viewed Session tab records `viewStartedAt` with an injected clock. For every committed receipt in history, reveal once when `timestamp >= viewStartedAt` and `turnId:revisionId:timestamp` has not been handled in this view. Missing, invalid, or earlier timestamps never reveal. The handled set resets when the user switches away and back, so away events are not replayed. The canvas continues to synchronize itself from the receipt; the sidebar needs no revision evidence.
5. Timestamp ties use `>=`, so a commit in the same millisecond as view start is not lost. Including the timestamp in the key distinguishes a same-turn, same-revision recommit with a later timestamp. If two commits have exactly the same turn, revision, and timestamp, they are indistinguishable without adding protocol data and conservatively reveal once, never replaying a duplicate. Revision-evidence matching, history-sync baselines, activity-transition tracking, pending candidates, and canvas queries are deleted.

## Reuse ladder

The implementation reuses the CLI receipt's existing timestamp, the shared outcome sanitizer and reveal callback, and the existing preview and manual-suppression LRU patterns. `committedDesignReceiptDetails` adapts the existing receipt derivation to preserve every committed DTO in history order; the latest-receipt helper still serves canvas synchronization. No new IPC, protocol, storage, timestamp, or second follow policy was added.

## Verification

- The timestamp-based hook has 155 lines and 24 behavioral tests; receipt derivation has another 9 tests, for 33 focused passing cases. The three review-6 regressions failed before the rewrite and now pass, alongside A–E, queued turns, view switching, timestamp ties, same-turn recommits, and Zen/navigation preservation. The 840 inference-only permutations were removed rather than retained as a model-specific suite. `pnpm --filter @molly/components typecheck` and full `pnpm check` pass.
- Native scenario `run-rMNXMe` proves a second turn can reopen the collapsed panel and remain on Browser through ready preview, with committed Design reveal afterwards. `run-jS6Osa`'s queue scenario proves `1 queued`, A's manual suppression, and C's new browsing and preview follows. Both used real Electron/main/preload/renderer/IPC, bundled CLI and Bento with only the external model wire scripted and isolated random endpoints.
- Second-review round `run-yoAsNr` repeats the original five scenarios plus reopening and queued-turn behavior; all seven pass with clean process and endpoint teardown. `pnpm format` and `pnpm run docs check` also pass.
- Third-review round `run-XTW6Gu` passes all seven prior scenarios and identical resubmission. The new scenario re-enters a running Session, collapses the panel, and uses the real `molly_resubmit_draft` tool; two committed receipts have distinct turn IDs and the same revision, followed by one visible Design reveal. Process and endpoint teardown pass.
- Fourth-review round `run-Wl4kmK` passes all eight native scenarios, with recommit evidence waiting for visible Design rather than an already-selected hidden tab. A separate delayed-history/global-event native scenario was not added because the harness cannot gate Session history independently without a product-only delay or wall-clock race; the exact two orders and pending-query baseline are covered by deterministic hook regressions.
- Fifth-review round `run-F40GTV` passes all eight native scenarios with clean process and endpoint teardown after the fact-model rewrite, including same-content recommit, queued turns, and Session isolation.
- Sixth-review round `run-Spzyni` passes all eight native scenarios after replacing receipt inference with per-view CLI timestamps, including same-content recommit and queued turns.
- Earlier failed fixture rounds remain uncommitted under `e2e/artifacts/sidebar-follow-agent/`. They distinguish selector and fixture mistakes from the reproduced product failures. Live DeepSeek/visual acceptance remains outside this evidence, as recorded in the [owning sidebar-follow note](../feature/2026-10-24-sidebar-follow-agent.md).

PR: [#239](https://github.com/LeonEthan/molly-design/pull/239)
