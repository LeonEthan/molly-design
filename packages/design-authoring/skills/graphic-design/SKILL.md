---
name: graphic-design
description: "Create, edit, or reconstruct editable posters, infographics, social graphics, banners, covers, flyers, and other static single-canvas designs as a YAML artwork project for Molly's Bento-derived editor and renderer."
metadata:
  short-description: Create and edit static single-canvas graphic designs
---

# Graphic Design

## Definition

Create one static graphic canvas that a person can keep editing in Molly. The
deliverable is a self-contained YAML artwork project in the design authoring
directory supplied with the turn:

```text
design.yaml          # molly-canvas/1: size, background, elements
media/               # local raster and font assets
```

A new design happens in two steps. First the image model produces at least
three complete **design options** and the user picks one; the chosen image is the
design. Then you reproduce that design as the editable project, as faithfully as
you can, and refine it with the user. The project is the deliverable: a design
image, reference image or flattened render never replaces it.

This directory may differ from Agent cwd. The separate `design-current/` path
is application input, not a draft you submit; you never write `design.json`, and
leftover `.pptd` files are not an authoring entry. Molly collects and checks the
project after your turn ends.

## Preparation and task branch

Read the user's content and references, locate the authoring directory, and pick
the branch:

| Task                                       | Design and layer baseline                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| New design from an open brief              | Offer at least three design options and stop for the user's choice; reproduce the chosen one.                                                     |
| Redesign of a supplied or open artwork     | A new design: the source supplies content, copy and delivery assets, not the composition. Offer options as for an open brief.                     |
| User-prescribed template or reconstruction | Inspect the specified reference and use it as the chosen design; reproduce the needed editable elements.                                          |
| Bounded edit to an existing artwork        | Read the prescribed current artwork, preserve unaffected elements and use it as the design and layer baseline. Only named, local changes qualify. |

Every branch follows all nine stages; a prescribed design fulfils stage 3, it
does not skip the others. "Redesign", "optimize" or "重新设计" asks for new
options even when the user also asks to keep a face, a product, the colors or the
size; those are delivery assets and constraints. A bounded edit is a named, local
change (new date, larger logo, different headline) and does not regenerate every
layer. A style reference offered as inspiration is still a new design.

Determine capabilities from the tools actually available, including MCP tools
callable only from `codemode` scripts. Before image calls, read the `imagegen`
Skill. Stay within the user's budget and scope. When an action is blocked by a
missing tool, network or budget, say what remains incomplete; a missing tool
never counts as a completed step, and other available tools are not
automatically equivalent.

Keep temporary scripts, environments and caches outside the authoring directory:
in the session workspace or the shell's `$TMPDIR`. `$TMPDIR` (including files Pi
saves for truncated output and images shown from `codemode`) is removed when the
worker exits, so copy anything a later turn needs into the workspace. Prefer the
shipped helpers and read a helper's `--help` before building its command. Fix
argument errors before blaming the sandbox. Never install globally or with
`pip install --user`.

## Required workflow

Follow these nine stages and their dependencies. Choose techniques and iterations
within the user's constraints. A repair returns to the stage it affects; after
any visual change, render and review again. Helper scripts are optional methods,
never gates.

### 1. Understand intent

Establish purpose, audience, where the work will be seen and what it competes
with there (a feed, a wall of posters, a product page), the category it belongs
to, the one message it must send, output size, exact copy, supplied assets and
constraints. Separate verified facts from assumptions. Distinguish **delivery
assets** (a supplied logo or product photo that must appear as supplied) from
**design references** that only guide appearance.

**Asking.** For a new design or redesign whose brief leaves a gap that would
change the direction (audience, where it is seen, the message, must-have copy),
ask with the `ask_user_question` tool when it is available: one call, one to four
questions, each with concrete options and your recommended default first. One
question may offer candidate direction words to pick or correct. Do not ask when
the brief already answers these, for a bounded edit, or about details you can
decide yourself. If the tool is unavailable or no answer can come, proceed on
stated assumptions and report them.

Then write a **direction sentence** (how the piece should feel and what it should
say) and two to four **direction words**, for example "smoky, intimate, after
hours". They are a working note, not a deliverable; stages 2, 3, 7 and 8 measure
against them.

Read [references/general-poster.md](references/general-poster.md) for a new design
or a composition pass, and [references/replication.md](references/replication.md)
for a reconstruction.

### 2. Inspect references and research

**Research rule.** Research exists to set a direction. Before choosing or
creating a composition, inspect relevant design-site visuals such as Pinterest
and other sources. Skip this only when no new direction is being set: the user
told you to follow a concrete template or reference without new inspiration and
you have inspected it, or the request is a bounded edit that keeps the existing
direction. Research anyway when the user asks for it. The same rule applies to
new designs, reconstructions and edits.

| Request                                                     | Research?                |
| ----------------------------------------------------------- | ------------------------ |
| "Reproduce this template, replace only the copy"            | No, after you inspect it |
| "Change the date and make the headline a little smaller"    | No                       |
| "Use this mood but redesign the composition"                | Yes                      |
| "Make the open artwork feel more premium" (a new direction) | Yes                      |
| A topic, style word, logo, product photo or your own idea   | Yes                      |
| An attachment you have not opened                           | Yes                      |

