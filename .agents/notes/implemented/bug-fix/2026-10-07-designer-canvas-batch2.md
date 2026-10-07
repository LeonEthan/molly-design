# Designer canvas cleanup, batch 2

Status: implemented
Translation: pending

## Abstract

The 2026-10-07 UI/UX audit found several canvas problems:

- The selection toolbar covered the artwork around the selection.
- The toolbar showed an unexplained "1" chip next to an unlabelled icon.
- "No saved version" sat beside the "Autosaved" pill.
- Export stopped at 1× PNG/JPEG.
- Idle format tiles looked disabled.
- Attach failures surfaced raw Electron IPC text with no retry.

Batch 2 makes three kinds of change:

- It changes placement, labels and contrast in Molly-owned code.
- It adds owner-approved 2×/3× export scaling.
- It turns the attach error into a plain message with a Retry button.

Placement still has to trade off in dense layouts, and the canvas tab stays closeable on purpose.

## Decisions and reuse

- **Toolbar placement (`selection-toolbar.ts`, Molly's adapter).**
  - `placeToolbar` keeps its rule: above the selection when it fits, otherwise below.
  - It now also scores both positions by the area they would cover: the selection plus the other artwork elements. Below wins only when it covers less.
  - Elements that contain the whole selection, such as a full-bleed backdrop, are ignored, because both positions cover them anyway.
  - With no obstacles the result is unchanged.
  - The vendored Bento source is untouched.
- **Toolbar labels.**
  - The count chip appears only when more than one element is selected.
  - The reference action keeps its icon and shows "Ask Molly"; its accessible name is "Ask Molly about the selection".
  - The new label key is listed in `DESIGN_CANVAS_LABEL_KEYS`, as the design-bento rules require.
- **Version wording.** English "No saved version" becomes "No versions yet". The shell still never infers autosave from versions, and Bento keeps "Autosaved". The Chinese text already avoided the clash.
- **Export scale.**
  - On 2026-10-07 the owner chose 2×/3× (not PDF).
  - The existing capture passes a scaled `clip` to `Page.captureScreenshot`, so Chromium re-rasterises the artwork at the chosen scale. 1× keeps its previous path.
  - Filenames gain `@2x` / `@3x`.
  - A result above 16384 px on one side is refused before the save dialog, citing Chromium's capture limit.
  - Thumbnails, previews and verification still render at 1×.
  - The Spec records this revision and stays `draft`.
- **Format tiles.** Labels use ink and idle outlines are stronger. Selection is still marked by the fill, the dot and a medium-weight label.
- **Canvas errors.**
  - A shared `ipcErrorMessage` helper strips Electron's "Error invoking remote method …" wrapper. It replaces the copy in the local-file hook and is used for every canvas error.
  - Attach failures say "The canvas couldn't open.", keep the detail, and offer Retry. Retry re-runs the existing attach effect.
- **Not changed (#21).**
  - The canvas tab stays closeable: closing it is the only way to unload a canvas, and reopening it recovers from a stuck attach.
  - The tab strip merging into the toolbar row is the phase 2 owner decision.
  - "Add panel → Files" stays.

## Verification

- Automated checks:
  - `pnpm check`, `pnpm format`, `pnpm run docs check` and the OSS desktop build passed.
  - New tests cover obstacle-aware placement, the count chip, and the attach error with Retry.
  - The existing toolbar and canvas suites pass (45 tests).
- In the rebuilt app, with real local data:
  - The format tiles render in ink.
  - The Urban Bloom canvas shows "No versions yet".
  - The Export menu lists PNG/JPEG at 1×, @2x and @3x.
  - Selecting the headline showed "Ask Molly", no count chip, and the toolbar below the headline, so "SPECIALTY COFFEE" was no longer covered.
- Real exports, with the save dialog stubbed to `/tmp` in the main process, produced 1080×1350, 2160×2700 and 3240×4050 PNGs. A crop comparison confirmed the 3× text is rasterised natively, not enlarged.
- Limits:
  - In that tight layout the toolbar still clips the top of the line below, and the size readout still overlaps "ROASTERS".
  - JPEG scaling, dark mode and the Chinese UI were not checked in the app.
  - No artwork was edited and no paid model request was made.
