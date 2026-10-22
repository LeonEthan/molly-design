# Compare font samples in the design image viewer

Status: implemented
Translation: pending

## Abstract

Implement the app portion of [#223](https://github.com/LeonEthan/molly-design/issues/223)
part C: one bounded comparison of installed font candidates against a reference,
using the existing read-only image viewer. Skills retain responsibility for font
shortlisting and creative judgment. The design Spec remains draft.

## Reuse and behavior

Adapt `molly_view_image`'s scoped paths, sharp dependency, JPEG response and SVG
number labels. `molly_render_preview` renders only the current artwork without
sample parameters; Settings' `queryLocalFonts` supplies names rather than file
paths; the skill's FontTools preparation requires a Python environment. A new
rasterizer or protocol is unnecessary. This extends the viewer described in the
[discovery record](../bug-fix/2026-10-21-design-viewer-exposure.md); its registration
and direct-exposure behavior remain unchanged.

Font mode accepts up to eight absolute TTF/OTF/TTC files plus literal text, with an
optional scoped reference crop. Realpath and regular-file checks confine fonts to
the Session workdir or platform font directories. Pango receives escaped markup
and the actual fontfile. Ink-trimmed rows share a normalized height, with labels,
width ratios and explicit reporting when a row is too wide for the bounded sheet.
Crop extraction is materialized before trimming because sharp orders trim before
extract within one pipeline. No files, caches or artwork state are written.

## Fallback probe limitation and plan deviation

The approved bitmap-only rejection rule is infeasible on the local sharp 0.35.4 /
Pango build: with the committed fixture fontfile, both `Molly Test Serif 96` and
`Molly Missing Face 96` render identical ink. Fontconfig reports no default config
and can choose the supplied font itself as the missing-face fallback. Rejecting
every equal bitmap would refuse valid samples.

Retain the planned bitmap comparison, but reject equal results only when the
requested name is also absent from the supplied SFNT/TTC name tables. Accept family,
full and PostScript names, plus family/style pairs, ignoring case, whitespace and
hyphens. Invalid font headers fail as render errors even if Pango silently renders
a previously loaded fallback. This is a best-effort missing-face check, not proof
of the selected Pango face or glyph coverage. Named faces can still use fallback
for unsupported glyphs, and a missing name with a different fallback bitmap is not
rejected by this probe. Do not claim stronger verification from a successful row.

## Evidence and limits

The viewer integration suite exercises strict input modes, text bounds, reference
plus two font rows, equal normalized ink heights, width ratios, labels, literal
markup, wide-row reporting, unknown faces, corrupt fonts, font scopes and symlink
escapes. It also retains the existing image and daemon-scope regressions. Samples
use a committed ASCII subset of Instrument Serif under OFL, renamed Molly Test
Serif; its source, regeneration method and license are beside the fixture.

These deterministic tests do not establish live Agent tool use, cross-platform
Pango selection or human visual acceptance. The coordinator owns the separate
case-C model runs and visual review.

Validation: targeted viewer/server tests passed 45/45, including a TTC synthesized
from the committed SFNT fixture. `pnpm check` passed (CLI: 3,014 passed and three
existing skips), as did `pnpm format` with the concurrently owned skill tree
explicitly ignored, `pnpm run docs check` and `git diff --check`. Existing docs
size/translation warnings remain; there are no registered protected topics.
