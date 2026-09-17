# Codex design hooks: verified runtime boundary

Status: rejected
Translation: pending

## Abstract

Codex's native file and shell hooks cannot currently satisfy Molly Design's required
model-generation fence. The pinned runtime emits useful pre/post tool events,
but does not provide an awaited boundary before each model request or associate
those events with a sampling generation. A native synthetic-provider probe also
shows that interactive shell input has no separate prehook and that failed Bash
commands can return the same hook text as successful reads. T18 remains blocked;
this record and its reproducible probe do not enable a partial production adapter.

## Scope and ownership

This records [Issue #20](https://github.com/LeonEthan/molly-design/issues/20), following
[shared read hooks](2026-09-10-design-sync-hooks.zh.md),
[Pi's native integration](../../implemented/architecture/2026-09-11-pi-design-hooks.md)
and [workflow convergence](../../proposed/simplification/2026-09-11-design-workflow-convergence.zh.md).
The existing `DesignSyncService` and `DesignSyncBaseline` remain the only owners
of successful-read evidence, generation-frozen digest/attempt identity, prewrite
checks and explicit resubmission. No production code, runtime pin, public contract,
submodule commit, global configuration or Spec intent changes here.

A later Codex adapter must preserve the original dispatch manifest and independently
check live baseline, exact draft digest, structure, assets and canonical CAS at
natural completion. A missing hook cannot create a baseline. Reading then writing
or explicitly resubmitting in the same model generation must still fail. Old calls
and results cannot borrow a later attempt, including same-byte resubmission.

## Versions and configuration

On macOS arm64, `codex --version` returned `codex-cli 0.153.4`, matching
[`codex-runtime-manifest.json`](../../../../apps/cli/src/agent/codex-runtime-manifest.json).
The executable was the installed npm launcher at `/opt/homebrew/bin/codex`;
its native arm64 binary SHA-256 was
`b973d440acac501fd2594a43e7ca9ce41e0a65b9dfb28d0d7a7837c99e1261e3`.
The checked-out public ACP submodule is `acp-extension-codex` **1.10.0**, commit
`9b4c96140c90100ea60c1f4ce3a7fdd7e6cb4b4f`.

The ACP [entry](../../../../packages/acp-extension-codex/src/index.ts) reads
`CODEX_PATH` and JSON `CODEX_CONFIG`; its
[process launcher](../../../../packages/acp-extension-codex/src/CodexJsonRpcConnection.ts)
starts that executable with `app-server` and inherited environment.
[`CodexAcpClient.createSessionConfig`](../../../../packages/acp-extension-codex/src/CodexAcpClient.ts)
merges session config and forwards actual ACP MCP servers as `mcp_servers` in
`thread/start` and `thread/resume`. Pi's missing-MCP workaround does not apply.
This launch/configuration statement is source inspection, not a new ACP end-to-end run.

The probe runs **native CLI exec**, with a temporary `CODEX_HOME`, temporary
`config.toml` and `hooks.json`, and a local synthetic Responses provider named
`probe` using model identifier `gpt-6-astra`. It passes hook trust explicitly for
that isolated invocation, disables plugins/recommended plugins, and passes a
small environment allowlist. It neither reads credentials nor changes user/global
settings. It does not establish Electron, ACP, paid-model or visual-quality acceptance.
The early exploratory run without the plugin flags logged an unauthenticated
featured-plugin warmup failure; the sealed probe disables that feature.

## Actual native sequence and tool coverage

Run from the repository root:

```sh
node apps/cli/scripts/probe-codex-design-hooks.mjs
```

The probe requires Node 22+, Python 3 and the exact CLI version on PATH (or
`CODEX_PATH`). It scripts six model responses and uses native tools to read a
fixture, write a file, apply a patch, start an interactive Python process, send it
input and execute an exit-7 read. It asserts file contents and runtime outcomes,
not timing or mock call counts. A bounded watchdog only terminates a failed probe.
Actual hook/result files stay in its temporary directory; no captured transcript
is committed or printed.

| Path                                                    | Observed evidence                                                                              | Boundary                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `exec_command` reading a complete file                  | `PreToolUse`/`PostToolUse`, tool name `Bash`, exact returned text                              | No independent Read tool is assumed; arbitrary commands do not declare reliable file/range identity        |
| `exec_command` writing a file                           | Bash pre/post hooks and changed file                                                           | Prehook is after arguments exist, not a model-generation boundary                                          |
| `apply_patch`                                           | Native `apply_patch` pre/post hooks, patch in `tool_input.command`, file created               | Potential write adapter path, not currently authorized by shared evidence                                  |
| `write_stdin` with nonempty input                       | Interactive file receives exact submitted line; original Bash posthook arrives                 | No prehook or tool event with the `write_stdin` call ID; initial exec observation cannot cover later input |
| Bash exits 7 after printing the complete fixture        | Actual native command result reports exit 7; posthook returns exactly the successful read text | Posthook text alone is not successful-read evidence; no exit code field is supplied there                  |
| MCP                                                     | Source shows namespaced pre/post payloads and real ACP forwarding                              | Native MCP execution was not probed; arbitrary server results do not prove local file delivery or mutation |
| Partial/truncated/cancelled reads, hook failure/absence | Not native-tested in this slice                                                                | No baseline may be inferred; existing shared rejection contract remains required                           |

The observed hooks span six model requests but use one `turn_id`, one initial
`UserPromptSubmit`, tool call IDs and a final `Stop`. Native tool results can arrive
in either order within the first response; ordering is not used as a generation
identity. There is no generation-frozen digest or attempt epoch in these payloads.

The sealed probe passed with evidence directory
`/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/folio-t18-native-dN7OZb`;
its sanitized summary is local at `/tmp/folio-t18-sealed-probe-final.log`.
The probe is a runtime-boundary audit, not proof of stale-write rejection,
Agent reread/retry, same-byte resubmission or independent final commit in Codex.
Those Issue acceptance items remain unimplemented and unverified.

## Why existing events cannot close the gap

Official runtime source was inspected at tag `rust-v0.153.4`, commit
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`:

- [Hook catalog](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/hooks/src/lib.rs#L21)
  lists 12 events, with no before-model or post-tool-batch hook.
- [Pretool request](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/hooks/src/events/pre_tool_use.rs#L24)
  carries session/turn/tool identities and already-generated arguments.
- [Sampling loop](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core/src/session/turn.rs#L368)
  constructs input and invokes `run_sampling_request` without an external awaited
  hook at this boundary. Post-generation response completion is handled later.
- [Interactive transport](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs#L124)
  explicitly returns no pretool payload and attributes eventual completion to the
  original command.
- [Bash hook output](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core/src/tools/context.rs#L404)
  supplies truncated text when the process finishes; this is not the full native
  result envelope containing exit status.
- [MCP hook mapping](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core/src/tools/handlers/mcp.rs#L412)
  uses the actual namespaced tool and its arguments/results.

ACP's [event handler](../../../../packages/acp-extension-codex/src/CodexEventHandler.ts)
currently ignores `rawResponseItem/completed` and `rawResponse/completed`. Even
forwarding these asynchronous post-response notifications would not establish an
acknowledged pre-generation snapshot. A transcript path is neither a flush guarantee
nor proof that an observer captured the draft digest before argument generation.

Starting a new generation on each pretool event allows same-response reads to
authorize later old arguments. Starting it on each posttool event has the same
problem and races parallel results. Keeping one generation for the entire user
turn prevents legitimate same-turn reread/retry. Reading/hashing the draft only
when a write arrives is too late to meet the explicit-attempt contract. None is an
acceptable replacement for the mandatory fence.

## Required upstream seam and disposition

The smallest missing runtime contract is an **awaited signal before each model
sampling request**, including continuations, bound to a stable generation identity
that accompanies its later tool calls/results. Molly Design must be able to freeze eligible
complete reads, exact draft digest and attempt epoch at that signal and reject
unknown or stale identities. The signal must not be merely a best-effort notification
after generation has started. A supported existing upstream extension point meeting
that contract would suffice; no replacement runtime or general hook platform is
proposed here.

Native result success/truncation metadata and interactive follow-up prechecks remain
separate coverage requirements after that blocker. MCP can carry optional
`molly_resubmit_draft` only once the real pre-generation fence binds its unchanged
bytes; forwarding MCP alone cannot authorize it.

Disposition: **BLOCKED**, preserving the shared contract. No upstream patch or
unpublished submodule gitlink is presented as reproducible delivery. The required
runtime capability and its managed/public distribution would need verification
before continuing production integration. Desktop proof should follow only after
that seam exists; running a partial adapter would not establish the Issue's claims.

## Validation

The final native probe and `node --check` passed. `corepack pnpm@10.20.0 format`,
`docs check` and `git diff --check` passed; documentation reported no errors and
only pre-existing rule-file size warnings. No SHA-protected topic changed. The
full `corepack pnpm@10.20.0 check` also passed, including 2,611 CLI tests and
3,305 component tests; existing suite skips remain unchanged. The root full-check log is `/tmp/folio-t18-check.log`; child test environments strip
inherited `ANTHROPIC_*` and `CLAUDE_CODE_USE_*` values without printing them.
Native acceptance is macOS arm64 only. Linux/Windows, MCP execution, ACP/Electron
lifecycle, conflict retries and final Codex commits remain unverified.

## Verdict

Status: rejected. The per-model-generation fence this record required was removed
from the product contract by the approved [editor-owned PPTD save](../../implemented/simplification/2026-09-12-editor-owned-pptd-save.md)
and [noninvasive reminders](../../proposed/simplification/2026-09-12-noninvasive-design-hooks.zh.md)
decision. The native runtime gaps documented here remain accurate runtime evidence,
but they no longer block a production adapter under the reminder-only design. This
record is retained to prevent resurrecting the stronger hook contract without a
new upstream runtime seam.
