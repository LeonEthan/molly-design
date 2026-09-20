# sessions — directory index

What each file in this directory is responsible for. Binding rules live in
[AGENTS.md](AGENTS.md); the long-form explanations it links to live under
[`.agents/docs/`](../../../../../.agents/docs/) with the `sessions-` prefix.

## Page shell and tabs

| File                                         | Responsibility                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `design-canvas.tsx`                          | Artwork copy, association repair and native canvas lifecycle; titles belong to Session |
| `session-detail.tsx`                         | Outer session shell: top tabs, side panel, session-switch reset, tab closer            |
| `desktop-session-detail-layout.tsx`          | Desktop two-column layout and the side-panel expand/collapse animation                 |
| `session-conversation-page.tsx`              | Shared full-page composition used by `SessionConversationPage.stories.tsx`             |
| `session-tab-bar.tsx`                        | Desktop merged top row: session tab pills, status slot, drag sources                   |
| `adaptive-tab-strip.tsx`                     | Width sharing for the tab pills                                                        |
| `session-side-panel-tab-bar.tsx`             | Right-panel tab strip (fixed panels, side chats, viewers)                              |
| `session-tab-close-target.ts`                | Registration for the Cmd/Ctrl+W close target                                           |
| `session-list-rows.ts`                       | Sidebar/tab row derivation, including child grouping by parent                         |
| `child-tab-empty-state.tsx`                  | Suggestions shown in an empty child tab                                                |
| `session-not-found.tsx`                      | Missing-session surface                                                                |
| `session-mention-drop-layer.tsx`             | Drop target that turns a dragged tab into a mention                                    |
| `session-pin.tsx`, `session-pin-context.tsx` | Pinned content above the stream                                                        |
| `session-search-context.tsx`                 | In-conversation search context                                                         |

## Conversation surface and composer

