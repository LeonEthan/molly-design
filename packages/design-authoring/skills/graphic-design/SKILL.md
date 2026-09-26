---
name: graphic-design
description: "Create, edit, or reconstruct editable posters, infographics, social graphics, banners, covers, flyers, and other static single-canvas designs as a YAML artwork project for Molly's Bento-derived editor and renderer."
metadata:
  short-description: Create and edit static single-canvas graphic designs
---

# Graphic Design

## Definition

Create one static graphic canvas as editable source for Molly's Bento-derived
editor and renderer. The deliverable is a self-contained YAML artwork project;
a composition draft, reference image or flattened render cannot replace it.

Write in the design authoring directory supplied with the turn:

```text
design.yaml          # molly-canvas/1: size, background, elements
media/               # local raster and font assets
```

This directory may differ from Agent cwd. Molly collects these files after your
turn and independently checks whether it can save the editable artwork. The separate
`design-current/` path is application input, never a submitted draft; it may be
absent until synchronized. You do not write `design.json` yourself. Leftover
`.pptd` files are not an authoring entry.

## Preparation and task branch

Read the user's supplied content and references, locate the authoring directory,
and establish which task applies:

| Task                                       | Composition and layer baseline                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| New design from an open brief              | Research informs several composition drafts; choose one before building layers.                                     |
| User-prescribed template or reconstruction | Inspect the specified reference and use it as the selected composition; rebuild the needed editable elements.       |
| Bounded edit to an existing artwork        | Read the prescribed current artwork, preserve unaffected elements and use it as the composition and layer baseline. |

All branches follow the workflow below, including its single research rule.
Using a user-prescribed result fulfills that stage's branch action; it does not
authorize omitting other stages. A bounded edit does not regenerate every layer.
A style reference offered as inspiration for a new composition remains a
new-design task.

Determine capabilities from the actual tool list. Before image calls, read the
`imagegen` Skill for the configured model, inputs and paid-call behavior. Follow
the user's budget and scope throughout drafting and repair. When a required
action is blocked, state the limitation and what remains incomplete; tool
absence or a budget limit does not establish that the action was completed.
Assess other available capabilities without claiming they are equivalent.

Keep temporary scripts, dependency environments and caches in the session workspace
outside the collected artwork directory, or in the shell's supplied `$TMPDIR`.
Prefer shipped helpers. Read a helper's `--help` before constructing its command;
use documented field lookups rather than searching the bundled library source.
Correct argument errors before attributing failures to the sandbox. Do not use
global or `pip install --user` installs for artwork preparation.

## Required workflow

Follow these nine stages and their dependencies. Choose techniques and useful
iterations within the user's constraints. Repairs return to the affected stage;
after visual changes, repeat native review and consistency checking. The helper
scripts are optional methods, not application submission or turn-ending gates.

### 1. Understand intent

Establish purpose, audience, output size, exact copy, supplied assets and design
constraints. Separate verified facts from assumptions. Read
[references/general-poster.md](references/general-poster.md) for a new design or
an overall composition pass. Read
[references/replication.md](references/replication.md) for reconstruction.

Distinguish **delivery assets**, such as a supplied logo or product photo that
must appear as supplied after any requested edit, from **design references**
that guide appearance. Resolve blocking missing facts with the user; state
nonblocking assumptions. Continue with an identified task branch and the content
and visual constraints that the result must preserve.

### 2. Inspect references and research

Before selecting or creating the composition, inspect design-site visuals such
as Pinterest unless **all** of these conditions hold:

- the user explicitly identifies a concrete template or reference target;
- the user's instruction calls for following that target without additional
  design inspiration;
- you have actually inspected the target and it supports the requested visual
  decisions;
- the user has not also requested research.

“Reproduce this template and replace only the copy” expresses the exception;
no special phrase is needed. A topic, broad style label, logo, product photo,
unexamined attachment, currently open artwork or your own concept does not
establish it. “Use this mood but redesign the composition” still requires
research. Local edits and reconstruction use this same rule.

When research is required, read
[references/browser-research.md](references/browser-research.md), browse relevant
visuals, and connect the observed layout, typography or palette to the design
direction. Search snippets alone do not constitute visual research. Briefly
identify the sources and useful observations, or the inspected user target and
why the explicit exception applies. Keep the user's direction as the basis.

Respect an explicit user prohibition on networking and report the resulting
research limitation. Tool absence or network failure is a blocker, not a
reference-based exception. Necessary factual verification, including dates,
remains separate from inspiration research.

