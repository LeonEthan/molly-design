# Explicit draft resubmission and candidate retirement

Status: implemented
Translation: pending

## Abstract

A stale design attempt could report a conflict but had no deliberate way to reuse
its preserved draft after rereading the current drawing. An optional explicit
resubmission now binds the exact existing draft and complete read evidence captured
before tool arguments, while retiring older generated calls and results. Natural
completion uses the same structural, asset and atomic save checks for normal edits
and regeneration; conflicts retain drafts and durable diagnostics instead of
creating candidates. Pi's verified native adapter exposes the operation because
its pinned ACP adapter does not forward MCP tools; other runtime integrations and
paid-model judgment are not claimed.

## Decision and responsibilities

This implements the explicit-attempt and candidate-retirement decision in
[workflow convergence](../../proposed/simplification/2026-09-11-design-workflow-convergence.zh.md)
and builds on [Pi read hooks](../architecture/2026-09-11-pi-design-hooks.md).
The latter's frozen dispatch manifest and successful complete projection-read
coverage remain intact. This note does not approve the draft Spec.

The shared design service captures the existing draft digest at each assistant
generation alongside its eligible read baseline. `folio_resubmit_draft` is a
no-argument declaration to retain that observed draft as a new attempt. It rejects
missing or changed bytes, incomplete or stale generation reads, and duplicate or
superseded operations. It records intent without committing, ending execution or
claiming that the Agent understood the design. No meaningless byte change is
needed. Subsequent edits still use native Write/Edit and natural final collection.

Each generation also freezes an attempt epoch. Resubmission advances the epoch;
old generations cannot borrow the new attempt, and delayed successful write results
cannot attest replacement content. Every write independently requires its own
eligible generation, even after an earlier legal write established an attempt.
This closes the otherwise possible lending of an established baseline to older
arguments. Rereading, mtime changes, file existence and identical writes never
create resubmission intent. An unchanged inherited artifact without that intent
continues to produce `no_artifact`.

The finalizer accepts only matching artwork, resolved draft and exact artifact
bytes from the live service, then uses the existing intake/assets/store pipeline.
The original manifest remains dispatch evidence. Final version conflicts become
`invalid` outcomes with bounded reason, draft location and explicit-continuation
instructions in the existing receipt and history. They are discovered after the
Agent ended and cannot be described as handled by that Agent turn. The next user
continuation receives the ordinary workspace/receipt pointer and can inspect the
current projection and preserved files. No Agent restart, semantic merge, paid
retry, new persistence system or mandatory finalize tool is introduced.

The production candidate writer and unused catalogue reader are removed. Historical
candidate JSON remains checksum/identity checked and available through ordinary
file preview, including embedded assets. Tests seed synthetic historical envelopes
instead of retaining a production candidate writer for fixtures. The independent
manual save-copy escape remains in the ordinary store/desktop flow.

## Exact snapshots without retained media buffers

`digestAuthoring` shares the existing collector scan and its path, link and
before/after file-handle identity checks. It streams a 64 KiB buffer and keeps only
path metadata, with the same sorted path/length/byte encoding as existing artifact
digests. Normal full-Map and referenced-preview collection retain their behavior;
the dependency callback remains intact. A separate permissive scanner or a new
64 MiB authoring cap would respectively weaken integrity or reject otherwise valid
drafts with retained media, so neither is introduced.

The collector seam incorporates the sealed live-preview implementation and its
missing-dependency callback; those inherited changes are not new T06 preview work.
Tests compare streamed and existing digests across reversed file creation order,
Unicode paths and binary content, and hash a sparse 64 MiB + 1 retained-media file
without a full-size fixture allocation. That sparse tree demonstrates authoring
hash resource behavior, not a new canonical storage limit or large-design visual
acceptance. The existing canonical 64 MiB JSON bound is unchanged.

## Native adapter boundary

The installed `pi-acp@0.0.33` bundle only assigns `this.mcpServers` in its session
constructor; it never reads it to create a transport or tool. This is why a portable
MCP registration alone would advertise no usable operation in the verified
`@earendil-works/pi-coding-agent@0.85.1` runtime. A thin native `registerTool`
registration forwards the explicit operation through the existing `design/tool-hook`
RPC, using the generation captured by native events. The adapter does not implement
MCP support. Future adapters should reuse the shared operation through verified
runtime hooks/MCP facilities and preserve generation fencing before arguments.
There is no universal Shell/custom-tool sandbox claim.

## Verification

The actual pinned Pi ACP/Pi extension/tool path passed the synthetic external-model
probe with six generations. It received an actionable stale-write error after an
abnormal canonical save, read the new projection, rejected a same-generation
resubmission, accepted the next-generation explicit resubmission with the exact
unchanged dispatch digest, and naturally completed through intake and atomic save.
The frozen manifest remained byte-identical. This probe uses a synthetic control
host and does not by itself establish Electron acceptance or paid-model behavior.

Deterministic tests cover older arguments borrowing a baseline, same-generation
reads/resubmission, old-epoch writes and duplicate resubmissions, late successful
results, changed generation-snapshot bytes, unchanged-output intent, final lock/CAS
interleaving, durable conflict receipt replay, and historical document/asset
readback. No timing thresholds, network or sleeps are used in these regressions.

The streamed native conflict probe passed again with actual projection and draft
reads in the conflict response sequence. Generation snapshot observations were
0.34–2.72 ms for that small project. A separate 180,000-character native projection
probe passed four continuation reads; its final populated draft hash took 0.59 ms.
These are local observations on this macOS machine, not latency thresholds or
cross-platform performance guarantees. Local synthetic logs are
`/tmp/folio-t06-native-stream.log` and `/tmp/folio-t06-native-large.log`; they are not
committed transcripts. Native model responses and local control-host behavior were
scripted; no paid model or global configuration change occurred.

The extended desktop probe also passed on the production build. It first saved a
native Bento shape and completed an ordinary edit, then sent a distinct explicit
user continuation with the unchanged inherited draft. An abnormal external store
save caused a real native stale-write error; Pi read current and draft files,
explicitly resubmitted, and ended naturally. Production Electron IPC,
MessageHandler, Session ownership, Pi ACP and final collection restored the exact
intended draft with the shape retained and native `readonly=false`. There were six
resubmission generations. Both Electron user data and CLI data/endpoint were
isolated by the existing harness. Only external model responses were synthetic;
no global user configuration or paid model was used. Local evidence is in
`/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/folio-t06-desktop-hPjvOT/evidence/`
and `/tmp/folio-t06-desktop.log`; those runtime captures are not committed.

Final validation passed: `corepack pnpm check`, `corepack pnpm format`,
`corepack pnpm run docs check`, and `git diff --check`. The full check includes
2,611 passing CLI tests and the shared/authoring/component suites, type checks,
lint and repository boundary guards. Four CLI tests and three Loro RPC tests
remain skipped by their existing suite definitions. The first full run exposed
two existing Claude authentication tests inheriting provider credentials; the
successful full run strips `ANTHROPIC_*` and `CLAUDE_CODE_USE_*` only from its child
environment. No authentication source or user configuration was changed.
