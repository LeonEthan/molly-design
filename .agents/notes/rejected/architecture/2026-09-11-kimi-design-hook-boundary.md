# Kimi managed runtime design-hook boundary

Status: rejected
Translation: pending

## Abstract

The pinned Kimi runtime cannot currently provide Molly Design's complete successful-read
attestation and generation-frozen write baseline. A native ACP probe of the exact
public artifact confirms that post-read hooks run without delaying the next model
request, receive truncated output, and permit writes after pre-hook errors or
timeouts. T19 therefore remains blocked; no Kimi design-hook adapter is enabled.
A separately released managed artifact must expose the required timing and content
before a thin adapter can reuse the existing design service safely.

## Ownership and scope

This records the unresolved Kimi slice of [shared design hooks](2026-09-10-design-sync-hooks.zh.md)
and [Issue #21](https://github.com/LeonEthan/molly-design/issues/21). The existing
[Pi integration](../../implemented/architecture/2026-09-11-pi-design-hooks.md)
and [explicit resubmission](../../implemented/simplification/2026-09-11-explicit-design-resubmission.md)
own complete delivered reads, generation fences, exact draft digests, attempt
epochs and independent final validation. Their guarantees are not relaxed here.
The Spec remains draft. This is runtime evidence, not a completed implementation
or a proposal to add a general execution protocol.

## Artifact and ACP identity

The root [manifest](../../../../apps/cli/src/agent/kimi-runtime-manifest.json)
pins `0.39.1-lody.f255222661c9`, source
`f255222661c9cc2842901858fd28e554d7796a51`. The public download at the configured
public runtime host, using `/api/runtimes/kimi-code/<version>/node/<fileName>`, yielded
3,335,953 bytes, SHA256
`a4bfb622023ceaf249faecf8da8508ee400af242de2d4590b72d64e95a0bbbb8`, exactly the
manifest identity. The extracted `package/package.json` agrees on source commit
and managed version and reports `dirty: false`. Native `--version` and ACP
`agentInfo.version` report upstream `0.39.1`; that alone is insufficient to identify
the managed build. The executable `package/dist/main.mjs` hashes to
`29ad5dab3fb9d9e3a65710def2e93ba5cf0a181ec1ece680fc7d2f76390999d4`.

The isolated submodule checkout is `aab809cca845e4b1d0a0db243d336ab5f128b177`;
it is newer than the artifact source. Evidence below uses `git show` at the
manifest source and corroborates the distributed bundle, not current checkout
behavior. The production command is Node plus this artifact's `main.mjs acp`.
Default ACP uses `@moonshot-ai/acp-server@0.0.1` and agent-core-v2; the legacy
adapter is a separate path. ACP initialize negotiated protocol 1 and advertised
Core version-1 usage, rate limits, fork, tasks, subagents and compaction. It
advertised no Molly Design design generation/read contract. The runtime's source pins
`acp-extension-core@0.1.0`; no implementation was copied into the root workspace,
no gitlink changed, and Kimi remains excluded from root pnpm.

## Native observation and source explanation

A synthetic loopback OpenAI-compatible provider drove the unmodified downloaded
artifact over real JSON-RPC ACP. A separate `KIMI_CODE_HOME` held synthetic model
and hook configuration with telemetry disabled. No paid provider, user settings,
global environment mutation, Electron session or canonical design commit was used.
The hook script reported events to the loopback control host, which could hold its
HTTP answer until a later provider request. This provides explicit causal evidence
without a scheduling-speed assertion.

- `SessionStart`, `UserPromptSubmit`, `TurnStarted` and tool hooks actually loaded
  from the isolated configuration. UserPromptSubmit occurred once before the first
  request; it did not recur for subsequent tool-result generations.
- Native Read returned a synthetic text file containing over 6,000 characters and
  its final marker to the model. The next request arrived before its PostToolUse
  hook was observed. A later request arrived while that hook's response was held
  open; its `tool_output` contained exactly 2,000 characters.
- Native Write wrote `synthetic write` when PreToolUse exited 1. Another Write
  wrote `timeout allowed` after its PreToolUse HTTP response was deliberately left
  unresolved until the configured one-second native timeout. These are native
  failure-policy probes, not sleeps or timing-dependent regression tests.
- Native Edit was refused when PreToolUse exited 2; the original bytes remained.
  `PostToolUseFailure` distinguished this refusal and a missing-file Read failure.
- The actual shell tool is `Bash`. Its pre-hook fired, but both synthetic calls
  failed with `ACP terminal capability is unavailable` under this probe's empty
  client capabilities. This proves that path's failure feedback, not successful
  shell execution, shell exit-code semantics or coverage of background processes.
- MCP capability advertisement is not a native MCP read/write acceptance test.
  Cancellation, missing hooks, successful shell/MCP, manual Bento changes, stale
  refusal/reread, explicit same-byte resubmission and final design commit remain
  unverified for Kimi. T19's acceptance criteria remain incomplete.

At the manifest source, agent-core-v2's
[external hook adapter](https://github.com/LodyAI/acp-extension-kimi/blob/f255222661c9cc2842901858fd28e554d7796a51/packages/agent-core-v2/src/features/externalHooks/agent/agentExternalHooksService.ts) registers
`onDidExecuteTool` but calls `notifyPostToolUse` without awaiting an external
response. That method fire-and-forgets the result and slices successful output
at 2,000 characters. Its external loop registration handles Stop after a finishing
step and explicitly skips `tool_calls`; it exposes no awaited pre-generation
external hook. `internal/types.ts` likewise has no generation event. The
[native hook runner](https://github.com/LodyAI/acp-extension-kimi/blob/f255222661c9cc2842901858fd28e554d7796a51/packages/agent-core-v2/src/features/externalHooks/internal/runHook.ts) returns allow on spawn/wait failure, timeout, abort,
and non-2 nonzero exits. The pre-tool path rechecks abort, so runner allow-on-abort
alone is not proof a cancelled tool executes. The legacy engine independently
has the same truncated, fire-and-forget post-result boundary and cannot serve as
a workaround.

## Decision and remaining work

Do not infer complete delivered bytes from a fresh filesystem read, freeze the
baseline at PreToolUse after arguments exist, or let a same-generation read
upgrade already-generated writes. ACP notifications, permission requests and
MCP registration do not supply the missing awaited generation boundary. A root
adapter built around these signals would violate the existing contract.

The alternative of changing isolated source locally and importing or patching it
into the desktop would bypass the checksummed managed artifact boundary. An
independent runtime change and public artifact release are prerequisites; neither
publication nor an unpublished gitlink was authorized. Required capability is
complete successful delivered content with an awaited fence before each model
request, plus dependable refusal semantics for supported controlled writes. Once
that artifact exists, reverify identity and timing, then reuse the current shared
service and run the entire native design journey, including cancellation and
missing/failed-hook cases. Final structure, assets, versions and canonical CAS
remain independent protections; they cannot retroactively provide tool-visible
conflict handling to an already-ended turn.

## Verification record

Local synthetic probe code and captured events are under
`/tmp/folio-t19-audit/`; they are deliberately outside Git. The nine-generation
expanded run ended naturally with the expected write bytes and Edit refusal.
No captured transcripts, source copies, configuration or runtime files are committed.
Full repository type checks, lint and tests passed, including 2,613 CLI tests and
3,274 component tests; four CLI and three Loro RPC tests retain existing skips.
The first full check then rejected a literal public runtime host in this note
because host ownership is restricted to the platform module. Replacing it with
the configured-host reference preserves the artifact evidence without duplicating
that constant. Formatting, documentation and final boundary checks passed. This evidence
supports the blocking conclusion only; it does not mark Issue #21 complete.

## Verdict

Status: rejected. The complete-read and generation-frozen baseline this record
demanded was retired when the product adopted [editor-owned PPTD save](../../implemented/simplification/2026-09-12-editor-owned-pptd-save.md)
and [noninvasive reminders](../../proposed/simplification/2026-09-12-noninvasive-design-hooks.zh.md).
The managed-runtime timing and truncation observations remain accurate, but they
no longer block design support. This record is retained so the stronger contract
is not reintroduced without a new artifact release.
