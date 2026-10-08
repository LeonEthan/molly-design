# Designer batch 4: no blank thumbnails or gallery cards for empty designs

Status: implemented
Translation: pending

PR: [#93](https://github.com/LeonEthan/molly-design/pull/93)

## Abstract

The 2026-10-07 audit found that a first run that stopped or failed leaves an artwork with nothing on the canvas. Its sidebar thumbnail was a blank white sheet, and the home "Your work" gallery promoted it as a finished piece. Canvases with no elements now get an empty thumbnail instead of a rendered white image, and the gallery leaves those designs out and counts only what it shows. Other batch 4 items are listed under Not done.

## Decisions and reuse

- **Reused:** the existing derived thumbnail cache and its per-revision comparison. A canvas with no elements takes the same path, but skips the offscreen render and caches `''` for that revision.
- **Cache directory.** The cache moves to `design-thumbnails-v2` and the previous one is retired, because artworks cached earlier would otherwise keep their white image until the next save.
- **Renderer.** `useDesignThumbnails` reads many artworks at once, so the gallery can filter before it draws and count what it shows. Blank designs stay subscribed, so one reappears once something is drawn on it.
- **Sidebar.** Rows keep their neutral tile; a blank artwork no longer shows a white square.
- **Pending thumbnails.** Cards whose thumbnail has not loaded yet still show their placeholder, so a blank one can appear briefly before it is removed.

## Not done

- No empty-canvas hint on the open canvas, which would be a new element and needs owner confirmation.
- The gallery count still only counts the newest 24; #20 (order and counts) is a separate item.

## Verification

- New core test: a canvas with no elements caches as blank without rendering, and renders again once it has content.
- New gallery tests: blank designs are left out and uncounted, and return after a refresh push.
