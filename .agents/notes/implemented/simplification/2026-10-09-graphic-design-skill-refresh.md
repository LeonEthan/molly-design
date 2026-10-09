# Refocus the graphic-design Skill on design quality

Status: implemented
Translation: current

[中文](2026-10-09-graphic-design-skill-refresh.zh.md)

## Abstract

The graphic-design Skill spent most of its words on claim discipline and repeated the same rules across files, while giving the Agent almost no concrete layout guidance; the observed design-eval failures were exactly layout problems (an oversized subject, a headline crowding a face) and a redesign claim on an unchanged layout. The refresh adds breakable design defaults that double as the review checklist, states each rule once, corrects guidance that forbade active icon, table and chart semantics, adds a layered example and Chinese/Japanese/Korean font guidance, and replaces sentence-pinned tests with structural ones. A fourth round anchors the workflow to direction words: structured intent questions, bounded research from those words with a bounded-edit exemption, image-plus-text drafts from native blockouts, and a rule for rejected directions. The owner approved the Spec revision (proportionate reporting plus these workflow changes) on 2026-10-09. Whether output quality improved is not yet measured; that needs serial design-eval runs judged blind by the owner.

## Problem and evidence

- About 6,200 words of graphic-design material, with negative evidence phrases ("does not establish", "is not proof") 16 times and the missing-preview, font-loading and save-timing rules each written in three places.
- `references/replication.md` said not to claim native icons, tables or charts, and `graphic-canvas-profile.md` told the Agent to treat unrecorded combinations as unsupported without showing the record. The frozen capability matrix marks every icon, table and chart row `active`.
- Inter, the default family, has no CJK glyphs. The matrix's `font.fallback` row notes that an unregistered family resolves through host system fonts and that export determinism is only promised for fully registered stacks; the Skill said nothing about it.
- The approved Spec's stage 9 required distinguishing prepared files, a reviewed draft and a saved artwork; the shipped Skill (after the short-reply fixes) said to mention that only when it matters.
- Skill tests pinned about 20 exact sentences, so any rewording failed tests without any behavior change.

## Decisions

The owner approved all eight suggestions and three decisions on 2026-10-09:

