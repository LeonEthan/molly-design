# Generative layered design workflow — decisions and validation record

Status: proposed
Date: 2026-09-24
Translation: current

[中文](2026-09-24-generative-layered-design-workflow.zh.md)

## Abstract

Molly's design Agent could author editable YAML but lacked a supported path from
a brief to a reviewed layered artwork. The initial implementation combined skill
guidance, transparent JSON image edits, native Pi tool errors, sandboxed
auto-review and optional Node image helpers. Run 1 failed at host image import;
run 2 committed an artwork but exposed attachment-response and native temporary
directory failures, and has no verified human reopen/export or visual acceptance.
The follow-up corrects those boundaries and makes inspiration research depend on
gaps in the user's supplied direction, without adding runtime creative gates.
Run 3 committed another artwork but failed native previews because an embedded
Kai font was rejected by Chromium. A corrected font copy now renders through the
native saved-design path, reopens in Molly and exports as PNG/JPEG; human editing
and visual acceptance remain pending.
The [task Spec](../../../../specs/generative-layered-design-workflow.md) is back in
draft for that intent revision; the revised flow still needs human acceptance.

## Problem and goal

The owner defined the core pipeline on 2026-09-24: intent understanding,
inspiration search, creative drafts with Agent selection, layer decomposition by
the image model, YAML recomposition, text handling, holistic review, consistency
with supplied materials and intent, and final polish. The goal is a working
end-to-end path first; turn length, tokens and cost are optimized afterwards.

## Initial decisions (owner, 2026-09-24–25)

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
"LGTM". That approval covered that revision only; implementation and acceptance
were pending at the time. The later inspiration-guidance revision returns the
Spec to `draft`, retaining this approval as historical evidence.

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

### Pre-implementation code inspection (2026-09-25)

The following findings describe the code before the implementation below, not
current behavior.

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

## Initial auto-review package evaluation

