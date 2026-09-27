# Editor-owned current PPTD and noninvasive reminders

Status: implemented
Translation: current

[中文](2026-09-12-editor-owned-pptd-save.zh.md)

## Abstract

Human canvas saves previously needed an Agent read hook to refresh the current
PPTD. Saves now publish that representation next to canonical storage, independently
of Agent execution, and reopen verifies actual file contents before reuse. Runtime
hooks give public reminders; generation/read-proof ledgers and tool interception
are removed together with their final-collection gates. Independent validation,
canonical version checks, draft isolation and genuine native terminal failures
remain. Canonical save and projection publication are separate operations, so a
partial failure is explicit and recoverable rather than reported as a complete save.

## Decision and responsibilities

This implements the approved continuation described by
[editor-owned save](2026-09-12-editor-owned-pptd-save.zh.md)
and [noninvasive hooks](../../proposed/simplification/2026-09-12-noninvasive-design-hooks.zh.md).
It replaces the generation/read mechanism in the historical
[Pi implementation](../architecture/2026-09-11-pi-design-hooks.md) and
[Claude implementation](../architecture/2026-09-11-claude-design-hooks.md), preserving
those decisions as source-version evidence rather than rewriting their history.
Their removed manual probe scripts are reproducible from the original source
commits named in those notes; they do not describe the new runtime contract.

The existing store owns the canonical self-contained document and assets and
already serves human save, import and Agent commit. Its create/save/idempotent retry
path now exports current PPTD under the same artwork lock. The fixed destination is
`<dataRoot>/chats/<artworkId>/design-current`, derived from trusted workspace facts;
no persistent projection registry or per-version directory is needed. Existing
project-local projections and Agent drafts remain untouched. Session cwd does not
change. Read-only draft previews still watch their exact draft sources.

Each publication writes and fsyncs staging files, moves the previous fixed directory
aside, and publishes staging. A marker records revision and hashes, but readiness
also compares every collected file against canonical export. A replaced/missing
file with an intact marker therefore fails verification. A failed second rename
leaves canonical durable and current files unavailable; retry/reopen re-exports the
same current canonical payload. Temporary leftovers are cleanup, not history.
Healthy reads remain lockless; repair acquires the artwork lock and re-reads latest
canonical. Dispatch verifies readiness after editor flush. Frozen input recovery
never changes a prior baseline merely because projection contents changed.

A persistent projection registry was unnecessary because the canonical artwork
already has stable storage. Publishing only on Agent reads was rejected by the
changed requirement: a human save must work with no runtime. Cross-file atomicity
is not claimed; an explicit persisted-canonical/publication-failed error and blocked
dispatch cover that boundary without rolling back user edits.

## Runtime and commit contract

Pi public `before_agent_start` and Claude `UserPromptSubmit` deliver the shared
read-before-edit reminder. No generation ledger, coverage accumulation or custom
Write/Edit gate remains. The bounded existing RPC version becomes 2 and accepts
native Pi start/settlement, explicit submission and capability requests; version 1
proof requests fail protocol validation rather than fabricating support.

Explicit submission supplies `expectedRevisionId` and `artifactDigest`; the shared
service checks both against actual current canonical and draft bytes. Final
collection requires a matching artwork/path/digest before using that revision.
Pi, Claude, Codex, Kimi and Grok share this existing launch-bound submission route;
non-Pi runtimes cannot supply Pi terminal events. Speculative processes created
before durable design identity are recreated through ordinary startup, ensuring
that their MCP context carries the correct launch/source registration.
Normal changed output uses the frozen turn baseline; unchanged inherited output
still requires explicit submission. Neither re-reading nor same-byte writes
silently choose a newer base. Structure, kernel replay, assets and CAS remain
independent of reminders or submission.

Pi ACP's lossy error translation still requires its real native settlement status.
The thin adapter uses an execution ID rather than model-generation identity;
unknown/error/cancelled results cannot become synthetic success. Existing current
client, launch, source-turn and canvas-owner fences reject delayed producers.
Native tool guards belong to the runtime; shell/custom tools are not sandboxed by
Folio. No paid retry or automatic turn restart was added.

## Verification and limits

