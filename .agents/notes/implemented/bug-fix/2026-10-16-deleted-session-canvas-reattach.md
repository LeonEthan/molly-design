# Deleted-session canvas re-attach (#151)

Status: implemented
Translation: pending

## Abstract

Hosted Scout rounds retained a live canvas record, lease and WebContents for artworks whose
sessions were already deleted. The renderer can reproduce that ordering: the confirm-delete
dialog covers a mounted canvas, native close destroys it, and the dialog closing re-runs the
attach effect, which opens the artwork again. Permanent deletion now owns a close lifecycle that
blocks attach for exactly the sessions being deleted and reopens only the survivors on failure.
The renderer cause is reproduced by a deterministic test; the exact hosted initiating call stack
was never observed.

## Evidence and limits

Two independent hosted rounds at the same source showed the canvas page closing and a fresh
origin loading about 150 ms after the deletion notification, with the record retained until the
end of the run. Six local rounds did not reproduce it, so the race is timing dependent. The
session-detail delete handler closes its dialog before awaiting deletion, so the dialog's DOM
removal can follow native close. That makes the covered-close-uncover order plausible and matches
the hosted trace; it is not proof of the hosted caller.

The fix does not claim to change the native in-flight load drain, which no test here exercises,
or main-process reload and reattach callers. `close` is keyed by session id while records are
keyed by artwork id, so a continuation session editing another session's artwork may not be
destroyed by this path; that is unchanged and unverified.

## Decision

Frontend only; no Scout threshold, gate or main-process change.

`lib/design-canvas-close.ts` keeps per-session state only while a `DesignCanvas` is mounted or a
deletion is running. Each deletion holds a lifecycle: it blocks attach for its ids after every
native `leave` check passes, the caller records each session whose deletion succeeded (or whose
document is confirmed deleted after a failure), and releasing it reopens only sessions that
survive and are not held by another operation. A deleted session stays blocked, including for a
canvas that remounts while the operation still runs, until both the operation and every mounted
canvas have ended; only then is the state dropped. No timer, size limit or global tombstone set is used.

Both deletion entry points, `deleteArchivedSession` and `deleteSessions`, use the lifecycle, so
partial failures keep completed deletions blocked and reopen the rest.

## Regressions

- `tests/design-canvas-deleted-session.test.tsx`: real `DesignCanvas` and `closeSessionCanvases`
  against a fake service where attach creates a record and close removes it.
- `tests/design-canvas-close.test.ts`: cancelled leave, refused close, overlapping operations,
  and no retained state.
- `tests/use-session-actions.test.ts`: direct deletion failure reopens the survivor; a failed
  parent deletion keeps the already deleted child blocked and reopens the parent.
