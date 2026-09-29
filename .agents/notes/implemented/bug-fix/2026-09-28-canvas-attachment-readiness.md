# Shared canvas attachment readiness

Status: implemented
Translation: pending

## Abstract

Reopening a saved design could show a persistent `design.attach` script error even when the canvas eventually loaded. Overlapping attachments could use a published view before its initial load and product API were ready; superseded dimensions could also leave an obsolete layout waiter to time out. Attachments now share the pending readiness promise, viewport fitting follows the latest requested dimensions, and the renderer clears only a recovered attachment error belonging to its current generation. Real loading, layout, save and synchronization failures remain visible.

## Evidence and responsibility

Native acceptance after the interrupted-run recovery build exposed the error
banner over a rendered, autosaved canvas. This was the same generic attachment
error seen during the earlier browser crash investigation, independent of the
browser's native navigation crash.

A deterministic test bundles the actual design service and holds its external
document load and product-readiness signals. A second attachment previously
skipped the pending opening because the view record already existed, then called
the renderer before its API was ready. All callers now await that same opening;
the record still exists early for cancellation and disposal ownership. Failed
loads reject every waiter, and hiding during load keeps the completed view hidden.

The viewport test evaluates the actual renderer script with controlled layout
events and deadlines. An older wait for 800×600 failed after a newer 1000×600
request succeeded. Pending fits now share equal dimensions and supersede obsolete
waiters, including cleanup of their listeners and timers. Earlier callers follow
the latest result, including a genuine timeout. An in-flight fit invalidates its
cached dimensions so resizing back cannot reuse a scale overwritten by that fit.
The unchanged retained view still preserves manual zoom.

The real React component regression reproduced a stale error after successful
reattachment. Attachment errors now have their own state and generation checks;
successful current attachment and toolbar setup clear only that state. A save or
sync error is independent, and a retired effect cannot change the current error.

## Verification and limits

The initial attach-readiness and obsolete-layout regressions failed before the
fixes. Three service attachment tests, six viewport tests, and nine component
receipt/attachment tests pass with explicit signals and no timing sleeps. This
changes readiness and presentation ownership, not artwork bytes, save semantics,
MCP integration, or Agent execution. No paid model or image request participates.

The full repository `pnpm check` and `pnpm build` passed. Reopening the affected
saved design in the rebuilt native app displayed the canvas and existing local
chat images, showed the autosaved state, and no longer displayed the attachment
error banner. This was a read-only visual check, not a fresh model turn.

The separate `canvas:resources` probe did not reach its assertions: its isolated
Electron process remained at `waiting-for-app-ready`, then window startup and
application teardown timed out. Its owned process exited and failure evidence was
retained. Resource-reclamation acceptance therefore remains unverified by this
run; the successful normal launch does not substitute for the heap assertion.

## Resource verification follow-up

The E2E harness now disables macOS window restoration only for its own process
with `-ApplePersistenceIgnoreState YES`, matching the earlier
[native startup diagnosis](2026-09-28-browser-response-navigation-crash.md#verification-and-limits).
No user saved state or global preference is changed.

A subsequent probe reached the heap assertion and found one 3,888,353-byte editor
backing store after every canvas had closed. The retaining path was an Electron
global handle through its native protocol wrapper into the retired surface's
callback and editor buffer. All three sessions were already available for reuse,
proving that contents destruction, request drainage and configured cleanup had
finished. Another run found zero buffers without a product change, so native
callback release timing cannot be the application's resource ownership boundary.

The existing canvas lease now owns the document protocol callback. Disposal clears
that callback before unregistering the native handler; a retained native wrapper
keeps only the retired lease. Already executing requests still drain through the
existing lease checks. The protocol, partition cleanup, payloads, permissions and
MCP chain are unchanged; the probe's zero-buffer assertion is not weakened.

After rebuilding, the native probe passed with one serial partition, three
simultaneous isolated sessions and zero retained editor backing stores. The
12 pool/disposal tests and three attachment tests passed; the tests retain old
callbacks explicitly, exercise native unregistration failure and hold an accepted
request until its drain signal. All three desktop smoke scenarios (18 steps)
passed with verified teardown. The user app was restarted normally and reopened
the saved canvas without an attachment error. The historical startup/heap failures
remain evidence of the defects, not outstanding acceptance failures.

The final full `pnpm check`, `pnpm e2e:check`, desktop build and documentation
check passed. The full test suite requires local socket permission; its initial
sandboxed attempt failed with `listen EPERM`, then passed with that permission.
