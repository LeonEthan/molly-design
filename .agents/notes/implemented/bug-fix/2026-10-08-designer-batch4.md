# Designer batch 4: no blank thumbnails, and a gallery that reads in order

Status: implemented
Translation: pending

PR: [#93](https://github.com/LeonEthan/molly-design/pull/93)

## Abstract

The 2026-10-07 audit found that a first run that stopped or failed leaves an artwork with nothing on the canvas. Its sidebar thumbnail was a blank white sheet, and the home "Your work" gallery promoted it as a finished piece. Canvases still in their starting state (no elements and the default white fill) now get an empty thumbnail instead of a rendered white image, and the gallery leaves those designs out and counts only what it shows. The gallery also reads left to right, newest first, and its count no longer pretends to be the total (#20).

## Decisions and reuse

- **Reused:** the existing derived thumbnail cache and its per-revision comparison. A starting-state canvas takes the same path, but skips the offscreen render and caches `''` for that revision.
- **What counts as blank.** No elements and the default solid white background (`packages/shared/src/design-blank-canvas.ts`). A design with only a changed background is real content, so it keeps its preview; the first version of this change treated every zero-element document as blank, which the PR review caught. The same rule now guards the "Before Molly's edit" entry from batch 3, which had the same flaw.
- **Cache directory.** The cache moves to `design-thumbnails-v2` and the previous one is retired, because artworks cached earlier would otherwise keep their white image until the next save.
- **Renderer.** `useDesignThumbnails` reads many artworks at once, so the gallery can filter before it draws and count what it shows. Blank designs stay subscribed, so one reappears once something is drawn on it.
- **Order (#20).** The gallery was a CSS multi-column layout, which fills each column top to bottom, so newest-first read out of order across the page. It is now a grid, so rows read left to right. Cards keep their natural height, so a row can leave space under its shorter cards.
- **Limit and count (#20).** Home passes up to 48 recent candidates; the gallery drops blank ones, then shows the first 24. The old count was the number shown out of an already-capped list, so it matched neither the sidebar total nor the real number of designs. The header now says "Latest 24" when the list is truncated, and "N pieces" otherwise.
- **Sidebar.** Rows keep their neutral tile; a blank artwork no longer shows a white square.
- **Pending thumbnails.** Cards whose thumbnail has not loaded yet still show their placeholder, so a blank one can appear briefly before it is removed.

## Not done

- No empty-canvas hint on the open canvas, which would be a new element and needs owner confirmation.
- No "see all" link from the gallery: the sidebar list is the full list.

## Verification

- New core test: a blank canvas caches as blank without rendering, and renders again once it has content.
- New gallery tests: blank designs are left out and uncounted, return after a refresh push, and the limit applies after blanks are dropped and reports truncation.
- In the app on a clone of the owner's data: cards sit left to right in date order (Oct 6, 6, 6, 6, 6, then Oct 5, …) and the header read "Latest 24".