### 3. Select a composition

For an open brief, generate and inspect several full-canvas drafts that differ
in composition or concept within the user's budget. Select one and explain its
message, hierarchy, room for copy and suitability for independent layers. For a
prescribed template, reconstruction or bounded edit, inspect and adopt the
specified composition rather than generating unrelated alternatives.

Read [references/layered-workflow.md](references/layered-workflow.md) when
generating drafts or image layers. Continue with an inspected composition that
guides the editable reconstruction; the draft itself never becomes the artwork
or a near-complete background.

### 4. Prepare complete layers

Read [references/graphic-canvas-profile.md](references/graphic-canvas-profile.md)
before choosing element semantics or promising editability. Plan layers by what
a person should be able to edit independently. Regenerate the needed raster
objects from the selected composition, including hidden portions; inspect each
result for completeness. Foreground objects that need transparent isolation
must have real alpha. Backgrounds can remain opaque.

Retain supplied delivery assets, supported native shapes and unaffected existing
layers. Use the techniques in the layered reference for isolation, alpha and
bounds checks. Continue with the required complete assets and supported editable
elements, reporting any missing parts or capability limits.

### 5. Recompose the artwork

Before writing, read [references/artwork-format.md](references/artwork-format.md)
and [examples/minimal/design.yaml](examples/minimal/design.yaml). Assemble
`design.yaml` with stable `id` / `kind`, actual geometry, correct stacking and
local `media/` references. Preserve fields and unaffected elements when editing.
Check that every referenced asset is present and within admission limits.

You may write `design.yaml` directly. The format reference explains optional
field lookup, validation and migration helpers. Continue with a complete editable
project; parsing alone does not establish rendering or a saved artwork.

### 6. Check text representation

For each piece of copy, choose native text, supported vector geometry or raster
lettering deliberately. Keep ordinary copy editable; report any edit limitation.
Register actual custom-font files and matching descriptors using the format
reference. Preserve the selected font's complete glyph coverage so later text
edits remain supported; use [font preparation](references/font-preparation.md)
when a font needs conversion. On the first renderable draft, test key fonts through the native
renderer before investing in detailed typography. Font presence or successful
structural validation does not establish font loading.

### 7. Review and adjust

Render the current draft with `molly_render_preview` and open the returned PNG
with an actual image-reading tool. Inspect the whole composition and relevant
details for hierarchy, placement, occlusion, edges, typography and readability.
Correct the source or affected assets, then render and read the updated version.
Continue only with a review of the current visual state or an explicit account
of the blocked review.

If `molly_render_preview` is absent, only that tool is unavailable; assess the
actual rendering and image-reading capabilities. External approximations may
help diagnosis but do not establish that Bento renders the artwork. Use known
asset or font diagnostics to fix the cause before another preview; an unknown
tool error is not evidence of a desktop connection failure.

### 8. Check consistency

Compare the current result with user copy, facts, delivery assets, reference
constraints and intent. Check that local edits preserved unaffected work.
Resolve deviations through the affected earlier stage; visual corrections
require another current native preview. Account for every required item and
state remaining fidelity, fact or editability limitations.

### 9. Polish and report

Make final refinements within scope and review the resulting current version.
Keep the complete authoring files in the supplied directory. Summarize the chosen
direction, useful research or prescribed reference, layer and text decisions,
actual checks, unresolved deviations and blocked work. Human judgment establishes
visual quality; Agent review is advisory. Describe your own image inspection as
Agent review, never human or manual acceptance unless a person actually performed
and reported that check.

## Completion reporting

Distinguish prepared authoring files, a natively rendered and inspected current
draft, and a saved artwork supported by an observed application receipt. Molly's
final collection runs after your turn ends: do not wait for that same turn's
save receipt or anticipate its success. End with what you have actually verified.
A normal turn may still be collected under existing schema, asset and version
rules when you report a visual limitation. Human edit/save/reopen/export is a
separate acceptance observation, not something implied by your preview.

## Boundaries

- One static canvas per project, with explicit dimensions from 1 through 4096.
  Preserve the requested ratio when proportionally reducing a larger source.
- Active support means the edit/render/save lifecycle declared by the canvas
  profile. Use admitted semantics and local assets; report unsupported behavior.
- Presentation narratives, slide decks, masters, speaker notes, transitions,
  animation and PPT/PPTX import or export are outside this skill.
- Image operation parameters and provider behavior belong to `imagegen`;
  this entry owns the design workflow and its task branches.
