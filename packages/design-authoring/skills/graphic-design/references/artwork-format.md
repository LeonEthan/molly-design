# YAML artwork format

The files Molly admits, what each element can do once a person opens the artwork,
and the optional helpers. Molly's intake validator enforces the format after your
turn. Do not invent fields, and do not write a presentation catalogue, HTML rich
text, theme `$ref` or leftover `.pptd` syntax.

## Project shape

```text
design.yaml          # molly-canvas/1: the complete editable canvas
media/*              # optional local raster and font assets
```

Image and font paths are `media/<name>` with a single filename, never remote URLs
or paths escaping the project. Each referenced image or font must be at most
16 MiB (16,777,216 bytes) and have a supported actual format for its kind; local
validation, native preview and final collection apply the same checks, and their
diagnostics name the relative path with actual and allowed bytes or the asset
kind. Unreferenced files in `media/` are not part of the artwork.

## Canvas fields

`design.yaml` requires `format: molly-canvas/1`, `size` and `elements`. `size` is
an integer pair `[width, height]`, each from 1 through 4096. Optional fields are
`background`, `customFonts`, `diagnostics` and `title`; missing background is
solid white and missing diagnostics is an empty array. `title` is file metadata
that Molly may show as the conversation name. Do not write `pages`, `version` or
`schemaVersion`.

`background` and shape `fill` are fill objects, never bare color strings:

```yaml
background:
  type: solid
  color: '#F4F1EA'
```

A linear gradient uses `type: gradient`, `gradientType: linear`, an `angle` in
CSS degrees (180 runs top to bottom) and two or more `stops` with `position`
0–1 and `color`; colors may carry alpha as `#RRGGBBAA`. The layered example uses
one as a text scrim.

## What is editable today

Every kind below is admitted and rendered by Molly's canvas. In the editor a
person can select, move, resize, rotate, reorder, group and delete any element;
the other edits differ by kind. Describe editability in these terms and promise
no more than this table.

| `kind`  | Use it for                                             | The editor also offers                                |
| ------- | ------------------------------------------------------ | ----------------------------------------------------- |
| `text`  | All ordinary copy                                      | Wording, size, color, weight, alignment, font         |
| `shape` | Flat blocks, rules, badges, scrims                     | Fill, border, preset or custom path                   |
| `line`  | Rules, connectors, arrows, curves                      | Points, curve mode, arrowheads, stroke                |
| `image` | Photos, generated layers, textures, artistic lettering | Replace the image, fit; treat crop as limited (below) |
| `icon`  | Glyph-style symbols from the offline set               | Choice of icon and its color                          |
| `table` | Real tabular content                                   | Cell text, fills, borders, alignment, merges          |
| `chart` | Real data: bar, line, area, pie and more               | Chart data, series, legend and labels                 |

Use `table` and `chart` when the content really is tabular or numeric data; a
picture of a chart is not editable data. Image `crop` has a known rendering issue
at fractional scales, so prefer pre-cropped assets with `fit` and check any crop
in a render. Groups are the flat `groupId`, not nested nodes, and do not change
rendering. Existing projected documents may carry editable fields this guide
does not list: preserve them when editing rather than treating them as
unsupported.

Field validation proves only that intake accepts the syntax. Any silent drop,
placeholder or mismatch between preview and reopened artwork is a failure to
remove or report, even if the source parsed.

## Elements

Each element has a unique, stable `id` and a `kind`. Array order is z-order; an
omitted `zIndex` is filled from the array index and an explicit one is kept.
Common fields are `bounds`, optional `rotation`, `flip`, `groupId`, `opacity` and
`shadow` (`blur`, `color`, optional `offset: [x, y]`). `bounds` is `[x, y, w, h]`
with `x ≥ 0`, `y ≥ 0`, `w > 0`, `h > 0`, `x + w ≤ canvas width` and
`y + h ≤ canvas height`; a block flush with the bottom edge uses `y = canvasH - h`.

For the validator-derived field list of one kind, run
`node scripts/format.mjs kind <kind>` from the skill directory. It lists field
names; the notes below explain their values.

- `text`: structured `text.paragraphs[].runs[]`, never HTML `content`. Text style
  (`fontSize`, `color`, `align`, `wrap`, `fontFamily`, `letterSpacing`, and a
  `gradient` fill object for the letters) goes inside `text`; run-specific
  overrides such as `bold` go on the run. A drop shadow is the element's
  `shadow`. Check styled text in a render.
