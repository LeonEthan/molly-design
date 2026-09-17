# Grok Build public read-before-edit reminder

Status: implemented
Translation: pending

## Abstract

Grok Build 1.0.13 can deliver a read-before-edit reminder through its public
PreToolUse hook. Folio loads its own temporary session plugin and uses Grok's
existing hook-management reload because this binary discovers the plugin without
initially adding its hooks to the active registry. A synthetic headless probe
verifies native reads/edits, context delivery after tools, new-file creation and
fresh-process continuation while preserving existing user hooks and configuration.
The reminder does not appear before the first model request or force the current
already-generated write to wait for a read.

## Decision and responsibilities

This implements the revised scope of [Issue #22](https://github.com/LeonEthan/Folio/issues/22)
after the [noninvasive reminder decision](../../proposed/simplification/2026-09-12-noninvasive-design-hooks.zh.md).
The earlier [runtime gap](../../rejected/architecture/2026-09-11-grok-design-hook-runtime-gap.md)
remains evidence about the retired generation-proof proposal, not a blocker for
this reminder. Automatic PPTD publication, final collection and resubmission are
owned by the separate [editor-save migration](../../implemented/simplification/2026-09-12-editor-owned-pptd-save.zh.md).
This slice does not implement or revalidate those shared responsibilities.

A built-in Grok design Session materializes only an application-owned plugin
containing the bundled reminder command, then passes its directory through the
existing ACP session metadata `pluginDirs`. The process's normal exit or final
startup failure removes the temporary directory. User global config, project
files, plugin paths and trust records are not rewritten or copied. Ordinary
sessions and custom launchers do not receive this plugin; the shared durable
`designHooks` activation gate remains owned by SessionManager.

AgentClient adds the directory to session creation/restoration metadata alongside
its existing client identity and Lody configuration. Before exposing that session,
it invokes Grok's existing `x.ai/hooks/action` reload and `x.ai/hooks/list` through
the ACP SDK extension transport. AgentClient adds the ACP `_` extension carrier
prefix at this transport boundary; the SDK's legacy `extMethod` forwards its
method argument unchanged. The transport-neutral reminder helper keeps the
logical method names without that prefix. AgentClient verifies an enabled
PreToolUse entry with the exact application plugin source directory. This also
covers replacement-session creation for edit-and-resend. An absent, disabled,
unrelated or malformed entry produces an explicit startup error instead of a
false support claim. The existing startup timeout/abort bounds these requests;
there is no separate scheduler or runtime patch.

Only Folio's precise session plugin directory receives native caller-supplied
plugin trust. Reload retains Grok's native discovery and trust policies for other
plugins and hooks; it does not enable or trust unknown user plugins. No global
trust-disable flag is used. No model proxy is part of production; the loopback
provider exists only in the manual probe.

The shared `DESIGN_READ_BEFORE_EDIT_REMINDER` text asks the Agent to read current
contents before editing existing files, read completely before whole-file
replacement, reread after conflicts and use the latest current-design paths on
continuation. Creating new files does not require reading nonexistent targets.
The command emits native `hookSpecificOutput.additionalContext` only. It does
not read files, synchronize, deny tools, build a ledger or authorize commits.

## Actual runtime interface

The verified macOS arm64 executable is `grok 1.0.13 (5e9a58528b76) [stable]`, SHA256
`8669e0fdadceec25b8c159c355f427ffbd82583525d774b6ab1522197ea83b80`.
The pinned compatibility adapter is `acp-extension-grok@0.1.0`, public submodule
`77a994f4e0a5acec8c52020c0a8e01b0e90aaef9`. It passes these existing native extension
requests unchanged; no submodule change or new runtime distribution is required.
The managed launch remains `GROK_PATH agent stdio`.

The native initialize response advertises only `list`, `resume` and `close` in
`sessionCapabilities`; it has no `fork`. Its `agentCapabilities._meta.lody`
advertises only `usage` and `rateLimits`, with no `forkAtTurn`. Both AgentClient
fork capability flags are therefore false. The fork-at-turn replacement branch
is rejected before dispatch for this managed pair; only ordinary replacement
creation needs the reload above. The probe asserts these actual capabilities and
keeps the full initialize response in temporary evidence. This does not claim
coverage for a future Grok runtime that adds fork support.

The binary's own extracted guides, `09-plugins.md` and `10-hooks.md`, document
per-session `_meta.pluginDirs`, caller-supplied plugin trust, and PreToolUse
additionalContext. Its UserPromptSubmit guide explicitly says allowing stdout is
discarded. PreToolUse context is instead appended **after** the tool runs, with
its batch results, and reaches the next model request. It cannot change argument
generation for that current tool or prove the model obeyed the reminder. A turn
that does not call a tool gets no fresh reminder from this event. Stop feedback
would force another model continuation and was not used.

The actual native plugin list reported Folio's plugin as trusted, enabled and
`hookStatus: active`, while the active hook list omitted it and no handler ran.
Calling native reload made the exact plugin hook appear and execute. The existing
API implementation is visible in the official source's
[hook management dispatcher](https://github.com/xai-org/grok-build/blob/37949780c144e37df692e3d669051a21fec24f20/crates/codegen/xai-grok-shell/src/extensions/hooks.rs)
and [reload implementation](https://github.com/xai-org/grok-build/blob/37949780c144e37df692e3d669051a21fec24f20/crates/codegen/xai-grok-shell/src/session/acp_session_impl/hooks_plugins.rs).
That public source revision is corroboration, not a claim of a reproducible build
matching the binary's embedded revision. Native execution establishes this slice's
supported combination.

## Verification and limits

After root dependency installation and ACP/dev bundling:

```sh
FOLIO_PROBE_GROK=/absolute/path/to/managed/grok \
  apps/cli/node_modules/.bin/tsx apps/cli/scripts/probe-grok-design-reminder.mjs
```

The [probe](../../../../apps/cli/scripts/probe-grok-design-reminder.mjs) runs the
actual bundled ACP adapter, managed binary and bundled hook command with synthetic
Chat Completions responses. It uses an isolated synthetic GROK_HOME and workspace,
an environment allowlist, disabled telemetry, and no inherited provider secrets.
It does not shadow HOME, copy user configuration, launch Electron or call a paid
model. Native request captures stay in temporary local evidence, outside Git.

Verified order and effects:

- The first native model request has zero reminder copies. After its Read, the
  next request has one; after native SearchReplace and new-file Write, the count
  reaches three. The new file is created without a prior read of that target.
- A separate process loads the session with a fresh Folio plugin directory.
  Retained context starts at three copies; the continued Read adds a fourth,
  proving fresh hook delivery rather than merely replaying old context.
- Native continuation reads the prior edit's actual bytes. An existing synthetic
  user PreToolUse hook continues to contribute its own context in both processes.
  A separate config-listed but untrusted user plugin remains untrusted after both
  reloads and contributes no context; its configured directory is preserved.
- The settled synthetic config and user hook file remain byte-identical. An
  initial exploratory run found native startup adding its own
  `marketplace.default_skills_installs_purged` migration flag. The preservation
  fixture includes that existing migration marker; Folio does not run, replace or
  bypass the native migration.
- Focused tests reject unrelated/disabled hook entries and hold session exposure
  until the native reload succeeds, assert the exact `_x.ai/hooks/action` and
  `_x.ai/hooks/list` wire methods, and preserve existing session metadata.

An installed acceptance run from source `47c0808d354ce2227e4fed288a748f4fec9e2435`
exposed the missing carrier prefix: native `session/new` succeeded, then the
application sent `x.ai/hooks/action` and Grok returned JSON-RPC `-32601 Method not
found` before any model HTTP request. The same pinned native binary had passed the
headless probe because that probe already added `_` at its transport boundary.
The fix reuses that proven wire convention in AgentClient; it does not change the
runtime, adapter, reminder policy or session metadata.

Only macOS arm64 with this managed pair is natively verified. Windows quoting and
Linux behavior remain unverified. This is not universal Shell/MCP enforcement,
model understanding, visual-quality review, installation/Electron acceptance, or
final canonical-commit validation. Native errors and permissions remain native;
missing reminders are not evidence that a produced artifact is invalid. No new
read-proof or generation contract is introduced.

## Validation

For the original implementation, root `corepack pnpm check` and `corepack pnpm
format` passed; the check includes full type, lint, test, i18n and import/public/platform
boundary checks. CLI dev and production bundles built successfully, and both
native ACP probes passed before the transport fix. For that fix, the focused
reminder/session-preparation set passed 26 tests, the CLI TypeScript check passed,
and `docs check` and `git diff --check` passed with existing rule-size warnings.
The integrated root `pnpm check` and `pnpm format` subsequently passed; installed verification of the corrected wire path remains pending. Test children omitted inherited
`ANTHROPIC_*` and `CLAUDE_CODE_USE_*` values without printing them.

Development evidence is under
`/private/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/folio-grok-reminder-probe-KtPLJE`;
production evidence with the untrusted configured plugin is under
`/private/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/folio-grok-reminder-probe-QLi71x`.
The installed failure evidence is under
`/private/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/folio-installed-grok-stop-v2-S6FMNQ/evidence`.
The dev-build file's pre-existing NUL remains unchanged; removing the single
Grok entry line restores its exact base bytes. No runtime pin, submodule gitlink
or upstream publication changed. The shared five-runtime activation/migration
commit is an integration prerequisite; this commit changes only Grok's narrow
plugin and reload connection.
