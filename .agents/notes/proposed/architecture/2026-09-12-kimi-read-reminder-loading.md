# Kimi public read reminder: scoped loading gap

Status: proposed
Translation: pending

## Abstract

Kimi's pinned managed runtime can deliver a read-before-edit reminder through its
public UserPromptSubmit hook. The earlier missing generation boundary is no longer
a blocker under the approved reminder-only design. However, the actual ACP command
loads hooks from the Kimi home configuration or globally installed plugins and
exposes no verified session-scoped overlay. That finding still rules out silent
hook injection. Later normal-package evidence establishes the public-plugin
combination with an explicitly registered plugin in an isolated Kimi home, as
recorded below; no runtime patch or static-skill substitute is introduced.

## Later installed evidence and user setup

The normal-package `folio-t28-kimi-current-IovONp` round subsequently passed
actual in-session Agent selection, native public-plugin reminder delivery,
current-PPTD reads, permissioned draft writes and collector commit. The
[installed matrix](../../implemented/testing/2026-09-11-installed-five-agent-matrix.md)
records its package/runtime identity and limits. The plugin was registered only
in the isolated test home; user credentials and global configuration were not
copied or changed.

This proves the conditional installed combination, not an automatic hook overlay
or an installation in the user's own home. Personal plugin installation is a
separate opt-in setup decision, not a requirement to mutate global configuration
to close T19/T28's technical verification. Original Issue 21 and the Spec explicitly
preserve that configuration. The native TUI installer command remains unverified,
and Molly Design does not claim that the reminder works before the plugin is registered.
The initial outcome below records the earlier gap, before this installed evidence.

## Revised responsibility

This follows the approved [noninvasive hook decision](../simplification/2026-09-12-noninvasive-design-hooks.zh.md)
and [editor-owned PPTD save decision](../../implemented/simplification/2026-09-12-editor-owned-pptd-save.zh.md).
The [earlier native audit](../../rejected/architecture/2026-09-11-kimi-design-hook-boundary.md) remains evidence
about runtime behavior, but its complete-read/generation requirements have been
superseded. Its recommendation to require a runtime release for those proofs is
not the current plan. This note does not implement editor-owned saves or change
final schema, replay, asset or version checks.

The current [shared reminder](../../../../apps/cli/src/design/read-before-edit-reminder.ts)
asks for current disk reads before editing existing files, complete reads before
replacement, rereads after changes/conflicts, and latest-current-design reads on
continuation. New files are exempt from reading nonexistent targets. Delivery
supplies behavioral context only; no read ledger or universal Shell/MCP guard is
required or claimed.

## Verified artifact and public surfaces

The unchanged [managed manifest](../../../../apps/cli/src/agent/kimi-runtime-manifest.json)
pins `0.39.1-lody.f255222661c9`, source
`f255222661c9cc2842901858fd28e554d7796a51`. The retained public artifact still matches
SHA256 `a4bfb622023ceaf249faecf8da8508ee400af242de2d4590b72d64e95a0bbbb8`;
`package/dist/main.mjs` hashes to
`29ad5dab3fb9d9e3a65710def2e93ba5cf0a181ec1ece680fc7d2f76390999d4`.
Native version is `0.39.1`, ACP protocol is 1, and the default route uses the v2
engine. The isolated submodule remains at `aab809cca845e4b1d0a0db243d336ab5f128b177`;
source inspection uses the manifest's older commit, not the checkout as a proxy
for the shipped artifact. No submodule revision, root dependency or artifact changed.

