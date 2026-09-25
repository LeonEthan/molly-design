---
name: imagegen
description: "Use when the user asks to generate or edit images through Molly's image connection (for example: generate image, product shots, concept art, covers, or batch variants); calls molly_generate_image or molly_edit_image, which is registered only when an image connection is configured and enabled in Molly settings."
metadata:
  short-description: Generate and edit images via Molly's image connection
---

# Image Generation and Editing Skill

Generates and edits images for the current design work (product shots, concept art, covers,
website heroes, illustrations, infographic art). Calls `molly_generate_image` or
`molly_edit_image`, which talk to the user's configured OpenAI-Images-compatible connection
using the model explicitly selected by the user; Molly has no default model.

## Availability

`molly_generate_image` and `molly_edit_image` are registered only when the user has configured and enabled an
image connection (base URL, API key, model) in Molly settings. If the tool is not in
your tool list, that tool is unavailable for this session. Molly settings can enable
its connection; assess other capabilities from the actual tools available to your
Agent, without inferring that all image generation or image reading is unavailable.
Never ask the user to paste an API key in chat; keys live in the app's settings storage.

## When to use

- Generate a new image (concept art, product shot, cover, website hero)
- Edit an existing image or combine references, optionally with a PNG mask
- Variants within the user’s requested scope; each call may be billed

## Using generated assets

Choose your own prompting, inspection, and iteration approach for the task. Useful
inputs include exact text, subject, composition, intended use, and constraints.
`molly_generate_image` writes returned bytes under `media/` in the supplied
design authoring directory and returns both the artwork-relative and absolute
paths. Reference the relative path from that directory's `design.yaml`. Open outputs with an actual image-reading tool to
judge the result and decide whether further changes are useful. Report material
limits and the resulting asset path.

Prompt templates and taxonomy below are optional aids. For drafts and
transparent layers in a design, the graphic-design skill's layered workflow
describes a tested path.

## Tool inputs and provider limits

- `molly_generate_image`: `prompt`, optional `size`, `background` and
  `output_format`.
- `molly_edit_image`: `prompt`, `images` (1–16 workspace source/reference paths in
  prompt order), optional `mask`, `size`, `background` and `output_format`. Files
  are sent as data URLs in a JSON request to `/images/edits`; copy outside
  references into the workspace first. Each file is limited to 16 MiB and the
  combined inputs to 64 MiB by Molly. Relative image and mask paths use the
  design authoring directory; use absolute paths for ordinary attachments
  elsewhere in the Session workspace.
- `background`: `transparent`, `opaque` or `auto`. Use `transparent` with
  `output_format: "png"` for a standalone layer with real alpha; Molly refuses
  transparent JPEG before sending. Also describe the isolated subject in the
  prompt. Read the result: a painted checkerboard is not transparency.
- `output_format`: `png` or `jpeg`. Omit both fields to use the provider default.
- `size` is passed through. GPT Image models need both edges to be multiples of
  16, an aspect ratio within 3:1 and at least 655,360 pixels (for example
  `1024x1536`); other providers have their own rules.
- Masks are PNG files for the first image. Transparent areas indicate regions to
  edit; match the first image’s dimensions and the configured provider’s rules.
  A mask guides the model; it is not a guarantee of exact pixel preservation.
- Both tools save a new asset. They do not replace or commit the current artwork;
  decide whether and how to use the result in the YAML artwork.

Provider/model support for editing, multiple images, masks, sizes, transparency and
input formats varies. Failures come back to you as ordinary tool errors; read
them and decide the next step. An error that reports an unknown outcome means the
request may have run and been billed. Molly never changes models, substitutes a
generation call for an edit, or retries paid requests on its own. Successful
`/models` discovery in Settings does not establish image endpoint support.
Returned assets currently must be PNG, JPEG or GIF for Bento intake. Inspect the
actual result and report relevant service limitations.

## Prompt augmentation

A structured, production-oriented spec can help clarify a prompt. Only make implicit
details explicit; do not invent new requirements.

## Optional use-case taxonomy

These buckets organize the examples; use them when helpful.

Generate:

- photorealistic-natural — candid/editorial lifestyle scenes with real texture and natural lighting.
- product-mockup — product/packaging shots, catalog imagery, merch concepts.
- ui-mockup — app/web interface mockups that look shippable.
- infographic-diagram — diagrams/infographics with structured layout and text.
- logo-brand — logo/mark exploration, vector-friendly.
- illustration-story — comics, children’s book art, narrative scenes.
- stylized-concept — style-driven concept art, 3D/stylized renders.
- historical-scene — period-accurate/world-knowledge scenes.

Quick clarification (augmentation vs invention):

- If the user says “a hero image for a landing page”, you may add _layout/composition
  constraints_ that are implied by that use (e.g., “generous negative space on the
  right for headline text”).
- Do not introduce new creative elements the user didn’t ask for (e.g., adding a
  mascot, changing the subject, inventing brand names/logos).

Template (include only relevant lines):

```
Use case: <taxonomy slug>
Asset type: <where the asset will be used>
Primary request: <user's main prompt>
Scene/background: <environment>
Subject: <main subject>
Style/medium: <photo/illustration/3D/etc>
Composition/framing: <wide/close/top-down; placement>
Lighting/mood: <lighting + mood>
Color palette: <palette notes>
Materials/textures: <surface details>
Text (verbatim): "<exact text>"
Constraints: <must keep/must avoid>
Avoid: <negative constraints>
```

Augmentation rules:

- Keep it short; add only details the user already implied or provided elsewhere.
- The taxonomy slugs help find matching examples in
  [references/sample-prompts.md](references/sample-prompts.md).
- For a broad request (e.g., "generate images for this website"), use judgment to
  propose tasteful, context-appropriate assets using the examples as inspiration.
- If any critical detail is missing and blocks success, ask a question; otherwise
  proceed.

## Examples

### Generation example (hero image)

```
Use case: stylized-concept
Asset type: landing page hero
Primary request: a minimal hero image of a ceramic coffee mug
Style/medium: clean product photography
Composition/framing: centered product, generous negative space on the right
Lighting/mood: soft studio lighting
Constraints: no logos, no text, no watermark
```

## Prompting best practices (short list)

- Structure prompt as scene -> subject -> details -> constraints.
- Include intended use (ad, UI mock, infographic) to set the mode and polish level.
- Use camera/composition language for photorealism.
- Quote exact text and specify typography + placement.
- For tricky words, spell them letter-by-letter and require verbatim rendering.
- Targeted follow-ups can help identify which change improved an image.
- If results feel “tacky”, add a brief “Avoid:” line (stock-photo vibe; cheesy lens
  flare; oversaturated neon; harsh bloom; oversharpening; clutter) and specify
  restraint (“editorial”, “premium”, “subtle”).

More principles: [references/prompting.md](references/prompting.md). Copy/paste specs:
[references/sample-prompts.md](references/sample-prompts.md).

## Guidance by asset type

Asset-type templates (website assets, game assets, wireframes, logo) are consolidated
in [references/sample-prompts.md](references/sample-prompts.md).
