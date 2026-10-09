# Inspiration images as inputs, source copy and lettering layers

Status: implemented
Translation: current

[中文](2026-10-09-inspiration-inputs-and-lettering.zh.md)

## Abstract

The first runs of [user-chosen designs](2026-10-09-user-chosen-designs.md) gave faithful reproductions but three gaps: the design options came from the source poster and a prompt only, because the Skill forbade passing found references to the image model; copy was dropped or altered because the Agent read it off the design image; and artistic product names were flattened into plain fonts. This correction lets the Agent pass one or two inspiration images it chose from research as `edit` inputs next to the source image, takes all wording from the brief or source with a line-by-line check, and turns any lettering a font cannot reproduce into an image layer isolated from the design, whatever its size. The Spec stays in draft for owner approval. In two DeepSeek reruns every option used inspiration inputs and the reproductions stayed close to the chosen design; one run passed its gate and the other produced a landscape canvas.

## Problem and evidence

- The owner's earlier requirement that the design draft be made from "image + text, not text alone" meant the inspiration images found in research, chosen flexibly by the Agent, assist the text and the source image. The [direction-first refresh](../simplification/2026-10-09-graphic-design-skill-refresh.md) read it as source images and blockouts and wrote the opposite rule: "found references are never edit inputs". This is a correction of that reading.
- Two complete DeepSeek runs of the Luckin redesign case on commit adfd3cd7 made all three options with `edit` calls whose only input was the source poster.
- In both runs the drink names "小黄油美式" and "小黄油拿铁", drawn as artistic letters on colored badges in the design, became native text (one run on a flat shape). The Skill had said to try native text first for a styled headline and to keep image lettering to a few large display words.
- A run failed the copy check on "*全网爆火全冰去水隐藏喝法，口感加倍浓郁" and another dropped the disclaimer: the Agent matched what the design drew, and stage 1 asked for copy before it was used.
- Research in both runs looked only at search-result grids.

## Decision

1. **Research saves inspiration.** Open individual images rather than only result grids, and save with `save_image` the one to three inspiration images the options may use.
2. **Options from images and text.** `edit` inputs are the source image first when there is one, then one or two inspiration images chosen per option, then an optional blockout. The prompt names what each image lends and forbids its objects, people, text and logos. Options may use different inspiration images. An option that reads as one reference with new copy fails. Connection input limits come from the `imagegen` Skill.
3. **Copy from the source.** Stage 6 takes every line of wording from the brief or source, fine print included, never from the design image; stage 8 checks each line. Stage 1 no longer lists copy.
4. **Lettering layers.** The test is whether native text can reproduce the design's letterforms and finish. If not (drawn letterforms, outlines with fills, texture, 3D, letters fused with a badge, warped or per-letter styling), the lettering is isolated from the chosen design as an image at any size, with its badge when that belongs to it, and checked character by character against the source. Long or small copy stays native.

The eval runner's process counter now counts only image calls the Agent made, not tool documentation that names them.

## Alternatives considered

- **Keep references out of the image model:** avoids copying another designer's work, but leaves text to carry light, palette and type treatment, which the owner's requirement says it cannot. The fail rule for a recognizable copy and the prompt's prohibitions address the risk instead.
- **Fixed reference count or mandatory references:** rejected by the owner; the Agent chooses how many and which.
- **Native text for everything below headline size:** keeps editing simple but loses the design, as the drink names showed.

## Limits

- Inspiration inputs can make an option resemble a reference too closely; only the Agent's review and the owner's judgment check this.
- DashScope accepts at most three input images, leaving room for one or two references beside a source.
- Lettering layers change wording only by regenerating them.
- Plate defects seen in the runs (a person kept in the plate, a lost wordmark, seams) are not addressed here.

## Rerun

Two DeepSeek flash runs of the Luckin redesign case on commit 9c4eb5fe, with the runner choosing the Agent's recommendation. Visual quality is the owner's judgment; these are observations.

- **Run 1 (gate passed).** Four inspiration images saved; each option was an `edit` from the source poster plus a different inspiration image, giving clearly different airy, deep-cobalt and blue-and-yellow options. The editable version of option A matches it closely, with every source line present including the disclaimer. Option A drew the drink names in plain bold type on navy badges, so native text was the faithful choice. 11 image edits. Option B's embed in the reply mixed two file hashes and showed "File was not found".
- **Run 2 (gate failed).** Options used the source plus one or two inspiration images. The Agent read "保持海报尺寸不变" (keep the poster size) as the untouched 800×600 default canvas instead of the attached 1126×1500 poster, so the options and the result are landscape. Within that canvas the reproduction is faithful, all copy lines are present, and it corrected drink labels the option had swapped. 7 image edits.

Open follow-ups: the size to keep in a redesign is the supplied artwork's when the open canvas is an untouched default; option images could be copied to short names before embedding so paths are not retyped; the plate still loses the wordmark on the held cup.

## Follow-up: canvas size and option names

After the rerun, with owner approval: stage 1 settles the canvas size from the brief in order (a stated size or format; the artwork the request refers to, so a redesign keeps the redesigned work's size and a bounded edit keeps the current canvas; where the work will be seen) and asks when none settles a size that changes the composition. An empty canvas with no elements is a placeholder whose size means nothing; this covers briefs with no attached artwork, which a rule tied to attachments would not. The options message states the chosen size. Options shown to the user are copied to short names such as `media/option-a.png` before embedding, so the model never retypes a hashed path.

Rerun on commit 453cd7cc, two DeepSeek flash runs: both passed the gate at 1126×1500 and stated the size; every option was an `edit` from the source plus one or two inspiration images; embeds used `option-a.png` names and resolved; every source line was present. The editable versions stay close to the chosen options; run 1 dropped the butter blocks and set the last headline line lighter than the option. Run 1 asked for the choice through the question card in the same turn instead of ending the turn, which the Skill does not ask for. 9 and 11 image edits.
