# Session files and image preview

File attachments use `file` blocks; the product contract is in
`specs/session-files.md`.

- `session-file-card.tsx` — pure card (icon by extension, name, size; pending/expired/
  previewable/downloadable derived from transport + `getServerNow()` expiry) and
  `SessionFileCardList` (adjacent-block aggregation). Story: `SessionFileCard.stories.tsx`,
  test: `tests/session-file-card.test.tsx`.
- One card, one primary action — EXCEPT an HTML attachment, which also gets a separate
  download button for the source bytes. Its click opens the RENDERED page (browser
  surface or live file preview), a surface with no control of its own for the file that
  was uploaded; every other previewable file opens the preview dialog, which already
  downloads from inside, so it must not grow a duplicate control. That button carries the
  in-flight spinner, and the primary affordance keeps reading as preview.
- `session-file-preview-dialog.tsx` — `SessionFilePreviewPanel` (status-driven;
  markdown reuses `MarkdownRenderer`, raw toggle, copy=raw, truncation) and dialog wrapper.
  Story: `SessionFilePreviewPanel.stories.tsx`.
- `view.tsx` `SessionFileGroup` owns atoms/download/preview-fetch and resolves the pending
  machine name. Both render switches and `UserChatBubble` route `file` blocks through it.
  Upload/download/preview helpers: `@/lib/session-file-{upload,download,presentation}.ts`.
- Agent-uploaded blocks may carry a workspace-relative `sourcePath` proven by the CLI's
  containment check. It is provenance for reopening the live file, never a download path.
  HTML clicks use it only for same-machine Sessions and enter the existing rendered file
  preview. Missing provenance or preview state falls back to the ordinary
  attachment preview instead of guessing.
- `@/lib/session-file-download.ts` exports attachment bytes in Electron through
  a blob and `<a download>`.

## Image-preview overlay (zoom / pan)

- **There is exactly ONE zoomable image surface in the app:**
  `../shared/zoomable-image-viewer.tsx` (`ZoomableImageViewer`, wrapping
  `react-photo-view` `PhotoSlider`). It owns pinch-to-zoom, double-tap/wheel zoom,
  drag-to-pan, and the top-right close button. Both callers mount it:
  `view.tsx` `ImagePreviewDialog` (chat image blocks, gallery of the turn's images)
  and `../sessions/session-file-image-preview.tsx` (Code Collab file preview, one
  image). A new image surface must reuse it rather than hand-roll gestures —
  the two paths are required to feel identical.
- The file preview stays a fitted `<img>` inline and opens the viewer on click.
- `react-photo-view@1.2.7` is patched in root `patches/` to hard-clamp the MINIMUM
  pinch scale at `1` (no shrink-below-fit rubber band; max stays 6×). Do not replace
  this with an outer `overlayRender`/React state clamp; that fights PhotoView's touch
  state.
- The viewer is a desktop lightbox (`zoomable-image-viewer.css`): the photo is
  inset by a `transform: scale()`, with a translucent blurred mask and a top bar
  padded clear of the macOS traffic lights / Windows caption buttons. A single
  image has no `1 / 1` counter. Never inset the photo by capping `width`/`height`
  or padding; PhotoView centers its own box and small images must stay visible.
- Right-click inside the viewer opens a NATIVE Copy / Save menu, Electron only
  (`../../lib/image-preview-export.ts` + `apps/electron/.../image-export-service.ts`).
  The image is a `blob:` URL, so main cannot download it: main pops the menu and
  the renderer sends bytes for the chosen action — PNG re-encoded through a canvas
  for the clipboard, original encoding for the save. Callers pass `fileName` on
  each `ZoomableImageViewerItem` for the save-dialog default. With no preload
  bridge the handler must not `preventDefault()`: web keeps the browser's menu.
- Still plain non-zoomable `<img>`, by scope not by accident: tool-call `image`
  content blocks in `view.tsx` and markdown images in `markdown-renderer.tsx`.
