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

This directory may differ from Agent cwd. A composition draft, reference image or
flattened render never replaces the project. The separate `design-current/` path
is application input, not a draft you submit; you never write `design.json`, and
leftover `.pptd` files are not an authoring entry. Molly collects and checks the
project after your turn ends.

## Preparation and task branch

Read the user's content and references, locate the authoring directory, and pick
the branch:

| Task                                       | Composition and layer baseline                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| New design from an open brief              | Research informs several composition drafts; choose one before building layers.                                     |
| User-prescribed template or reconstruction | Inspect the specified reference and use it as the selected composition; rebuild the needed editable elements.       |
| Bounded edit to an existing artwork        | Read the prescribed current artwork, preserve unaffected elements and use it as the composition and layer baseline. |

Every branch follows all nine stages; a prescribed composition fulfils stage 3,
it does not skip the others. A bounded edit does not regenerate every layer. A
style reference offered as inspiration for a new composition is still a new
design.

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

### 3. Select a composition

For an open brief, first keep three to six references and note the one quality
each contributes (the palette of one, the type of another, the crop and light of
a third). Take qualities, never a reference's literal objects or finished
layout; check each against the direction words.

Then draw drafts from image plus text by default: block out each composition
with native shapes and placeholder copy in the extracted palette, render the
blockout, and pass it to `molly_image` `edit` with the supplied delivery assets
and a prompt built from the extracted decisions. The blockout is temporary and
never the delivered artwork. Never pass found references
such as someone else's poster as edit inputs. When the image model cannot edit,
generate from text and report that. Draft several compositions that differ in
concept, within budget; when there is room, make one deliberately unlike the most
common look among the references. Choose one for its message, hierarchy, room for
copy and how well it splits into layers.

For a template, reconstruction or bounded edit, adopt the prescribed composition
instead of inventing alternatives. Read
[references/layered-workflow.md](references/layered-workflow.md) when blocking out
or generating drafts and layers. A draft guides the rebuild; it never becomes the
artwork or a near-complete background.

### 4. Prepare complete layers

Plan layers by what a person would edit independently. Regenerate the needed
raster objects completely from the chosen composition, including hidden parts,
and inspect each one. Foreground objects that need isolation must have real
alpha; backgrounds can remain opaque. Keep supplied delivery assets as supplied,
use native shapes for flat geometry, and keep unaffected existing layers. Report
missing parts.

### 5. Recompose the artwork

Read [references/artwork-format.md](references/artwork-format.md) before writing;
it also lists what is editable today. Copy field shapes from
[examples/minimal/design.yaml](examples/minimal/design.yaml) and the layered
[examples/layered/design.yaml](examples/layered/design.yaml). Write `design.yaml`
with stable `id` / `kind`, real geometry, correct stacking and local `media/`
references. When editing, preserve existing fields and unaffected elements.

### 6. Check text representation

Choose a representation for each piece of copy:

- **Native text** (`kind: text`) with a standard or registered font is the
  default: body copy, dates, times, prices, addresses, lists, small labels and
  anything the user is likely to reword. Native text also handles color,
  gradient, shadow, weight and spacing, so try it first for a styled headline.
- **Image lettering** (an `image` element generated with `molly_image`) suits
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
section there. Render the first usable draft early to confirm key fonts load
before detailed typography.

### 7. Review and adjust

Render the current draft with `molly_render_preview` and open the PNG with an
actual image-reading tool. Look at the whole canvas and the details, and go
through [Design defaults](#design-defaults) as the review checklist. Fix the
source or the affected asset, then render and read again. Repeat until the
current render passes or you can name what is still wrong.

If `molly_render_preview` is absent, only that tool is unavailable: use the
rendering and image-reading tools you do have, and report that Molly's renderer
was not checked. Another renderer does not prove how Molly draws the work. Fix
known asset or font errors before rendering again; an unknown tool error is not
evidence of a desktop connection failure.

### 8. Check consistency

Compare the current render with the user's copy, facts, delivery assets,
reference constraints and intent, and check that a local edit kept everything
else. Compare it with the composition you chose or were given: if you will call
the result a redesign or a new layout, the layout must visibly differ from the
starting artwork. For a new direction, check that the render answers every
direction word, that nothing borrowed reads too literally, and that palette and
type match the decisions taken from the references; a departure should be
deliberate. Fix deviations at the stage that caused them and review the new
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
depart from one in a new design. Use them as the stage 7 checklist.

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

Before redesigning, check the rejection against the direction words:

- **The words still hold:** your visual reading of them missed. Keep the words,
  interpret them differently from stage 3, and say what changed.
- **The words no longer hold:** the brief has moved. Return to stage 1 and ask
  what dissatisfies the user, as one question, before writing new words.

Either way the new version must visibly differ, as stage 8 checks.

## Reporting

Write in the user's language and size the reply to the request.

- **Bounded edit:** one or two sentences saying what changed, for example "Done:
  the headline now reads "Jazz Evening", a little smaller so it fits." When there
  is nothing to add, "Done." is enough.
- **New design or redesign:** present the one direction you chose, not a pile of
  options. Embed the chosen draft with Markdown image syntax, using the
  `absolutePath` returned by `molly_image`, for example
  `![Draft A](/abs/media/a.png)`; wrap paths containing spaces in angle brackets.
  Show an alternative too only when the user asked for options or two drafts are
  genuinely close. Give one line naming the direction and why you chose it,
  name the research sources briefly, and add a short note on the direction only when it helps the user
  judge the result.
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
explained without them; the draft image embeds above are the only paths in a
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
