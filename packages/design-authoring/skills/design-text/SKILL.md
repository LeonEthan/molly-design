---
name: design-text
description: 'Use when a Molly design task involves text: choosing between native editable text and image lettering, extracting or regenerating lettering layers with textCopy, registering custom fonts, preparing WOFF faces, or handling Chinese, Japanese or Korean copy.'
metadata:
  short-description: Text representation, lettering layers and fonts
---

# Design Text and Lettering

How copy is represented in a Molly artwork so it stays faithful and as editable
as the design allows. The `graphic-design` skill owns branches and reporting;
this skill owns the wording.

## Take wording from the source, not the design image

Take the wording from the brief or the source artwork, never from the design
image: the image model drops and alters copy. List every line the source
carries, fine print and disclaimers included, and place each one, including a
line the design left out, where the design's hierarchy puts similar copy. Then
match how the chosen design sets each piece: position, size, weight, color,
spacing and alignment.

## Choose a representation for each piece

Ask whether native text can reproduce the design's letterforms and finish
faithfully:

- **Native text** (`kind: text`) with a standard or registered font when it can:
  body copy, dates, times, prices, addresses, lists, fine print, labels in an
  ordinary typeface and anything the user is likely to reword. Native text
  handles color, gradient, shadow, weight and spacing. Long or small copy stays
  native even when styled; match it as closely as fonts allow.
- **Image lettering** (an `image` element isolated from the chosen design) when
  it cannot, at any size: drawn or custom letterforms, calligraphy, outlines
  combined with fills, texture, 3D, letters fused with a badge or background
  shape, warped or per-letter styling. Isolate it together with its badge when
  the badge belongs to it. Do not flatten such lettering into a plain font for
  the sake of editability. One image lettering layer carries one piece of copy
  that reads as a unit (a headline, a name, a label): never merge separate
  lines or unrelated pieces into one layer, and never fuse body copy into a
  headline's layer. Every image lettering layer must carry `textCopy` with the
  exact wording the picture shows, so the editor can offer to reword it and a
  later turn can regenerate it without re-reading pixels.

Every character of image lettering must match the source copy; check it letter
by letter, regenerate a wrong one with the exact text, and if it still fails
set that copy as native text and report the difference. The wording of image
lettering changes by regenerating it; because the layer carries `textCopy`, the
person can ask for that rewording directly from the canvas, so report image
lettering as regenerable wording rather than as frozen pixels. The extraction
prompt and layer checks are in the `design-replication` skill's
`references/layered-workflow.md` ("Lettering layers"); `customFonts` field
shapes are in the `graphic-design` skill's `references/artwork-format.md`.

## Fonts

**Finding fonts.** Look only in the known font directories: on macOS `/System/Library/Fonts`, `/System/Library/Fonts/Supplemental`, `/Library/Fonts` and `~/Library/Fonts`; on Windows `C:\Windows\Fonts`; on Linux `fc-list` or `/usr/share/fonts`. Never search the whole filesystem or home directory (`find /`, `find ~`, unscoped `mdfind`); it can take minutes. `node scripts/font-catalog.mjs list` prints those faces with their files and
metrics in one call; `match` shortlists faces for copy measured in a reference
(see the `design-replication` skill's "Fit type"). If a wanted face is not
there, use Inter (the bundled default) or a face you found and say so.

Register real font files as the format reference describes, keep each face's
complete glyph set, and check Chinese, Japanese or Korean copy against the font
section there. Render the first usable version early to confirm key fonts load
before detailed typography. To convert or compress a complete face (never
subset), read [references/font-preparation.md](references/font-preparation.md)
and use the optional helper from this skill's directory:

```sh
node scripts/font-prepare.mjs --help
node scripts/font-catalog.mjs list [--family <substr>] [--cjk]
node scripts/font-catalog.mjs match --text "<copy>" --width <px> --cap <px> [--stroke <px>] [--glyphs <n> --glyph-ink <px>] [--x <px>] [--family <substr>]
```
