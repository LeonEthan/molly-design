# On-demand sync of current artwork with Agent tool hooks

Status: rejected
Translation: current

[中文](2026-09-10-design-sync-hooks.zh.md)

## Abstract

After human editing, BentoDoc must become the latest design context readable by the Agent,
otherwise the next turn may overwrite user changes based on an old PPTD. This approach lets
the Agent's read operation request a design-service PPTD sync through a hook; the canvas
only provides a generic snapshot/save capability, while writes and final commits check the
read baseline and current version. It supplements Lody's existing file workflow without
introducing a new Agent scheduler or prescribing creative steps. Reverse conversion and
actual hook wiring for the five Agents remain to be verified; when hook coverage is
incomplete, canonical commit checks still protect the current artwork.

## Decision scope and sources

2026-09-12 final ruling: the user confirmed [editor autosave updates PPTD](../../implemented/simplification/2026-09-12-editor-owned-pptd-save.zh.md)
and asked to keep a [read-before-edit reminder hook](../../proposed/simplification/2026-09-12-noninvasive-design-hooks.zh.md).
The rest of this record preserves the old read-driven sync and strict baseline plan; it has
been partially superseded by the new goal and no longer requires runtime patches or
per-sampling generation proofs. The migration converges old dependencies of write and final
collection, keeping structure, assets, provenance, version checks, and drafts. The new rules
are governed by the [Spec](../../../../specs/graphic-design-platform.zh.md); existing
implementations or failure records are not automatically rewritten as the new contract
having passed.

This record supplements and partially replaces the not-yet-implemented P3 in the
[migration plan](../../implemented/architecture/2026-09-09-graphic-design-platform.zh.md): it
adds current-artwork read consistency and removes the migration requirement for full
three-way comparison and automatic element/attribute merging. P0–P2 implementation facts are
not rewritten; the product contract is in the
[Spec](../../../../specs/graphic-design-platform.zh.md). Only documents were edited; the
syncer, hooks, and runtime skill were not implemented.

The existing PPTD importer (`06aa8ba:packages/design-authoring/src/import.ts`) provides
forward conversion; that does not mean reverse conversion already exists. The adjacent
project's `packages/orchestration/src/job-context.ts` can construct a Bento context, which is
also not the same as having BentoDoc → PPTD. Adding reverse conversion is the necessary cost
to ensure the Agent can read manual editing results; Lody session, file, tool, permission,
and recovery capabilities continue to be reused.

## Supplement on file-change preview (2026-09-11)

The [live preview decision](../../implemented/architecture/2026-09-11-pptd-live-preview.zh.md)
adds an independent file-change → PPTD forward conversion → read-only preview path,
coexisting with this record's on-demand reverse sync. File watching starts/stops by actual
consumer, reusing existing forward intake and Bento rendering, independent of the five
Agents' Write hooks, and without committing the current artwork or rewriting the read
baseline.

The two paths are separated by source: the read hook's input is always the current artwork
(read-only during Agent execution and artifact processing), and its output is an
application-generated PPTD projection; live preview's input is Agent/external editing drafts,
and its output is an uncommitted read-only view. Projection and preview caches do not enter
creation listening or artifact collection, and switching to preview does not change the read
target. Preview does not prove creation completion; at turn end collection is rerun with
formal validation and version checks. No import happens during execution/processing; after
completion a safe commit directly becomes the current artwork, conflicts go to the Agent,
and external files are explicitly imported after preview, per the new record.

## Serial-editing revision

The [serial-editing decision](../../implemented/architecture/2026-09-11-design-serial-editing.zh.md)
replaces the earlier normal flow of "read, then allow continued manual editing": before
dispatch, save manual edits; during Agent execution and collection/commit, the owning canvas
is read-only. On-demand sync is still triggered by the read hook, providing the latest saved
manual result before execution; read-only does not mean PPTD is automatically updated. Final
version validation continues to protect against external changes and stale requests.

## Responsibilities and read process

