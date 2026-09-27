# Claude Code design hooks through existing ACP settings

Status: implemented
Translation: pending

## Abstract

Claude Code design sessions now use the shared projection and read-baseline service through native session-scoped command hooks. The existing bundled ACP adapter accepts these settings without modifying upstream code, user configuration or existing project hooks. Native batch completion establishes the next generation's eligibility only after successful final Read output is available; native writes and explicit resubmission reuse the same attempt and final atomic-save protection as Pi. This is a version-specific tool integration, not a shell sandbox or a creative workflow.

## Decision and responsibilities

The public submodule remains `acp-extension-claude` 0.70.0 at
`d395b3dc69832c6566eb0da84a08486d16ba1e69`, with SDK 0.3.258 and managed Claude Code
2.1.258. The existing manifest remains the runtime pin. `prepareClaudeDesignLaunch`
executes the selected binary's `--version` and refuses a mismatch before dispatch;
the per-session environment carries the observed native version. The common
service's expected `runtimeVersion` denotes that **native CLI version**, not the
ACP adapter or SDK version. The daemon chooses the adapter from private live
Session launch registration, not a hook caller's claimed provider name. Existing
managed-runtime dependency/manifest checks remain intact.

`AgentClient` carries command hooks through the existing
`_meta.claudeCode.options.settings` on new, restored and replacement sessions.
Claude merges this settings layer with user/project/local settings. No global file
is edited and no installed hook list is replaced. The native child inherits the
existing selected provider environment, permission mode, model and MCP catalog.
The production/dev bundles both contain the sibling command-hook entry.

`UserPromptSubmit` starts the first shared generation. Native `PostToolBatch` runs
once after the batch has resolved, before the next model request; it supplies the
final model-visible Read output and starts the next generation. A `PostToolUse`
success is required as well, and failure/cancellation removes the pending read.
Only exact native numbered text that the common service matches against captured
projection ranges contributes coverage. Missing results, partial subsets,
rewritten text and failed calls cannot establish complete delivery. Subagent
hooks cannot contribute main-session evidence.

The thin adapter stores only native call/batch correlation. Projection, separate
drafts, exact-content attempts, resubmission epochs, artifact hashing and atomic
commit stay in the [shared Pi foundation](2026-09-11-pi-design-hooks.md).
`folio_resubmit_draft` uses the existing Lody MCP transport, takes no arguments,
and consumes an unambiguous pending native call bound to its original generation.
It is available only for a launched compatible design session. It never commits
or ends a turn; ordinary natural completion remains the collector boundary.

## Evidence and limits

The manual `probe-claude-design.ts` launches the actual bundled ACP entry and pinned
native executable against a synthetic local Anthropic provider and control/MCP
peers. It exercises Bash, failed and partial Read, complete Read, same-batch Write
refusal, successful Write/Edit, an external canonical revision change, stale-write
feedback, reread and same-byte explicit MCP resubmission. Natural collection
commits the retained draft while the original frozen manifest remains unchanged.
Separate temporary user and project hooks execute alongside session hooks.
No captured transcript is checked in; the committed probe uses synthetic fixtures.

