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

### Authoring preview in the canvas

`design-canvas.tsx` switches the existing canvas region between the retained current
artwork and a readonly, unsubmitted source preview. Automatic refresh uses frozen
document and asset bytes; failures are reported and retain the last valid preview.
The preview offers no manual refresh and no import-into-current-artwork action.
Current-artwork copy/export actions are disabled while viewing source files. The
preview never unlocks or destroys the editor and does not declare Agent completion.

When an Agent turn starts while Current artwork is selected, the canvas enters that
same readonly source preview and subscribes to valid intermediate PPTD snapshots.
An explicit view choice made afterward remains in place while that live status
stays active; idle external-file previews still use the Unsubmitted preview control.

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

The canvas retains its current artwork while the authoring-source preview is shown.
After a new successful Agent receipt, the existing guarded store sync must succeed
before the canvas returns to the current artwork. Historical receipts on initial
hydration and later explicit source choices do not trigger that navigation. Reload
failures remain visible and preserve unsaved edits. See the
[decision and verification](../../../../../.agents/notes/implemented/bug-fix/2026-09-11-current-canvas-after-commit.md).

### Design versions

The version selector uses immutable local Git history. Save version flushes the current
artwork and records its exact assets; ordinary autosave does not create a version.
Historical views share the isolated readonly renderer, while the current editor remains
hidden with its undo state. Edit from here explicitly restores the selected version;
the service preserves unversioned current content in the same Git history first.
Version mutations use the existing execution/processing gate, and history cannot supply
current-artwork selections. Git errors remain
visible without replacing the current editor. See the
[implementation and acceptance limits](../../../../../.agents/notes/implemented/feature/2026-09-12-design-version-history.zh.md).
