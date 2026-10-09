# Refocus the graphic-design Skill on design quality

Status: implemented
Translation: current

[中文](2026-10-09-graphic-design-skill-refresh.zh.md)

## Abstract

The graphic-design Skill spent most of its words on claim discipline and repeated the same rules across files, while giving the Agent almost no concrete layout guidance; the observed design-eval failures were exactly layout problems (an oversized subject, a headline crowding a face) and a redesign claim on an unchanged layout. The refresh adds breakable design defaults that double as the review checklist, states each rule once, corrects guidance that forbade active icon, table and chart semantics, adds a layered example and Chinese/Japanese/Korean font guidance, and replaces sentence-pinned tests with structural ones. The Spec revision that makes reporting proportionate is a draft awaiting owner approval. Whether output quality improved is not yet measured; that needs serial design-eval runs judged blind by the owner.

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
4. **Reporting** is one section. Spec stage 9 now requires never claiming an unperformed check or save and always reporting gaps, with the three-way distinction only when it matters. The Spec returns to draft.
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

## Alternatives considered

- Keeping the Spec's three-way report and reverting the short replies: rejected because the short replies were deliberate product fixes, and the honesty guarantee survives without forced narration.
- Hard numeric rules enforced by the app: rejected by the agent-naive design principle; defaults stay advice.
- Keeping `graphic-canvas-profile.md` as a developer document: its activation discipline belongs to platform contracts, not to the Agent's reading path.

## Limits

- No Agent run has used the new material. Before/after quality needs 2–3 serial design-eval cases including the Luckin twin, judged blind by the owner, with an approved image budget.
- The layered example passes intake; it has not been rendered through `molly_render_preview`.
- The editability table follows the frozen matrix and the editor's panels; per-kind edit operations were not re-verified end to end in this change.
- The literal research rule still requires inspiration research for trivial bounded edits; changing that is an intent change left to the owner.
