# Design tab runtime tools

Status: implemented
Translation: pending

## Abstract

New design tab accepted a child conversation without design metadata, so Agent
startup disabled design runtime behavior and omitted design MCP namespaces.
The owner decided on 2026-10-24 that new tabs share the current artwork.
Tab acceptance now carries that artwork association through the existing child
creation path, enabling the ordinary design startup mechanism. Deterministic
producer and startup tests pass; native Pinterest navigation remains untested.
The owner approved the added Spec revision on 2026-10-24.

## Root cause and decision

[Issue #236](https://github.com/LeonEthan/molly-design/issues/236) requests
design-tool parity between New design and New design tab.
`session-detail.tsx`'s `handleSendDraft` supplied `parentSessionId` to
`startSession` without `design`. Landing creation creates the blank canvas and
supplies `design.artworkId` to the same acceptance path. `use-session-actions.ts`
preserves explicitly supplied design metadata; it does not derive artwork
ownership from the parent.

`session-manager.ts` enables `designHooks` only from the child's own durable
design association. `session.ts` derives its design launch identity from that
flag; `agent-client.ts` registers `molly_image` and `molly_browser` only with
that identity. Read reminders, personal memory and the design permission
profile also depend on the gate. Opening the browser panel cannot change the
accepted metadata or the startup decision.

The [Spec](../../../../specs/graphic-design-platform.zh.md) previously described
one main conversation per artwork by default without defining New design tab
ownership. The owner selected shared artwork on 2026-10-24. The new paragraph
records that decision; the owner approved the written revision on 2026-10-24
and the English translation is current.

## Reuse ladder and scope

1. Direct reuse: ordinary child creation already shares the validated parent
   workspace and atomically accepts metadata with the first user message, but
   its caller omitted the design association. Landing creation directly reused
   would instead create an independent artwork, contrary to the owner's decision.
2. Reuse with adaptation (chosen): extract the existing parent context fields
   into `getDraftSessionParentContext` and include the complete `design`
   association. The production tab caller and deterministic acceptance tests
   use that same mapping. This preserves an artwork id different from its
   parent Session id, including continuation sessions.
3. Borrowing another pattern or custom-building is unnecessary. Existing
   `startSession`, design launch gates, artwork-keyed canvas/flush ownership,
   final CAS and conflict/re-read paths cover the required behavior. No daemon
   fallback, protocol, store, paid retry or new concurrency mechanism is added.

Ordinary parents without a design association continue creating ordinary children.
Existing tab metadata is not migrated. New design tabs create neither a blank
artwork nor a copy. The original startup diagnostic used the old malformed
accepted metadata and failed; its retained consumer regression now represents
the association emitted by the fixed producer. The separate producer regression
guards against reintroducing the omission.

## Verification and limits

Based on `origin/main` at `61bf5138`, branch `fix/236-design-tab-tools`.

- Before the fix, the startup diagnostic failed with `expected false to be true`
  at `designHooks`; 74 existing tests passed. The first fixture attempt lacked
  a synthetic connection and was corrected before recording that result.
- The extracted production parent-context mapping initially preserved the bug.
  `use-session-actions.test.ts` then failed for both ordinary design and
  continuation parents because accepted metadata lacked `design`. Adding the
  association made those cases pass; the non-design case stays ordinary.
- Focused verification: 81 component tests and 89 CLI tests pass, including
  draft persistence, first-turn acceptance, design startup, MCP namespace
  registration and browser tool behavior. The new fixtures use fixed input
  timestamps, an unused synthetic credential reference and a spawn-boundary
  rejection; they perform no provider calls, network requests or sleeps.

- `pnpm install --offline --frozen-lockfile` passes using the existing pnpm
  store. `pnpm check` passes, including 257 CLI and 421 component test files,
  Electron tests, typechecking, lint and public/platform boundaries.
- The initial sandboxed full check encountered Unix socket `listen EPERM` in
  existing local IPC tests and was interrupted. The complete rerun with local
  socket permission passes. The uninitialized historical vendor tsconfig emits
  a non-fatal resolution warning; no nested vendor dependencies were installed.
- `pnpm format`, `pnpm run docs status` and `pnpm run docs check` pass. Docs
  report existing AGENTS size warnings and no registered SHA-protected topics.

No native E2E was run.
Suggested native E2E: open an existing design, create a New design tab, select
DeepSeek Flash, ask the Agent to find poster references on Pinterest, and confirm
`mcp__molly_browser__navigate` executes successfully. Compare design namespaces
with a New design session under the same host and connection settings. Verify
the tab still targets the original artwork and preserves its saved content.

## Codex P1 follow-up: executing child preview

Codex CLI review identified that the shared canvas still requested the root
conversation's source. With an idle root and an executing child, the handler
returned the root draft and no causal input turn. Main IPC also equated the
requested Session with the artwork, then used artwork identity as the input
Session. Thus the missing preview was a separate defect after tool activation.

Direct reuse of the selected tab identity was rejected: switching back to the
root while its child executes must still show that same child draft. Reuse with
adaptation selects the executing Session from `DesignCanvasHost`'s existing
artwork owner map, resolves its trusted workspace and verifies its artwork
association. The existing `design/source-path` result carries artwork and live
Session/canvas/source-turn identity, including a pending causal input during
preparation. No endpoint, protocol version, store or ownership index is added.
After asynchronous resolution, the handler checks the same execution owner.
Historical turn requests retain their own frozen Session paths.

Main validates the returned artwork and current canvas turn, then forwards the
executing Session identity through the existing `LiveSource` consumer and
`bindLiveSource`. The renderer's artwork and retained host keys stay unchanged;
root and child views share the same draft observation. Existing artwork-level
readonly, flush, CAS and release mechanisms remain responsible for all Bento
instances. No renderer presence heuristic or new lifecycle mechanism is needed.

The deterministic handler regression first failed with the root path and missing
child/input-turn identity. It passes after the repair and covers pending input,
root/child lookup consistency and wrong-artwork refusal. Actual IPC-class tests
cover child identity, stable artwork/host, late input binding and wrong-artwork,
replaced-turn, idle-source and historical-request rejection. Preview consumers
share one observation and pass the same child input to the worker. Focused
verification passes: 6 CLI, 33 IPC/preview/access and 31 renderer tests. The
existing access tests cover all artwork instances remaining readonly through
execution and artifact processing. Fixtures use explicit promises and synthetic
inputs without sleeps, external network or model calls.

The owner supplied native evidence for HEAD `7d51998e` on 2026-10-24 using
DeepSeek Flash: New design produced an editable poster; New design tab opened
`https://www.pinterest.com/search/pins/?q=coffee%20shop%20opening%20poster` and
returned three references in 2 minutes 8 seconds. Both conversations showed
the same `canvas-1ebcc560-…`, readonly during execution and Autosaved afterward.
The UI did not expose the full tool catalog, so `molly_image` was not directly
observed. That turn did not change the artwork and does not validate this P1.
This follow-up runs no new native E2E; child live-draft display still needs the
separately assigned native acceptance. The approved shared-artwork Spec intent
and owner approval record at `7d51998e` remain unchanged.

Follow-up validation: `pnpm check` passes, including CLI 3016 passed / 3 skipped,
components 3380 passed, Electron tests, typechecking, lint and all boundary
checks. The first typecheck exposed a fixture/result identity type mismatch,
and lint caught one test variable shadow; both were corrected before the final
complete run. `pnpm format` and `pnpm run docs check` pass, with existing AGENTS
size warnings and no registered SHA-protected topic changes. Review and native
evidence are collected in [PR #238](https://github.com/LeonEthan/molly-design/pull/238).

## Codex P1 follow-up: version-skew compatibility

[Review comment 4367322575](https://github.com/LeonEthan/molly-design/pull/238#discussion_r4367322575)
correctly identified the unversioned strict response change in `43ea28af`.
The original Electron parser rejects extra fields at both the response and
`live` levels; the changed parser requires artwork and executing Session ids.
Deterministic regressions reproduced both directions: the current IPC rejected
an old daemon response for missing identities, and a frozen original strict
parser rejected the current daemon's unversioned response.

The shared negotiation contract requires capability-based workflow selection.
Making new fields optional alone cannot protect an old strict parser. Reuse the
existing `MachineMeta.protocolCapabilities` advertisement and canvas-host
exchange: `designCanvasSerialEditing` now advertises v2, while the base v1
flush handshake remains supported. The existing host snapshot supplies the
negotiated source version to the canvas-access state; disconnect clears it,
and a version change invalidates the existing display state notification.
No release-string inference, discovery endpoint, retry path or persisted
version store is introduced.

Reuse with adaptation retains strict v1/v2 codecs for `design/source-path`.
Unversioned requests return the exact v1 shape and requested-Session behavior,
so an original Electron can still parse a new daemon's response. New Electron
requests source identity v2 only after negotiation, and uses the v1 codec and
empty parameters with an old daemon. The aggregate RPC decoder accepts both
shapes; the IPC selects a strict codec from the negotiated version. V1 still
checks artwork/request identity and current turn and allows pending input to
bind later. V2 retains the shared-artwork/child-input checks from the prior fix.
Missing capability is unsupported, rather than assumed to be v1. Legacy peers
keep their existing child-preview limitation, without breaking normal previews
or making the v1 flush handshake unavailable.

Focused validation passes: 8 daemon source/registration tests, 34 IPC/preview/access tests
and 5 capability tests. The frozen original parser and real IPC class cover
both skew directions, request parameters, pending input, unavailable capability
and strict current-source validation. Capability fixtures cover missing/v1/v2/
future peers, v1 handshake acceptance and clearing negotiation on disconnect.
`pnpm check` passes, including CLI 3016 passed / 3 skipped, components 3380 passed,
Electron tests, typechecking, lint and all boundary guards. The exhaustive machine
registration fixture now acknowledges capability v2. `pnpm format`, docs status
and docs check pass with existing AGENTS size warnings and no registered protected
topic changes. No native E2E is run for this repair. The owner's ready state is
retained; no comment reply or review
trigger is sent.
