# Canvas continuity beneath shell overlays

Status: implemented
Translation: pending

## Abstract

Shell menus overlapped a separate Electron WebContentsView. Hiding that native
view made the menus usable but exposed an empty canvas host. Phase 2 retains a
single inert image of the displayed viewport for each overlapping-menu period.

## Decision and reuse

Reuse the existing overlap detector, retained canvas/preview records, attach/hide
paths and Electron compositor capture. The persisted sidebar thumbnail was rejected:
it cannot reproduce current zoom, selection or unsaved pixels. Native menus would
not address shell dialogs. Rebuilding the compositor hierarchy is outside this fix.

The validated design IPC scopes coverage to the trusted main window and host.
Capture starts before synchronous hide; capture or decoding failure cannot trap the
menu behind the native view. A transient host gate covers native load, fitting and
promotion paths. Renderer presentation generations reject late frames after close,
switch or deactivation. Restore retains the frame until the current attach succeeds.
PNG data stays in component memory; no save, export, history or Agent execution is
triggered. The frozen frame may lag changes while covered. The asynchronous handoff
is not a zero-flash guarantee.

## Review and verification

The read-only gpt-6-astra/high second opinion recommended this approach and called
out late native reveals, stale captures and the asynchronous handoff limitation.
Its advice informed explicit visibility gates and generation checks. It did not
modify files. Targeted component and main-process checks cover nested blockers,
non-overlap, capture failure, delayed results, ownership, bounds changes and restore.
The OSS desktop build passed. Native macOS inspection confirmed retained pixels
beneath Export, History and More menus, a clickable PNG action opening the save
dialog, retained 55% manual zoom after dismissing history, and a retained text
selection after dismissing More. The save dialog was cancelled; artwork content
was not edited. Opening showed a brief blank handoff before the bitmap appeared.
Live Agent preview transitions were tested deterministically, not with a paid run.
Final `pnpm check`, `pnpm run docs check`, scoped Prettier checks and `git diff --check`
passed. The focused suites passed 32 component and 16 main/IPC tests. No commit or
publication was performed.
