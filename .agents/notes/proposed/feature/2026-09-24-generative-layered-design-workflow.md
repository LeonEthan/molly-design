# Generative layered design workflow — decisions and validation record

Status: proposed
Date: 2026-09-24
Translation: current

[中文](2026-09-24-generative-layered-design-workflow.zh.md)

## Abstract

Molly's design Agent could write editable `design.yaml` artworks but had no default
workflow from a brief to a reviewed layered design. The approved
[task Spec](../../../../specs/generative-layered-design-workflow.md) puts that
workflow (brief, Pinterest research, drafts, complete transparent layers
regenerated from the chosen draft, recomposition and review) in skill material,
supported by JSON image edits with transparency options, native Pi tool-error
handling, a sandbox-plus-classifier auto-review mode and optional Node alpha
helpers. Segmented experiments showed native alpha from OpenAI Image 2.5 when the
transparency parameter reaches the service, and verified import, editing, crop,
save/reopen/export and embedded-Agent correction on retained or synthetic assets;
no brief-to-saved-artwork run has been made, so that run is the primary
acceptance. This note keeps the decisions, evidence and rationale; the Spec is the
active plan.

## Problem and goal

The owner defined the core pipeline on 2026-09-24: intent understanding,
inspiration search, creative drafts with Agent selection, layer decomposition by
the image model, YAML recomposition, text handling, holistic review, consistency
with supplied materials and intent, and final polish. The goal is a working
end-to-end path first; turn length, tokens and cost are optimized afterwards.

## Decisions (owner, 2026-09-24–25)

- **Rule scope.** Root [AGENTS.md](../../../../AGENTS.md) governs repository
  development; it does not forbid the product Agent's skill from recommending a
  creative workflow or repeated image calls. The application still enforces no
  creative steps.
- **Skills, not system prompt or orchestration.** One entry skill
  (`graphic-design`) with focused references; `imagegen` stays capability-gated.
  The per-turn pointer is reworded so the Agent reads the skill before design
  work. No stage controller, second scheduler or system-prompt change.
- **Agent discretion.** Skills teach methods, benefits, limits and examples; open
  trade-offs belong to the Agent. Text becomes native text, raster image or vector
  shape at the Agent's choice. The Agent picks the best draft; a later "auto"
  option may distinguish Agent and user selection.
- **Generated, not cropped, layers.** Each element is regenerated completely,
  including occluded parts, because crops leave holes that hinder re-layering and
  manual edits. Reference reconstruction uses the same approach; the supplied
  image replaces draft exploration. Delivery assets and design references are
  distinguished when judging fidelity; layer granularity follows independent
  editing value.