The native [UserPromptSubmit handler](https://github.com/LodyAI/acp-extension-kimi/blob/f255222661c9cc2842901858fd28e554d7796a51/packages/agent-core-v2/src/features/externalHooks/agent/agentExternalHooksService.ts)
awaits the configured script and appends successful stdout as a hook-origin user
message before model execution. This public event is suitable for the reminder.
Existing native Edit instructions already require Read before each edit and after
an earlier edit changes the file; Write instructions require reading before
replacement. These existing descriptions support the behavioral rule but do not
constitute Molly Design hook loading or enforcement of successful prior reads.

The [external hook loader](https://github.com/LodyAI/acp-extension-kimi/blob/f255222661c9cc2842901858fd28e554d7796a51/packages/agent-core-v2/src/features/externalHooks/app/externalHooksRunnerService.ts)
combines the app's `hooks` configuration with enabled installed-plugin hooks.
Bootstrap resolves configuration as explicit programmatic `configPath` or
`<KIMI_CODE_HOME>/config.toml`. The distributed `acp` command only passes the home
directory into the server; it exposes no configuration-path or plugin-directory
argument. Plugin discovery reads `<KIMI_CODE_HOME>/plugins/installed.json`, not a
per-session plugin overlay. ACP `session/new` forwards workspace and MCP fields;
`session/set_config_option` accepts model, mode and thinking, not hooks.

## Native headless verification

Two unmodified artifact processes used separate temporary Kimi homes, synthetic
loopback OpenAI-compatible model responses and telemetry-disabled configuration.
No paid model or Electron was launched; no real user configuration was read or
written by the probe. The hook printed the exact shared reminder on
UserPromptSubmit. Both processes ran an initial prompt and an explicit continuation.

| Probe | Observed result |
| --- | --- |
| Hook in isolated home `config.toml` | Two UserPromptSubmit events; the exact reminder was present in both model requests before their responses; both prompts ended naturally |
| Same hook moved into workspace `.kimi-code/config.toml` | No hook events and no reminder in either request; ordinary ACP prompts still completed |
| Native `acp --config <path>` | Rejected with `unknown option '--config'` |
| ACP `session/set_config_option`, `configId: hooks` | Rejected with code `-32602`, `Unknown configId: hooks` |

The source and native result agree on a configuration-loading gap. Successful
home-config loading does not prove a Molly Design-scoped launch integration. These probes
do not claim model judgment, enforced read ordering, new-file/edit behavior,
process-restart resume, Agent switching, cancellation or final design acceptance.
The earlier native audit separately records hook error/timeout fail-open behavior;
under the new scope, absent reminders cannot be treated as failed read evidence.

Local synthetic scripts/logs remain under `/tmp/folio-t19-audit/`, including
`probe-reminder.mjs`, `probe-reminder-project.mjs` and their logs. They are not
committed transcripts or production integration code.

## Initial outcome and alternatives

The Kimi reminder integration in T19 /
[Issue #21](https://github.com/LeonEthan/molly-design/issues/21) remains incomplete under
the revised scope. This does not block Kimi native file tools, editor-owned PPTD
saves, independent final validation or another Agent's reminder integration. There is a usable public event but no verified
noninvasive loading path for the current managed executable. Molly Design does not add
Session wiring that silently replaces Kimi's home, modifies its global hook/plugin
configuration, or imports the isolated engine to reach a programmatic bootstrap
option. Shadowing the home and copying or symlinking its credentials, sessions,
MCP state and plugin registry would create a new ownership/lifecycle mechanism
merely to inject a reminder, so it is not implemented.

Keep native tool descriptions and protections intact. Static skills are useful
context but are not a fallback completion of this hook requirement. The minimal future choices are a verified official scoped-loading facility or
a public reminder plugin that the user actively installs into their own Kimi
configuration. Neither choice is implemented or authorized as an installation
here. Do not patch or publish the runtime to manufacture a surface. The existing managed artifact and independent design
save/commit work continue unchanged.

## Repository validation

The full `corepack pnpm check` passed, including type checking, lint, tests,
i18n/import guards and platform/public boundaries. The CLI suite passed 2,671
tests; its four existing skips and the Loro RPC suite's three existing skips
remain. `corepack pnpm format`, `corepack pnpm run docs check` and
`git diff --check` passed. Child checks removed inherited `ANTHROPIC_*` and
`CLAUDE_CODE_USE_*` environment values without reading or printing them.
Documentation remains proposed, translation pending; this record is evidence
of the gap, not an implementation or an approval of the draft Spec.
