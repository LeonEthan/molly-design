# Auto review and merge, and the session status slot

The per-session auto review mode and the priority-ordered connection/machine status slot.

Scope: `packages/components/src/components/sessions`. Binding rules and the
pointer to this page live in
[that directory's AGENTS.md](../../packages/components/src/components/sessions/AGENTS.md);
this page is the full text of the rules summarised there.

- Automatic code review/merge, its configuration and its subscriptions are retired
  from Molly. Existing review records are retained without restarting work. See
  [the consumer audit](../notes/implemented/simplification/2026-09-11-developer-workflow-retirement.md).
- `session-status-strip.tsx`: ONE priority-ordered status slot for
  connection/machine problems (browser-offline > machine-removed >
  machine-offline); states hand off, never stack. Doc-stream degradation is
  deliberately NOT a status (was removed by product decision — the reconnect
  loop owns recovery and surfacing it read as noise); do not re-add a "may be
  out of date" state. The status renders as the info bar's status chip on
  BOTH platforms via `useSessionStatusPresentation` (the standalone
  `SessionStatusStrip` component no longer renders in production — story
  coverage only). Machine liveness is presence-based
  (`useMachineOnlineStatus`, three-state — 'unknown' must not claim offline).
  `isMachineRemoved` (meta gone, blocks send; gated on `docMetaCacheReadyAtom`)
  is distinct from machine-offline (informational only: sends are written
  durably and run on reconnect — do not block them; neutral tone, not warning).
  The header `SessionSyncingIndicator` only covers active catch-up
  (`isSyncingRoomSyncState`) behind a ~400ms `useDelayedFlag`.
