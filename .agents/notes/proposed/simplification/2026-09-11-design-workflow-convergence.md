# Design workflow convergence and implementation boundaries

Status: proposed
Translation: current

[中文](2026-09-11-design-workflow-convergence.zh.md)

## Abstract

The overall scope review found that Bento's editing capabilities exceed the current
PPTD expression range, that special regeneration candidate rules lack explicit input
basis, and that candidate approval conflicts with the goal of letting Agents handle file
conflicts themselves. The user confirmed keeping necessary format adaptation to preserve
editing power, unifying modification and regeneration into the same commit, letting
Agents resolve conflicts through their file-tool loop, importing external files directly
after preview, and requiring a user-supplied model for the built-in image MCP generate/edit.
During execution only watch the live result; after submission continue editing from the
current artwork. These decisions reduce product process, but conversion, actual tool
wiring, and final submission protection still need verification. This record writes the
confirmed direction back into documents and breaks out implementation; runtime code has not
been changed, and the record remains proposed.

## Confirmed decisions

This record supplements the [scope review](2026-09-11-design-result-feedback.zh.md),
replacing its goal of building a minimal candidate UI; it also revises the boundaries of
[sync](../../rejected/architecture/2026-09-10-design-sync-hooks.zh.md),
[preview](../../implemented/architecture/2026-09-11-pptd-live-preview.zh.md), and
[serial editing](../../implemented/architecture/2026-09-11-design-serial-editing.zh.md).
The product contract is expressed by [Spec](../../../../specs/graphic-design-platform.zh.md);
the delivery breakdown is in the [main plan](../../implemented/architecture/2026-09-09-graphic-design-platform.zh.md#下一步实施切片2026-09-11).
The scope is confirmed; implementation evidence and release acceptance are still
incomplete; do not automatically mark the whole Spec as approved.

| Decision | Final behavior | Cost / reduction |
| --- | --- | --- |
| Bento ↔ PPTD roundtrip | First list the full gap, then do minimal format and bidirectional conversion adaptation for the existing editing capabilities in the first phase. | Not "just write a serializer"; do not drop fields, rasterize, or block normal manual operations in the next turn to deliver. |
| Regeneration | Use the same structure/version-check/auto-commit flow as ordinary modifications. | Delete special submission mode; do not parse prompts to decide candidacy. |
| In-execution interaction | Watch read-only creation progress in the same canvas area; after completion reference the current artwork to continue editing. | No new temporary-preview element reference / edit context; Bento still only takes a generic read-only state. |
| File conflict | Return conflict via tool/hook; Agent re-reads, compares, modifies, and retries. | App only does data protection; no semantic merge, human candidate picking, or automatic rerun. |
| Image capability | Built-in MCP provides generate and edit, sharing existing connection and asset save. | Required user model; delete product default; add edit interface; no new image job, model router, or mask editor. |
| External file import | After preview, explicitly import; validate the viewed snapshot and atomically save as current artwork. | Delete the "create candidate → adopt/reject" intermediate layer; still protect unsaved changes and original artwork. |

## Facts and design corrections

### Reverse conversion must close the existing expression gap

Bento's [group control](../../../../packages/design-bento/vendor/packages/editor-bento/src/ui/dom/transform.ts)
writes `groupId`, while the [frozen capability matrix](../../../../packages/design-bento/vendor/packages/contracts/capability-matrix/v1.json)
records that PPTD v2 has no group field. The [shadow control](../../../../packages/design-bento/vendor/packages/editor-bento/src/ui/dom/style.ts)
allows multi-layer shadows, but the [PPTD validator](../../../../packages/design-authoring/src/validate.ts)
and importer (`06aa8ba:packages/design-authoring/src/import.ts`) only handle a single
shadow object.

Therefore P3.1a first delivers the field/asset gap table for the currently visible editing
capabilities, then adapts format version, validation, import/export, capability matrix, and
source patches together. Group and multi-layer shadow are just examples found; they do not
pretend to be a complete gap list. No new editing capability is introduced for this; old
documents continue to be read by the declared version, unknown versions are rejected, and
the matrix is not changed to claim support. Maintain provenance under the existing
vendor/patch/source-manifest rules.

### Conflicts use Agent tool feedback, not a unified merge service

The [Lody ACP file entry](../../../../apps/cli/src/agent/agent-client.ts) reads old bytes
for diff and then executes `fs.writeFile`; there is no universal CAS or semantic merge
service. [Kimi Edit](../../../../packages/acp-extension-kimi/packages/agent-core/src/tools/builtin/file/edit.ts)
returns an error when `old_string` does not match and asks for a re-read. This proves that
the reusable paradigm is tool error returned to the Agent for it to continue; it does not
prove that all Write/Shell paths already have equal protection.

| Timing | Handling contract |
| --- | --- |
| Read/write conflict during Agent execution | Return reason, latest projection, and draft location; Agent uses existing file tools to re-read and handle; the normal tool loop can continue. |
| Retry after re-read | Associate the explicit attempt with a new read baseline and exact content; do not rewrite the frozen original input, and do not automatically let already-generated old write arguments pass. |
| Submit conflict after the turn | Current artwork unchanged; working files and diagnostics persist; provided to the Agent on the next explicit user continuation; do not reactivate the ended turn. |
| Ambiguous intent | Agent clarifies design trade-offs with the user; app does not choose visual results itself. |

The existing [session-execution-service](../../../../apps/cli/src/session/session-execution-service.ts)
collects design after the Agent prompt returns; [turn-outcome](../../../../apps/cli/src/design/turn-outcome.ts)
turns version conflicts into candidates. Thus the new goal is not a description of the
current state: P3.1/P3.3 must add tool-visible errors and draft continuation paths, then
stop producing new candidates. The final atomic version check remains; in-turn hooks cannot
replace it; do not add a forced finalize/submit tool step to pretend all final conflicts
can be resolved in the same turn.

Content may need explicit resubmission even when unchanged. For example, after a previous
submission conflict, the Agent re-reads and confirms the draft still applies; it must not
be forced to change meaningless bytes just to bypass digest deduplication. P3 should
distinguish legacy files that no one resubmitted from an active new attempt bound to a new
read baseline and exact content; the latter still validates and atomically saves. The
specific carrier is the verifiable operation fact from the planned hooks or a minimal
explicit operation, to be determined in the first end-to-end slice; mere re-read,
mtime/event change, or same-byte rewrite cannot automatically wash away the old baseline.
Ordinary unchanged old files remain `no_artifact`; do not restore #2b auto-promotion.

### Candidate product retires; existing data stays reachable

Regeneration no longer creates special candidates, conflicts are no longer picked by
humans, and external imports no longer create candidates first. Therefore P3.0/P3.3 no
longer build a minimal candidate panel, pending list, or adopt/reject flow. Submission
receipts, old outcomes, and necessary content/asset readback remain readable; historical
`candidate` states record the facts of that time and are not rewritten to the new rule.

Before retirement, check that existing candidate content and assets are reachable through
controlled file paths for the Agent, or through the same preview/explicit-import path.
Reuse existing readback and storage; do not require bulk conversion of historical data, do
not delete old directories, and do not keep creating candidates in the name of backward
compatibility. The original artwork, draft, and import staging snapshot each have their
necessary lifecycle, but they do not constitute an artwork version library. P1's manual
save copy escape hatch remains temporarily; do not override it with "the Agent will handle
it."

External import performs structural checks, pre-save flush, atomic version validation, and
existing idempotency semantics on the document and assets the user actually saw. If the
content has changed and the original snapshot can no longer be used, re-present it and let
the user explicitly import again. A single explicit import is the operation intent; do not
fabricate an Agent read fact. On failure keep the original artwork and unsaved changes;
handle via ordinary file diagnostics.

### Image MCP: add edit, remove default model

Current [image-generation](../../../../apps/cli/src/mcp/image-generation.ts) only has text
generation requests, and [image-connection](../../../../packages/shared/src/image-connection.ts)
still defines a product default model; both need correction and cannot be written as merely
connecting a selection. The [source manifest](../../../../packages/design-authoring/source-manifest.json)
and [README](../../../../packages/design-authoring/README.md) are available for migration
traceability; the upstream `skills/imagegen/scripts/image_gen.py` already has edit paths for
original image and mask; when wiring, check its actual interface and do not copy the whole
Python runtime environment.

Wiring follows the [OpenAI Images API](https://developers.openai.com/api/docs/guides/image-generation):
generate uses `generations`; edit uses `edits`, carrying prompt, original/reference image,
and optional mask. Reuse user URL, key, required model, permissions, and workspace asset
save; do not set recommended models, alias mapping, or silent fallback. Parameters and
multipart/file transport must adapt to the actual interface; do not claim the existing
JSON-only transport already supports edit. Tool results first become files; the Agent
decides document modifications. When a user-configured service does not support a
capability, return a clear error; do not automatically turn edit into text-to-image or
retry paid calls. Mask expresses local-edit intent; it does not promise unchanged pixels
outside the mask.

Settings, config normalization, MCP schema/description, skills, materialization, error
handling, and corresponding acceptance are updated together. Keep already-saved model
values; do not rewrite user config; blank new config or empty model no longer backfills a
default. Generative editing is independent of attachments / Agent image reading / Bento
manual cropping.

## Implementation order and verification limits

The main plan keeps the Pn.x numbering and changes deliverables: P3.0 retires cards/
thumbnails and old-file promotion; P3.1 fills conversion, paths, hooks; P3.2 splits image
MCP completion from selection wiring; P3.3/P3.4 change to conflict continuation and old-data
reachability; P3.7 completes live preview and direct import. P2-A3 continues to reuse the
attachment chain independently and is not absorbed into image operations.

The first P3.1 slice must check `getDefaultSessionWorkdir` against the actual Lody local
project cwd: projection, draft, assets, MCP, preview, and collection must resolve to the
same artwork entry. Existing canonical isolation is by artwork identity; this path check
does not prove cross-artwork coverage, nor does it authorize building a new directory
management product.

This review modifies design documents after source inspection; no product tests, builds,
real Agents, image requests, or file watches were run. Release platforms, the five agents,
and format roundtrip acceptance are recorded by actual verification. Documentation checks
do not prove the runtime already satisfies the new contract; English translation is pending;
there is no product-scope question that requires user input to break down.

Documentation verification: `corepack pnpm run docs status` / `docs check` reported no
errors, 21 pre-existing rule-file size warnings, no registered SHA topic;
`check:public-boundary` (4554 files, 24 manifests) and `git diff --check` passed. Root
AGENTS.md remained under 8 KiB; P0–P2 historical records matched the byte count at the
start of this round. No product tests, typechecks, or builds were run because this round
made no runtime code changes; no commit was made.
