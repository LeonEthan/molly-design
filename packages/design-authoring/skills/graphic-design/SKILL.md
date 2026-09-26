---
name: graphic-design
description: "Create or reconstruct editable posters, infographics, social graphics, banners, covers, flyers, and other static single-canvas designs as a YAML artwork project for Molly's Bento-derived editor and renderer."
metadata:
  short-description: Create editable static single-canvas graphic designs
---

# Graphic Design

Create one static graphic canvas as editable source. The source is a YAML artwork
project that Molly imports into its Bento-derived editor and renderer. It is not a
slide deck. A reference image or a flattened render must never stand in for the
editable design.

Write the project in the design authoring directory supplied with the turn:

```text
design.yaml          # molly-canvas/1: size, background, elements
media/               # local raster and font assets
```

This directory may differ from Agent cwd in a local project; ordinary chat
workspaces retain their root. Molly collects exactly these draft files, validates
them, and imports the result as the editable document. The separate
`design-current/` path is application input, never a submitted draft; it may be
absent until synchronized. You do not write `design.json` yourself. Leftover
`.pptd` files are not an authoring entry.

## Recommended workflow

For a new design, or a reconstruction that needs generated imagery, a useful
path is:

1. understand the intent, copy, materials and the user's design thinking;
2. build on supplied inspiration and references; research design sites when they
   are absent or leave a design decision unresolved;
3. generate several whole-canvas drafts and choose one;
4. regenerate each element of that draft as a complete transparent layer;
5. recompose the layers in `design.yaml`;
6. decide which text stays editable;
7. render and review the whole composition, then adjust;
8. check consistency with the brief and supplied materials;
9. polish and deliver, stating remaining deviations.

[references/layered-workflow.md](references/layered-workflow.md) explains each
stage, its tools and what testing showed. Adapt, reorder, repeat or skip stages
for the task; small edits to an existing artwork rarely need drafts. Without
image tools, compose from supplied assets, native elements and other available
capabilities.

## Route the task

Read only the references needed for the current work:

- For a new design or an overall composition pass, read
  [references/general-poster.md](references/general-poster.md). This is the default
  design knowledge for this skill.
- When generating imagery or building image layers, read
  [references/layered-workflow.md](references/layered-workflow.md).
- When reconstructing a supplied reference image, also read
  [references/replication.md](references/replication.md).
- Before choosing element semantics or promising editability, read
  [references/graphic-canvas-profile.md](references/graphic-canvas-profile.md).
- When writing the project files, read
  [references/artwork-format.md](references/artwork-format.md) and use
  [examples/minimal/design.yaml](examples/minimal/design.yaml) for a complete
  image-and-text example. From this skill directory, run
  `node scripts/format.mjs kind <kind>` for admitted element fields; the format
  guide explains nested values such as structured text.
- When supplied inspiration is absent or insufficient for a design decision, or
  the user requests online research, read
  [references/browser-research.md](references/browser-research.md). Research the
  gap while preserving the user's direction.

Do not load references for modes or element families that the task does not use.

## Authoring and optional helpers

Choose your own analysis, drafting, and review methods, order, and iteration count
for the user's task. Establish the communication goal, supplied facts and assets,
output scenario, and canvas geometry as needed. Use semantic elements at their
supported edit level; keep genuinely raster content in local assets.

Script paths below are relative to this skill's directory. These are optional
helpers, not prerequisites for creation, rendering, submission, or turn completion:

- `node scripts/reference-pack.mjs pack <reference> <work>/inspect` provides
  dimensions, grid, bands, and palette artifacts. Its `crop` command extracts a
  raster region. For 8-bit PNG layers, `alpha` reports transparency and visible
  bounds, `trim` removes transparent padding and reports the offset, and
  `compare` writes side-by-side, overlay and light/dark sheets for two same-size
  images; every option is explicit and sources are never overwritten. See
  [replication.md](references/replication.md) for this script's format limits
  and [layered-workflow.md](references/layered-workflow.md) for the layer
  helpers; use available image tools or other analysis methods as appropriate.
- `node scripts/finalize.mjs <project>/design.yaml[.tmp]` checks structure and can
  promote a clean `.tmp` canvas. You may write `design.yaml` directly. Molly
  independently validates structure, assets, and versions at intake; it does not
  require evidence that you ran this helper or completed a creative checklist.
- `node scripts/migrate-two-file.mjs <old-draft> <new-output>` explicitly converts
  a previous Molly two-file draft into a fresh directory, preserving the source.
  It does not submit or update current artwork.
- `node scripts/format.mjs [kind <kind> | excluded]` prints the admission
  table (kinds, per-kind fields, explicit rejections) derived from the same
  validator intake runs. It is a lookup helper, not a writing gate.
- `node scripts/render-preview.mjs <project>/design.yaml` checks intake locally.
  This script does not render an image or perform visual review.

Keep temporary scripts and processing files in the artwork's working directory
or the shell's `$TMPDIR`; use that supplied temp path instead of hardcoding `/tmp`.
Prefer the shipped helpers. If an additional dependency is needed, keep its
environment and caches in those writable locations rather than a user-wide install.

When using `molly_render_preview`, open the returned PNG with an actual
image-reading tool, inspect what was rendered, and continue modifying the project
as useful. Render and view updated images when you need to judge changes. A prior
image shows the prior file state; structural validation does not judge composition.
If `molly_render_preview` is absent, only that tool is unavailable; assess other
image-reading and rendering capabilities actually available to your Agent. Report
what you could and could not inspect without claiming a review you did not perform.
Agent review is advisory and its method and extent are your decision. Human
judgment establishes visual quality, not a result card or application score.

Report consequential fidelity or editability limitations, dropped effects, and
assumptions honestly.

## Invariants

- **Exactly one canvas**: `design.yaml` contains `format: molly-canvas/1`, `size`
  and `elements`. Multiple deliverables are separate single-canvas projects.
- **Editable source first**: never paste the reference or a near-complete render as
  the background to simulate editability.
- **Active means end-to-end**: validator acceptance alone is not a support claim. An
  element or property is usable only at the edit level declared by the Active Profile.
- **Fail closed**: do not invent fields, element kinds, enum values, fonts, or asset
  schemes. Unsupported or unverified semantics must be rejected or reported.
- **Local assets only**: image sources are relative paths under `media/`; do not use
  remote URLs or remote fonts.
- **Actual canvas size**: use explicit positive integer dimensions from 1 through
  4096 inclusive. Presets are conveniences, not a whitelist; preserve the requested
  aspect ratio when a larger source must be scaled into this admitted range.
- **Advisory review**: Agent Visual Review may drive corrections but never establishes
  visual acceptance; final quality judgment remains human.

## Outside this skill

- Presentation narrative, multiple slides, masters, speaker notes, transitions,
  animations, and PPT/PPTX import, export, or round-trip.
- Business-vertical dimensions, copy rules, and compliance policies.
- Image generation and editing. The imagegen skill describes `molly_generate_image`
  and `molly_edit_image` when available. Place image assets under `media/`. A materialized
  skill does not itself establish tool availability; use the actual tool list.
