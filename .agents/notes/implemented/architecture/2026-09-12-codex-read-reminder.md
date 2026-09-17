# Codex public read-before-edit reminder

Status: implemented
Translation: pending

## Abstract

The earlier Codex integration was blocked by an unavailable model-generation
boundary. The approved design now uses ordinary editor-owned PPTD saves and a
public reminder hook, so that boundary is unnecessary. Folio injects a fixed
read-before-edit rule through native UserPromptSubmit hooks while preserving user
configuration and trusting only its own bundled command. A managed-runtime ACP
probe demonstrates fresh context delivery, existing-file editing, new-file
creation and process-restart resume; it does not claim enforced read ordering.

## Decision and scope

This implements the revised reminder scope of
[Issue #20](https://github.com/LeonEthan/Folio/issues/20), following the approved
[noninvasive reminder decision](../../proposed/simplification/2026-09-12-noninvasive-design-hooks.zh.md)
and [editor-owned save decision](../../implemented/simplification/2026-09-12-editor-owned-pptd-save.zh.md).
The [prior runtime audit](../../rejected/architecture/2026-09-11-codex-design-hook-boundary.md)
remains valid historical evidence about tool events; its generation-proof blocker
no longer applies to this revised reminder-only task. This change does not
implement or certify the separate save/projection and final-collector migration.

`Session.createAgent` applies `withCodexDesignReminder(env)` only to built-in
Codex design sessions, using the existing `designHooks` activation bit. SessionManager enables that
bit from durable design metadata and disposes an unhooked speculative Codex
process before recreating through the ordinary cold-start path. Ordinary
sessions, other agents and custom launchers retain their previous behavior. The
existing ACP lifecycle supplies the overlay to new and resumed sessions. There
is no new AgentClient/RPC protocol, runtime patch, shell parser, read ledger,
model proxy, generation state or mandatory tool.

The shared `DESIGN_READ_BEFORE_EDIT_REMINDER` literal requires:

- Read current disk contents before modifying existing files, and complete
  contents before replacing a whole file.
- Reread and adjust after changes or conflicts.
- Do not read nonexistent targets before creating new files.
- For continued artwork, read the latest current-design paths supplied by the
  turn instead of relying on memory while editing a retained draft.

The bundled `codex-design-reminder.js` returns only native UserPromptSubmit
`hookSpecificOutput.additionalContext`. It accesses no design files or service.
The event places context before the model request; it does not reject tools or
retroactively authorize generated arguments. Canonical validation and commit
permissions remain separate. Native patch matching and tool permissions remain
unchanged. Shell, interactive stdin and arbitrary MCP are not universally guarded.

## Configuration and native trust

ACP `1.10.0` at public submodule commit
`9b4c96140c90100ea60c1f4ce3a7fdd7e6cb4b4f` reads JSON `CODEX_CONFIG` and passes its
configuration through normal `thread/start`/`thread/resume`. The helper appends a
UserPromptSubmit group to existing session hooks, preserving unrelated fields,
other events and existing hook state. The hook is a separate bundled entry so its
command names an application-owned script with safely quoted executable paths.
The existing development build guard verifies that child lookup remains beside
the CLI entry, rather than moving into a split chunk.

Native Codex `0.153.4` requires a matching hook trust hash even for session flags.
The helper supplies only the appended group's `hooks.state` record under the
native synthetic session-config path. Its normalized identity is compact,
alphabetically ordered JSON with the event name and the exact synchronous
command/timeout/type, SHA-256-prefixed as the native implementation expects.
No global trust bypass flag is passed; no user hook is newly trusted. Public
source: [native hook identity](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/discovery.rs#L768),
[hash encoding](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/config/src/fingerprint.rs#L50)
and [session/user state precedence](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/config_rules.rs#L16).

Malformed config and dotted `CODEX_CONFIG` `hooks.*` overrides produce an explicit
startup error instead of dropping or guessing their merge semantics. The supported
shape is one nested `hooks` object; existing user files are never rewritten.
Explicit `features.hooks=false` stays false. User/system policy may disable hooks;
reminder absence is not a reason for final artifact rejection. The trust encoding
is verified against the current managed manifest, not a new runtime version gate.
Future runtime changes require repeating native delivery verification. Windows
path/quoting support is source-level only until exercised on Windows.

## Native verification

Run from repository root after building ACP adapters and the CLI dev bundle:

```sh
FOLIO_PROBE_CODEX=/path/to/managed/codex apps/cli/node_modules/.bin/tsx apps/cli/scripts/probe-codex-design-reminder.ts
```

The probe uses the real bundled Codex ACP and managed native executable, with a
synthetic localhost Responses provider and model identifier `gpt-6-astra`. It
creates a temporary CODEX_HOME/workdir and passes an environment allowlist. No
credentials or user/global configuration are copied or changed. Runtime logs and
transcripts remain local; only assertions and a sanitized summary are printed.

Verified behavior:

- Every model request contains the complete rule from the actual native hook.
- Native shell reads an existing fixture and native apply_patch changes it.
- Native apply_patch creates a new file without reading that nonexistent target.
- ACP exits before a fresh process loads the same session and prompts again.
  The reminder's model-input occurrence count increases from one to two, proving
  fresh delivery rather than merely recovering old context; the resumed native
  read receives the previously changed bytes.
- A pre-existing trusted user hook still supplies its own context, while a
  pre-existing untrusted hook supplies none.
- The synthetic config.toml stays byte-identical.

Only external model responses are scripted. These observations prove context and
native execution, not model understanding, universal read-before-write enforcement,
semantic design quality, Electron behavior or production final artifact commits.
No paid model or Electron was launched for this slice. Acceptance is macOS arm64;
Linux and Windows remain unverified.

The development build file already contained one NUL byte at HEAD. This change
adds only the Codex entry (83 bytes); removing that line restores the exact original
bytes. The binary-looking Git diff is not a new encoding change.

## Validation

The managed binary used was
`/Users/macmini/.lody/agent-binaries/codex/0.153.4/darwin-arm64/bin/codex`.
The final synthetic probe summary is `/tmp/folio-t18-reminder-probe-final.log`,
with isolated evidence under
`/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/folio-codex-reminder-ShNfZy`.
Ten deterministic tests cover configuration preservation/rejection, exact-command
trust, durable design activation, ordinary-session exclusion and speculative
runtime disposal before cold startup. Development bundling and CLI typecheck
passed. Full `corepack pnpm@10.20.0 check`, `format`, `docs check` and `git diff --check`
passed. The full check included 2,668 CLI tests and 3,288 component tests; existing
suite skips remain. After the final SessionManager activation hunk, CLI typecheck,
lint and all 31 tests in the affected session-manager/reminder set passed again.
Both development and production CLI bundles passed. The production-bundle ACP
probe passed independently with evidence under
`/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/folio-codex-reminder-eijFYS`
and summary `/tmp/folio-t18-reminder-production-probe.log`. Select the production
bundle with `FOLIO_PROBE_BUNDLE_DIR=apps/cli/dist`. No SHA-protected topic changed;
docs reported no errors and only existing rule-size warnings. Test child
environments omit inherited `ANTHROPIC_*` and `CLAUDE_CODE_USE_*` values without
printing credentials.