| Participant | Responsibility |
| --- | --- |
| Bento canvas | Independent editing, rendering, saving; provides generic snapshot/flush and read-only capability; does not perceive Agent lifecycle |
| Design service | Consistent snapshot, bidirectional conversion, assets, read baseline, atomic save, and tool-visible conflicts; keeps working files |
| Lody runtime and adapter | Existing launch, session, tool events, and permission chain; thin hook/extension adapter |
| Agent | Autonomous read, investigation, modify, self-check, and completion; after receiving conflict, re-read files and handle diffs itself |

Conceptual sequence (P3 target, not current implementation):

```mermaid
sequenceDiagram
  participant A as Agent tool call
  participant H as Adapter hook
  participant S as Design service
  participant C as Independent canvas
  participant W as Workspace files
  A->>H: Read current design
  H->>S: Request latest consistent snapshot
  S->>C: Generic snapshot/flush
  C-->>S: Completed edit/save state
  S->>W: Same-version PPTD projection and assets
  H-->>A: Allow reading corresponding projection
  A->>W: Read file
  A->>H: Tool successfully returns corresponding content
  H->>S: Record artwork, draft, and read version
  A->>H: Modify creation draft
  H->>S: Check read baseline
  alt Baseline valid
    H-->>A: Allow
    A->>W: Write draft
  else Baseline expired
    H-->>A: Conflict reason and latest file location
    Note over A,W: Agent re-reads and handles diffs itself, explicitly starting a new attempt
  end
  Note over S,W: Post-turn uses existing collection; final commit checks version again under lock
```

Before dispatch, use a generic flush to confirm all completed manual edits and pending
saves, then freeze the current artwork version and start the Agent; the read hook obtains a
consistent snapshot of that artwork. If saving, stable snapshot, or conversion fails, return
an error; do not treat old files as latest information. Cross-file publishing guarantees
PPTD and assets are at the same version. Manual changes during normal model execution are
forbidden; abnormal external changes are still identified by final version checks; no
promise is made that arbitrary host files are locked.

## Conversion and file boundaries

- BentoDoc is the authoritative current artwork; PPTD is the readable/editable
  representation. Conversion belongs to the design capability package and service, not
  triggered by canvas edit events, and not implemented per Agent.
- First list the full gap between first-phase open editing capabilities and PPTD, then add
  minimal format/version, validator, import/export, capability matrix, and source patches.
  Group and multi-layer shadow are already known expression gaps; do not just add a
  serializer or block normal manual operations in the next turn. Roundtrip preserves IDs,
  hierarchy/order, attributes, and assets; it does not require YAML comments/layout to
  match; unknown or undeclared content errors rather than silently flattening.
- Current-artwork projection and Agent working drafts are separated. Sync only updates the
  projection and cannot overwrite in-progress creation files; re-reading only produces a new
  read fact and does not automatically rebase an old draft. When continuing based on a new
  version is needed, the Agent explicitly rebuilds or adjusts the corresponding creation
  attempt.
- The baseline is associated with artwork, draft/attempt, read version, and exact content;
  do not use a session-level `hasRead` boolean. Merely receiving PreToolUse, opening a path,
  or a tool error does not mean successful read; the valid scope of a partial read must also
  be explicit and cannot automatically prove the whole design was read.
- The [P2 turn input](../../../../apps/cli/src/design/turn-input.ts) dispatch snapshot
  preserves the original fact; a later successful read within the turn can establish a new
  draft baseline but cannot overwrite the whole old manifest or replace other drafts' baselines.
- Projections produced by the application have distinguishable provenance and do not enter
  post-turn collection as new Agent artifacts. Specific layout, baseline recording, and draft
  initialization are determined in the P3 slice, reusing workspace and existing artifact flow;
  do not add a new independent working-copy management product or a mandatory per-element
  editing tool.

## Hook strength and limits

Sync before read, record fact after successful read, check baseline before controlled write.
Write entry points include actual tools such as Edit/Write/patch on existing designs; do not
sync after receiving already-generated write parameters and silently approve them, since
those parameters may still be based on the old artwork. Parallel read/write, cross-artwork
operations, retries, and continuations must all be handled under the same baseline contract;
do not infer reads from event arrival order.

