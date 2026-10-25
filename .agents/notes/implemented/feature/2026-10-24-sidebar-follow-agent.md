# Sidebar follows the viewed Agent run

Status: implemented
Translation: pending

## Abstract

Agent browsing could reveal the right panel once per turn, but live canvas construction and committed receipts could not bring the canvas back, and a hidden canvas stopped producing preview signals. The owner approved current-conversation-only sidebar following on 2026-10-24: browsing segments and new live snapshots yield to manual panel actions, while every new committed receipt reveals the canvas once regardless. The implementation adapts the existing reveal hook, receipt derivation, preview events and hidden canvas consumer without adding IPC, protocol or storage. Focused deterministic tests, full repository checks and all three native Electron scenarios pass; live DeepSeek acceptance remains unavailable because the local proxy rejects the request without credentials.

## Root cause and approved behavior

`useAgentBrowserAutoReveal` spent one reveal per `browserId:turnId`, explicitly never returned to the canvas, and treated per-command `agentControl` flips as irrelevant after the first reveal. `DesignCanvas` derived committed receipts and synchronized its retained editor in place, but `active=false` closed the source preview, so a browser-covered canvas had no live signal for the session shell.

The approved contract is scoped to the executing Session in the currently displayed conversation tab. A new browsing segment reveals Browser, a new ready `design.preview` snapshot reveals Design, and a new committed receipt reveals and opens Design once even after manual interaction or panel closure. Selecting/closing tabs or collapsing the panel suppresses browsing and live-preview follows for the rest of that turn, not commits. Failure, cancellation and `no_artifact` do not switch. Events from other Sessions or same-artwork sibling tabs do not trigger, existing receipts at mount are handled rather than replayed, and following never navigates or focuses a window. Browser/live follows do not leave Zen; a commit in Zen only updates the stored open Design panel state.

