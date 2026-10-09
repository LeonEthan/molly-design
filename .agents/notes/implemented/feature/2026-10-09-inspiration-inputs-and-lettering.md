# Inspiration images as inputs, source copy and lettering layers

Status: implemented
Translation: current

[中文](2026-10-09-inspiration-inputs-and-lettering.zh.md)

## Abstract

The first runs of [user-chosen designs](2026-10-09-user-chosen-designs.md) gave faithful reproductions but three gaps: the design options came from the source poster and a prompt only, because the Skill forbade passing found references to the image model; copy was dropped or altered because the Agent read it off the design image; and artistic product names were flattened into plain fonts. This correction lets the Agent pass one or two inspiration images it chose from research as `edit` inputs next to the source image, takes all wording from the brief or source with a line-by-line check, and turns any lettering a font cannot reproduce into an image layer isolated from the design, whatever its size. The Spec stays in draft for owner approval; the effect on quality depends on the rerun recorded below.

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