- `shape`: `shapeName` (`rect`, `roundRect`, `ellipse`, `oval`, `triangle`, `arrow`,
  or `custom` with `viewBox` and `path`), plus `fill` / `border`.
- `line`: `viewBox: [width, height]` is a pair of positive numbers (for example
  `[120, 120]`), not an SVG four-number string. `points` are whitespace-separated
  `x,y` pairs. With `curve: smooth`, give one start point then groups of three
  (control 1, control 2, endpoint), so 4, 7, 10, … points; these are Bézier
  controls, not sampled freehand points. `sharp` and `round` take ordinary
  polyline points. Optional `arrow`, plus `border`.
- `image`: `src` under `media/`, `fit` (`cover`, `contain` or `fill`), optional
  `crop` and `cropShape`.
- `icon`: `iconName` as `style:name` from the pinned offline shelf.
- `table` / `chart`: structured `table` / `chart` objects with literal styles.

Geometry sits on the element and text style inside `text`; unknown fields are
rejected, not relocated:

```yaml
- id: heading
  kind: text
  bounds: [12, 12, 261, 48]
  text:
    fontSize: 20
    color: '#111111'
    align: [center, middle]
    wrap: true
    paragraphs:
      - runs:
          - text: 'Editable heading'
            bold: true
```

Two geometry habits the editor rewards:

- Give text bounds headroom; the editor re-measures and grows text boxes on edit,
  and a tight box shifts layout under the user's first touch.
- Do not place `wrap: false` text near canvas edges: it renders unclipped and
  overflows the canvas.

## Fonts

Omit `fontFamily` to use Inter, the bundled default. Any other family needs a
`customFonts` entry with `family` and a local `media/` `src`, plus optional
`weight` and `style` strings describing the actual face; use one entry per face.
The text's `fontFamily` names the registered family:

```yaml
customFonts:
  - family: Artwork Heading
    src: media/artwork-heading.woff
    weight: '400'
    style: normal
elements:
  - id: heading
    kind: text
    bounds: [24, 24, 432, 120]
    text:
      fontFamily: Artwork Heading
      fontSize: 40
      paragraphs:
        - runs:
            - text: 'Editable heading'
```

Check the font's actual format and bytes; renaming the extension does not convert
it. Keep the face's complete glyph set, because subsetting to today's copy breaks
the user's next edit; to convert or compress a face, read
[font-preparation.md](font-preparation.md). A file's presence or a passing
validation does not prove Chromium can load it, and copying a macOS system font
carries the same doubt, so render the first usable draft with its key fonts. A
native preview font error points to that registration, not to a missing renderer.

**Chinese, Japanese and Korean copy.** Inter has no CJK glyphs. Without a
registered CJK font, those characters fall back to whatever system font the
viewing computer has, so the artwork can look different on another machine and in
export. When CJK copy matters to the design, register a complete licensed CJK face
(one that also covers the Latin characters you use) and set it as the text's
`fontFamily`. Complete CJK fonts are large: if one exceeds the 16 MiB asset limit,
compress the complete face to WOFF first, then choose another complete face or
agree the limitation with the user; never subset it. If you leave CJK text on
fallback, report that its typeface depends on the viewer's computer.

Check more than letters: the face must include the punctuation and symbols the
language uses (Chinese full-width commas, full stops, book-title marks and
quotation marks, Japanese brackets), and the copy should use that language's
punctuation rather than Latin substitutes. Avoid starting a line with closing
punctuation; adjust the break or the box width in the render.

## Examples

- [../examples/minimal/design.yaml](../examples/minimal/design.yaml): a solid
  background, a `rect` band, structured text and an image with `fit: cover`.
- [../examples/layered/design.yaml](../examples/layered/design.yaml): the layered
  structure most designs need: an opaque background image, a transparent subject
  with a shadow, a gradient scrim and two grouped text elements, back to front.

Copy their field shapes; they are not a capability list. Repository tests run
intake against both, so they cannot silently drift from the schema.

## Helpers

All run from the skill directory and are optional.

- `node scripts/finalize.mjs <project>/design.yaml[.tmp]` checks structure and
  assets and can promote a clean `.tmp`. Writing `design.yaml` directly is fine.
- `node scripts/render-preview.mjs <project>/design.yaml` runs intake locally. It
  does not render an image; `molly_render_preview` does.
- `node scripts/migrate-two-file.mjs <old-draft> <new-output>` converts an
  inherited old two-file draft into a fresh directory and keeps the source.

None of these renders, reviews or saves the artwork.