The hook enforces data-integrity conditions, not design methodology. It does not enforce
inspect → draft → self-check → review → report, does not judge whether the model truly
understands the file, and does not require the model to use a new `read_design` tool.
Ordinary new files are not globally blocked by design rules; initialization conditions for
new artworks vs. modifying existing artworks must be clearly distinguished.

Different CLIs have different tool-event coverage and failure policies. Recognizable design
read/write paths plug into the same sync/baseline implementation; do not promise universal
interception by matching arbitrary shell text, and do not build a sandbox or Agent runtime for
that purpose. Paths without hooks, timeouts, or failures cannot receive a fabricated valid
read baseline. Final canonical commit always atomically checks the real baseline inside the
existing commit lock; on missing/expired baseline it errors and keeps drafts, without auto
overwriting or creating user-adopt candidates. Hook allowing draft write does not equal
allowing commit; the final version and object identity are still checked. The application
rejects all manual writes to the owning canvas during execution and artifact processing; the
pre-dispatch save must complete first. If abnormal cases still find unsaved changes or
external version changes, keep the content and reject overwrite; do not destroy these changes
by reloading after commit.

## Adapter plan for the five Agents

The following records the integration points identified by prior static research as a basis
for re-verification before implementation; **this is not Molly Design current support or end-to-end
acceptance**. Vendor docs change; when work starts, pin actual runtime version, ACP launch
mode, config loading scope, and tool events, then record the measured matrix. Prefer
supported session/project-level configs, keep user config, and do not override global hooks.

