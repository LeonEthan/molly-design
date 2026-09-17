# Grok Build design-hook runtime gap

Status: rejected
Translation: pending

## Abstract

Grok Build 1.0.13 has working native file and client hooks, but the inspected
interfaces cannot freeze a design attempt before each model response generates
its tool arguments. Tool hooks expose an individual tool ID, without a model
response identity or an explicit last-tool boundary; the client post hook is also
an unacknowledged notification. Implementing the design adapter from those events
would require inventing a generation boundary, which could bless already-generated
writes with a later read. T20 remains blocked with its acceptance criteria intact;
this change records native evidence and a repeatable probe, and adds no runtime
adapter or support claim.

## Scope and ownership

This is the runtime audit for [Issue #22](https://github.com/LeonEthan/molly-design/issues/22),
on the shared [Pi hooks](../../implemented/architecture/2026-09-11-pi-design-hooks.md)
and [explicit-attempt contract](../../proposed/simplification/2026-09-11-design-workflow-convergence.zh.md).
The [Spec](../../../../specs/graphic-design-platform.zh.md) remains draft. The
[scope review](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md)
continues to bound migration. No shared service, Session lifecycle, Bento editing,
projection, final collection or canonical storage code changes here.

The required facts remain: successful **delivered** complete text/ranges; an
attempt generation frozen before model arguments with exact draft digest/epoch;
same-response reads cannot bless writes from that response; an explicit no-argument
resubmission consumes only its frozen read and digest; old calls/results cannot
borrow a newer attempt. Final canonical compare-and-swap is independent of hooks.
A preview is neither a commit nor a read baseline.

## Exact inspected combination

- Official executable: `grok 1.0.13 (5e9a58528b76) [stable]`, macOS arm64. Native
  help identifies **Grok Build TUI**, not a Grok model in another harness.
- Executable SHA256:
  `8669e0fdadceec25b8c159c355f427ffbd82583525d774b6ab1522197ea83b80`.
- Compatibility adapter: `acp-extension-grok@0.1.0`, pinned public submodule
  `77a994f4e0a5acec8c52020c0a8e01b0e90aaef9`. Its unchanged
  `src/runtime-process.js` launches `GROK_PATH agent stdio` and disables the native
  updater. `runtime-manifest.json` pins official version/minimum 1.0.13; no runtime
  is built from that adapter repository.
- ACP initialization reports protocol version 1 and native version 1.0.13. Its
  `x.ai/hooks.blockingEvents` are `pre_tool_use`, `stop`, `subagent_stop`.
- The executable extracts its own `docs/user-guide/10-hooks.md` under the isolated
  `GROK_HOME`. That bundled document SHA256 is
  `3690762505faa65d6a82e6462abeaa20fe3a127de611021c171f9088f2c2e56f`.
  It lists session, user-turn, tool, stop, subagent and compaction events; none
  establishes an awaited before-model boundary.

The official [published source](https://github.com/xai-org/grok-build/tree/37949780c144e37df692e3d669051a21fec24f20)
was inspected at `37949780c144e37df692e3d669051a21fec24f20`. Relevant files are
`xai-grok-hooks/src/event.rs`, `xai-grok-shell/src/extensions/hooks.rs` and
`xai-grok-shell/src/session/acp_session/hooks.rs` under `crates/codegen/`.
That source is **not** claimed to reproduce this native binary: fetching the short
embedded build revision failed, and current source/docs contain newer post-hook
output behavior. Runtime observations and the binary's bundled docs take
precedence over current website descriptions.

## Native observations

The committed [manual probe](../../../../apps/cli/scripts/probe-grok-design-hooks.mjs)
launches the actual pinned compatibility adapter and official executable. Only
model responses are synthetic, served through a loopback Chat Completions endpoint
in a temporary custom-model config. It uses an explicit child environment without
inherited model credentials, disables telemetry and discovered unrelated plugins
inside its temporary Grok home, and leaves user global config untouched. Captured
native events and model requests stay outside Git.

Run after installing root dependencies and building `acp-extension-core`:

```sh
MOLLY_PROBE_GROK=/absolute/path/to/official/grok \
  node apps/cli/scripts/probe-grok-design-hooks.mjs
```

The successful round retained its evidence under
`/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/folio-grok-hooks-MS8IKs`.
`summary.json` records event ordering and native tool outcomes; the externally
observed model request number is a **probe oracle**, never an adapter protocol.

| Case                          | Actual observation                                                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session client-hook loading   | `_meta["x.ai/hooks"]` on actual `session/new` loads callbacks; pre hooks arrive as `_x.ai/hooks/run` requests and post hooks as `_x.ai/hooks/event` notifications.                                       |
| Normal file tools             | Native `read_file` returns `FileContent` with raw bytes and line-anchored rendered content; native `write` creates the expected file.                                                                    |
| One model response, two calls | A single scripted response emits Read and Write. Both pre-hook payloads already contain generated arguments; neither carries a model-response ID, batch size or last-tool flag.                          |
| Refusal                       | A pre-hook `deny` prevents its target file, then the model proceeds to another response.                                                                                                                 |
| Hook error                    | A pre-hook JSON-RPC internal error fails open; the target contains the requested bytes.                                                                                                                  |
| Hook timeout                  | A callback with actual `timeout: 1` and no response times out natively and permits the write. The probe uses the runtime timeout, not an arbitrary sleep.                                                |
| Large delivered read          | A 60,001-byte file is read, but its post-hook serialized result is replaced by a truncated string with `toolResultTruncated: true`. A fresh disk read cannot stand in for the missing delivered payload. |
| Missing file                  | Native `post_tool_use` still fires with `ReadFile.FileNotFound`; the event name alone is not evidence of successful delivery.                                                                            |
| Shell failure                 | Native `run_terminal_command` exiting 9 emits `post_tool_use`, with `Bash.exit_code: 9`; it must not establish a successful design read.                                                                 |
| Cancellation                  | Cancelling the session while the write pre hook is pending produces `cancelled`; the target is absent. No success fact is inferred.                                                                      |
| Unknown generation event      | Registering `BeforeModel` does not yield that event. The bundled event catalog and public source contain no equivalent generation or last-tool event.                                                    |

A separate local file-hook probe used an isolated `GROK_HOME/hooks/probe.json`
with native command handlers. It established real pre/post file hook loading and
an exact successful `FileContent` result. Holding the post-hook command response
blocked model advancement until the native hook timeout; increasing the timeout
kept the next request blocked until probe cancellation. **File post hooks must not
be described as fire-and-forget.** SDK post hooks are a different interface and
remain notifications with no acknowledgement. That exploratory file-hook probe
is local evidence, not a committed regression fixture.

Process `--plugin-dir` and session `_meta.pluginDirs` were also tried in that
exploratory probe. The native debug log discovered the plugin with `has_hooks=true`,
but `_x.ai/hooks/list` did not list its hooks; the isolated global hook file did
appear and execute. This is a bounded negative observation, not a claim that all
Grok plugin configurations fail. Project trust/config loading, actual MCP tools,
`search_replace`, platform variants and hook-absent native design commits remain
unverified.

## Why a thin adapter cannot yet satisfy T20

File hook envelopes provide `toolUseId`, input, result and truncation flags, plus
session/path/timestamp metadata. Tool envelopes observed here lack even the
turn-level `promptId`; they have no generation ID or batch-completion boundary.
Ordinary ACP ToolCall notifications include `promptId`, `streamStartMs` and
`turnStartMs`, but arrive after model argument generation. Timestamps and passive
arrival order do not freeze draft bytes before the response starts, and do not
provide an awaited last-tool boundary before the next response.

Awaiting a file post hook proves the handler can finish before continuation; it
does not prove it is the last call in that generated response. Incrementing a
counter on every pre hook would let a same-response read establish evidence for
an already-generated write. Advancing on every post hook has the same problem.
Parsing the transcript or inferring batches from timestamps/tool arrivals would
create a second, undocumented protocol. Freezing only at user dispatch prevents
legitimate read/retry within the turn, so it does not meet acceptance either.

No thin adapter is therefore enabled. Reopening implementation requires an actual,
distributed native seam that freezes generation before arguments, or an equivalent
awaited response boundary with unambiguous batch identity/completion. Complete
successful result delivery must also be established for every claimed read path,
with errors and truncation rejected or covered by exact native ranges. An
unpublished runtime fork, silent output repair, fresh filesystem hashes, a new
scheduler or weaker read-only/commit rules are not substitutes.

## Acceptance and verification limits

T20 remains **BLOCKED**, not done. Identity/version, native SDK registration and
the audited tool behaviors are proven only for the combination above. The full
normal design commit, stale-write rejection, conflict re-read/retry, same-byte
explicit resubmission and missing-hook final canonical protection are not proven
for Grok. The shared final CAS remains necessary and unchanged; existing generic
tests are not a substitute for those native acceptance journeys. No paid provider
was called and no GitHub mutation, publication, runtime pin or submodule gitlink
was changed.

Validation: root `corepack pnpm check` passed (typecheck, lint, full tests, i18n,
import and public/platform boundary guards); root `corepack pnpm format`,
`corepack pnpm run docs check`, `node --check` for the probe and `git diff --check`
also passed. Child checks filtered inherited `ANTHROPIC_*` and `CLAUDE_CODE_USE_*`
keys without printing values. The docs check required initializing the unchanged
pinned Kimi submodule to resolve an existing documentation link; it remains outside
root pnpm. Existing rule-file size warnings remain. No Spec approval is claimed;
translation remains pending.

## 2026-09-12 cancellation follow-up: late response and public close

This supplement concerns cancellation under the revised reminder scope, not the
retired generation-proof acceptance above. The [installed matrix's original
cancel transport failure](../../implemented/testing/2026-09-11-installed-five-agent-matrix.md#grok-cancellation-direct-native-transport-boundary)
remains failed: native `cancelled` and idle did not close the held model HTTP
response before fixture cleanup. The public reminder does not fix that failure.

Two subsequent direct native ACP cases used the same checksummed Grok 1.0.13
binary, separate synthetic configuration/workspaces and a loopback provider. ACP
responses, notifications and HTTP close events were recorded independently.
Captured records remain outside the repository; no product/runtime change is
part of this supplement.

- **A2, late Write:** after the original prompt returned `cancelled`, the fixture
  released that held response with a `write` call targeting a unique absent file.
  The HTTP close was classified as **fixture response release**, not native
  cancellation success. Through the next explicit user turn's completed native
  Read, no matching late tool event appeared and the target remained absent. The
  continued Read delivered the existing synthetic state's actual bytes. This is
  bounded evidence for this late-response case, not proof about already-running
  tools, background commands or all cancellation interleavings.
- **B, close while held:** native cancel acknowledged at 04:53:51.492Z while HTTP
  remained open. The fixture called public `session/close` without releasing the
  provider response. HTTP closed independently at .516Z; the close response at
  .518Z reported `_meta["x.ai/closeOutcome"] = "closed"`. Explicit `session/load`
  responded at .553Z, then an explicit prompt successfully read the saved state.
  No OS kill was needed. This establishes native close as a smaller available
  resource-release operation for this scenario; it does not implement a new
  Molly Design Stop policy.

A2 evidence is
`/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/folio-native-grok-stop-A-n8EErq`;
B evidence is
`/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/folio-native-grok-stop-B-BqJ8U6`.
Both contain `events.json`, `acp.jsonl` and synthetic provider requests. Each
native process subsequently exited zero after stdin EOF, and independent process
inspection confirmed it absent. The fixture script is retained privately, not
committed with captured records.

### Close does not promise background preservation

The official source at `37949780c144e37df692e3d669051a21fec24f20` implements
[close_active_session and hard_stop_resident](https://github.com/xai-org/grok-build/blob/37949780c144e37df692e3d669051a21fec24f20/crates/codegen/xai-grok-shell/src/agent/mvp_agent/session_lifecycle.rs#L61-L108)
by sending cancellation with `cancel_subagents: true` and
`kill_background_tasks: true`, followed by `Shutdown(CancelRunningTurn)`.
The [cancellation implementation](https://github.com/xai-org/grok-build/blob/37949780c144e37df692e3d669051a21fec24f20/crates/codegen/xai-grok-shell/src/session/acp_session_impl/cancel.rs#L479-L495)
kills background tasks by session owner for a subagent and all backend background
tasks for a main session. This source corroborates intended teardown semantics;
it is not claimed to reproduce the binary's embedded revision. B did not create
background tasks, so their exact native termination behavior remains untested.
Close must not be described as preserving the running background environment.

Molly Design already exposes `AgentClient.closeSession` and explicit session restoration.
A possible future correction can await native close before releasing the canvas
and restore only on the next explicit user turn, without a runtime patch or a new
scheduler. It must account for the closed resident session and the loss of its
background execution, rather than reuse it as though Stop merely interrupted a
prompt. The current wrapper returns a boolean after the close RPC and does not
inspect Grok's `closeOutcome`; a completed RPC alone must not be elevated to proof
of `closed`. No product implementation or blanket safe-to-unlock claim follows
from these two fixtures.

A strengthened isolation gate was prepared for review but **not executed**. It
checks canonical temporary configuration paths, an explicit synthetic API key,
only a loopback model URL, and native model/authentication identity before any
prompt, rejecting cached authentication. No further native probe was run after
that review pause. The original failed transport observation remains unchanged.

## 2026-09-12 implemented Stop policy

The user explicitly selected complete Grok session closure on Stop, including
termination of its background tasks/subagents; a subsequent explicit user message
restores the session. This implements that narrow policy, not the retired read
proof proposal. The original transport failure and the limited A2/B native
observations above remain unchanged.

AgentClient now distinguishes the resident's active, closing, closed, failed and
restoring states. Only built-in Grok takes this path. `closeAfterStop` uses public
`session/close` with a bounded request and accepts only native `closed` or
`notResident` (the requested resident is already absent). Missing capability,
missing/unknown outcomes, `superseded`, transport failures and timeouts do not
prove closure. Ordinary ACP cancel remains available separately. No runtime
patch, OS kill or process replacement is introduced.

The existing visible-turn owner retains the original close promise and captured
ACP prompt settlement, and is released only after those and artifact processing
finish. A failed close surfaces an error, retains drafts and the original canvas
owner, and remembers only that provider's retry action. A new explicit user
message first retries this exact close; confirmation and the original provider
settlement release the old owner before normal canvas preparation. Failed retries
leave the lock in place. There is no background retry, silent owner transfer or
replay of the stopped prompt.

On successful Stop the ACP transport process remains available. The next explicit
dispatch loads the same native session with its workdir, current MCP catalog and
existing session metadata, reloads Molly Design's precise reminder plugin, then uses the
ordinary turn configuration and prompt path. Loading does not send a prompt by
itself. A Stop arriving during restoration waits for that load to settle and
closes the resulting resident before canvas release. Direct prompts against a
closing, closed or failed resident are refused. Load failures cannot silently
reuse the resident; an explicit restoration attempt closes uncertain residency
before trying to load again.

Deterministic tests cover delayed close, rejected/missing/unknown close outcomes,
timeout, stopped prompt refusal, explicit retry followed by load/new input, Stop
during load, and the actual visible-turn canvas order through failed closure and
explicit recovery. They also retain existing non-Grok cancellation behavior. The
implementation has not run a new native Grok/model request or UI session. A2/B
establish the previously recorded public close/load capability only; integrated
native acceptance remains pending a separately reviewed isolation fixture. The
strengthened gate above remains unexecuted.

Implementation validation: root `corepack pnpm check` passed, including types,
lint, full tests and public/platform boundaries. The two focused suites contain
114 passing tests. Root format, docs check and diff check passed. Test children
excluded inherited `ANTHROPIC_*` and `CLAUDE_CODE_USE_*` flags. These checks do not
replace the pending integrated native acceptance.

### Load timeout is not native completion

Static follow-up found that `withTimeout` races the load promise without cancelling
its RPC. Retrying close after only the timeout could observe `notResident` before
the original load later establishes residency. AgentClient now retains the raw
load RPC settlement independently of the bounded caller wait. Every subsequent
Stop/close waits for that original request to resolve or reject before dispatching
close; elapsed time is never a substitute for this boundary. A fake-clock test
keeps the raw load pending past both the load timeout and another close interval,
asserts no close is dispatched, then resolves the original RPC and observes close.
No native request was run for this verification.

A replacement installed-package probe was prepared privately and syntax-checked
only. Its native wrapper gates every invocation, including version/inspect,
against canonical private HOME/GROK_HOME/work paths, no authentication cache,
fixed synthetic loopback configuration, an explicit environment allowlist and the
pinned binary checksum. Native initialize must report the synthetic model and
API-key authentication before any prompt is forwarded. It reuses ElectronHarness
and records close/load responses independently from HTTP closure. This fixture
remains unexecuted: root reviewed the revised gates, but execution still requires
a new checked package and a released UI slot. It is not integrated acceptance
evidence.


The official [close implementation](https://github.com/xai-org/grok-build/blob/37949780c144e37df692e3d669051a21fec24f20/crates/codegen/xai-grok-shell/src/agent/mvp_agent/session_lifecycle.rs#L15-L108)
limits its load-attachment wait to five seconds within an eight-second aggregate
budget, then can return `notResident`. This corroborates the need to await the
original load RPC before calling close; the public-source/binary correspondence
limit above still applies. Full root check, format, docs check and diff check
passed for this correction; the focused AgentClient suite now has 22 passing tests.

## Verdict

Status: rejected. The generation-frozen fence this runtime gap served was cancelled
by the approved [editor-owned PPTD save](../../implemented/simplification/2026-09-12-editor-owned-pptd-save.md)
and [noninvasive reminders](../../proposed/simplification/2026-09-12-noninvasive-design-hooks.zh.md)
design. The native observations about missing pre-generation and last-tool boundaries
remain valid, but they no longer need a production workaround. This record is kept
as evidence against reintroducing the stronger contract without an upstream seam.
