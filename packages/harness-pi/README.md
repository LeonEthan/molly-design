# Molly embedded Pi

This package is Molly's Agent engine: the public Pi SDK (`@earendil-works/pi-coding-agent`
1.0.0) plus unmodified published Pi packages, behind an ACP adapter. The CLI host owns
dispatch, credentials, design transactions and session history policy; Pi owns the model
loop, tools, resource discovery and native conversation history.
Intent: [embedded harness Spec](../../specs/molly-embedded-pi-harness.md).

## Pi profile

Each worker runs with `PI_CODING_AGENT_DIR=<molly-data>/harness/pi/config/workers/<sha256(runtimeEpoch)>`,
its own native Pi agent directory. The launch environment and worker bootstrap derive
the same path before importing the SDK. It never reads or writes the user's `~/.pi/agent`. On startup the worker
writes the profile's `settings.json` from [profile-settings.ts](src/profile-settings.ts), listing
shared `MOLLY_PI_PACKAGES` (Settings › Advanced › System › Engine details reports the same set):

| Package                              | Purpose                                        |
| ------------------------------------ | ---------------------------------------------- |
| `pi-subagents`                       | Delegation to foreground and background agents |
| `pi-skillful`                        | Skill discovery and inline expansion           |
| `@juicesharp/rpiv-ask-user-question` | Questions through the GUI form dialog          |
| `@zigai/pi-mention-skill`            | Typed `$skill` mentions                        |
| `@ff-labs/pi-fff`                    | Fast file search tools                         |
| `cc-safety-net`                      | Deterministic destructive-command floor        |

Packages are referenced by their absolute paths in the sealed closure and loaded by Pi's
native package discovery; none is patched or forked. `cc-safety-net` is also listed in
`subagents.defaultExtensions`, because sub-agent children load only that list. The
`pi-subagents` built-ins that drive another installed CLI (Codex, Claude Code, Cursor) are
disabled through `subagents.agentOverrides`: they would run on another account and skip that
list.
`defaultProjectTrust` is `never`: opening a directory does not authorize its `.pi`
settings, packages or JavaScript extensions. Pi's saved trust grants remain authoritative
inside that worker profile; a fresh worker does not inherit another profile's grants or
package state. Materialized text skills in the workdir's `.agents/skills` load through
`DefaultResourceLoader.additionalSkillPaths`, independently of executable project trust.
Tools run without permission checks.

The managed profile enables native Codemode with `defaultTools: ['+codemode']` and
`codemode.mode: 'on'`, including fresh sessions without MCP. Ordinary tools remain
directly available; direct `read` returns image content to the model. Pi owns script
execution, tool discovery and nested calls. The published foreground sub-agent factory
also loads native Codemode when its tool ceiling permits it.
Main-session Codemode uses `createCodemodeExtension({ models: false })`, so scripts get
no `models` global. Pi 1.0 otherwise lets scripts run OpenRouter's built-in image models
with the chat key, bypassing the user's image connection. Sub-agent children still load
Pi's default Codemode, and published settings cannot turn `models` off; this is a known
upstream limitation ([redesign proposal](../../research/redesign-proposal.md), Q2).
Reopen follows the unmodified Pi 1.0 SDK factory: saved messages remain intact, while
active tools come from the current profile defaults and native MCP activation. A saved
tool declaration does not override that factory loadout. Loading history performs no
inference or tool execution.

The managed settings disable native agent and provider retries. The main host's public
`session_before_compact` hook also cancels overflow/truncation recovery when Pi would
retry inference; ordinary compaction remains available. These settings do not change
the unmodified sub-agent package's separate lifecycle behavior.

In RPC mode Pi binds select/confirm/input/editor/notify to the existing ACP form dialog
([session.ts](src/session.ts), [extension-ui.ts](src/extension-ui.ts)). Terminal components,
widgets, footers, autocomplete and the sub-agent fleet view are unavailable.

## Credentials and models

The host grants the selected connection's key over the private fd-3 pipe for each run.
The worker pins its first granted key in memory with `setRuntimeApiKey` and
stores it through Pi's native `login` in the profile's `auth.json` and writes a custom
endpoint's provider entry into `models.json`
([profile-credentials.ts](src/profile-credentials.ts)). Sub-agents, including detached
background runners that outlive the turn, read those files. Workers sharing a Pi provider
ID have separate files, so one connection cannot replace another's endpoint or key.
A changed grant retires the worker before replacing either key; rotation needs a fresh
worker and never automatically replays the fenced run. A process lock
holds native login and the `models.json` read-merge-publish together, so concurrent updates
retain other providers. The catalog is still replaced atomically, keeping readers from
seeing a partial file. Lock contention has a bounded retry budget and fails the run rather
than stealing from a live worker. Old shared profiles are neither imported nor deleted;
product history restores independently. Deleting a connection or retiring a worker does
not yet remove its plaintext profile copy or revoke a detached child's provider key.

