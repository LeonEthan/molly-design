# `src/hooks` — background

Binding rules for this directory live in [AGENTS.md](AGENTS.md); this file keeps
the reasoning behind them so the rules can stay short. It explains only the hooks
that carry an invariant — the directory itself is the list of hooks.

## Conversation scrolling (`use-sticky-scroll.ts`)

`virtua` owns mounted rows, measurement, and index navigation. `use-stick-to-bottom`
only observes content growth; it does not replace Virtua and does not own the
product-level behaviors (per-session scroll restoration, search and group-expansion
suppression) that the app adapters add
around it. That is why the two concerns stay separated and why recovering the
viewport element by DOM query, `VList` handle, item-count effect, observer retry, or
timer is banned: only the viewport's own React callback ref fires on the real mount
and unmount commits, which is what an empty-to-populated conversation depends on.

`ResizeObserver` records are the single source of viewport-size change because
window resizing changes that same element; custom resize-event
pumps and guessed transition durations were the earlier, unreliable version. Only
height matters: a flex sibling such as the desktop sidebar can animate its width
every frame, and forwarding width-only records competes with the content observer's
bottom correction and visibly jitters the conversation.

The composer one-shot ref preserves the reader's position while typing without
changing keyboard or window-resize follow behavior, which is why it is
consumed for exactly one height resize and is not merged into programmatic-jump
suppression.

## `useStableSession`

The local platform auth provider derives a static session view from the CLI-owned
installation snapshot. `useStableSession` reads that context for existing UI
consumers and performs no authentication request or retry.

## `use-session-actions.ts`

Native design editors survive ordinary navigation, so permanent deletion must
explicitly close them. Both direct and archived deletion preflight all lifecycle
canvases through `design.leave`, then use `design.close` before deleting documents
or queueing machine cleanup. The native service owns flushing, unsaved-edit dialogs,
and WebContents disposal; the hook does not delete artwork bytes. A failed or
cancelled preflight leaves all editors and session documents available.

## Workspace catalog hooks

Machine Flock timing goes to `PerformanceObserver` and slow-operation debug output.
`use-machine-flock-rows.ts` clears its own completed measure immediately after
recording it; observers still receive the queued entry, while retrospective
`performance.getEntriesByType('measure')` does not accumulate every completed read
or sync. Other sources' measures are untouched.

The workspace catalog is ONE small document, but a consumer mounts for every visible
session plus every hidden child tab and side chat, so per-mount leases multiply room
joins and duplicate row maps for a single list — the same problem
`use-machine-flock-rows.ts` ref-counts away. The shared snapshot is also
identity-stable across mounts, which is what lets the selection and composer-menu
memos built on it actually hit.

Catalog `upsert`/`remove` resolve on durability because a dialog that awaited the
upload sat open for the whole round trip, and the row it had already written showed
up in the catalog underneath it — so the open create form reported its own name as
taken (`resolveAgentRoleNameCheckExemption`) moments before closing on success.

Hiding a private Agent Role in the UI is not an access check, and an availability
rule copied into a component is one that can drift into a silent fallback; both stay
in the shared `listAccessibleAgentRoles` / `resolveAgentRoleAvailability` helpers.

## `use-session-doc.ts`

Session history snapshots are state, not an event log. Rendering every intermediate
ACP/CRDT snapshot can queue minutes of React work behind a long active turn and
retain every obsolete history tree, so history-only bursts coalesce to the latest
snapshot once per animation frame while control state stays synchronous.

## Code Collab file-index hooks

Owner-session resources are borrowed from the workspace-owned Effect `ScopedCache`
so that opening, scanning, subscribing, and joining happen once per session rather
than once per React mount. A recreated cache resource restarts its local revision
counter, which is why resource identity is part of provider memoization.
Local-machine RPC snapshots seed the shared resource before it becomes visible, so
first paint stays local while later Flock events remain deduplicated.

## `use-safe-area-insets.ts`

`DropdownMenuContent` and `PopoverContent` run this hook even when closed, so a
session switch mounts hundreds of subscribers. A per-instance `getComputedStyle`
would force a full-document style recalculation after the commit dirtied style.

## `use-keyboard-navigation.ts`

A session switch renders synchronously for longer than the key repeat interval, so a
held shortcut would otherwise queue renders nobody sees. The one-navigation-per-
painted-frame rule is a frame budget, not a time-based debounce.
