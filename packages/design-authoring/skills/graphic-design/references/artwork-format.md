# YAML artwork format

This is a compact format guide. Read
[graphic-canvas-profile.md](graphic-canvas-profile.md) first. Write the YAML
artwork projection below; Molly's intake validator enforces it after your turn.

Do not invent fields. Do not write a presentation catalogue, HTML rich text,
theme `$ref`, or leftover `.pptd` syntax.

## Project shape

Deliver one self-contained project in the design authoring directory supplied
with the turn:

```text
design.yaml          # molly-canvas/1: the complete editable canvas
media/*              # optional local raster and font assets
```

Keep dependencies inside the project. Image and font paths must be `media/<name>`
with a single filename, never remote URLs or paths escaping the project.

Each referenced image or font must fit within 16 MiB (16,777,216 bytes) and have
a supported actual format for its asset kind. The same asset checks apply to
local validation, native preview and final collection. Unreferenced files in
`media/` are not part of the artwork's asset closure. Size diagnostics identify
the relative path and actual/allowed bytes; format diagnostics identify the
relative path and asset kind. Correct the asset before repeating the check.

## Canvas fields

`design.yaml` requires `format: molly-canvas/1`, `size`, and `elements`.
`size` is an integer pair `[width, height]`; each dimension must be from 1 through
4096 inclusive. Optional fields are
`background`, `customFonts`, `diagnostics`, and `title`. Missing background is
solid white; missing diagnostics is an empty array. `title` is file metadata,
not a canonical title saved by the editor. Do not write `pages`, `version`, or
`schemaVersion`.

`background` and shape `fill` must be fill objects, never bare color strings.
For a solid color, use `type: solid` and `color: '#F4F1EA'` under the fill field;
`background: '#F4F1EA'` and `fill: '#F4F1EA'` are rejected at intake.

Omit `fontFamily` to use Inter, the bundled licensed default family name. Other
families need a `customFonts` registration whose `src` is a local `media/` font
file.

## Fonts

Register each font with `family` and `src`. Optional `weight` and `style` are
strings describing the actual face; multiple weights use separate entries.
The text's `fontFamily` references the registration's family name. This complete
source example assumes a compatible regular font has been placed at the named
local path; replace the name and descriptors with those of your chosen font:

```yaml
format: molly-canvas/1
size: [480, 240]
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
      color: '#111111'
      paragraphs:
        - runs:
            - text: 'Editable heading'
```

Check the actual font format and bytes, not just the filename extension. Render
the first usable draft with its key fonts before detailed typography. Keep font
sources local and preserve the original when preparing an explicit compatible
copy; changing an extension alone does not convert the font. For preparation,
read [font-preparation.md](font-preparation.md). Keep the selected face's complete
glyph coverage; subsetting to today's copy can break the user's next edit.

A font file's presence and structural validation do not prove that Chromium can
load it; copying a macOS system font carries the same limitation. A native
preview font error points to a registered font that needs diagnosis and a
compatible source, not to an unavailable rendering tool. Preserve the intended
typography when correcting the registration, then use the native preview to
check the result.

## Elements

Each element uses Bento `id` and `kind`. IDs must be unique and stable. Array
order is z-order; an omitted `zIndex` is filled from the array index, and an
explicit `zIndex` is kept.

Admitted `kind` values are `text`, `shape`, `line`, `image`, `icon`, `table`,
and `chart`. Common fields include `bounds`, optional `rotation`, `flip`,
`groupId`, `opacity`, and `shadow`. `bounds` is `[x, y, w, h]` with `x ≥ 0`,
`y ≥ 0`, `w > 0`, `h > 0`, `x + w ≤ canvas width`, and `y + h ≤ canvas height`.
A block flush with the bottom edge uses `y = canvasH - h`.

For the validator-derived list of admitted element fields, run
`node scripts/format.mjs kind <kind>` from the skill directory, for example
`node scripts/format.mjs kind image` or `node scripts/format.mjs kind text`.
This lists field names; the descriptions and examples below explain their values
and nested structure.