[model-connection.ts](src/model-connection.ts) registers the selected connection in memory,
including declared OpenAI-compatible models. Pi applies a provider endpoint override to every
model of that provider, so a connection on its preset's default endpoint
(`PROVIDER_PRESET_DEFAULT_BASE_URLS`) registers no override and each model keeps its own SDK
endpoint: OpenRouter serves Anthropic-protocol models at `/api` and the rest at `/api/v1`.
A custom endpoint still replaces every model's. When a connection lists `models`, the
conversation picker offers only those catalog models and the worker refuses any other with
`harness_model_not_in_catalog`; without the list it offers the whole preset catalog. Settings'
free key check follows `PROVIDER_PRESET_CHECKS`, which a test keeps in step with each preset's
SDK protocol. Model and thinking selection are fixed per
worker; hooks in [host.ts](src/host.ts) retire the worker if an extension changes them.

## ACP adapter

[agent.ts](src/agent.ts) and [session.ts](src/session.ts) adapt the lifecycle of
[`victor-software-house/pi-acp` 0.17.1](https://github.com/victor-software-house/pi-acp/tree/9c027cf6c5fc76ea85433139e750e18f87e706ba)
to the current SDK; [translate/](src/translate) is copied from that revision
([MIT license](src/LICENSE.pi-acp), shipped in the bundle). Success requires native
settlement and a final assistant entry; cancellation, truncation and handled commands are
reported distinctly. Native usage is projected to Core usage notifications
([usage.ts](src/usage.ts)); sub-agent usage is not included.

ACP MCP servers, including Molly's design and image servers, are registered through Pi's
native `createMcpExtension`, `createCodemodeExtension` and `createToolSearchExtension`
([mcp.ts](src/mcp.ts)). Protected MCP credentials arrive once per worker on fd 3.
A catalog `description` (and Molly's fixed built-in summary) travels in ACP
`_meta.mollyMcpDescription` and becomes Pi's native server `description`, the one line
listed in the `mcp_servers` prompt section. Catalog `exposure` and `toolExposure` use
Pi's names and values and travel as `_meta.mollyMcpExposure`/`mollyMcpToolExposure`.
`toolExposure` is stored and sent as ordered `{ pattern, exposure }` rules, because Flock
does not keep object key order and Pi applies the first matching pattern; the harness
rebuilds Pi's object in rule order (`toPiToolExposure`);
an invalid value refuses the session (`pi_acp_mcp_exposure_invalid`) rather than falling
back to a default. The built-in server keeps Pi's default `codemode` exposure.
Only the daemon-identified built-in Molly servers (`molly` and, in design sessions,
`molly_image`, which share the built-in catalog identity) in the managed host receive native
`timeout: 900` (seconds); external and standalone ACP servers retain Pi's default.
This is Pi's progress-reset request timeout, not an absolute whole-operation deadline.
Image-service request deadlines and cancellation remain unchanged. Timeout or Stop
does not prove that an image service stopped or did not bill; uncertain paid calls are
not automatically replayed.
Custom HTTP headers such as `X-API-Key` are valid without `Authorization`; the vault
values replace public headers case-insensitively and reach native requests literally.
They stay in extension configuration in memory. Pi may use its normal OAuth fallback
after a 401 when no Authorization header exists; this does not turn the custom header
into OAuth credentials or persist that header in native OAuth state.
Known upstream defect: [Pi #10249](https://github.com/earendil-works/pi/issues/10249) — a
server still starting during shutdown can outlive it. Molly does not patch around it.

Live tool activity preserves native call IDs, canonical names and parent IDs in the
existing product history and activity rows. On native-only restore, Pi's bounded
`nestedCalls` summaries supply child names, arguments and recorded statuses, but no
original child results. Recovered rows say that results are unavailable; incomplete
records remain unknown. Existing product results survive reopen, and history restore
does not run scripts, repeat paid calls or commit artwork.

The managed host ([host.ts](src/host.ts)) validates each run snapshot against the worker,
fences the run with an exclusive record in `<private>/runs` before reading credentials
([run-journal.ts](src/run-journal.ts)), adds Molly's system prompt, host time, the
read-before-edit reminder and recalled personal preferences through `before_agent_start`,
and extracts new preferences after completion ([personal memory](../../specs/personal-memory.md)).
The native completion receipt is durably settled before extraction starts. Caller
cancellation sends ACP cancel and retains the pending response until native settlement;
the CLI validates the run, epoch and current catalog before accepting it. Revoked workers
and invalid receipts still fail. Explicit Stop keeps dispatch paused and cancels artifact
finalization, independently of the completed native response; existing Stop escalation
still applies if the worker cannot settle.
The extraction result's measured provider/model usage is appended through native
`SessionManager.appendUsage` before cancellation, stop-reason or JSON validation, then
projected through the same Core notification path. Extracted text stays transient.
Malformed responses, cancellation and capture failures preserve the completed main
receipt and measured usage. A failed notification remains pending for a later cumulative
flush; it never retries inference or adds another native usage entry.

Native histories keep the previous layout,
`<private>/sessions/<sha256(connection)>/<sha256(product session)>/`, so sessions created by
earlier releases restore unchanged ([native-session.ts](src/native-session.ts),
[profile.ts](src/profile.ts)). An `.acp-lock` beside a history records its owner process and refuses a second writer; a
lock whose owner has exited (the host stops workers with SIGKILL) is taken over. Its
`.acp-lock.guard` stays held through shutdown and marker removal; empty or malformed legacy
markers remain untouched and refuse acquisition because their owner's exit is unproven.

[process-lock.ts](src/process-lock.ts) provides both locks. It publishes a fully staged,
nonempty directory containing a unique PID/UUID owner filename. Recovery removes only
the exited owner's filename, then attempts a nonrecursive `rmdir`. A successor's nonempty
directory survives a delayed recovery or release; release is idempotent. Only `ESRCH`
proves exit, so permission errors, unexpected probe failures and reused PIDs keep a lock
held. Empty abandoned guard directories are recoverable. These guards coordinate workers
from this revision; already running workers from an earlier build must stop before using
the repaired protocol. History files and their partition layout are unchanged.

## Build and verification

`apps/cli/scripts/build-embedded-harness.mjs` bundles [entry.ts](src/entry.ts) and stages
Pi and every package dependency into the sealed `harness/` closure with a checksummed
manifest. `molly-pi-agent.js --probe` reports the engine and package count without a key.
The workspace, CLI install/startup checks and bundle require Node `>=22.19.0 <23 || >=23.6.0`
with Node-API 10, matching Pi 1.0.0 and the SQLite binding.
The Settings capability reader verifies the staged question package's `package.json`
and `LICENSE` against that manifest and exposes only public package metadata.
`apps/cli/scripts/smoke-embedded-harness.mjs <cli-output> [node]` starts the bundled worker
in a temporary root, checks package commands and tools, runs one turn against a loopback
synthetic model, executes native Codemode and a nested file read, and checks the profile
credential. This exercises the sealed QuickJS worker/WASM resources rather than only
checking that files exist.

On macOS, signing changes the sealed native binaries' bytes. The public
[`mac.sign` hook](../../apps/electron/scripts/sign-embedded-harness.mjs) compares their
code payloads in temporary copies, updates full resource hashes before the root app's
signature seals the manifest, and verifies the resulting closure. Non-signature changes
fail packaging. Final signed-product smoke uses the packaged Helper executable.

Package tests use the real SDK with synthetic providers in owned temporary profiles:
[adapter\*.test.ts](tests) cover lifecycle, MCP, trust, usage and the managed host;
[profile-packages.test.ts](tests/profile-packages.test.ts) loads every package natively,
checks the safety floor blocks without prompting and answers a question through the GUI.
[CLI cancellation integration](../../apps/cli/tests/embedded-harness-cancellation.test.ts)
reuses the managed synthetic worker through real ACP and the production Session/client/control
path. MCP tests exercise custom header requests through an in-memory fetch transport;
profile/host tests cover transient failures and refused overflow/truncation recovery.
[Codemode image/design integration](../../apps/cli/src/mcp/codemode-image-design.test.ts)
uses native Codemode and the actual Molly image server with synthetic transport. It
covers generation/editing receipts, direct image reads, live and reopened asset paths,
YAML authoring, natural completion and the existing canonical CAS commit. Assets and
draft files alone do not commit the canvas.
[profile-races.test.ts](tests/profile-races.test.ts) forces stale-marker and catalog-update
races with explicit barriers; [process-lock.test.ts](tests/process-lock.test.ts) checks
competing reapers, delayed cleanup and real worker death without timed sleeps.
One desktop design run (DeepSeek, text and shapes) completed without permission prompts.
An additional macOS arm64 packaged-daemon/worker check on 2026-10-01 made two live image
tool calls through the configured OpenAI Images proxy: generation took 17.3 seconds and
editing took 22.7 seconds. Both returned 1254×1254 PNGs despite requesting 1024×1024.
Receipt hashes matched the saved files and each current native image read. The ordinary
no-open-view canvas flush, YAML authoring, natural completion and canonical CAS succeeded;
parent relationships and asset receipts survived opening a fresh local-plane history replica.
Language inference was controlled loopback, with a source Electron protected-credential host;
this does not establish autonomous visual judgment, GUI or live daemon-restart acceptance,
upstream proxy billing, or real latency above 60 seconds. Native deterministic tests cover
the longer timeout boundary. Background sub-agents and other providers remain unverified.