1. **Design defaults** in `SKILL.md`: focal scale, copy never over faces or products, margins, at most three type sizes, text-over-image legibility, alignment and reading order. They are defaults the Agent may break with a reason; only failures seen in real runs earn a rule. Stage 7 uses them as the checklist and stage 8 checks that a claimed redesign changed the layout.
2. **Editable today**: `graphic-canvas-profile.md` is removed; `artwork-format.md` carries a per-kind table bounded by what the editor offers, with image crop flagged as limited (issue #15).
3. **One statement per rule**; references link to the owning section instead of restating it.
4. **Reporting** is one section. Spec stage 9 now requires never claiming an unperformed check or save and always reporting gaps, with the three-way distinction only when it matters. The Spec returned to draft and the owner approved the revision on 2026-10-09.
5. **Layered example** `examples/layered/` (opaque background, transparent subject with shadow, gradient scrim, grouped text) with synthetic PNGs, admitted by the intake test.
6. **CJK fonts**: register a complete licensed face, compress rather than subset, or report that the typeface depends on the viewer's computer.
7. **Research rule** stated once with a table of examples. Its meaning is unchanged, including that the currently open artwork alone does not establish the exception.
8. **Structural tests**: stage headings, every relative link and heading anchor resolves, every reference is reachable, key rules appear exactly once, both examples pass intake from the materialized tree.

## Follow-up: lessons from published design practice

A second pass the same day compared the defaults with a practice summary of thirteen design texts (the Vignelli Canon, Bierut, Rand, Hische, Lupton, Sagmeister and others; quotations not independently re-checked). It showed that the first defaults treated margins and type too mechanically and carried unsourced numbers (subject 35–60% of the short edge, 5% margins, 0.5–0.65 size steps). Those numbers are removed, and the defaults now say they are working habits rather than laws:

- margins keep a clearance floor, then are chosen for tone (tight for tension, wide for calm);
- one or two text sizes with a strong jump (around 2×), weight before a third size, no shouting with size and bold;
- white space is structure, and the golden ratio and rule of thirds are not composition rules;
- stage 1 asks where the work is seen and what surrounds it;
- reports present the one chosen direction, adding alternatives only on request or when two are genuinely close;
- `general-poster.md` adds what is specific to the brief, an optional grid, and choosing type with a reason and for viewing distance;
- `browser-research.md` asks for several (including historical) sources and a check that the direction is not one source with new copy;
- the CJK section also checks punctuation and line-start rules.

Book sequencing, double-sided print, type history and designer authorship were judged out of scope for a single static canvas. These changes are also unevaluated.

## Follow-up: flexible text representation

At the owner's request, stage 6 no longer says ordinary copy must always be native text without saying when an image is better. Native text with a standard or registered font stays the default for body copy, facts and anything likely to be reworded, and is tried first for styled headlines (intake admits text `gradient`, `letterSpacing` and element `shadow`; their rendering was not checked here). Artistic text that fonts cannot express (hand lettering, calligraphy, dimensional or illustrated type, type woven into the scene) may be an `image` element generated with `molly_image`. Because image models often misspell, especially in CJK, every character must be checked; a wrong character means regenerating or falling back to native text. The wording of image lettering changes only by regenerating it, which is reported as an editability limit. `layered-workflow.md` gains a lettering-layer technique. This stays within the approved Spec's stage 6 ("which text becomes editable text and which is better represented as an image or vector"), so the Spec is unchanged.

## Follow-up: direction first (mood-board lessons)

Three mood-board texts were compared with the workflow: the uisdc guide (2022, Chinese), Made Good Designs' mood-board guide and Elizabeth Goodspeed's AIGA Eye on Design essay arguing that shared mood boards make advertising look the same. They agree on a one-sentence direction before collecting, a few references cut hard, sources from outside the category, references carrying qualities rather than objects, and the board as a yardstick. The Skill's research was Pinterest-first with no stated direction, the pattern Goodspeed links to derivative work. With owner approval:

- **Stage 1** adds the category and the one message, then a direction sentence and two to four direction words as a working yardstick, not a user approval step. For a new design or redesign with direction-changing gaps, the Agent asks once through `ask_user_question` (one to four questions, options with a recommended default) and otherwise proceeds on reported assumptions, so non-interactive runs do not stall.
- **Stage 2** searches from the direction words, includes one source outside the category and current feeds, and is one bounded pass. Research is exempt for a bounded edit that keeps the existing direction (the owner's open question, now decided); this changes the research rule's intent.
- **Stage 3** keeps three to six references, each contributing one quality. Drafts default to image plus text: a native blockout (shapes, placeholder copy, extracted palette) rendered through `molly_render_preview` and passed to `molly_image` `edit` with delivery assets. The owner asked for image-conditioned drafts because text describes layout poorly. Found references are never edit inputs, since image conditioning copies composition and objects and the work belongs to others. Text-only generation remains the reported fallback because providers differ (DashScope accepts at most three inputs; multi-reference composition is listed as unverified in `USER_GUIDE.md`). `molly_render_preview` takes no input and renders only the authoring `design.yaml`, so the blockout occupies it temporarily, any existing artwork is copied aside, and the blockout is replaced before the turn ends.
- A new design default requires every signature motif to connect to the subject or message; stage 8 checks the render against the direction words; reports name the direction.
- When the user rejects a direction, the Agent checks it against the direction words: reinterpret if they still hold, otherwise return to stage 1 with one question.

Not adopted: a mood board the user must approve before design (Goodspeed ties pre-approval to derivative work, and it adds a blocking step), a mood-board file or image deliverable, and boards built from generated images.

## Follow-up: redesigns start from drafts

The first eval runs of the direction-first Skill (Luckin redesign case, kimi-k3 · Max) completed, and the owner judged the results mediocre. In the run that kept full evidence, the Agent researched on Pinterest, then made three `edit` calls to isolate the spokesperson, coffees and signature, one `generate` call for an empty background, and no blockout or composition draft; the layout came from rearranging cut-outs. The branch table had no row for "redesign this poster", and a supplied poster with "keep the face, coffees and size" read as reconstruction or a bounded edit, both of which adopt the given composition. The request to keep the face identical also discouraged any image-model draft.

With owner approval:

1. A **redesign** row in the branch table: the source supplies content, copy and delivery assets, not the composition. "Redesign", "optimize" or "重新设计" asks for a new composition even with keep-the-face constraints; a bounded edit is a named, local change.
2. **Drafts are required for a new composition**, at least two within budget. Rearranging cut-outs or existing layers is not composition selection; a composition that could not be drafted is reported.
3. **Drafts and final layers do different jobs.** Drafts settle composition, light and atmosphere and may approximate a face or product; isolated subjects sit in the blockout so drafts keep likeness and scale. Final layers keep identity by isolating supplied subjects from the source and placing them as the chosen draft shows. `layered-workflow.md` gains a "Redesign with preserved subjects" recipe.
4. **Stage 8** checks that a claimed redesign follows the chosen draft; a layout matching no draft has skipped stage 3.
5. The recipe allows a display headline drawn in the draft to become image lettering, answering the owner's earlier note that the accepted baseline's system-font type looked rigid.
6. The eval runner records process counts (image generate and edit calls, render previews, browser and question calls) from the Pi session in `run.json` for the owner's review. They are evidence, not a gate.

The Spec returns to draft for the redesign branch and the draft/identity split.

## Alternatives considered

- Keeping the Spec's three-way report and reverting the short replies: rejected because the short replies were deliberate product fixes, and the honesty guarantee survives without forced narration.
- Hard numeric rules enforced by the app: rejected by the agent-naive design principle; defaults stay advice.
- Keeping `graphic-canvas-profile.md` as a developer document: its activation discipline belongs to platform contracts, not to the Agent's reading path.

## Limits

- No Agent run has used the new material. Before/after quality needs 2–3 serial design-eval cases including the Luckin twin, judged blind by the owner, with an approved image budget.
- The layered example passes intake; it has not been rendered through `molly_render_preview`.
- The editability table follows the frozen matrix and the editor's panels; per-kind edit operations were not re-verified end to end in this change.
- Redesign drafting adds roughly two to four image calls per run; whether it improves the owner's verdict is measured only by the following eval runs.
- Installed-build question interaction is still unverified (`USER_GUIDE.md`). Blockout-conditioned drafts are untested with a real image model; a flat blockout may make drafts stiff.