| File                                                            | Responsibility                                                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-chat-interface.tsx`                                    | Conversation surface: stream, header variants, read receipts, file-path actions                                                                     |
| [`chat-share-image-dialog.tsx`](chat-share-image-dialog.tsx)    | Selected-message card styling, historical metadata, PNG export, and local image copying; [draft contract](../../../../../specs/chat-share-image.md) |
| `draft-session-chat-interface.tsx`                              | Draft variant of the conversation surface                                                                                                           |
| `session-chat-input-area.tsx`                                   | Composer: attachments, run-config footer, submit                                                                                                    |
| `message-queue/`                                                | Queued turns ([scope AGENTS.md](message-queue/AGENTS.md))                                                                                           |
| `session-message-submit-route.ts`                               | Send vs. queue vs. steer routing decision                                                                                                           |
| `desktop-run-config-menu.tsx`                                   | Desktop run-config dropdown + permission-mode button                                                                                                |
| `recent-run-config-menu-group.tsx`                              | "Recently used" run-config entries                                                                                                                  |
| `composer-agent-role-panel.tsx`, `agent-role-detail-pane.tsx`   | Agent Role selection and the single Role detail pane                                                                                                |
| `floating-permission-request.tsx`, `ask-user-question-card.tsx` | Floating permission requests and agent questions                                                                                                    |
| `design-file-receipt.tsx`                                       | Durable save receipts and diagnostics; original files open through the ordinary file viewer                                                         |
| `notification-permission-prompt.tsx`                            | Notification permission ask                                                                                                                         |
| `session-fork-destination-menu.tsx`                             | Legacy fork target presentation; current human forks share the workspace                                                                            |
| `rename-session-dialog.tsx`                                     | Session rename dialog                                                                                                                               |
| `design-continuation-dialog.tsx`                                | Explicit legacy-design context preview and renderer publication; no model execution                                                                 |

## Info bar, status, and session actions

| File                                                                         | Responsibility                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `session-info-bar.tsx`, `session-info-chips.tsx`, `info-chip.tsx`            | Canonical cluster + fixed stage bar above the composer           |
| `session-info-action-state.ts`                                               | Which repository action the context stage offers                 |
| `session-status-strip.tsx`                                                   | Priority-ordered connection/machine status (story coverage only) |
| `session-syncing-indicator.tsx`                                              | Catch-up spinner pinned to the bar's right edge                  |
| `session-goal-banner.tsx`, `session-goal-control.ts`                         | Goal actions reused by the goal chip                             |
| `session-plan-bar.tsx`, `session-tasklist-mapping.ts`                        | Plan/tasklist presentation                                       |
| `scheduled-tasks-panel.tsx`                                                  | Scheduled task list reused by the schedule chip                  |
| `session-usage-popover.tsx`                                                  | Usage/context popover                                            |
| `pull-request-badge.tsx`, `pr-merge-button.tsx`, `pr-merge-method.ts`        | PR identity and merge split-button                               |
| `create-pr-prompt.ts`, `session-pr-prompts.ts`, `session-pr-agent-action.ts` | Agent prompts behind Create PR / Fix CI / Resolve Conflicts      |
| `diff-pr-analytics.ts`                                                       | Analytics for diff and PR surfaces                               |
| `use-capacity-auto-retry.ts`                                                 | Capacity-error retry behaviour                                   |

## File, diff, and browser surfaces

| File                                                                                                                                      | Responsibility                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `session-changes-sidebar.tsx`                                                                                                             | All Changes panel                                        |
| `session-conversation-diff-panel.tsx`, `session-conversation-diff-types.ts`                                                               | Conversation/turn diff page                              |
| `use-session-conversation-diff-data.ts`, `use-session-all-changes-diff-data.ts`, `use-session-diff-summary.ts`, `session-diff-summary.ts` | Diff data and summary derivation                         |
| `use-diff-focus-scroll.ts`                                                                                                                | Scroll-to-focused-hunk behaviour                         |
| `session-file-content-view.tsx`, `session-monaco-text-viewer.tsx`                                                                         | File viewer and its Monaco editor window                 |
| `session-file-image-preview.tsx`, `session-file-binary-preview.tsx`                                                                       | Non-text previews                                        |
| `session-file-diff-notice-card.tsx`, `session-file-error-state.tsx`                                                                       | File notices and the error card that offers file actions |
| `session-file-actions-menu.tsx`                                                                                                           | Shared file-action menu rendering                        |
| `session-file-quick-open.tsx`                                                                                                             | Quick open over the file index                           |
| `components/`                                                                                                                             | File tree ([scope AGENTS.md](components/AGENTS.md))      |
| `session-browser-panel.tsx`, `session-browser-toolbar.tsx`, `session-browser-resume-state.ts`                                             | Session Browser panel, address bar, and resume state     |
| `public-browser-surface.tsx`                                                                                                              | Public engine host (Electron `WebContentsView`)          |
| `managed-preview-surface.tsx`, `managed-preview-frame-cache.ts`                                                                           | Managed Preview host and its LRU frame cache             |
| `static-html-preview-document.ts`, `session-html-attachment-action.ts`                                                                    | Static `srcdoc` document policy for complete HTML text   |

## Long-form explanations

- [Session tabs, top bar, and `?tab` routing](../../../../../.agents/docs/sessions-tabs-routing.md)
- [Side panel, side chats, opened sessions, browser mount](../../../../../.agents/docs/sessions-side-panel.md)
- [Browser engines, Managed Preview, HTML viewer, annotations](../../../../../.agents/docs/sessions-browser.md)
- [Conversation surface](../../../../../.agents/docs/sessions-surface.md)
- [Run config and Agent Roles](../../../../../.agents/docs/sessions-run-config.md)
- [Live status and dispatch](../../../../../.agents/docs/sessions-live-status.md)
- [Composer info bar](../../../../../.agents/docs/sessions-info-bar.md)
- [Auto review and status slot](../../../../../.agents/docs/sessions-auto-review.md)
- [File surfaces](../../../../../.agents/docs/sessions-file-surfaces.md)
- [Render-cost invariants](../../../../../.agents/docs/sessions-render-cost.md)
- [Stories and Storybook fidelity](../../../../../.agents/docs/sessions-stories.md)

PR/CI actions, live GitHub review comments and automatic review settings/engines are
retired from Molly. Generic file/diff viewers and send-to-chat references remain.

### Continue an old design with Molly

The owned legacy design's header menu negotiates preparation support on its machine.
The dialog requires an explicit same-machine Molly selection, shows historical text
as plain text with omissions and current attachment availability, then re-prepares
on confirmation. A changed preview requires another confirmation. Cancellation,
unmount and workspace/identity changes invalidate pending UI work.

The existing renderer writer waits for the daemon's immutable receipt to sync and
checks its identity, source, target catalog and deletion state before publishing
the independent target's bindings. It omits mutable title/activity/archive fields
so delayed confirmations preserve later edits. Publication waits for local Repo flush,
then rechecks the receipt and live target before acknowledging success. A failed flush
retains accepted metadata; explicit retry flushes again and reuses the same target.
Accepted writes may finish after the dialog closes. This is neither an execution lock
nor a cross-process metadata transaction; normal guarded dispatch remains required.
The new conversation opens without a turn or model call. Connection/model choice
and the next request use the normal composer. Old history and files remain in place.
Source-level tests and stories do not establish native desktop migration acceptance.

### Authoring preview in the canvas

`design-canvas.tsx` owns one canvas region. Idle shows the editable current draft;
an authoritative active Agent turn displays valid, frozen YAML/asset snapshots.
Until the first valid changed draft, retain the canonical canvas. Invalid subsequent
files retain the last valid frame. There is no source switch, manual refresh or import.
Native replacements prepare decoded pixels under the outgoing view and promote
before disposal. Turn completion retains the final preview until the canonical
editor is ready; component phase cleanup does not dispose that handoff surface.
Turn-bound display never saves, flushes, changes version base or ends execution.
The main-process canvas-host state keeps edit/reference/export/version actions locked
through artifact processing; conversation presence or file appearance cannot release it.

Current-artwork selection controls and their popups render inside Bento's native
view near the selection. The shell passes labels/theme and receives validated
reference actions; it no longer reserves a toolbar row. Selection summaries and
the retained-view cache remain necessary for remount and composer recovery.

Selecting elements on Current artwork also mirrors one selection chip into the
composer automatically: the chip is replaced as the selection changes, removed when
the selection clears or the canvas reloads, and suppressed until the next selection
change once the user removes it manually. “Reference selected elements” on Current
artwork consumes that mirrored chip or inserts an ordinary mention into the
existing composer. Passive mirroring waits for normal autosave; explicit reference
actions flush pending canvas edits first. Both retain the resulting
revision through draft restoration, and restores input focus. Subsequent edits,
deletions or artwork changes invalidate the mention explicitly at send; remove it
and reselect. Unsubmitted previews cannot supply these references.

### Current artwork after a commit

The existing guarded store sync reconciles committed receipts, including hydration.
The authoritative canvas-host release waits for artifact handling and canonical sync;
only then does the single canvas return to editing. Failed/cancelled/no-artifact turns
return to the confirmed current draft. Reload failures preserve unsaved edits. Camera
scale and canvas-coordinate center survive surface replacement within native bounds.

### Design versions

The separate Save version button flushes current edits and saves exact assets in
immutable local Git history. Ordinary autosave does not create a version. Clicking
history directly switches the editable current draft, protecting unversioned work in
the same Git repository first. The selected base survives restart; subsequent saves
record that logical source without deleting later versions. An unchanged draft does
not create a duplicate. Version operations use the execution/processing gate.
The label distinguishes Vn from “Based on Vn · New changes”; selections are recaptured
after switching. See the [current design and validation plan](../../../../../.agents/notes/proposed/architecture/2026-09-18-version-based-canvas-editing.zh.md).