Targeted deterministic tests cover no-Agent create/human save, draft preservation,
canonical-adjacent path resolution, actual file replacement/deletion, failure after
renaming the previous projection, exact retry recovery, frozen turn replay,
explicit revision/digest mismatch, ordinary changed output without read evidence,
unchanged submission, native failure/cancellation and stale runtime producers.
The initial full `corepack pnpm check` passed, including typecheck, lint, CI tests,
platform and public boundary guards. The final full check also passed after the five-runtime
registration correction: 2,664 CLI tests and 3,288 component tests passed, with the
existing explicit skips retained. Root format,
docs check and diff checks passed. The CLI dev bundle built; its Claude hook
subprocess accepted synthetic UserPromptSubmit input and emitted the reminder,
while retired PreToolUse input produced no tool interception output. The built Pi
extension registration smoke check exposes only public reminder/native terminal
events and exact submission, with no read/tool/generation interceptor.

Local evidence logs: `/tmp/folio-t05-revised-check.log`,
`/tmp/folio-t05-revised-final-check.log`, `/tmp/folio-t05-revised-assets.log`,
`/tmp/folio-t05-revised-runtime-submission.log`,
`/tmp/folio-t05-revised-built-claude-hook.log`,
`/tmp/folio-t05-revised-built-pi-extension.log` and
`/tmp/folio-t05-revised-docs-check.log`. These contain synthetic test/check output;
no captured user or model transcript is committed.

The source-only handoff initially left desktop/native verification open. The
following integrated acceptance closes the Pi/Claude save/terminal gap using a
synthetic external provider; it does not use earlier generation-proof results as
proof of this new contract. The exported PPTD retains existing lossless conversion
and asset checks; projection does not establish visual quality or change Bento's
independent editor.

## Integrated native acceptance, 2026-09-12

The actual built OSS desktop from source
`c6830385c69f335d3b588858a4fd2ff8b7d758b4` includes this implementation
(root integration `603bf9d`), Pi MCP, Codex reminders and Git history. The existing
`ElectronHarness` launched the desktop package, bundled CLI, actual Pi `0.85.1`
with `pi-acp@0.0.33`, and actual Claude Code `2.1.258` with its bundled ACP adapter.
Provider configuration used only isolated loopback OpenAI/Anthropic endpoints and
synthetic credentials. No paid model, runtime patch, direct service substitute or
hook-registration-only success criterion was used.

Final evidence is `/tmp/folio-t05-new-contract-NSbuQU/result.json`; that directory
also holds the exact executed `probe.mjs`, native canvas/desktop screenshots and
isolated CLI/harness logs. The run log is
`/tmp/folio-t05-new-contract-run-final.log`. Bundle SHA-256 values were:

- Electron main: `324930b32d43fc0962338780d9f3c5958510089625f900574aab69e38bac9478`.
- Bundled CLI: `c0e40756882f6b9bf06107d5388cd6c402d13b522f24c63cd260fb77a9234c4c`.

All six paths passed: Pi and Claude each produced `committed`, `failed` and
`cancelled` receipts through actual Session/MessageHandler/finalization. The first
human edit was a native Bento toolbar click followed by its real public save. With
zero model requests, the probe read canonical bytes and current projection directly
from disk, verified revision and all file hashes, and imported that PPTD back to
the same document. It did not invoke `design.read` first and thereby mask a missing
save-time publication. The subsequent manual edit before switching to Claude also
left the prior Agent draft unchanged.

Held provider responses made execution observable while every tested current
canvas was read-only: native toolbar mutation left the document unchanged and
native save returned a read-only error. Actual native Read/Write tools received
current projection and draft paths, delivered the manually saved element, and
modified the draft and an ordinary file. The common reminder appeared in the real
provider request. Frozen input bytes remained unchanged, and their baseline was
the saved version captured for that explicit turn. Success changed canonical
through natural completion while preserving human elements. Provider failure and
user Stop retained the new draft but left canonical and current projection at the
preceding successful version.

Pi's successful canonical revision was
`a40d4242f95b3b3258571b6cc85f47c8b9d5b2810ab662c46fed266a22b50c34`;
its failure and cancellation retained that revision. Claude's success and both
subsequent retained versions were
`d5a1e44b37ea6763bbe9970c58b257ba964c1040af944238cad0623ebdb85f5d`.
`CLAUDE-CANCEL-final-canvas.png` was inspected and shows the retained `#667788`
canvas; the two synthetic shape elements overlap by construction. This is the
same final run and version, not a screenshot borrowed from an earlier probe.