The [Spec](../../../../specs/graphic-design-platform.zh.md#侧栏跟随) records this revision as draft. The owner approved it in the task conversation; a linkable approval record is still pending.

## Decision and reuse ladder

1. Direct reuse was insufficient separately: the existing browser hook encoded once-per-turn behavior, and visible-only preview ownership provided no hidden signal. The existing `revealRightSidebar`, `activateSidebarTab`, receipt derivation, `publicBrowser.state`, `design.state`, `design.preview` and module-level `LRUCache` remain the authorities.
2. Reuse with adaptation was chosen. The old hook becomes one small sidebar-follow policy: a 500 ms quiet interval separates browsing segments while command-boundary `human` states coalesce, snapshot `sourceIdentity` deduplicates live previews, and receipt identity deduplicates forced reveals. Manual suppression is keyed by Session and turn in the existing LRU pattern. A committed receipt reveals only after the existing `design.state` activity query returns the same revision and a matching canvas turn observed in the current mount (including steer successors and back-to-back turns); history catch-up and receipts already present at mount do not manufacture that activity. This avoids treating the outcome's classification-start timestamp as the history arrival time.
3. The existing canvas consumer was adapted rather than adding a second preview channel. Outside Zen, a hidden mounted canvas keeps its ordinary source subscription only while the current design-associated Session executes and its canvas turn exists. The canvas owner can remain stable across steer handoffs; an ordinary fork without the same artwork association cannot borrow a parent's run. Hidden pixels never attach, save/flush is never registered, and background Sessions/tabs or Zen-hidden canvases do not retain this exception.
4. A new follow event, receipt protocol, persistent segment store, or window-level focus action was rejected as unnecessary duplication. Parent and currently viewed design-child receipts both feed the existing `syncOpenDesignCanvas` path, with the newest timestamp selecting one source, so neither a parent commit is dropped nor a shared retained editor becomes stale.

The 500 ms boundary is a presentation heuristic, not a new execution contract. Longer gaps may start another browsing segment, but repeated reveals remain harmless when the user has not taken over; any manual panel action suppresses subsequent non-commit follows for the turn. An explicit future browsing-segment identifier could replace the timer without changing the sidebar contract.

## Review hardening

Five review findings were reproduced before their fixes, without changing the approved behavior:

1. Every explicit Browser/viewer/panel open or selection now records the same manual interaction as the tab strip; automatic reveals do not. The preview-chip path exposed a second ownership bug: its same-document navigation emitted `did-start-navigation` with `inPlace=true`, which the main process treated as owner loss and closed the source preview. Only a full-document main-frame navigation now releases that ownership.
2. Manual suppression moves to the accepted pending Turn when its durable timestamp is not later than the interaction. A later Turn does not inherit it. The accepted projection also keeps hidden preview observation alive before dispatch pointers catch up.
3. An independent initial `design.state` query establishes the mount revision/turn baseline and is not cancelled by later activity queries. Late history cannot borrow another Session's same-artwork activity or the idle last user message to replay an old receipt.
4. Ready snapshot identities use the existing module-level LRU pattern across conversation re-subscriptions. Background events may update that deduplication memory but cannot reveal.
5. Accepted/running turn identities are retained while receipt canvas queries are pending, so an applied steer receipt is not lost when a queued successor advances metadata.

## Verification and limits

- The new policy tests were red before implementation and now cover 19 deterministic cases: segmented browsing, manual suppression, new versus duplicate ready snapshots, non-current tabs, forced single receipt reveals, mount baselines, history catch-up, both receipt/activity orders, same-revision turns, steer, back-to-back turns, Zen/navigation preservation, and non-committed outcomes. They use fake timers and observable panel state, not mock call counts.
- `design-source-preview.test.tsx` covers seven cases, including hidden subscription retention without presentation, release at completion, and rejection when the viewed Session is not executing. `design-canvas-receipt.test.tsx` covers 28 cases, including both parent and viewed-child receipt synchronization. `design-canvas-sync.test.ts` covers eight receipt/revision cases.
- The focused 62-test set and `pnpm --filter @molly/components typecheck` pass. Final `pnpm check`, `pnpm format` and `pnpm run docs check` pass. Final Standards and Spec review both report no P0/P1 findings.
- Final native Electron acceptance used real Electron/main/preload/renderer/IPC, bundled CLI and Bento with only the external model wire scripted. `run-heBCw4` observed Browser → Design → Browser → Design with two ready previews and a committed revision matching `design.read`; `run-qDMFzN` kept the manually closed panel closed during previews and opened Design exactly once on commit; `run-iBc0rP` kept Session B's URL, Browser tab, visibility and native URL unchanged while A committed. All three passed with clean process/endpoint teardown. Evidence is under `e2e/artifacts/sidebar-follow-agent/` and was not committed. Earlier failed rounds are retained.
- Review-fix verification covers 23 deterministic policy cases and 12 main-process source-preview cases, including accepted-turn suppression, late-history baselines, cross-tab snapshot deduplication, deferred steer receipts, and same-document navigation. The focused 66-component-test set, `pnpm check`, `pnpm format`, and `pnpm run docs check` pass.
- Final review-fix Electron round `run-1i90Zm` passed all five scenarios: Browser → Design → Browser → Design; manual closure with one committed reveal; independent Session B unchanged during A's commit; preview-chip opening without live-follow but with one committed reveal; and same-artwork draft → A with no reveal from a replayed snapshot. The run used real Electron/main/preload/renderer/IPC, bundled CLI and Bento with only the model wire scripted, isolated data directories and random CLI ports, and clean process/endpoint teardown. Artifacts remain uncommitted.
- DeepSeek Flash live acceptance was not run. Common credential environment variables were absent and the local proxy returned HTTP 401 for `/models` and a synthetic-key `deepseek-flash` chat probe. No credential files were read or copied, no Pro model was used, and no live-model or visual-quality claim is made.
- The Chinese Spec is the current draft; the English translation is marked stale until translated. No approval link is invented by this implementation record.

PR: [#239](https://github.com/LeonEthan/molly-design/pull/239)