- `text`: structured `text.paragraphs[].runs[]`. Do not write HTML `content`.
- `shape`: `shapeName` (`rect`, `roundRect`, `ellipse`, `oval`, `triangle`,
  `arrow`, or `custom` with `viewBox` and `path`), plus `fill` / `border`.
- `line`: `viewBox: [width, height]` is a pair of positive numbers defining
  local coordinates (for example `[120, 120]`), not an SVG four-number string.
  Use `points`, optional `curve` / `arrow`, plus `border`.
  Points are whitespace-separated `x,y` pairs. For `curve: smooth`, use one
  start point followed by groups of three: control point 1, control point 2,
  segment endpoint. Thus a curved line needs 4, 7, 10, … points; two points
  render as a straight line. These are Bézier controls, not sampled freehand
  points. `sharp` and `round` accept ordinary polyline points.
- `image`: `src` under `media/`, `fit` (`cover`, `contain`, or `fill`), optional
  `crop` and `cropShape`.
- `icon`: `iconName` as `style:name` against the pinned offline shelf.
- `table` / `chart`: structured `table` / `chart` objects with literal styles.

Text geometry belongs on the element; text style belongs inside `text`, not beside
`kind`. For example:

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
```

Run-specific overrides such as `bold` go on that run. `bounds`, `opacity`, `groupId`
and `shadow` remain element fields. Unknown fields are rejected, not relocated.

Groups are the existing flat `groupId`, not nested nodes. Preserve existing
fields and array order when editing a projected document.

## Minimal structural example

Read [../examples/minimal/design.yaml](../examples/minimal/design.yaml) and its
adjacent `media/`. It demonstrates packaging, geometry, and
membership together: a solid background, a `rect` band, structured text, and an
image with `fit: cover`. Copy its field shape; it is not a capability whitelist.
A repository test runs intake against these files, so the example cannot
silently drift from the schema.

Two geometry habits the editor rewards:

- Give text bounds headroom instead of fitting the box exactly to the glyphs;
  the editor re-measures and grows text boxes on edit, and a tight box shifts
  layout under the user's first touch.
- Do not place `wrap: false` text near canvas edges: it renders unclipped and
  overflows the canvas.

## Authoring invariants

- Use explicit finite canvas geometry and explicit element bounds in canvas
  coordinates.
- Keep every element `id` unique and stable. Preserve array order when it
  carries z-order.
- Use locally resolvable assets under `media/` and Inter (or a registered
  custom family) for type.
- Keep text as text and flat graphics as supported editable primitives.
  Rasterize only content that is genuinely raster or when the Active Profile
  explicitly declares and accepts the resulting edit limitation.
- Use compound elements only at their declared edit level. Do not call a
  decomposition a native table, chart, icon, rich-text block, or mask.
- Do not write fields merely because a TypeScript type, Bento internals, or an
  external catalogue mentions them. Active support requires the full lifecycle.
- Do not depend on presentation order, notes, animation, remote services, or
  PPTX semantics.

## Validation and handoff

`node scripts/finalize.mjs <project>/design.yaml[.tmp]` (from the skill
directory) is an optional structure and asset self-check. It can promote a clean `.tmp`,
but writing `design.yaml` directly is supported. Molly independently checks the
collected project and versions. A successful helper result does not prove native
font loading, visual review or an application save.

`node scripts/render-preview.mjs <project>/design.yaml` checks intake locally;
it does not render an image. Use the main Skill's native preview and image-reading
steps to establish the current draft's rendered appearance. An external
approximation is supplementary evidence, not proof that Bento renders the work.

For an inherited old two-file draft, the optional
`node scripts/migrate-two-file.mjs <old-draft> <new-output>` creates a fresh
directory and preserves the source. It does not submit or update current artwork.

Final collection happens after the Agent turn. Report prepared files and observed
previews accurately; a saved artwork requires an application save receipt. Do not
wait for that turn's later collection or treat `finalize` as a commit command.

Any silent drop, placeholder, reset after reopen, or mismatch between preview
and export is a failed capability, even if the source parsed. Remove the
unsupported semantics, choose a declared editable decomposition, or report the
limitation.
