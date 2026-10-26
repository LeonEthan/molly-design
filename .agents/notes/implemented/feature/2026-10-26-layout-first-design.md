# Layout-first design

Status: implemented
Translation: current

[中文](2026-10-26-layout-first-design.zh.md)

## Abstract

Some users want to control where things sit before paying for an image, as layout-conditioned models such as MOSS-Image allow, but every new design started with three finished image-model options. The owner decided on 2026-10-26 to add a layout-first path to the existing Skills: after a style question and research, the Agent draws an editable layout of labelled region boxes and final copy on the canvas and stops; after the user adjusts and confirms it, the Agent generates one design from the rendered layout and reproduces it in editable layers, with position and size from the layout and appearance from the generated design. The entry is a trigger phrase, offered as a fifth home idea chip, because Molly has no working slash commands. The workflow Spec returned to draft, and no Agent run has verified the path yet.

## Problem

- This extends the [user-chosen designs](2026-10-09-user-chosen-designs.md) and [whole-image delivery](2026-10-26-whole-image-delivery.md) decisions; three options remain the default for open briefs.
- Options fix the composition inside the image model's output, so a user who wants to decide placement first can only reject options and pay for new ones.
- General image models (GPT Image, Qwen Image) take a layout only as a guide image and drift from it, so reproduction must decide whether the layout or the generated image wins.

## Decision

1. **Geometry from the layout, appearance from the image.** Copy elements keep their layout bounds and wording; extracted objects are scaled into their region boxes; the plate comes from the generated design. Background lighting may not line up with moved objects; this is accepted.
2. **One image after confirmation.** No options on this path; "generate again" reuses the saved layout guide with one new edit call.
3. **Trigger-phrase entry.** The Skill branch matches wording such as "先排版", "先出布局" or "layout first"; a fifth home idea chip fills in such a prompt. Mode state lives in the artwork (`layout-` element ids), not in a flag.
4. **Ask style first, research before drawing.** The Agent always asks about style direction on this path, then researches under the unchanged research rule, then draws the layout; the kept inspiration images feed the generation turn.
5. **Delivery.** Editable layers unless the brief asks for a whole image; the form is not asked. `layout-` boxes and labels are deleted before delivery, and the confirmed layout remains in design history.

## Reuse

- Reused: the rendered native blockout in `design-research/references/design-options.md` (now kept on the canvas instead of restored), ordinary `shape`/`text` elements, `molly_image` `edit`, `design-replication`, and the existing `HomeIdeaChips` component.
- No new artwork format, storage, protocol or run-config state.

## Alternatives

- **Slash command `/layout`.** Rejected for now as larger infrastructure: the embedded catalog publisher writes `availableCommands: []` (`apps/cli/src/agent/embedded-harness-catalog.ts`), so the composer `/` menu never opens for Molly; Pi's `available_commands_update` is dropped (`packages/shared/src/acp/history-apply.ts`); and Molly prepends prompt scaffolding, which likely prevents Pi's prompt-template expansion (inferred from code, not tested). Real slash support is a separate infrastructure issue.
- **A persistent mode switch.** Would add run-config state carried to every turn; rejected because the layout elements already identify the state.

## Changes

The workflow Spec (both languages), the `graphic-design`, `design-research` and `design-replication` SKILL.md files, the new `design-research/references/layout-first.md`, `chat-landing.tsx` and the `en`/`zh_CN` locales.

## Limits

Unverified: no Agent run has exercised the path, and an end-to-end run is owed. A full run needs roughly four to six image calls (one generation plus plate and object extraction), which may exceed the default budget of five and needs the owner's approval. Whether five idea chips fit the home row needs a visual check.
