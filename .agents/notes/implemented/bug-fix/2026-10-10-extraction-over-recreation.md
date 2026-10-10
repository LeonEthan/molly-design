# Extraction over re-creation when reproducing the chosen design

Status: implemented
Translation: current

[中文](2026-10-10-extraction-over-recreation.zh.md)

## Abstract

The editable version of a user-chosen design could visibly depart from the
chosen image — restyled portraits, moved rules, altered textures — because the
reproduction guidance asked image models to "match the design's appearance" and
to "complete hidden parts", which reads as permission to re-imagine elements,
and never forbade generating a layer from scratch. Current frontier image
editors preserve appearance well enough that exact extraction is the right bar,
so the graphic-design Skill now requires every raster layer to come from the
chosen design's own pixels via `edit`, forbids `generate` for elements the
design already shows, asks the model to leave untouched pixels unchanged,
requests each layer at its canvas pixel size, and adds a per-layer compare
before assembly. The change is wording-only; fidelity on real models remains to
be judged in design evaluation runs.

## Problem and evidence

- A reproduction run of a hand-drawn portrait poster returned a clearly
  re-rendered portrait, a moved divider, a resized seal dot and a different
  book row, although stage 4 already said "Reproduce the chosen design; do not
  reinterpret it".
- `references/layered-workflow.md` asked isolation prompts only to "match the
  design's appearance" and to deliver "the complete element, including parts
  hidden behind other objects"; `references/replication.md` said to
  "regenerate each object completely from the reference". Both sanction
  re-creation over extraction.
- The ban on `generate` existed only for lettering ("Use `generate` only for
  new lettering with no design to match"), not for other layers, and layer
  fidelity was checked only after assembly, where the repair loop is again
  generative and converges to "close enough".
- Only lettering had a minimum-pixel requirement; a subject re-rendered small
  and scaled up turns soft.
- This follows [user-chosen designs](../feature/2026-10-09-user-chosen-designs.md),
  which fixed redesign-on-rebuild; this note fixes re-creation-within-reproduction,
  the next divergence observed after that correction.

## Decision

Wording changes only, within the approved Spec intent (stage 4 already
prescribes decomposing the chosen design):

1. `layered-workflow.md` "Reproducing the chosen design" opens with
   "Extract, never re-create": raster layers come from the chosen design's own
   pixels through `edit` with the design as the first image; `generate` is
   forbidden for elements the design already shows; a re-imagined layer is a
   failed layer to re-extract or report.
2. The background plate and isolation prompts ask for every other pixel to
   stay unchanged (light, color, texture, grain), with `mask` on the removed
   regions when the connection accepts one; objects are extracted exactly as
   they appear, completing only genuinely hidden parts, at no fewer pixels
   than the element occupies on the canvas.
3. A new per-layer check crops the element's region from the chosen design and
   `compare`s it with the extracted layer before assembly.
4. `SKILL.md` stage 4 carries the same principle, and the Reporting rule for
   the editable version now names each raster layer that visibly departs.
5. `replication.md` replaces "regenerate each object completely" with the same
   extraction wording.

Deliberately not done: no pixel-level cutout/segmentation script (generative
extraction is now sufficient and a script adds a dependency and maintenance
surface), and no Spec change, since the Spec's stage 4 already describes
decomposition of the chosen design.

## Verification and limits

- Documentation-only change; `pnpm run docs check` passes and edited files pass
  Prettier.
- No design evaluation run has exercised the new wording yet; whether frontier
  connections (for example GPT Image, Nano Banana, Seedream-class editors)
  deliver near-lossless extraction on illustration and typography remains to be
  judged by human review in real runs, per the workflow Spec's acceptance
  policy.