The [vendor hook reference](https://code.claude.com/docs/en/hooks) and installed
SDK types explain the native events, but are not the acceptance evidence. Actual
native execution observed UserPromptSubmit before request zero and awaited
PostToolBatch before the next request. Read PostToolUse is structured file data;
PostToolBatch contains final numbered text. The adapter deliberately uses the
latter, after sibling output transformations.

Bash is observed but not parsed as a general file reader/writer. Arbitrary shell,
custom tools, subagents and other MCP servers establish no read baseline. Native
Read/Edit/Write are the controlled file paths; image reads remain useful but do
not attest textual design coverage. Hook payloads and tool text are bounded;
large reads must use native ranges, while draft collection retains the shared
streaming digest with no new draft-size cap. Unsupported versions fail explicitly.
The command hook has a 35-second native timeout and its control request a
30-second timeout. Parse/transport/service failures return exit 2 as native hook
feedback; they never synthesize successful read output. No universal claim is
made that every native hook timeout stops arbitrary tools. Missing live evidence
and final version/dirty-canvas checks remain independent of hook delivery. Native
hook absence and deterministic service failures were tested; a stalled real
35-second hook was not used as a timing-based acceptance test.

Deterministic tests cover failed/cancelled/missing/partial/rewritten delivery,
same-batch rejection, missing resubmission identity, runtime checks and subagent isolation.
Collector tests cover Claude output without live facts and a final atomic version
race. These checks do not establish paid-model design quality or support for
unverified operating systems/runtime versions. Electron acceptance evidence is
recorded below.

### Desktop acceptance

The existing Electron harness launched the production-built local app directory
with isolated user data, data root and endpoint. This was a development launch,
not an installed distribution. Through the actual provider settings
UI it selected the pinned Claude executable and synthetic local endpoint. The
probe inserted a shape in Bento, saved through real IPC, read that projection,
observed a same-batch Write refusal, then wrote and naturally committed while
preserving the shape. A later turn changed the canonical revision externally,
read the fresh projection and called the **product's** MCP resubmission tool;
natural collection restored the exact unchanged draft bytes. The canvas unlocked
after final processing and displayed the retained shape. Synthetic permissions
were approved individually through the ordinary “Allow Once” UI.

Evidence from 2026-09-11: `probe-claude-design-desktop.mjs` completed with
`blocked: true`, one retained element, three edit model calls, and an explicit
same-byte resubmission. Local acceptance artifacts were kept outside the checkout
under `folio-t17-desktop-QdXKGg/evidence` (canvas and application screenshots).
This is actual Electron/IPC/MessageHandler/Session/ACP/MCP/native-tool/collector
execution; only the model provider was synthetic. No paid-model quality claim.

ACP uses explicit SDK settings instead of its `CLAUDE_MODEL_CONFIG` fallback.
The launch adapter therefore carries that existing environment option's two
supported fields (`modelOverrides`, `availableModels`) into the session settings;
it does not drop enterprise model routing or forward arbitrary environment keys.
The final native probe also launched a second ACP session with our hooks absent:
actual native tools wrote a valid changed draft, but final collection rejected the
missing live baseline, preserved the canonical revision and retained draft bytes.

### Subagent scope correction

An initial wildcard handler rejected every hook payload containing `agent_id`,
which also blocked ordinary delegated Bash and file operations. Actual pinned
native execution reproduced that failure. The corrected adapter ignores subagent
reads, results and batch events so they cannot alter the main session's evidence
or generation. It permits ordinary subagent tools and refuses only native
Write/Edit on controlled projection/draft paths and `folio_resubmit_draft`.
The shared service's existing lexical path classification is reused unchanged;
no subagent synchronization engine or creative workflow was introduced.

Run `probe-claude-design.ts` with `FOLIO_PROBE_SUBAGENT=1` to exercise this boundary.
The actual Claude 2.1.258 `Agent` tool uses `run_in_background: false` so the
synthetic parent's next operation waits for its child. Native hooks identify child
PreToolUse/PostToolUse/PostToolBatch with `agent_id`. The child successfully runs
Bash and ordinary Read/Edit/Write, reads the complete published projection, then
receives refusals for draft Write, projection Edit and MCP resubmission. The
parent's subsequent Write still receives `DESIGN_READ_REQUIRED`, and controlled
bytes remain unchanged. The local run recorded three child and three parent
model requests in `/tmp/t17-subagent-after.log`; only the model/control/MCP peers
are synthetic. Deterministic tests additionally cover colliding child call IDs
and child batch/failure events without erasing or advancing parent evidence.
Arbitrary shell/custom-tool access remains outside this native path guard.