| Agent | Pending integration point and source | Must verify during implementation |
| --- | --- | --- |
| Claude Code | [PreToolUse / PostToolUse](https://code.claude.com/docs/en/hooks#pretooluse) | Actual events for Read/Edit/Write/Bash/MCP, reject vs. successful-read receipt, whether ACP config takes effect |
| Codex | [tool hooks](https://learn.chatgpt.com/docs/hooks#tool-coverage) | Actual apply_patch, Shell/MCP coverage; do not assume a separate Read tool, and do not infer full coverage from first event of interactive shell follow-up input |
| Pi | [extension tool_call / tool_result](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md) | Native and custom tool events, blocking results, parallel tool calls, and extension loading mode |
| Kimi Code | [PreToolUse / PostToolUse](https://moonshotai.github.io/kimi-code/en/customization/hooks) | Whether hosted artifact/ACP launch actually loads; hook error or timeout may still let the call proceed and must not be treated as successful validation |
| Grok | [Grok Build hooks](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md) | Refers to Grok Build CLI, not just the model with the same name; pinned version events, blocking and error pass-through semantics, launch config |

The matrix records separately for each tool path: supports read sync, records successful
read, blocks stale writes, hook absent/failed, final commit protection. Only claim support
for verified combinations; vendor-provided hooks do not mean this application's hosted
adapter already enables them. Each adapter only does parameter/event adaptation, not copying
the design protocol.

## Agent handling conflicts and resubmission

Per the [overall convergence record](../../proposed/simplification/2026-09-11-design-workflow-convergence.zh.md),
conflicts return reason and file location through existing tools/hooks; the Agent reads the
latest projection, compares and keeps the draft, and adjusts. No application merge algorithm,
candidate panel, or fixed creation order is added. This reuses the coding-agent tool-feedback
paradigm; Lody's ordinary ACP file write itself has no universal CAS service. Success/failure
events and tool coverage per adapter still need verification.

The original turn manifest preserves the dispatch fact; re-reading does not automatically
rewrite the draft baseline. When the Agent explicitly resubmits, associate a new attempt,
read version, and exact content, then perform atomic checks; content need not change to have
a valid path, and meaningless edits are not forced. Mere re-read, file existence, or
low-level events cannot prove active resubmission. This contract is implemented in the first
complete P3.1/P3.3 slice, without a separate empty-interface phase or a new mandatory submit
tool.

Current formal collection happens after the Agent prompt returns; submission conflicts
discovered then keep files and diagnostics and provide them to the Agent on the next explicit
continuation. Do not claim the error was received in the same turn, and do not automatically
call the model again. Detectable conflicts during execution are fed back as early as possible
at the tool boundary; the independent CAS after completion is still preserved.

## Relation to other scope decisions

P3 cancels special regeneration candidates, human conflict picking, and independent
candidate create/adopt/reject flows. Existing candidate content, assets, and historical
receipts remain reachable through controlled file reads; external files are explicitly
imported after preview. Serial editing, draft retention after failure/cancellation, existing
explicit continue/recovery, and the manual save copy escape hatch remain; they are not moved
to an upstream job/checkpoint/recovery orchestration.

Subsequent skill changes keep format contracts, capability descriptions, tool references,
design suggestions, and optional helper scripts; remove fixed call order, inspect-once,
forbidden self pixel analysis, and mandatory review counts. Absence of a `molly_*` tool only
means that tool is unavailable, not that other Agent-native capabilities are unavailable.
Formal PNG/JPEG export continues to use the fixed Bento renderer. Runtime skill was not
edited this round; planning goes to P3.6.

Subsequent scope is clear: P2.7 #2b old-PPTD auto-candidate is removed per P3.0d; P2-A3
local reference-image attachments remain an independent adapter and are not automatically
merged into P3; reference-pack first phase clarifies the optional-script non-PNG limitation,
normalized as an optional improvement. The upstream Pillow porting source is valid; do not
assert "no need to recreate" solely because the current implementation is hand-written; do
not continue expanding codecs either. CLI holding bytes does not mean decoding capability
exists; Electron host path cost must be evaluated separately.

## Acceptance and unresolved implementation details

P3 essential acceptance: manual edits can be successfully read, roundtrip semantics are
consistent, stale/missing baselines do not overwrite the current artwork, sync does not break
Agent drafts, projections are not mistakenly collected. Cover parallel tools, failures,
continue, rejected manual changes during execution, and abnormal version changes with
deterministic signals; reuse existing test facilities. P6 verifies claimed supported paths on
actual packages and explicit versions of the five adapters; do not substitute one passing
adapter for all.

Still to be determined in implementation slices: snapshot/file-publish concrete interfaces,
identity representation for draft and read scope, hook config under each ACP launch mode, and
ability presentation for uncovered paths. This record establishes responsibilities and
failure semantics without pre-expanding session persistence schema, universal protocols, or
cross-process entry points. This plan has not been run through product tests, real Agents, or
cross-platform validation.

Documentation verification: `corepack pnpm run docs status` / `docs check` reported no errors,
20 pre-existing size warnings, and no registered SHA topic; `git diff --check` passed.
English translation pending; that does not constitute implementation or release-support
evidence.

Pre-commit verification: `corepack pnpm format` and `corepack pnpm typecheck` passed; static
checks for lint, i18n, code-collab imports, and platform boundary passed. The public boundary
check first flagged an external Web implementation path in the plan; after removing that path
reference, re-check passed; investigation conclusions and orchestration basis remain. Unrelated
file diffs caused by formatting were reverted; per the no-test requirement, the full
`pnpm check` including tests was not run.

2026-09-11 scope review supplement: per the [result feedback and migration scope review](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md)
and subsequent overall convergence, result cards, dedicated thumbnails, and new candidate
workflows retire; Agent rendering/image reading, old content, and receipts remain. P3.6 cancels
mandatory finalize and the rule that a single missing tool fails all review. P3.0d removes
old-file auto-promotion, P3.3 distinguishes explicit resubmission, P3.7 uses direct explicit
import. Hooks are a confirmed adapter, not expanded into a universal governance platform;
runtime code was not changed.

## Verdict

Status: rejected. The read-sync hook direction was explicitly superseded on 2026-09-12 by
[editor autosave updating PPTD](../../implemented/simplification/2026-09-12-editor-owned-pptd-save.zh.md):
human save updates the current PPTD independently through editor capability, so Agent
read-triggered sync is no longer needed; only a public read-before-edit reminder hook is
kept. This record preserves the old read-driven sync plan and its implementation background
to prevent repeated attempts.