When research applies, read
[references/browser-research.md](references/browser-research.md): search from
the direction words, look at the actual images (search snippets are not visual
research), include at least one source outside the category and current design
feeds, and make one focused pass rather than browsing without end. The user's own
direction stays the basis. If the user forbids networking, respect it and report
the gap; a missing browser or network failure is a blocker, not an exception.
Fact checks such as event dates are separate from inspiration research.

### 3. Offer designs and let the user choose

Keep three to six references and note the one quality each contributes (the
palette of one, the type of another, the crop and light of a third). Take
qualities, never a reference's literal objects or finished layout; check each
against the direction words.

Then create at least three complete **design options** with the image model,
each a finished poster at the canvas ratio: composition, imagery, light, the
headline and key copy drawn in, and the finish you intend. They are the design,
not sketches, so judge each against the [design defaults](#design-defaults)
before showing it, and regenerate one that fails. Make the options differ in
concept or composition, not just color; when there is room, make one
deliberately unlike the most common look among the references. Pass supplied
delivery assets (a product photo, a logo, a source poster being redesigned) as
`edit` inputs so the options keep them; never pass found references such as
someone else's poster. A rendered blockout can steer an option's layout when
words are not enough. Techniques are in
[references/layered-workflow.md](references/layered-workflow.md#design-options).

Show the options and **end the turn** so the user can choose, as
[Reporting](#reporting) describes. Do not write or change `design.yaml` in that
turn. Continue with stage 4 in the turn where the user names an option. If the
user asked you to decide ("just pick one", "you choose"), take your
recommendation and continue in the same turn.

For a template, reconstruction or bounded edit, the prescribed artwork is the
chosen design; do not offer options.

### 4. Prepare complete layers

Reproduce the chosen design; do not reinterpret it. Plan layers by what a person
would edit independently: usually a background plate, the main subject, a few
secondary objects and the copy. Make the plate by editing the chosen design to
remove the foreground objects and all text, keeping everything else as it is.
Isolate each foreground object from the chosen design, complete including hidden
parts, with real alpha. When the user requires a supplied face, product or logo
to stay exact and the design altered it, isolate it from the source instead and
place it where the design has it. Use native shapes for flat geometry, keep
unaffected existing layers, inspect each layer and report missing parts. The
recipe is in
[references/layered-workflow.md](references/layered-workflow.md#reproducing-the-chosen-design).

### 5. Recompose the artwork

Read [references/artwork-format.md](references/artwork-format.md) before writing;
it also lists what is editable today. Copy field shapes from
[examples/minimal/design.yaml](examples/minimal/design.yaml) and the layered
[examples/layered/design.yaml](examples/layered/design.yaml). Write `design.yaml`
with stable `id` / `kind`, real geometry, correct stacking and local `media/`
references. Measure positions and sizes from the chosen design. When editing,
preserve existing fields and unaffected elements.

### 6. Check text representation

Match the copy drawn in the chosen design: position, size, weight, color,
spacing and alignment, and the closest available letterforms. Choose a
representation for each piece of copy:

- **Native text** (`kind: text`) with a standard or registered font is the
  default: body copy, dates, times, prices, addresses, lists, small labels and
  anything the user is likely to reword. Native text also handles color,
  gradient, shadow, weight and spacing, so try it first for a styled headline.
- **Image lettering** (an `image` element isolated from the chosen design or
  generated with `molly_image`) suits
  artistic text that fonts cannot express: hand lettering, calligraphy, 3D or
  dimensional type, textured or illustrated letters, type woven into the
  scene, or a logotype-style title. Use it for a few large display words, not
  for long or small copy.

Every character of image lettering must be exact; check it letter by letter and
regenerate or switch to native text if anything is wrong. The wording of image
lettering can only change by regenerating it, which counts as an editability
limit to report. Techniques are in
[references/layered-workflow.md](references/layered-workflow.md#lettering-layers).

Register real font files as the format reference describes, keep each face's
complete glyph set, and check Chinese, Japanese or Korean copy against the font
section there. Render the first usable version early to confirm key fonts load
before detailed typography.

### 7. Review and adjust

Render the current project with `molly_render_preview` and open the PNG with an
actual image-reading tool. The chosen design is the target: compare the render
with it side by side and as an overlay, and fix differences in position, scale,
color, type and finish. Then check [Design defaults](#design-defaults) for what
the reproduction introduced, such as text over a busy area. Fix the source or the
affected asset, then render and read again. Repeat until the render matches the
design or you can name what still differs.

If `molly_render_preview` is absent, only that tool is unavailable: use the
rendering and image-reading tools you do have, and report that Molly's renderer
was not checked. Another renderer does not prove how Molly draws the work. Fix
known asset or font errors before rendering again; an unknown tool error is not
evidence of a desktop connection failure.

### 8. Check consistency

Compare the current render with the user's copy, facts, delivery assets,
reference constraints and intent, and check that a local edit kept everything
else. Copy drawn in a design option can be misspelled; the user's exact copy
wins. Compare the render with the chosen design one last time: it should read as
the same design, not a rearrangement of its parts. For a new direction, check
that it answers every direction word and that nothing borrowed reads too
literally. Fix deviations at the stage that caused them and review the new
render.

### 9. Polish and report

Make final refinements within scope and review that version. Keep the complete
project in the authoring directory. Set the `design.yaml` `title` to two to five
words in the user's language naming the subject and format, such as "Autumn jazz
night poster"; keep an existing title unless the subject changed. Molly may show
it as the conversation name, and a name the user set always wins. Then reply as
[Reporting](#reporting) describes.

## Design defaults

Starting points, not laws: working habits of practising designers plus fixes for
failures seen in real runs. Follow them unless the brief, a prescribed reference
or a stated design reason calls for something else; say so briefly when you
depart from one in a new design. Judge design options against them in stage 3,
and check the reproduction in stage 7.

- **Focal subject.** One element is clearly largest, and the copy still has its
  own area. If subject and headline compete for the same space, shrink or move
  the subject rather than squeezing the copy.
- **Copy never covers what matters.** Keep text off faces, hands, products and
  logos, and off the subject's key detail. Move or resize the copy or subject
  instead of overlapping them.
- **Margins set the mood.** Keep text and key content clear of the canvas edges
  so nothing feels cut off; beyond that, choose deliberately: tight margins add
  tension and energy, wide margins add calm. Full-bleed imagery may run to the
  edge.
- **Few sizes, strong contrast.** Prefer one or two text sizes with a clear jump
  between them (the large one around twice the small); separate further levels
  with weight before adding a third size. Do not make everything big and bold to
  "shout": contrast and space carry hierarchy. Detail text stays readable at the
  real viewing size and distance.
- **White space is structure.** Use empty space to group, separate and rank
  information, not as whatever is left over. A crowded canvas with no room to
  breathe is a defect even when every element is legible.
- **Text over images.** Place copy on a calm area of the image, or add a scrim (a
  gradient or translucent shape behind the text) or a solid block. Check contrast
  in the render, not by assumption.
- **Alignment.** Choose one alignment axis for a text group and keep its edges on
  it. Group related copy with `groupId` so it moves together.
- **Reading order.** The render should read in the intended order at thumbnail
  size, in the place it will be seen: subject, headline, then details.
- **Every motif has a reason.** A signature device (a reflection, a floating
  product, a shelf arrangement, a gradient backdrop) must connect to the subject
  or message, not appear because it is popular.

Do not apply the golden ratio or rule of thirds as composition rules; place
things by hierarchy, content and space.

## When the user rejects a direction

When the user rejects every option or the finished design, check the rejection
against the direction words before offering new options:

- **The words still hold:** your visual reading of them missed. Keep the words,
  offer new options that interpret them differently, and say what changed.
- **The words no longer hold:** the brief has moved. Return to stage 1 and ask
  what dissatisfies the user, as one question, before writing new words.

Either way the new options must visibly differ from the rejected ones.

## Reporting

Write in the user's language and size the reply to the request.

- **Bounded edit:** one or two sentences saying what changed, for example "Done:
  the headline now reads "Jazz Evening", a little smaller so it fits." When there
  is nothing to add, "Done." is enough.
- **Design options:** embed every option with Markdown image syntax, using the
  `absolutePath` returned by `molly_image`, for example
  `![A](/abs/media/a.png)`; wrap paths containing spaces in angle brackets. Label
  them A, B, C with one line each on the idea, say which you recommend and why in
  one line, name the research sources briefly, and ask the user to choose. Note
  copy the image model drew wrong; it will be exact in the editable version.
- **Editable version of the chosen design:** one or two sentences, plus what
  differs from the chosen design and why.
- **Always report**, proportionately: unmet requirements, material assumptions,
  blocked steps, departures from the design defaults, flattened or otherwise
  non-editable content (including image lettering, whose wording changes only by
  regenerating it), and concerns from your review.

Do not narrate your steps, list stages or checks, list what stayed unchanged, or
say that something was previewed or confirmed unless the check found a problem or
could not be done. Mention editability only when asked or when it differs from
what the user would expect. Offer next tweaks only when asked or when a concrete
decision remains. Leave out file paths, YAML fields, element IDs, tool and script
names, commands and diagnostic codes unless the user asks or a limit cannot be
explained without them; the option image embeds above are the only paths in a
normal reply.

Never claim a check, rendering or save that did not happen. Your image
inspection is Agent review, not human acceptance; human judgment decides visual
quality. Molly collects and saves the project after your turn ends, so do not wait
for or predict that save, and do not describe a successful structural check as a
saved or rendered artwork. A turn with a reported visual limitation can still be
collected normally.

## Boundaries

- One static canvas per project, with explicit dimensions from 1 through 4096.
  Preserve the requested ratio when reducing a larger source.
- Presentation narratives, slide decks, masters, speaker notes, transitions,
  animation and PPT/PPTX import or export are outside this skill, as are audio,
  video, scripts, web embeds, remote assets and remote fonts.
- Image parameters and provider behavior belong to `imagegen`; this Skill owns the
  design workflow and its task branches.
