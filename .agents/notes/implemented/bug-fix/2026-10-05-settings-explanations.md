# Settings explanations and information hierarchy

Status: implemented
Translation: pending

## Abstract

Phase 4 makes settings easier to scan while preserving privacy explanations,
source-specific failure guidance and the full installed capability inventory.

## Decisions and reuse

Reuse CompactRow, SegmentedControl, InfoTip/WithInfo and Radix Collapsible. The
existing seven settings destinations are sufficient; no navigation, import backend,
credential contract or persisted preference is added. Phase 1–3 edits remain intact.

- General labels describe the resulting action. Queue/guide says After the current
  step / As soon as possible. The control fills its own row and wraps in narrow
  panels. Repeated startup help is removed; prevent-sleep copy explicitly includes
  time between tasks. Personal memory retains local storage and selected-model
  disclosure inline, with existing scope/deletion caveats available through help.
- The old notification status returned Off before checking denied/default permission.
  It now distinguishes permission and support from Molly's saved off switch, without
  changing permission requests, system-settings launching or preference writes.
  The switches have explicit accessible names.
- Capability descriptions stay visible; package names, versions, licenses and full
  build identity move into Technical details. Loading/failure still claim nothing.
- Selected-source import failures stay beside the controls and identify the browser
  profile used in the failed attempt. Other unreadable browsers are expandable when
  a usable source exists; no-source diagnostics remain visible. Authorization,
  memory-only persistence warnings and explicit retry remain visible and unchanged.

The workbench Spec intent and draft status are unchanged. The browser diagnostic
records from October 4–5 establish the existing all-source reporting and launcher
permission boundaries; this change only prioritizes their presentation.

## Validation

Targeted suites pass 19 tests across notifications/message choices, bundled
inventory disclosure, browser import and personal memory editing. Synthetic
fixtures verify source/profile attribution, disclosure toggling, explicit retry,
no-source recovery, package metadata and unchanged queue/guide values.

Full `pnpm check`, Electron `build:app`, scoped Prettier, `git diff --check` and
`pnpm run docs check` pass. Existing doc-size warnings remain; there are no doc
errors. The browser-account story needed the existing IPC event subscription stub
for ThemeProvider; this fixture-only correction was checked in the running story.

The rebuilt macOS app shows the new General controls and privacy disclosure with
the user's existing font. Storybook checked English and Chinese in a 360px panel;
the message control's client and scroll widths both measured 286px. Keyboard Enter
expanded Chinese Technical details and Other browser issues, revealing the full
metadata and source diagnostic. Screenshots remain in the local audit artifact
directory outside Git. These checks establish presentation and control access;
they do not revalidate real system authorization or paid execution.
No real browser account import, permission change or paid request was performed.