- **Models.** The core deliverable is a usable skill solution. OpenAI Image 2.5 is
  this round's target; Qwen Image 2.1 and Seedream 5.0 Pro follow later
  ([#16](https://github.com/LeonEthan/molly-design/issues/16)). Connection settings
  are not restricted. An earlier three-model allowlist idea is withdrawn.
- **Inspiration search** uses Pinterest through the existing embedded browser.
- **No call limits** on review or correction for now.
- **Native tool errors.** Remove the harness handling that ends a run on a
  dispatched image failure or unknown MCP delivery; both return to the Agent as
  tool errors. Crash/restart no-replay protection is session recovery and stays.
- **Auto-review mode.** Risk is judged by effect, not command form, because code
  execution is a core design capability. Shell commands run without prompts in
  `@anthropic-ai/sandbox-runtime` attached to Molly's own bash tool; escalations
  (unknown domains, requests to leave the sandbox) are judged by the
  `pi-auto-approval` classifier, falling back to the user on deny, failure or
  timeout. Network is limited to pre-allowed development and design domains.
- **Acceptance.** One end-to-end usability run from a plain brief through Molly's
  embedded Agent to a saved, edited, reopened and exported artwork. Earlier
  golden-replica experiments belong to a previous phase and are not acceptance
  for this task. A 2026-09-25 decision to reuse segmented evidence instead of a new
  generated run is superseded by this acceptance.
- **Single harness.** New executions use the embedded Pi harness
  ([Spec](../../../../specs/molly-embedded-pi-harness.md)).

## Spec approval (2026-09-25)

On 2026-09-25 the owner reviewed the
[task Spec](../../../../specs/generative-layered-design-workflow.md) and its Chinese
counterpart as submitted in the pull request that introduces them, and replied
"LGTM". That approval covers this revision only; implementation and acceptance
remain pending, and later changes to intent return the Spec to `draft`.

## Evidence

Artefacts from these experiments stayed outside the repository; no credentials or
captured transcripts are recorded. Call counts: 11 image API calls on 2026-09-24
(8 through a third-party relay, 3 through a local reverse proxy) and 1 on
2026-09-25, all with `gpt-image-2.5-sunburst`; one Codex CLI reference run.

### Transparency through the Image API

| Endpoint / body                 | Transparency request                          | Result                                                     |
| ------------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| generate, JSON                  | prompt only                                   | RGBA cutout; solid pixels at alpha 253                     |
| edit, multipart                 | prompt only                                   | RGBA once; RGB with a painted checkerboard once            |
| edit, multipart                 | `background=transparent`, `output_format=png` | RGB on both proxies; one reported `"background": "opaque"` |
| generate, JSON                  | parameter only                                | RGBA; reported `"background": "transparent"`               |
| edit, JSON with data-URL images | same parameters                               | RGBA on two calls; reported `"background": "transparent"`  |

OpenAI's API reference for
[image edits](https://developers.openai.com/api/reference/resources/images/methods/edit)
and [generation](https://developers.openai.com/api/reference/resources/images/methods/generate)
states that the 2.5 models support transparent backgrounds with `png`/`webp`
output and documents no separate background-removal endpoint. The tested proxies
lost the multipart field; whether OpenAI's own endpoint does was not tested. JSON
edits avoid the question. Three flat-green chroma-key edits were also keyed
successfully offline (soft steam preserved, one-pixel fringe); that fallback is
not shipped because native alpha works.

Generated layers drift from the draft: a cup returned about 20% larger and moved;
a Codex reference run (eight built-in `image_gen` edits of one poster, native alpha
on all seven transparent layers) had to re-place every layer, beans at roughly
twice their size. Stated coordinates in prompts do not preserve layout.

### Segmented MVP on Molly's real surfaces

| Check                                  | Finding                                                                                                                                                                                                    | Limit                                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Import and projection                  | Eight retained layers import; bounds, opacity and order edits round-trip exactly through YAML                                                                                                              | Serialization only                                                                                                                         |
| Desktop editing (packaged app)         | Render, edit, V1/V2 saves, restart and PNG/JPEG export behave; exports byte-identical across restart                                                                                                       | Full-canvas transparent padding made the top layer capture clicks                                                                          |
| Lossless crop                          | Cropping fully transparent padding (plus a 2 px guard) keeps pixels exactly; 1:1 export byte-identical; lower layers become directly selectable                                                            | Rectangular hit areas remain                                                                                                               |
| Fresh JSON edit                        | Real alpha 0–254; 20,062 faint (alpha 1–4) pixels keep the crop at 85% of the source area                                                                                                                  | One sample                                                                                                                                 |
| Subject placement                      | Manual uniform scale/translation aligned the cup within 4–7 px at landmarks                                                                                                                                | Done by the experimenter, not an Agent                                                                                                     |
| Faint-pixel cleanup                    | Global alpha cutoffs harden steam and shadows; a guarded spatial crop (region around alpha > 4 plus margin) removed only alpha-1 pixels and restored pointer selection                                     | Two samples; not a default                                                                                                                 |
| Fractional-scale rendering             | Crop-origin-sensitive subpixel rasterization changes native exports at non-integer scales (tracked in [#15](https://github.com/LeonEthan/molly-design/issues/15))                                          | Cause inside the renderer unresolved                                                                                                       |
| Layer order                            | Rendering follows element array order; changing `zIndex` alone had no visible effect                                                                                                                       | Tested path                                                                                                                                |
| Blinded review (fresh Codex reviewers) | Six synthetic cases (position, scale, faint effect, overlap, no change, intended change) all met preregistered checks                                                                                      | Referee-mediated rendering; no control arm                                                                                                 |
| Embedded Kimi review in Molly          | Same six cases through Molly's native UI with native previews and image reads all passed; 146 tool calls (13–33 per case); one case recovered from an ineffective `zIndex` edit by reading the format docs | Synthetic fixtures; prompts named the task; diagnostic code had mistakes (color masks, integer overflow, overstated zero-difference claim) |

### Code inspection (2026-09-25)

- The harness ends a run on a dispatched image failure or tool error
  ([acp-adapter.ts](../../../../packages/harness-pi/src/acp-adapter.ts)); unknown MCP
  delivery also ends it
  ([tool-operation-journal.ts](../../../../packages/harness-pi/src/tool-operation-journal.ts)).
- Design runs prompt for every tool call except browser calls on granted sites
  ([worker-main.ts](../../../../packages/harness-pi/src/worker-main.ts)); Molly wraps
  its own tools with host approval
  ([approved-tools.ts](../../../../packages/harness-pi/src/approved-tools.ts)).
- The pinned Pi SDK 0.85.1 exposes `BashOperations` on
  `createBashToolDefinition`, the hook Pi's official
  [sandbox example](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/sandbox/index.ts)
  uses.
- Intake imports only referenced image, image-fill and font assets
  ([intake.ts](../../../../packages/design-authoring/src/intake.ts)), so unused
  drafts in `media/` do not enter the committed artwork; they remain on disk.
- The per-turn pointer calls the skill "optional helpers"
  ([skills.ts](../../../../apps/cli/src/design/skills.ts)).

## Auto-review package evaluation

| Candidate                                           | Outcome                      | Reason                                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@anthropic-ai/sandbox-runtime` 0.0.77 (Apache-2.0) | Adopted for shell            | OS-enforced read/write/network boundary; attaches to Molly's bash tool without an extension or SDK upgrade; beta, so pin                                                                                                                                                          |
| `pi-auto-approval` 0.1.1 (Apache-2.0)               | Adopted for escalations only | Native `tool_call` extension whose fallback uses `ctx.ui.select`/`input`, which Molly supports. Alone, every piped or redirected shell command would cost a classifier call and a wrong verdict would run unrestricted. Vendoring must drop its unmapped `/auto-approval` command |
| `@erichll/pi-auto-review` 0.21.0                    | Not adopted                  | Requires Pi SDK `^0.87.1` (Molly pins 0.85.1); model review per ask; grants for an OS sandbox adapter Molly lacks                                                                                                                                                                 |
| `@gotgenes/pi-permission-system` 34.0.0             | Not adopted                  | Command-form rules; prompts through `ctx.ui.custom`, unsupported by Molly's extension UI; adds a second gate. Its bash parsing is a candidate to borrow                                                                                                                           |
| `pi-sandbox` 0.6.8                                  | Not adopted                  | Wraps a fork of the sandbox library and documents added loopholes for browser tools                                                                                                                                                                                               |

## Alternatives considered

- One skill per stage, or one large SKILL.md: the pointer names one skill, stages
  share state, and a large file loads irrelevant guidance into small edits.
- Crop plus clean plate for layers: occluded elements stay incomplete.
- Chroma key as the primary transparency route: worked offline but depends on key
  color and loses soft-shadow fidelity; native alpha works over JSON.
- Keeping multipart edits with added fields: the tested proxies dropped them.
- Resampling layers back to the full canvas: YAML bounds place trimmed layers
  without re-encoding.
- Stopping the run on image failures: rejected by the owner in favor of native
  Pi tool errors.

## Risks and limits

- Long turns and many image reads; no call limit; each call may be billed. With
  native tool errors an uncertain call may be repeated and billed twice.
- Layers are redrawn, not copied; occluded content is invented; placement relies
  on the Agent's judgment.
- GPT Image output sizes must be multiples of 16, within 3:1 and at least 655,360
  pixels; extreme canvases need other treatment.
- Generated solids sit at alpha 253–254 and stay slightly translucent when stacked.
- The sandbox's domain list and writable caches need tuning; the classifier can be
  influenced by untrusted content the Agent reads.
- Agent draft selection and reviews are advisory; human judgment decides quality.

## Verification limits

Evidence covers segmented stages on retained, synthetic or single fresh assets,
proxies rather than OpenAI's own endpoint, and one run per synthetic review case.
No Molly runtime code has changed for this task. No brief-to-saved-artwork run,
Qwen or Seedream call, or official OpenAI endpoint call has been made. Local
experiment files are not part of the repository and cannot be re-verified from it.

PR: [#17](https://github.com/LeonEthan/molly-design/pull/17) (Spec and this record).
