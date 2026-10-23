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

## PR #231 review corrections

The review exposed three defects in the shipped fitting helpers. X-height-only
Latin copy (`summer`, `minimum`, `iii`) supplied its body height through `--cap`
but was scaled against cap height. The matcher now recognizes that copy and uses
`sxHeight`, reporting that interpretation. Other copy keeps cap-height scaling;
faces without the required height remain excluded. This is a Latin heuristic,
not general script or optical-height recognition.

The catalog now retains advances for every covered Unicode range, including
supplementary-plane characters. The CJK filter accepts overlap with CJK ranges,
including Hangul, rather than requiring both endpoints of an entire block.
Actual copy must still pass coverage and advance checks. Cache version 4 forces
old truncated advance maps to rebuild, including at an overridden cache path.

Measurement joins small detached bands to a nearby taller body when their columns
align, with the gap bounded relative to the body's height. The body with the most
ink supplies the core baseline and height; dots and accents remain in the ink box
and glyph measurement. Multi-line segmentation remains approximate for tightly
spaced lines or mixed type sizes.

Reuse: adapt the existing sfnt/cmap/advance parser, row bands and synthetic-fixture
tests. External font tooling or a separate image-analysis dependency would add
setup without resolving an uncovered responsibility. The merge with `main`
preserves both the Round 5/6 Part C and Part A test records; no historical result
is changed. These repairs do not change creative-stage policy or approve the Spec.

Deterministic regression cases cover lowercase sizes, CJK ideographs/kana/Hangul
and supplementary characters on cold and warm caches, and detached/offset marks
above stems alongside a separate second line. Full validation is recorded in the
[PR](https://github.com/LeonEthan/molly-design/pull/231); no paid model calls or
visual acceptance reruns are required for these helper corrections.

Review-fix validation: `pnpm check` passed after initializing the required ACP
core/DSH contract submodules and granting local IPC test sockets access outside
the runner sandbox. This includes 178 authoring, 3,014 CLI and 3,367 component
tests, with the existing suite skips retained. `pnpm format`,
`pnpm run docs check --base origin/main` and `git diff --check` passed.
A real local system-font scan took 8.4 seconds cold; cached Chinese matching
returned candidates in 0.27 seconds. The binary-search lookup produced the same
catalog bytes as the linear lookup. These timings are observations on one Mac,
not deterministic performance assertions or cross-platform acceptance.

## Second review: cache safety and unsupported inputs

The next review of PR #231 identified a predictable shared temporary cache path,
unbounded cache reads, truncated TTC headers escaping the per-face error boundary,
and meaningless text metrics on nonuniform backgrounds. Regressions reproduced
unsafe cache writes, scan failure and false metrics before the fixes.

The catalog keeps its existing advisory cache, now under a private per-user
0700 directory. POSIX reads and replacement require the current user's private,
single-link regular file; symlinks, hardlinks and nonregular files are rejected.
Reads bind the opened file identity, allocate at most the 64 MiB cache limit plus
an overflow byte, and validate cached face shapes. Atomic writes use exclusive
0600 temporary files, check the destination again and clean up temporary files.
Unsafe or unavailable caches fall back to an uncached scan. Windows retains type
and bounded-read checks but does not claim POSIX ownership/mode enforcement.
The explicit cache override likewise requires a private directory.

Reuse alternatives checked: `collect-authoring` already demonstrates no-follow,
identity-checked and bounded reads. Its code cannot be imported by a self-contained
skill, so the helper borrows that pattern with Node builtins. `font-prepare` owns
an explicit Python environment rather than a general cache seam. Removing caching
would make every match repeat the measured cold scan, so caching remains advisory.
No new service or shared persistence abstraction is introduced.

TTC offset arrays must fit in the file and all advertised face headers must be
in bounds; an invalid collection is skipped while valid neighboring fonts remain
usable. Measurement reuses the existing quantized color samples: substantial
variation on the crop border or among foreground pixels causes a clear unsupported
measurement error before any line metrics. This is a conservative flat-background,
single-color-text helper, not general photographic text segmentation. Mild background
variation and antialiasing remain covered by a passing fixture.

Regression coverage includes private default-cache modes, symlink/hardlink/directory
and publicly writable cache paths, oversized/malformed caches, a truncated TTC next
to a valid face, gradient/texture refusal, and acceptance of a near-flat antialiased
line. No live model calls or changes to artwork intake/creative stages are involved.

Second-review validation: all 189 design-authoring tests and the complete
`pnpm check` passed (including 3,014 CLI and 3,367 component tests; existing skips
retained). `pnpm format`, targeted type-aware lint/typecheck,
`pnpm run docs check --base origin/main` and `git diff --check` passed. Validation
uses synthetic local fixtures and local IPC permissions; no external model calls.