| Candidate                                           | Outcome                      | Reason                                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@anthropic-ai/sandbox-runtime` 0.0.77 (Apache-2.0) | Adopted for shell            | OS-enforced read/write/network boundary; attaches to Molly's bash tool without an extension or SDK upgrade; beta, so pin                                                                                                                                                          |
| `pi-auto-approval` 0.1.1 (Apache-2.0)               | Adopted for escalations only | Native `tool_call` extension whose fallback uses `ctx.ui.select`/`input`, which Molly supports. Alone, every piped or redirected shell command would cost a classifier call and a wrong verdict would run unrestricted. Vendoring must drop its unmapped `/auto-approval` command |
| `@erichll/pi-auto-review` 0.21.0                    | Not adopted                  | Requires Pi SDK `^0.87.1` (Molly pins 0.85.1); model review per ask; grants for an OS sandbox adapter Molly lacks                                                                                                                                                                 |
| `@gotgenes/pi-permission-system` 34.0.0             | Not adopted                  | Command-form rules; prompts through `ctx.ui.custom`, unsupported by Molly's extension UI; adds a second gate. Its bash parsing is a candidate to borrow                                                                                                                           |
| `pi-sandbox` 0.6.8                                  | Not adopted                  | Wraps a fork of the sandbox library and documents added loopholes for browser tools                                                                                                                                                                                               |

### Separate evaluation of `@erichll/pi-sandbox` 0.21.1

The scoped package is a different project from the unscoped `pi-sandbox` above;
that earlier rejection does not evaluate it. Its published
[package metadata](https://github.com/erichll/pi-packages/blob/f211b1233e4bc8e2109e8c105643110bc5e3f32f/packages/pi-sandbox/package.json)
declares Apache-2.0, Node `>=22.19.0`, Pi `^0.87.1`, and dependencies on
`@anthropic-ai/sandbox-runtime ^0.0.77` and `@erichll/pi-auto-review ^0.21.0`.
Molly currently pins Pi 0.85.1.

Its public
[`./runner`](https://github.com/erichll/pi-packages/blob/f211b1233e4bc8e2109e8c105643110bc5e3f32f/packages/pi-sandbox/src/runner.ts)
can be evaluated separately from the full extension: callers supply filesystem
policy, environment, cancellation, output and network-review callbacks, while the
runner owns a broker process and private temp directory per command. It does not
register the full extension's tools, UI or auto-review broker. Reuse would still
need SDK compatibility and packaged broker-resource validation, while preserving
Molly's run/epoch authorization and journal boundaries. Its
[documented filesystem policy](https://github.com/erichll/pi-packages/blob/f211b1233e4bc8e2109e8c105643110bc5e3f32f/packages/pi-sandbox/README.md#security-model)
remains static; swapping packages alone does not establish that native macOS
temporary paths or local attachment responses work.

The upstream
[changelog](https://github.com/erichll/pi-packages/blob/f211b1233e4bc8e2109e8c105643110bc5e3f32f/packages/pi-sandbox/CHANGELOG.md)
records recent release and loader fixes, including a missing runtime dependency
in 0.20.1 and the Pi TUI alias in 0.21.1. This is maintenance evidence, not Molly
integration acceptance. This correction keeps the existing sandbox library and
does not adopt the scoped package; selective runner reuse remains an option.

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

## Implementation (2026-09-25)

The initial Spec's tasks were implemented after approval. The following records
that implementation; the subsequent runs and corrections are recorded below.

| Task                  | What landed                                                                                                                                                                                                                                                                                                                                                                   | Tests (synthetic)                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Image capability      | Optional `background` and `output_format` on both tools; transparent JPEG refused before dispatch; edits send ordered images and the mask as JSON data URLs; the multipart transport branch is removed                                                                                                                                                                        | Request, MCP and asset-import tests                                                                                |
| Native tool errors    | The run stop and cross-call retry fence are removed; failed or uncertain image calls return to the model; a dispatched tool-call ID still never replays                                                                                                                                                                                                                       | Journal tests; ACP tests where the run continues and the model receives the tool result                            |
| Optional asset helper | `reference-pack.mjs` gains `alpha`, `trim` and `compare`                                                                                                                                                                                                                                                                                                                      | Retained pixels, offsets, guarded crop, comparison sheets, source preservation                                     |
| Design experience     | New `layered-workflow.md` reference; `SKILL.md` recommends the nine stages; reconstruction and imagegen guidance aligned; the per-turn pointer asks the Agent to read the skill first                                                                                                                                                                                         | Materialization and pointer tests                                                                                  |
| Auto-review mode      | `Ask` and `Auto-review` published to the composer and frozen in each run snapshot; shell in `@anthropic-ai/sandbox-runtime` 0.0.77; effect-based policy; escalations judged by a classifier adapted from `pi-auto-approval` 0.1.1 on the journaled session model, falling back to the user; approvals recorded in the run journal; both packaged with provenance and licences | Policy, approval fallback, network review, sandbox routing, classifier, provenance and an adapter integration test |

A manual check against the real macOS sandbox (not a repository test) showed:

- writes and reads in the workspace worked;
- a write to the home directory and a read of `~/.ssh` were blocked;
- the sandbox temp directory was writable;
- the npm registry was reachable;
- `example.com` reached the review callback and stayed blocked when declined;
- a workspace inside a denied private-data root stayed readable while a sibling file was blocked.

The first probe exposed that `sandbox-runtime` sets the sandboxed `TMPDIR` from `CLAUDE_CODE_TMPDIR`, which is now set to a per-worker temp directory.

Implementation choices within the Spec:

- **Mode transport.** The mode travels as an ACP mode plus a `mode` config option for the Molly agent. The run-config applier validates it and the session stamps it into the run snapshot, so worker configuration stays per session.
- **Scope.** Capabilities are published per agent configuration, so auto-review is offered to every Molly session. Non-design sessions simply have no design tools.
- **Escalation argument.** Bash gains an optional `outside_sandbox` argument for escalation requests; other modes ignore it.
- **Path forms.** File-tool paths starting with `~` or `@` are reviewed rather than resolved by Molly.
- **Linux.** Linux needs `bwrap`, `socat` and `rg`. Without them, or on other platforms, shell keeps its prompt.
- **Network.** Network decisions are remembered for the run, and network prompts appear as their own tool-call cards.

Found during implementation:

- The embedded system prompt said "Ask for approval before tool execution", which could make the Agent ask in chat under auto-review. On 2026-09-25 the owner approved replacing it with "The host handles tool approval; do not ask for it in chat." before run 1; no other system-prompt text changed.
- Package-manager caches outside the workspace (`~/.npm`, the pnpm store) are not writable, so installs may need an escalation.

## Acceptance runs and corrections (2026-09-25)

Run 1 remains a failed run. Its recorded summary reports about 18 minutes, 44
model requests and 53 approvals: 49 automatic, one browser-site prompt and three
image-recovery prompts. All three image calls were affected by the host import
authorization mismatch. The worker had approved them under auto-review, while the
host still required a matching interactive prompt. It also exposed blocked
`pip install --user`, native macOS temp access and a long read of the bundled
format library. These observations do not prove that the image provider never
ran or billed a request.

Run 2 ran from 22:08:03 to 22:29:42 America/Los_Angeles (21 minutes 39 seconds).
Inspection of its local journals and persisted artwork established:

- 27 model requests and 44 approvals: 42 automatic and two user prompts, both for
  `molly_upload_images`;
- eight image operations: seven `succeeded` and one lantern operation
  `outcome_unknown`; recovery verified seven stored assets, without an automatic
  paid retry;
- two successful native render previews, both read by the Agent, a successful
  finalize check and a `committed` artwork receipt;
- both image-sharing attempts failed response validation after local handling;
  the `sips` fallback then failed on native macOS temporary-directory access;
- the Agent read the layered guide for a plain Mid-Autumn poster brief but did not research in
  the browser. The browser tool was available and had been used in run 1.

Later persisted artwork revisions at 22:36:09 and 22:36:36 changed the title and
month and removed the stamp, reducing the element count from 13 to 11. These
revisions prove later saves, not who edited, whether saving was explicit or
automatic, or that reopen/export and visual acceptance passed. The old unknown
image receipt does not identify its failing boundary; the new diagnostics below
cannot reconstruct it retrospectively.

The owner then authorized these corrections:

- **Image import and recovery.** The host accepts worker-approved imports and
  recovery only while the matching run has frozen auto-review mode; run, epoch
  and connection ownership checks remain. Ask mode still requires its matching
  approval. Recovery is read-only and sends no paid request. See
  [agent contract](../../../../apps/cli/src/agent/AGENTS.md).
- **Local attachments.** Auto-review includes the built-in image and file sharing
  tools. Local `session/file-upload` responses now carry local file blocks and
  their owning machine, without a download URL, after the history write. Zod and
  TypeScript/CommonJS validators agree and retain the older `r2` response shape.
  Workspace containment still applies; this does not add a cloud upload path.
  See [session files](../../../docs/cli-lib-session-files.md).
- **Safe failure diagnostics.** Existing operation receipts can record only the
  fixed `failureStage` values `dispatch`, `receipt`, `import` or `persistence`.
  They retain no raw errors, headers, response bodies or credentials, and stage
  absence remains unknown. The dispatched-call replay fence, asset receipts and
  absence of host paid retries stay intact. See
  [harness contract](../../../../packages/harness-pi/AGENTS.md).
- **Native temp access.** On macOS, resolve and canonicalize the current user's
  `getconf DARWIN_USER_TEMP_DIR` and allow writes only to that directory in
  addition to the worker-owned temp and workspace. Do not grant its ancestors or
  open the home directory to make `pip install --user` work. Shutdown removes
  only worker-owned temp files.
- **Design guidance.** Start with the user's design thinking, inspiration and
  references. If absent or insufficient for a decision, actively research design
  sites for the gap while retaining that direction. Existing format-query and
  minimal-example routes are made explicit; no missing format feature was
  established, so no new tool or source-reading prohibition is added. Prefer the
  shipped helpers; temporary scripts, dependency environments and caches stay
  in the artwork workspace or `$TMPDIR`. These are skill instructions, not
  runtime stages.

A real `WorkerSandbox` probe reproduced `sips` failing with exit 13 before the
native-temp change; the same synthetic PNG operation exited 0 after granting
only the canonical current-user directory. A Swift probe using
`xcrun swift -module-cache-path "$TMPDIR/swift-cache" sample.swift` also exited 0
and emitted its expected signal. Workspace and worker-temp writes worked, while
private sibling reads and writes outside the allowed roots stayed blocked.
These are narrow manual probes, not general native-tool compatibility or a new
design acceptance run.

The skill materialization suite passed 13 tests, including building and staging
the actual bundle; the helper suite passed 18, including the existing format
queries and text example. The combined `pnpm check` and `pnpm format` completed
successfully, including type, lint, test, translation, platform and public-boundary
checks. Focused runtime regressions cover the corrected approval, response,
receipt and temporary-directory boundaries. The complete local build succeeded
and the rebuilt Molly desktop opened at a new chat without starting an Agent
run. That startup check does not establish manual design acceptance.

## Run 3: native font failure (2026-09-26)

Run 3 lasted 28 minutes 37 seconds, from 2026-09-25 23:46:00 to 2026-09-26
00:14:37 America/Los_Angeles. Local journals and the canonical artwork establish:

- 46 successful model requests and 60 automatic approvals: 29 sandbox, 21
  workspace and ten design-tool approvals;
- three image generations and four edits, all successful;
- three failed `molly_render_preview` calls, with only
  `harness_mcp_tool_failed` reaching the Agent;
- no browser or network research, attachment uploads or image recovery. The
  materialized skill, layered guide and browser guide matched the revised
  repository versions;
- a successful finalize check and `committed` receipt. The Agent instead used a
  Pillow approximation, which does not verify the formal Bento rendering. Human
  edits, save/reopen and export remain unverified.

A separate real Electron probe reproduced the font failure. The embedded Kai
asset has a `00010000` SFNT header (TTF); Chromium's OpenType Sanitizer reported
`bad table directory rangeShift` and missing `OS/2`. STFangsong and bundled Inter
loaded in the same investigation. This establishes a rejected font asset, not
absence of the native rendering tool, and does not establish a general TTC or
dFont defect.

The structural font sniff accepts the Kai asset, and intake, asset storage and
Bento projection preserve its bytes. Passing those checks does not establish
Chromium compatibility. The renderer correctly refuses a failed font; replacing
that refusal with a fallback or accepting the Pillow image as native evidence
would conceal the defect. The generic MCP error also hides the actionable font
failure from the Agent.

The authoring reference now explains that existing files, structural checks and
copied macOS system fonts do not guarantee loading, and directs font failures
back to the registration and native preview. No intake rule, runtime creative
gate or Spec intent changed.

The following corrections and checks are complete:

- **Safe render errors.** Only exact known font failures returned by the built-in
  `molly_render_preview` map to `harness_render_font_failed`; other recognized
  render failures map to `harness_render_failed`. Unknown, external and transport
  errors retain the generic error. Unit tests and an end-to-end MCP chain verify
  this boundary; it exposes no raw diagnostic payload and does not replay calls.
  See [MCP bridge](../../../../packages/harness-pi/src/mcp-bridge.ts) and its
  [tests](../../../../packages/harness-pi/tests/mcp-bridge.test.ts).
- **Native reproduction.** A separate real `renderSavedDesign` call on the
  original artwork failed with `Font failed to load`; the compatible copy
  rendered a complete 1024 × 1536 PNG successfully.
- **Explicit font repair.** Temporary FontTools tooling rebuilt the Kai table
  directory and added explicitly inferred `OS/2` metadata. Of the 23 original
  tables, 22 remain byte-for-byte identical; only `head.checksumAdjustment`
  changed in the remaining table. Glyph, `cmap` and metrics tables are preserved.
  This is evidence of retained font data, not proof that all rendered pixels
  are identical. The font is not added to the source repository.
- **Artwork preservation.** After a normal app quit, the existing
  `history-create` operation saved the original as v1, a compare-and-swap save
  registered the corrected font hash, and a second history save created v2.
  The original `Kai.ttf` and historical receipt remain unchanged; the mutable
  YAML changes only the Kai registration's `src` to the new file. There is no
  runtime font conversion, fallback or creative gate.
- **Automated verification.** The full `pnpm check` and `pnpm format` passed
  after the render-error change.
- **Reopen and native export.** A complete `pnpm start:local` rebuild launched
  Molly, and reopening the original chat showed the full v2 poster, including
  its Kai title, without a font error. Editing controls and Export were enabled.
  Independent production `renderSavedDesign` calls on the saved canonical
  artwork produced 1024 × 1536 PNG and JPEG files with no font or OTS diagnostic;
  source-preview also accepted the updated draft's font hash. The UI export
  dialog was not exercised, and the user has not performed the manual edit/save
  or visual acceptance steps.

## Verification limits

The evidence now includes three real design runs, but none establishes the full
human acceptance path for the corrected implementation. The corrected artwork
has desktop reopen and native PNG/JPEG evidence; the UI export dialog and human
editing/save/visual acceptance remain untested. Run 3 had the revised inspiration guidance but did
not perform research, and called 2025 the current year. No new Agent run has
verified correction of these behaviors. Earlier image experiments used proxies rather than OpenAI's
own endpoint; Qwen and Seedream integration is still outside this task. Local
run records and experiment files remain outside the repository; only aggregate
findings are recorded here, so they cannot all be reproduced from repository
files alone.

PR: [#17](https://github.com/LeonEthan/molly-design/pull/17) (Spec and this record).