Two probe corrections preceded the final pass. Historical conversation prompts
required selecting the latest frozen-input pointer rather than the first pointer.
Claude retried the synthetic HTTP 400 once, so the provider had to repeat the same
error instead of closing that subsequent connection; the latter had caused a
probe-only timeout. Neither correction changed product code or added product
retries. Native transport behavior is not a fabricated successful terminal event.
The final process exited zero and harness logs confirm endpoint release, directory
cleanup and completed owned-process teardown. The exclusive Electron slot was
released before documentation work. The evidence-only update also passed full
`corepack pnpm check` (`/tmp/folio-t05-native-evidence-check.log`), root format,
docs check and diff checks; no product source changed during this acceptance.

The external model was scripted, so this proves runtime/tool/IPC/storage behavior,
not autonomous artistic judgment or paid-provider compatibility. This run covered
one actual current canvas instance, ordinary chat source paths and native Pi/Claude
execution; multi-instance locking, project/worktree isolation, other Agents,
explicit resubmission and injected publication faults retain their separate test
and owner evidence. No user or model transcript is committed.

## Installed multi-instance and Git supplement

The bounded supplement passed on the normal installed package for source
`50ddd41bfb3e88537c0dcbec40c0ce86ca40b8e4`, whose identity is recorded at
`/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/folio-current-50ddd41b-78c0b9vz/package-identity.json`.
The immutable round is `/tmp/folio-t05-multi-history-kE3grc/`, containing
`probe.mjs`, `result.json`, `running-checkpoint.json`, native screenshots and CLI
logs; `/tmp/folio-t05-multi-history-run-final.log` records exit zero. It reused the
existing Electron harness, actual Pi 0.85.1 / pi-acp 0.0.33, and a local scripted
provider. No product code, package resources, runtime state or timers were patched.

The earlier T02 and T29 evidence already covered generic serial execution and
multiple native editors. This supplement tested only their interaction with
editor-owned PPTD publication and Git history. Two native instances represented
artwork A and a third represented B, all attached through the existing desktop
API. A native edit was observed dirty in A1 while A2 was clean. Ordinary composer
dispatch then froze the version containing that edit, and direct disk inspection
verified the complete current projection. This proves the pre-dispatch persistence
result; normal autosave may participate, so it does not attribute that save solely
to the explicit flush call.

During the held real Pi request, both A instances rejected native mutation and
save. The clean instance still displayed its older revision while read-only; it
did not overwrite the newer human save. Actual `design.saveVersion` and
`design.restoreVersion` calls rejected while execution was active. B remained
editable and its native save published its own PPTD. Pi's natural completion
committed revision
`70408fce58307e5bd6886f045aead58db60a2119789cdba37900d664c4908642`;
both A instances were recreated, displayed the committed background and became
editable. A subsequent native human edit saved successfully.

The Git CAS check deliberately used controlled external file replacement, not a
second product save. With the existing canonical lock held by the probe, an actual
desktop restore captured the current document and published its protective Git
entry. Read-only Git log/show inspection observed that entry and verified its
content before an atomic fixture replacement of isolated canonical bytes. After
lock release, the real restore rejected with `DESIGN_CONFLICT`, preserving the
external revision
`0f33e4717ffbe8fe64ab45d7982ff120ce3051e21e8ccf52006eb1b549c1edd3`
and exact Agent draft bytes. A subsequent normal desktop restore succeeded at
`821f0b4b117a4657b21b8fdfabab9601f52f7177a597c386fd5e3f3308d252ce`,
with matching current projection and unchanged draft. This establishes defensive
CAS behavior for an abnormal external writer; it does not claim concurrent normal
UI saves can bypass the artwork lock.

The first round `/tmp/folio-t05-multi-history-wlWDwy/` remains failed evidence:
its Pi commit and active-state checks passed, but the probe used an obsolete
WebContents ID after the product recreated native editors. The correction observes
two loaded instances by their artwork query identity and waits for their actual
committed content. It does not retain a fabricated old editor. The final screenshot
helper selected the first live native canvas, which after reload is B; that image
is not evidence of A's restored version. A's version assertions come from exact
canonical/projection bytes and the explicitly selected native instances. Harness
logs confirm completed owned-process and endpoint teardown; the UI slot was
released. No six-path replay, paid model call, or additional product protocol was
introduced.

This evidence-only supplement passed full `corepack pnpm check`
(`/tmp/folio-t05-multi-history-check.log`), formatting, docs check and diff check.
The original isolated source checkout remains unchanged apart from this note.
