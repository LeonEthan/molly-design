# Generative layered design workflow — decisions and validation record

Status: implemented
Date: 2026-09-24
Translation: current

[中文](2026-09-24-generative-layered-design-workflow.zh.md)

## Abstract

Molly's layered-design workflow, asset admission, native preview diagnostics and
auto-review fixes are implemented and accepted for the tested local macOS arm64
journey. The latest complete design run performed research, generated editable
layers, inspected native previews and saved successfully with no manual approval
prompts. The owner confirmed manual text editing, save, reopen and export; the
signed app also retained Pinterest login after normal quit and restart. A later
browser flicker and address-input regression was reproduced and fixed. This closes
the authorized scope, without claiming universal visual reliability, other-provider
support or notarized distribution.

## Current acceptance and closeout

The final acceptance state is recorded below in [Closeout approval 2026-09-26](#closeout-approval-2026-09-26).
Earlier sections preserve the evidence and limitations as they stood at each run;
their pending-test language is historical, not the current acceptance checklist.

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

## Research and temporal context correction (2026-09-26)

Run 3's supplied references were empty. Its native tool results contained the
complete revised skill, poster guide and layered guide, matching repository
bytes; it then moved to font investigation and three generated drafts without
reading the browser guide or making a browser call. The frozen toolset identity
matched the earlier run that used the browser. There was no browser attempt from
which to infer a permission or network failure. Native font failures occurred
later, so they cannot explain the initial research omission.

The skill required research for missing inspiration but also broadly permitted
omitting stages. This is a plausible contributor to instruction noncompliance,
not a proven explanation of the model's internal choice. The owner authorized
removing that permission entirely. The revised guidance gives each branch its
actual conditions: use sufficient supplied references; otherwise research the
unresolved design decisions. A topic, broad style label or the Agent's own idea
does not count as sufficient user-supplied inspiration. Methods, ordering and
iterations remain Agent choices; the application gains no creative gate.

The model introduced the wrong year before receiving any tool content containing
that year. It later treated font-file modification time as support and wrote the
unverified calendar date into editable text. Neither the input nor the image
prompts supplied that date. Source inspection and an offline probe of pinned Pi
0.85.1 establish that neither its default prompt nor Molly's custom prompt
supplied the current date. Freezing the clock in two different years produced
identical prompts. Native message timestamps are metadata, not calendar context
in the provider request. This corrects the hypothesis that Molly had discarded
a default SDK clock; that clock was absent in both branches.

The owner approved dynamic date, time and location context. Molly refreshes
host date/time, UTC and the IANA time zone through the public
`before_agent_start` hook for each prompt, including a reused session. A running
tool loop keeps that prompt's sample; work needing a newer instant can query the
clock. The host clock is not an event date. Existing UI language and scheduling
time-zone fields do not establish the user's location, and there is no user
location setting to reuse, so geographic location remains unknown unless the
user supplies it. No IP lookup, location setting, wire field or new store is
added. Temporal environment context belongs to the harness; research and factual
copy guidance stay in the skill, preserving the earlier decision not to place
creative stages in the system prompt.

The real-SDK regression used synthetic provider responses and injected clocks:
the new cases failed before the change and passed afterwards. It covers a local
day/year boundary and time-zone change between prompts, a stable timestamp across
each tool loop, and preserved host context and optional read-before-edit reminders
without accumulation. The 47 session/resource-loader tests and harness typecheck
passed. The 13 skill-materialization tests also passed, including actual build
and staging. Full `pnpm check`, `pnpm format` and `pnpm run docs check` passed.
Three old pointer-copy assertions were updated to check the materialized skill
path rather than its editorial wording before the passing full check.
`pnpm start:local` rebuilt and restarted Molly; the shipped harness contains the
time hook and the staged skill matches source. The existing v2 artwork reopened
with its title, native canvas and Export control available, without a font error.
No new model or image request has been made.

The next manual run must still
demonstrate research when references are missing, direct use of sufficient
references, and factual dates grounded in the task rather than file timestamps.
This correction does not rewrite the prior artwork's date or replay its run.

## Workflow skill rewrite proposal (2026-09-26)

This proposal supersedes the earlier broad freedom to choose stage order and the
"sufficient references" research exception. The owner now requests an explicit
workflow and permits omitting additional inspiration research only for a
specified template or reference target that the task requires following without
new inspiration. This section updates the plan, not the shipped Skill or runtime.

### Evidence after the temporal-context correction

Run 4 read the complete updated Skill, including the removal of stage-omission
language, but made no research/browser calls. An offline reconstruction of the
frozen tool catalog confirmed that the browser was available. The run recognized
the current year and retained a lunar festival label rather than inventing a
Gregorian date; this does not establish correct calendar conversion. All 68
permission decisions were automatic, with no user prompt; eight image calls and
one local image-upload call succeeded.

Three native previews failed. Production-path reproduction identified the first
failure before renderer dispatch: a referenced 20,752,628-byte font exceeded the
16 MiB asset limit; another referenced 20,856,816-byte font also exceeded it.
Structural validation and `finalize` passed, but final collection returned
`invalid/design_asset_failed` and the canonical artwork remained empty. The
Agent's Pillow composition did not prove Bento rendering or successful delivery.
The underlying error was reduced to `harness_mcp_tool_failed`, concealing the
repairable asset problem. Unlike run 3, these original fonts loaded in the actual
Electron font engine; the observed blocker was their admission size.

The Agent's subsequent explanation is a useful lead, not proof of its internal
reasoning: it treated familiar design language and its own concepts as grounds
to omit research, and interpreted the generic preview error as a desktop
connection failure. Both explanations indicate where the instructions and error
surface allow unsupported conclusions.

### Writing approach

The owner supplied the neighboring `open-kimi-ppt/skills/open-kimi-ppt/SKILL.md`
as a writing reference. Borrow its organization: define the deliverable, classify
the task and inputs, give imperative branch actions at the point of use, then
separate validation from delivery. Do not copy its PPTD/PPTX outputs, public
editor dependencies, global installation commands or presentation-specific rules.
Its structure is a useful example, not evidence that Molly's rewritten Skill
will reliably be followed.

Keep one `graphic-design` entry and the existing capability-gated `imagegen`
Skill. Rewrite the entry around **Definition → Preparation and task branch →
Required workflow → Completion reporting**. Place the nine-stage instructions,
their branch conditions and their observable completion criteria in this entry.
References supply techniques at the relevant step; they do not define a second,
competing workflow. Remove broad permission to choose stage order, and replace
it with explicit forward dependencies and repair loops: after a visual change,
return to native review and consistency checking. Methods and useful iterations
remain Agent choices within user constraints.

### Research rule and task branches

Prioritize the user's design thinking, inspiration and references. **Perform
design-site research before composition selection or creation unless all of the
following hold:** the user explicitly identifies a concrete template or reference
target; the user's instruction calls for following that target without additional
inspiration; the Agent has actually inspected the target and it supports the
requested visual decisions; and the user has not also requested research.

The user need not utter a special phrase: "reproduce this template and replace
only the copy" establishes the intended exception. A topic, broad style label,
logo, product photo, unexamined attachment, currently open artwork or the Agent's
own idea does not establish it. "Use this mood but redesign the composition"
still requires research. Read the supplied target even when additional research
is exempt; necessary factual verification, such as an event date, is separate.
An explicit user prohibition on networking takes precedence over this default;
report the resulting research limitation. Tool absence or network failure is a
blocker, not evidence that the reference exception applies.

| Task branch                                | Research treatment                                                                                                          | How the workflow uses existing work                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New design from an open brief              | Required                                                                                                                    | Research informs several composition drafts and their selection.                                                                                                    |
| Specified template or exact reconstruction | Only the exception above permits no additional research                                                                     | An inspected, user-prescribed reference serves as the selected composition; build the needed editable elements without generating unrelated alternative directions. |
| Bounded edit to an existing artwork        | The same exception applies when the user explicitly fixes the existing design as the target and requires no new inspiration | Use the current artwork as the composition and layer baseline; change affected elements and review the resulting whole.                                             |

Task labels alone do not grant exemptions. Using an existing, user-prescribed
result to fulfill a stage is an explicit branch action, not discretionary stage
omission. Do not regenerate every layer merely to demonstrate workflow activity.

### Proposed main Skill workflow

Preparation establishes the authoring directory, supplied inputs, task branch and
actually available capabilities. Read the format reference before writing and
the image Skill before image calls. Choose relevant techniques without requiring
new global dependencies or asking the user to approve every stage.

| Stage                        | Required action and observable result                                                                                                                                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Understand intent         | Establish purpose, canvas, exact copy, supplied assets and design constraints; distinguish verified facts from assumptions.                                                                                                                                                                                                |
| 2. Reference and research    | Inspect supplied references, evaluate the explicit exception, otherwise inspect relevant design-site visuals. Briefly connect sources and observed layout, typography or color choices to the design direction; search snippets alone do not constitute visual research.                                                   |
| 3. Select a composition      | For open briefs, generate and inspect differentiated full drafts and explain the choice. For the specified-target branches, inspect and adopt the prescribed composition. Do not invent a fixed draft count.                                                                                                               |
| 4. Prepare complete layers   | Regenerate needed raster objects including hidden portions, and inspect their integrity. Check real alpha for foreground objects that need transparent isolation; backgrounds can remain opaque as the design requires. Keep reusable delivery assets, native shapes and unaffected existing layers according to the task. |
| 5. Recompose the artwork     | Assemble editable `design.yaml`; keep its referenced assets complete and within supported admission limits. Use actual geometry and image bounds.                                                                                                                                                                          |
| 6. Check text representation | Choose native text, vector or raster deliberately. Register the actual custom-font source and descriptors and verify it in the native renderer; demonstrate key fonts on the first renderable draft before investing in detailed typography.                                                                               |
| 7. Review and adjust         | Render the current version through Bento and actually read the returned image. Check composition, occlusion, edges and readability; correct and render again after visual changes. An external approximation is supplementary evidence.                                                                                    |
| 8. Check consistency         | Compare current output with user copy, assets, reference constraints and intent. Corrections return to the affected stage and require another current native preview.                                                                                                                                                      |
| 9. Polish and report         | Review the final version and accurately identify completed checks, unresolved deviations and any blocked work. Claim saved-artwork success only when supported by an observed application receipt.                                                                                                                         |

No additional research ledger, stage state, proof storage or phase-by-phase user
approval is proposed. Existing tool results and a concise account of the design
basis are enough to make behavior inspectable; this does not guarantee quality.

### Reference ownership

| Existing file                          | Role after the rewrite                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graphic-design/SKILL.md`              | Sole owner of workflow order, branch predicates, research exception and completion claims.                                                                          |
| `references/layered-workflow.md`       | Draft comparison, complete-object regeneration, alpha inspection, recomposition and correction techniques; remove its parallel workflow and broad order discretion. |
| `references/browser-research.md`       | How to inspect design sites, extract useful observations and handle inaccessible references; point to the entry for when research is required.                      |
| `references/general-poster.md`         | Poster composition, hierarchy and factual-copy judgment, without a competing research trigger.                                                                      |
| `references/replication.md`            | Reference measurement, native-element reconstruction and fidelity checks; inherit entry branch conditions.                                                          |
| `references/artwork-format.md`         | Minimal complete schema/font examples, supported asset requirements and the actual meanings of validation, preview and finalization.                                |
| `imagegen/SKILL.md` and its references | Image API, transparency, sources/masks, prompting and paid-call uncertainty; do not redefine the design workflow.                                                   |

Keep existing paths and load pointers next to the step that needs them. Rewriting
the entry as a mere index would hide the required actions; repeating the full
workflow in each reference would preserve the current ambiguity.

### Validation and runtime prerequisites

The rewrite cannot fix a concealed runtime failure by adding stronger prose.
Align the existing authoring check, preview and final collection around shared
asset-admission checks, and expose safe categories for built-in asset-size,
asset-format, font-load and rendering failures. Include a validated relative
asset path and actual/allowed size for known size failures, without forwarding
arbitrary external error text. Unchanged inputs plus another call are not a
repair. Provide complete font-registration examples so the Agent need not search
the bundled implementation to learn the authoring format.

An isolated feasibility check compressed the two complete TTF fonts to WOFF:
20,752,628 → 13,242,276 bytes and 20,856,816 → 13,678,720 bytes. Both retained all
43,033 glyphs, glyph order, character maps and horizontal/vertical metrics, and
loaded in Electron 39.5.1 without font diagnostics. This supports an explicit
recovery option without increasing the limit or dropping glyphs; it is not a
full Bento render test. No artwork was changed. Do not add silent font conversion,
automatic substitution or a new mandatory Python dependency.

Separate three claims: authoring files and asset checks are ready; the current
version has been natively rendered and inspected; the application has saved the
artwork and the user has verified editing/reopen/export. The Agent can establish
the first two during its run. Final collection occurs after the model finishes,
so the Skill cannot require waiting for that same turn's save receipt before
ending. It must not anticipate a successful commit. A normal turn ending with
an honest limitation can still be collected under existing schema/asset/version
rules; reporting incomplete visual review does not itself prevent saving. Do not
add an application creative gate or restart a completed turn to close this gap.

### Implementation and verification order

1. Repair shared asset checks and safe diagnostics, and validate the existing
   failed draft using explicit, fidelity-preserving font recovery. Keep the
   original draft and font files available; no new image call is needed for this
   diagnosis.
2. Rewrite the main Skill and redistribute reference guidance as above; update
   affected package rules and materialization checks with the implementation.
   Stage complete material together so installed copies cannot retain conflicting
   research or order language.
3. Use deterministic fixtures to check asset-limit feedback, font/render error
   categories and packaged Skill contents. These checks prove the surfaces, not
   that a real Agent follows prose. Do not install runtime creative enforcement
   merely to make a behavioral test pass.
4. In real acceptance, cover an open brief, a prescribed template with no new
   inspiration, a reference that still asks for a new composition, and a bounded
   edit preserving the prescribed artwork. Check actual research where required,
   current native previews, honest failures and the application's save receipt;
   finish with human edit/save/reopen/export. Observe explicit user budgets and
   native tool-error behavior; add no automatic paid retry.

Only the proposal and task Spec are updated in this planning pass. Formal Skill
files, runtime behavior and user artwork are unchanged by this pass; no new model
or image request was made.

## Workflow rewrite approval (2026-09-26)

The owner accepted the revised plan in the current review conversation and then
explicitly authorized implementation. Approval covers the required Skill
workflow and strict research exception, shared asset admission and safe error
feedback, explicit recovery of the failed artwork, checks, and restarting Molly
for a user-initiated test. It does not establish behavioral or visual acceptance.
The task Spec links this approval for the revised intent; the earlier approval
remains a historical record.

## Approved rewrite implementation and recovery (2026-09-26)

- **Skill ownership.** The main entry now contains the nine required stages,
  explicit task branches, research exception and completion reporting. Technique
  references point back to that policy, and `imagegen` owns only image operations.
  The package rules, README and actual materialization tests agree. A complete
  custom-font example includes source, family, weight, style and text use.
- **Shared admission.** `asset-admission.ts` owns the existing 16 MiB cap and MIME
  sniffing. YAML validation, preview, final intake and canonical storage use it;
  optional `finalize` therefore catches the oversized fonts before returning
  success. Diagnostics retain the source path, actual bytes and limit. Unused
  media is not a referenced asset; full-tree collection and digest limits remain
  unchanged. No image or font conversion is automatic.
- **Safe errors.** Asset failures travel as a strict optional local RPC field
  and private MCP metadata. Only the built-in preview tool may expose the fixed
  category, bounded single-file `media/` path and validated size/type fields.
  The producer formats these fields rather than forwarding arbitrary diagnostic
  text. Unknown, external, malformed and transport failures stay redacted; font
  and native-render categories retain their previous behavior.
- **Reproduction and regression.** Before the fix, the real helper returned
  success for a synthetic oversized font. After the fix, the preserved real
  draft returns two `MOLLY-E005` errors naming its 20,856,816- and
  20,752,628-byte fonts and the 16,777,216-byte limit. Production
  `buildPreviewPayload` also refuses that draft with the typed failure. Three
  separate regressions first demonstrated a generic harness error, a dropped
  daemon field and raw producer diagnostic text; each passed after repair.
- **Explicit artwork recovery.** The application was exited normally. Complete
  WOFF copies are 13,678,880 and 13,242,140 bytes, with all decompressed font
  tables byte-identical to the original TTF tables, including all 43,033 glyphs
  per font. Only the two source references changed; the 14 elements, geometry,
  copy, original fonts and other media remain intact. Existing design history
  preserved the prior empty canonical as v1 and the restored artwork as v2,
  using ordinary save/CAS and readback. A stale revision after version creation
  was correctly refused; re-reading the unchanged content supplied the current
  baseline. Historical failed-turn receipts were not rewritten.
- **Native evidence.** Production `renderSavedDesign` rendered the recovery
  payload as 1080 × 1350 PNG and JPEG without font diagnostics; the PNG was
  inspected. Production `buildPreviewPayload` accepts the repaired draft and
  produces exactly the saved document/assets. Both shipped-helper entry points
  pass against the repaired draft after rebuilding the helper library. This
  proves recovery and native renderability, not human visual acceptance.

Focused checks passed: 150 authoring tests, 69 CLI design tests, 47 harness MCP
tests, 33 CLI render/daemon integration tests and 13 materialization tests, plus
the affected package typechecks. The exact-limit case remains accepted, one byte
over is refused without changing canonical, unused media is ignored for asset
admission, and large full-tree digests retain their prior behavior. Full
`pnpm check`, `pnpm format` and `pnpm run docs check` passed. Molly was rebuilt
and restarted with `pnpm start:local`; the seven staged Skill documents match
their source files byte-for-byte. The actual desktop canvas displays the recovered
v2 artwork without the font-error banner, with Export available and the autosaved
state visible. A fresh Agent run and manual editing/export acceptance remain for
the user. No new model or image-generation request was made for this implementation
or recovery.

## Fifth acceptance run and follow-up proposal (2026-09-26)

This section records findings and a proposed solution, not implementation approval.
The run lasted about 31 minutes 53 seconds: five successful image calls, two
successful native previews followed by image reads, and a committed artwork with
14 elements and five assets. The journal and daemon agree on 57 approvals: 55
automatic and two human, with about 7 minutes 44 seconds of human waiting. The
Pinterest login overlay is distinct from those two permission requests; a third
Molly permission request has not been established. Captured records remain outside
the repository.

The owner reports having configured Pinterest. The settings screenshot shows three
site cookies, but `getAccountSummary` counts site cookies without establishing
authentication. Settings, import and Agent pages select the same browser partition.
The current development process uses the memory-only partition; whether the prior
configuration was in that process, survived a restart, or was made in a signed
package remains unconfirmed. Treat this as configured account-state reuse failing
in the test, not as proof that the owner omitted setup. The existing
[browser account design](../../proposed/architecture/2026-09-22-embedded-browser-account-import.zh.md)
and [release scope](../../implemented/feature/2026-09-23-pinterest-browser-release.zh.md)
own that boundary.

Proposed work, in implementation order:

1. **Approval and diagnostic evidence.** Add bounded, optional classifier outcome
   metadata to the existing journal, separating deny, timeout, invalid response
   and execution failure from the eventual human decision. Do not store raw model
   rationale, command arguments or cookies. Preserve old journal readability.
   Change sandbox feedback to retain the command's original failure and describe
   accompanying denied operations without asserting causality or automatically
   recommending outside-sandbox execution. Reproduce the observed invalid helper
   argument plus incidental `sysctl` denial, alongside a real write denial.
2. **First browser authorization.** Review the bounded site-research grant in
   auto-review instead of falling directly through to a user prompt. Update the
   classifier's existing subject/context to recognize task-relevant browsing;
   reuse the existing run/epoch/site grant and host checks after allowance, rather
   than add a grant store or trust a browser-like tool name. Review new sites;
   retain prompt fallback on deny/failure and explicit authorization for account
   changes, publishing and purchases. Test both worker authorization and host
   enforcement, including stale runs, cross-site navigation and revocation.
3. **Configured Pinterest account.** Establish the source build/profile, successful
   import or manual sign-in, restart sequence and destination page identity without
   exposing cookie values. If the cause is a development restart or build mismatch,
   use the existing stable-signed package flow for account-persistence acceptance;
   retain memory-only development and encryption/signing checks. If the problem
   reproduces in a supported signed build, fix the evidenced import, cookie identity,
   expiry or destination-session defect before accepting the result. Clarify the
   existing settings presentation: cookie count, import result and observed website
   authentication are distinct; keep the memory-only warning beside the relevant
   account information. Do not invent a persistent authentication verdict from a
   cookie count. Verify manual browsing, Agent browsing and a cold restart using
   the same supported build.
4. **Reusable font preparation.** Add a small optional Skill helper around a tested
   FontTools environment in the session workspace outside the collected artwork
   tree, or in the supplied temporary directory.
   Reuse a working environment; otherwise explicitly prepare pinned dependencies
   there, with cache/bytecode output kept inside the sandbox. Require an available
   compatible interpreter; do not silently install a global Python runtime. The
   helper lists TTC faces, extracts a selected face and makes a complete WOFF copy
   while reporting size, family/weight/style and glyph coverage. Preserve source
   fonts and verify the decompressed tables, character map and metrics. Prefer a
   compatible complete font under 16 MiB; current-copy-only subsetting is not the
   default for editable text. Any explicitly requested subset carries its edit
   limitation. Keep conversion Agent-invoked, not automatic intake repair.
5. **Skill repair and delivery language.** Keep the nine stages. Place dependency
   preparation beside the preparation step and full-font guidance beside text
   handling. Browser research must retain reference URLs and concrete visual
   observations; recover a page/reference error by observing the actual page and
   report failed configured login accurately. Use accessible visual sources when
   possible, and request user sign-in only when that specific authenticated source
   is needed. Distinguish partial research from verified details. Native previews
   read by an Agent are Agent review, while human acceptance requires an actual
   human observation. Link existing field lookup and helper usage instead of
   encouraging bundled-library searches or another workflow definition.

Acceptance starts with deterministic regressions, then a stable-signed account
round trip and the real font helper inside the production sandbox. A fresh design
run uses the same ordinary brief and auto-review: expected in-scope browsing and
font preparation should need no human permission prompt, while real boundary
escalations remain explicit and diagnosable. Verify sources, native preview/image
reading and the post-turn save receipt. On a disposable copy, add text absent from
the original copy but present in the complete source font, edit a lower layer,
save, reopen and export; verify the embedded font rather than accepting an
unnoticed system fallback. Paid design validation is limited to five image calls
unless the owner authorizes more. No new run or paid request was made for this
proposal. Replacing the sandbox library, broadening global write access, adding a
creative-stage controller and automatically modifying the existing artwork are
outside this proposal. Existing artwork font recovery is a separate explicit
operation through normal version/CAS handling.

## Verification limits

The evidence now includes five real design runs. Run 5 establishes research,
native preview with Agent image reading and application save after the workflow
rewrite. Human editing/save/reopen/export acceptance and visual quality remain
unverified, and the configured Pinterest account failure still needs its build
and restart history confirmed. The fourth run's failed artwork was separately
recovered; that recovery does not establish the fifth run's text-edit coverage.
The follow-up above remains a proposal. Earlier image experiments used proxies rather than OpenAI's
own endpoint; Qwen and Seedream integration is still outside this task. Local
run records and experiment files remain outside the repository; only aggregate
findings are recorded here, so they cannot all be reproduced from repository
files alone.

PR: [#17](https://github.com/LeonEthan/molly-design/pull/17) (Spec and this record).

## Sixth-round implementation (2026-09-26)

The owner explicitly requested “开始修复本轮问题” after approving the follow-up
scope and checking local signing availability. This authorizes implementation
and a local signed test package; it does not publish a release, commit changes,
or attest acceptance of the newly edited Spec text. The Spec revision returns to
draft while the earlier approved revision remains linked.

The first public browser site now uses the existing auto-review classifier and
in-memory run/epoch grant (eight-site cap), with journal-before-grant and stale
scope checks. Ask mode and external MCP approvals remain unchanged. Browser host
URL/DNS/dispatch protections remain authoritative; research grants do not express
purchase, publication or account-change intent. No second grant store was added.
The curated reviewer explains ordinary design research, with an updated source
hash. Classifier records add an optional bounded outcome, keeping old journals
readable and excluding raw rationale, provider errors and arguments. Incidental
sandbox denials no longer overwrite the interpretation of a command's own error.

The optional font helper explicitly prepares pinned FontTools 4.60.2 in an isolated
Python environment, then lists faces and compresses a full face to WOFF. It checks
tables, glyph mappings/order, horizontal metrics and the existing 16 MiB limit,
preserves source files, and refuses overwrites. It is an Agent-invoked method, not
an intake repair, runtime dependency, creative gate or automatic installation.
The Skill keeps the nine-stage workflow and adds local guidance for font coverage,
helper usage, login obstruction, actual reference URLs and Agent-versus-human
review. Existing artwork is not silently rewritten.

The account screenshot establishes that the tested development build uses memory
sessions and disables Chrome import. It does not establish a cookie-import or
partition defect. The same existing account/Agent partition path is retained;
settings now labels cookie counts as unverified sign-in and places the temporary
session warning beside each site. A stable signed package is the appropriate test
surface. Local Apple Development signing is available; public distribution and
notarization are separate, unclaimed checks.

Executed preliminary verification: 42 focused harness tests and 155 authoring
tests passed. A production WorkerSandbox probe successfully created the isolated
font environment and converted the system Songti SC Regular face without an
outside-sandbox request: 43,033 glyphs, 32,965 character mappings, 13,678,880-byte
WOFF, exact table preservation except the calculated head checksum. Full checks,
native font rendering and signed-package account acceptance are recorded below
when completed. No paid image or model calls were used for these checks.

The completed full `pnpm check` passed type checks, lint, repository tests,
i18n and platform/public boundaries (the CLI suite retains its three pre-existing
skips). `pnpm format`, `pnpm run docs check`, `git diff --check` and `pnpm build`
also passed. A separate synthetic native Bento probe rendered PNG and JPEG with
new Chinese copy including characters absent from run 5, with no font diagnostics;
the resulting PNG was inspected. No user's artwork was changed for this probe.
The staged entry Skill, font helper, font guide and browser guide match source
bytes. Signed-package verification and account limitations follow below.

Local packaging completed through `package-electron.mjs` with development signing,
`forceCodeSigning=true`, notarization disabled and publishing set to never. The
output is the ignored `apps/electron/dist/round6-signed-20260926/mac-arm64/Molly.app`.
`codesign --verify --deep --strict` passed, with a stable Apple Development authority
and team. The delivered executable's encrypted-cookie fuse is enabled; packaged
Chrome reader, Playwright MCP/transport, Bento resources, image decoder, sealed Pi
closure and embedded CLI/native-binding probes passed. The four changed Skill
materials match source bytes inside the delivered app. Its asar SHA-256 is
`57d9e91b4168f364273543fb8eb5bced9fbb842403d6725fba2494afff061623`.

The development app was exited through normal Quit after observing completed
Agent work and autosaved canvases; its owned main/CLI processes exited. The signed
package now runs against the same local workspace, with its daemon showing Running.
The real Website accounts screen shows the Chrome profile selector and enabled
Import from Chrome button; the development-only memory/import warnings are gone,
and the new unverified-cookie copy is visible. Pinterest has zero stored cookies
in this persistent profile. The app is left on that screen for the owner's explicit
import and manual test. No Chrome cookie values were read and no account import,
website authentication or authenticated cold-restart acceptance is claimed for this
build. Prior signed-package account evidence remains historical. No commit, push,
publication or paid model/image call occurred in this round.

## Sixth acceptance review (2026-09-26)

The owner reported completion without observed problems and requested review.
The latest design run completed in approximately 25m49s: all 45 provider requests
succeeded; all 65 approval records allowed automatically (25 sandbox, 24 workspace,
9 design-tool, 6 task-browser and 1 classifier), with no human prompt. Seven image
tool results succeeded (three drafts and four edits); both native previews succeeded
and were subsequently opened with image reading. The Pinterest screenshot visibly
shows an authenticated account and unobscured search results. A separate preceding
browser test also completed with four automatic approvals and no manual prompt.

The saved BentoDoc contains 15 elements and seven assets. Independent inspection
of its embedded font bytes confirmed their content digests, complete Songti Regular
and Bold coverage (43,033 glyphs / 32,965 mappings each), and Hiragino W3 coverage
(29,352 glyphs / 29,318 mappings). All include plausible future copy “快乐新年”.
The Agent used the isolated font helper inside the sandbox. One incorrect relative
path in an alpha-check command produced ENOENT, then the Agent corrected it without
an outside-sandbox escalation. The final native preview was also inspected during
this review; no font/render blocker was observed.

Standards/security and Spec reviews of the current uncommitted fixes found no
confirmed P0/P1. This is source and recorded-execution evidence, not another paid
model run. No runtime code or user artwork was changed. Authenticated cold restart
and the complete human edit/save/reopen/export sequence remain outside what these
records establish; the owner's general report is not expanded into specific checks
they did not identify. Raw account screenshots and transcripts remain outside the
repository. The current Spec remains draft pending review of its revised text.


### Acceptance clarification and browser blocker (2026-09-26)

The owner subsequently explicitly confirmed completing manual text editing, save,
reopen and export. That sequence is now user-reported passed. The authenticated
cold-restart check was blocked by native Browser flicker and address-draft loss;
see the separate [browser stability fix](../../implemented/bug-fix/2026-09-26-public-browser-render-stability.md).


## Closeout approval 2026-09-26

After the remaining work was explicitly listed as Git submission, acceptance-record
consolidation and approval of the current generative-layered-design Spec revision,
the owner instructed completion of all three. This is the human approval reference
for that Spec's current English and Chinese revision. It approves the intended
workflow and boundaries; passing tests alone did not confer approval. The broader
embedded-Pi Spec retains its separate review status.

| Acceptance item | Final evidence |
| --- | --- |
| Agent workflow and permissions | Latest complete run: research, layered authoring, two inspected native previews and saved artwork; 65 automatic approvals, zero human prompts. |
| Editable fonts and saved assets | Saved document and full embedded glyph coverage checked; isolated font helper used inside the sandbox. |
| Human editing, save, reopen and export | Explicitly confirmed completed by the owner. |
| Browser stability and address editing | Two reproduced regressions fixed; eleven focused tests and signed-app keyboard/navigation/tab-switch checks passed. |
| Pinterest persistence | Normal quit and signed-app restart retained authenticated browsing without re-import or sign-in. |
| Engineering checks | Full `pnpm check`, `pnpm format`, documentation checks, build, packaged resource/runtime probes and strict signature verification passed. |

No known development or mandatory test blocker remains in this scope. The browser
fix was validated without another paid design run. CPU readings are snapshots, not
a stress benchmark. Public distribution, notarization, other providers and the
separately scoped follow-ups remain outside this acceptance. Git commits record the
closeout locally; no push, PR publication or Issue state change is authorized here.
