# Sidebar follows the viewed Agent run

Status: implemented
Translation: pending

## Abstract

Agent browsing could reveal the right panel once per turn, but live canvas construction and committed receipts could not bring the canvas back, and a hidden canvas stopped producing preview signals. The owner approved current-conversation-only sidebar following on 2026-10-24: browsing segments and new live snapshots yield to manual panel actions, while every new committed receipt reveals the canvas once regardless. The implementation adapts the existing reveal hook, receipt derivation, preview events and hidden canvas consumer without adding IPC, protocol or storage. Focused deterministic tests and component typechecking pass; native Electron and live-model acceptance remain to be recorded below.

## Root cause and approved behavior

`useAgentBrowserAutoReveal` spent one reveal per `browserId:turnId`, explicitly never returned to the canvas, and treated per-command `agentControl` flips as irrelevant after the first reveal. `DesignCanvas` derived committed receipts and synchronized its retained editor in place, but `active=false` closed the source preview, so a browser-covered canvas had no live signal for the session shell.

The approved contract is scoped to the executing Session in the currently displayed conversation tab. A new browsing segment reveals Browser, a new ready `design.preview` snapshot reveals Design, and a new committed receipt reveals and opens Design once even after manual interaction or panel closure. Selecting/closing tabs or collapsing the panel suppresses browsing and live-preview follows for the rest of that turn, not commits. Failure, cancellation and `no_artifact` do not switch. Events from other Sessions or same-artwork sibling tabs do not trigger, existing receipts at mount are handled rather than replayed, and following never navigates or focuses a window. Browser/live follows do not leave Zen; a commit in Zen only updates the stored open Design panel state.

The [Spec](../../../../specs/graphic-design-platform.zh.md#侧栏跟随) records this revision as draft. The owner approved it in the task conversation; a linkable approval record is still pending.

## Decision and reuse ladder

1. Direct reuse was insufficient separately: the existing browser hook encoded once-per-turn behavior, and visible-only preview ownership provided no hidden signal. The existing `revealRightSidebar`, `activateSidebarTab`, `latestCommittedDesignReceipt`, `publicBrowser.state`, `design.preview` and module-level `LRUCache` remain the authorities.
2. Reuse with adaptation was chosen. The old hook becomes one small sidebar-follow policy: a 500 ms quiet interval separates browsing segments while command-boundary `human` states coalesce, snapshot `sourceIdentity` deduplicates live previews, and receipt identity deduplicates forced reveals. Manual suppression is keyed by Session and turn in the existing LRU pattern. The session shell supplies only the currently viewed tab's executing turn and receipt.
3. The existing canvas consumer was adapted rather than adding a second preview channel. Outside Zen, a hidden mounted canvas keeps its ordinary source subscription only when its canvas turn equals the viewed Session's executing turn. It never attaches hidden pixels, registers save/flush, or outlives the turn; background Sessions/tabs and Zen-hidden canvases do not retain this exception.
4. A main-process follow event, new receipt protocol, persistent segment store, or window-level focus action was rejected as unnecessary duplication. The viewed child conversation's receipt also feeds the existing `syncOpenDesignCanvas` path so switching to a shared artwork after a child commit cannot expose a stale retained editor.

The 500 ms boundary is a presentation heuristic, not a new execution contract. Longer gaps may start another browsing segment, but repeated reveals remain harmless when the user has not taken over; any manual panel action suppresses subsequent non-commit follows for the turn. An explicit future browsing-segment identifier could replace the timer without changing the sidebar contract.

## Verification and limits

- The new policy tests were red before implementation and now cover nine deterministic cases: segmented browsing, manual suppression, new versus duplicate ready snapshots, non-current tabs, forced single receipt reveals, mount baselines, Zen/navigation preservation, and non-committed outcomes. They use fake timers and observable panel state, not mock call counts.
- `design-source-preview.test.tsx` covers seven cases, including hidden subscription retention without presentation, release at completion, and rejection of a different Session's turn.
- `design-canvas-receipt.test.tsx` covers 27 cases, including the viewed child conversation receipt reaching shared-artwork synchronization.
- The focused 43-test set and `pnpm --filter @molly/components typecheck` pass. Broader checks and native Electron/live-model acceptance are not yet established by this record; update this section with their actual results rather than inferring them from unit coverage.
- The Chinese Spec is the current draft; the English translation is marked stale until translated. No approval link is invented by this implementation record.
