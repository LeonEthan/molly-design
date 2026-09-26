# React hooks

Parent rules apply. `CLAUDE.md` links here; edit `AGENTS.md`. [Ownership](README.md).

## Conversation scrolling

- Keep virtualization and bottom-following separate: `virtua` owns mounted rows,
  measurement, and index navigation; `use-sticky-scroll.ts` adapts `use-stick-to-bottom`
  to Virtua's viewport and content elements. Never restore a content-token effect or a
  distance-based upward-scroll threshold. Any real upward wheel, touch, selection, or
  scrollbar movement releases streaming follow at once.
- Sticky-scroll binds through the real scroll viewport's React callback ref, on Virtua's
  public `Virtualizer` primitive with that explicit viewport. Never recover the element
  from a `VList` handle, DOM query, item-count effect, observer retry, or timer.
  Empty-to-populated conversations attach on the viewport's mount commit and detach on
  its unmount commit.
- Treat `use-stick-to-bottom`'s `state.isAtBottom` as the follow-lock truth: the returned
  `isAtBottom` adds near-bottom tolerance, and `escapedFromLock` is escape history that
  stays true after an explicit `scrollToBottom` restored the lock.
- Follow viewport-size changes from the viewport's `ResizeObserver` records; never
  restore resize-event pumps, guessed transition durations, or stop timers. Only HEIGHT
  changes may re-anchor the viewport; never forward width-only records.
- A session composer height change sets a one-shot ref immediately before its inline
  height write. Consume that ref only for the next viewport _height_ resize, without
  calling `scrollToRealBottom`, and keep it separate from jump suppression.
- Group expansion scrolls after Virtua descendants finish their layout effects and
  releases sticky suppression in the later parent layout effect of the same commit;
  no frame retries or guessed settle timers.
- Preserve the app-specific adapters: per-session scroll restoration,
  search/group-expansion suppression, and viewport resize handling.

## Session, auth, and app shell

- Permanent session deletion checks retained canvases across the selected lifecycle
  before disposing views or queueing machine cleanup. Reuse native save/close guards;
  cancellation or failure preserves session documents. Navigation/archival alone
  must not dispose retained editors, and closing views never deletes artwork files.
- `useStableSession` reads the local platform's static authentication context.
  The CLI-owned installation snapshot supplies user identity; no renderer auth
  refresh, retry, or product-cloud sign-out is part of this hook.
- `use-session-doc.ts` publishes the initial mirror snapshot immediately, then coalesces
  history-only mirror bursts to the latest snapshot once per animation frame through
  `lib/latest-frame-subscription.ts`. Control state (`session`, message queue, fork,
  preview, external cursor) stays synchronous: never delay it behind transcript rendering
  or restore a direct `setState` for history-only mirror events.
- `use-safe-area-insets.ts` is ONE module-level store: never add a per-instance
  `getComputedStyle`. Keep the snapshot identity stable while values hold, and the resize
  listeners for the document's life.
- `use-keyboard-navigation.ts` issues at most one session navigation per painted frame:
  with no frame outstanding a press navigates and re-anchors on the route; during an owed
  frame it only advances the target. Not a time-based debounce.

## Workspace catalog

- Machine Flock timing entries are transient diagnostics: clear each completed
  measure by its own name after enqueueing it for observers; never clear other
  owners' timing entries or retain a per-read global timeline.
- `use-workspace-catalog.ts` reads a ref-counted per-workspace room in
  `lib/workspace-catalog-room.ts`; it must not open the Flock document, subscribe, or
  join the room per mount. MCP servers and Agent Roles are two row families of that ONE
  document, so `use-workspace-mcp-catalog.ts` and `use-workspace-agent-roles.ts` derive
  from that room instead of opening a second one. Keep the shared snapshot identity
  stable across mounts.
- MCP catalog `upsert`/`remove` resolve on DURABILITY; the upload runs on its own
  and no surface waits for it or reports it.
- Role hooks remain legacy helpers, unmounted by the product composer and settings.
  Stored Role ids never restore selection, prefix prompts or drive new execution.

## Code Collab

- Code Collab file-index hooks borrow owner-session resources from the workspace-owned
  Effect `ScopedCache`; do not open, scan, subscribe, or join the same Flock once per
  React mount. The resource subscribes before its cold scan, advances by batch events,
  and compares the Flock version before any remote catch-up rescan. Each entry holds a
  loro-repo Flock lease: LRU eviction closes its room and Flock subscriptions, releases
  the lease, then unloads the replica, in that order; a room that finishes joining after
  eviction is unsubscribed and best-effort unloaded again. Never cache a failed open;
  invalidate a failed room resource after its last borrower releases. Workspace disposal
  closes every borrower Scope before destroying the repo, and cache-resource identity is
  part of provider memoization. Local-machine RPC snapshots seed the shared resource
  before it is visible; later Flock events stay deduplicated across mounts.
