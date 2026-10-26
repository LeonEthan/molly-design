---
name: graphic-design
description: "Create, edit, or reconstruct editable posters, infographics, social graphics, banners, covers, flyers, and other static single-canvas designs as a YAML artwork project for Molly's Bento-derived editor and renderer."
metadata:
  short-description: Create and edit static single-canvas graphic designs
---

# Graphic Design

Create one static graphic canvas that a person can keep editing in Molly. The
deliverable is a self-contained YAML artwork project in the design authoring
directory supplied with the turn:

```text
design.yaml          # molly-canvas/1: size, background, elements
media/               # local raster and font assets
```

This directory may differ from Agent cwd. The separate `design-current/` path
is application input, not a draft you submit; you never write `design.json`, and
leftover `.pptd` files are not an authoring entry. Molly collects and checks the
project after your turn ends.

## Task branch and depth

Pick the branch; it decides how much process the task needs. Match effort to
the request: a bounded edit can reach a first preview in one write and one
render, while an open brief earns research and user-chosen options.

| Task                                       | Design and layer baseline                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New design from an open brief              | Read the `design-research` skill, offer three design options and stop for the user's choice — or one option and no stop when the user tells you to choose; reproduce the chosen one. |
| Redesign of a supplied or open artwork     | A new design: the source supplies content, copy and delivery assets, not the composition. Offer options as for an open brief.                                                        |
| User-prescribed template or reconstruction | Inspect the specified reference and use it as the chosen design; reproduce the needed editable elements.                                                                             |
| Bounded edit to an existing artwork        | Read the prescribed current artwork, preserve unaffected elements and use it as the design and layer baseline. Only named, local changes qualify.                                    |

"Redesign", "optimize" or "重新设计" asks for new options even when the user
also asks to keep a face, a product, the colors or the size; those are delivery
assets and constraints. A bounded edit is a named, local change (new date,
larger logo, different headline) and does not regenerate every layer. A style
reference offered as inspiration is still a new design.

Research and offered options apply only when the branch sets a new direction:
open briefs and redesigns, or when the user asks. Prescribed templates,
reconstructions and bounded edits skip them and go straight to reproducing the
baseline; an edit with a clear brief needs no direction words and no
`ask_user_question` round trip.

**Delivery form.** A new design or redesign delivers the chosen design in one
of two forms: **editable layers** (the default) or **one whole image**. Ask
which in the design options reply, together with the choice of option, unless
the brief already names a form; use the default when the user does not answer.
On the you-choose path, deliver editable layers unless the brief asks for a
whole image. Prescribed templates, reconstructions and bounded edits always
work in editable layers and are not asked. A whole image is the chosen option
placed as a single `image` element covering the canvas; it skips
`design-replication`, and its copy and layout cannot be edited afterwards.

Sibling skills to read when the task reaches their ground — only then:

- `design-research` — website research, inspiration images, image-model design
  options, composition judgment, and what to do when the user rejects a
  direction. Required before offering options for a new design or redesign.
- `design-replication` — turning a chosen design or reference into faithful
  editable layers: extraction, measuring, comparison helpers. Required for
  reconstructions and for reproducing a chosen option.
- `design-text` — native text vs image lettering, lettering layers, custom
  fonts and CJK copy. Read when the artwork carries styled copy.
- `imagegen` — the image model's tools and limits, before any image call.

Determine capabilities from the tools actually available, including MCP tools
callable only from `codemode` scripts. Stay within the user's scope. When an
action is blocked by a missing tool or network, say what remains incomplete; a
missing tool never counts as a completed step, and other available tools are
not automatically equivalent.

Keep temporary scripts, environments and caches outside the authoring
directory: in the session workspace or the shell's `$TMPDIR`. `$TMPDIR`
(including files Pi saves for truncated output and images shown from
`codemode`) is removed when the worker exits, so copy anything a later turn
needs into the workspace. Prefer the shipped helpers and read a helper's
`--help` before building its command. Fix argument errors before blaming the
sandbox. Never install globally or with `pip install --user`. Never search the whole filesystem or home directory (`find /`, `find ~`, unscoped `mdfind`); look in the known directories instead (fonts: the `design-text` skill lists them).

## Required workflow

Follow these steps and their dependencies on every branch; the branch decides
how deep each step goes, and the `design-research` stages apply only when it
sets a new direction. The application checks structure, assets and versions at
intake, never creative stages. Choose techniques and iteration counts within
the user's constraints. A repair returns to the step it affects; helper scripts
are optional methods, never gates.

1. **Baseline.** Read the brief and the branch's baseline artwork: the current
   `design.yaml` for an edit, the prescribed reference for a reconstruction.
   Only for a new direction, write a short direction note and do the research
   and options pass in `design-research`, ending that turn for the user's
   choice unless the user told you to choose.
2. **Layers.** Edit or reproduce toward the baseline. New raster layers and
   faithful extraction follow `design-replication`; a bounded edit reuses
   existing layers and changes only what was named. For a whole-image
   delivery, copy the chosen option into `media/` as the only layer, and check
   its copy letter by letter against the brief.
3. **Compose.** Read
   [references/artwork-format.md](references/artwork-format.md) before writing;
   it lists the admitted fields and what each element kind leaves editable.
   Write `design.yaml` with stable `id` / `kind`, real geometry, correct
   stacking and local `media/` references; field shapes copy from the examples
   in `design-replication`. Preserve existing fields and unaffected elements.
   Set `title` to two to five words in the user's language naming the subject
   and format ("Autumn jazz night poster"); keep an existing title unless the
   subject changed. Copy representation follows `design-text`. Reach a first
   renderable draft before refining: assemble a close-enough version of the
   whole canvas, render it, then improve what the render shows.
4. **Render and read.** Render the project with `molly_render_preview` and open
   it with `molly_view_image` (or another image-reading tool when that is absent), once the draft can render at all
   and again after visual changes. In one pass compare against the baseline
   design, the brief's copy and facts, and the skill's design habits; fix at
   the step that caused a difference and render again. One read per render,
   and stop when the render matches or you can name what still differs:
   successive renders exist to confirm named fixes, not to look again for new
   flaws. Never sweep fonts, sizes, tracking or positions in a loop to match
   pixels; fit type with the `design-replication` skill's "Fit type" recipe.
   To compare the render with the chosen design, view both in one `molly_view_image` `paths` call instead of two separate reads. If `molly_render_preview` is
   absent, only that tool is unavailable: use the rendering and image-reading
   tools you do have, and report that Molly's renderer was not checked.

## Reporting

Write in the user's language and size the reply to the request.

- **Bounded edit:** one or two sentences saying what changed, for example
  "Done: the headline now reads "Jazz Evening", a little smaller so it fits."
  When there is nothing to add, "Done." is enough.
- **Design options:** copy each option you show to a short name in `media/`
  (`option-a.png`, `option-b.png`) and embed it with Markdown image syntax and
  its absolute path, for example `![A](/abs/media/option-a.png)`; never retype
  a hashed file name. Wrap paths containing spaces in angle brackets. Label
  them A, B, C with one line each on the idea, say which you recommend and why
  in one line, name the inspected source-page URLs, or the saved inspiration
  image paths when a page has no usable URL (a user-supplied reference by its
  attachment) (a search-results URL alone does not count), and ask the user to
  choose, together with the delivery form when Delivery form calls for it. Note copy the image model drew wrong;
  it will be exact in the editable version.
- **Editable version of the chosen design:** one or two sentences, plus what
  differs from the chosen design and why, naming each raster layer that visibly
  departs from it.
- **Whole-image delivery:** one sentence, plus every copy line the image draws
  wrong or leaves out; say that its wording and layout are not editable and
  that it can be split into editable layers on request.
- **Always report**, proportionately: unmet requirements, material assumptions,
  blocked steps, departures from the design defaults, flattened or otherwise
  non-editable content (including image lettering, whose wording changes only
  by regenerating it), and concerns from your review.

Do not narrate your steps, list stages or checks, list what stayed unchanged,
or say that something was previewed or confirmed unless the check found a
problem or could not be done. Mention editability only when asked or when it
differs from what the user would expect. Offer next tweaks only when asked or
when a concrete decision remains. Leave out file paths, YAML fields, element
IDs, tool and script names, commands and diagnostic codes unless the user asks
or a limit cannot be explained without them; the option image embeds and
inspiration paths above are the only paths in a normal reply.

Never claim a check, rendering or save that did not happen. Your image
inspection is Agent review, not human acceptance; human judgment decides visual
quality. Molly collects and saves the project after your turn ends, so do not
wait for or predict that save, and do not describe a successful structural
check as a saved or rendered artwork. A turn with a reported visual limitation
can still be collected normally.

## Boundaries

- One static canvas per project, with explicit dimensions from 1 through 4096.
  Preserve the requested ratio when reducing a larger source.
- Presentation narratives, slide decks, masters, speaker notes, transitions,
  animation and PPT/PPTX import or export are outside this skill, as are audio,
  video, scripts, web embeds, remote assets and remote fonts.
- Image parameters and provider behavior belong to `imagegen`; this Skill owns
  the artwork project, its branches and its reporting.
