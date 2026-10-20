# Molly embedded Pi

This package is Molly's Agent engine: the public Pi SDK (`@earendil-works/pi-coding-agent`
1.3.0) plus unmodified published Pi packages, behind an ACP adapter. The CLI host owns
dispatch, credentials, design transactions and session history policy; Pi owns the model
loop, tools, resource discovery and native conversation history.
Intent: [embedded harness Spec](../../specs/molly-embedded-pi-harness.md).

## Pi profile

Each worker runs with `PI_CODING_AGENT_DIR=<molly-data>/harness/pi/config/workers/<sha256(runtimeEpoch)>`,
its own native Pi agent directory. The launch environment and worker bootstrap derive
the same path before importing the SDK. It never reads or writes the user's `~/.pi/agent`. On startup the worker
writes the profile's `settings.json` from [profile-settings.ts](src/profile-settings.ts), listing
shared `MOLLY_PI_PACKAGES` (Settings › Advanced › System › Engine details reports the same set):

| Package                              | Purpose                                 |
| ------------------------------------ | --------------------------------------- |
| `pi-skillful`                        | Skill discovery and inline expansion    |
| `@juicesharp/rpiv-ask-user-question` | Questions through the GUI form dialog   |
| `@zigai/pi-mention-skill`            | Typed `$skill` mentions                 |
| `@ff-labs/pi-fff`                    | Fast file search tools                  |
| `cc-safety-net`                      | Deterministic destructive-command floor |

Packages are referenced by their absolute paths in the sealed closure and loaded by Pi's
native package discovery; none is patched or forked. The managed runtime is single-session:
[`pi-subagents` retirement #72](https://github.com/LeonEthan/molly-design/issues/72) removes the
package, child configuration and foreground/background/workflow launch surfaces. Existing
native/product histories and shared task-history readers remain available. `cc-safety-net`
continues to load in the main session; the worker sets `CC_SAFETY_NET_PROJECT_TIGHTEN_ONLY=1`,
so a project policy can tighten the user's policy but never weaken it.
`defaultProjectTrust` is `never`: opening a directory does not authorize its `.pi`
settings, packages or JavaScript extensions. Pi's saved trust grants remain authoritative
inside that worker profile; a fresh worker does not inherit another profile's grants or
package state. Materialized text skills in the workdir's `.agents/skills` load through
`DefaultResourceLoader.additionalSkillPaths`, independently of executable project trust.
Tools run without permission checks.

The managed profile enables native Codemode with `defaultTools: ['+codemode']` and
`codemode.mode: 'on'`, including fresh sessions without MCP. Ordinary tools remain
directly available; direct `read` returns image content to the model. Pi owns script
execution, tool discovery and nested calls.
Main-session Codemode uses `createCodemodeExtension({ models: false })`, so scripts get
no `models` global. Pi 1.0 otherwise lets scripts run OpenRouter's built-in image models
with the chat key, bypassing the user's image connection. Removing the delegation package
closes its separate default-Codemode route. Ordinary shell and trusted native code retain
normal OS-user access; this is not an OS sandbox.
Pi writes output files (full truncated tool output, binary MCP resources and images shown
from scripts) to `TMPDIR` and never removes them. Each worker therefore gets its own
`<private>/tmp/<pid>.<uuid>` as `TMPDIR` ([worker-temp.ts](src/worker-temp.ts)) and removes
it on exit. A worker stopped with SIGKILL leaves its directory; the next worker removes
directories whose owner PID probe returns `ESRCH`, using the history guards' ownership check,
and leaves live owners and unidentified entries untouched.
Reopen follows the unmodified Pi 1.0 SDK factory: saved messages remain intact, while
active tools come from the current profile defaults and native MCP activation. A saved
tool declaration does not override that factory loadout. Loading history performs no
inference or tool execution.

The managed settings enable Pi's native agent retry: one initial request plus at most
three retries, with 1s/2s/4s backoff capped at 20s. Provider/SDK retries stay disabled,
so retries use the existing ACP `kind: 'retry'` activity. Only the failed model request
repeats; Molly never replays the dispatched prompt/turn or completed tools, and Pi does
not execute tool calls from an errored response. The main host's public
`session_before_compact` hook still cancels overflow/truncation recovery when Pi would
repeat inference; ordinary compaction remains available.

Known Pi limits, observed on 1.0.4 and not listed as fixed in the 1.3.0 changelog: partial text already streamed before a failure remains visible
beside the retried answer because ACP has no retraction. A bare `529` or `ECONNRESET`
without accompanying overload/connection-error text is not matched by Pi's retry
classifier. Retry-After values are not honored; backoff is fixed. Ordinary compaction
summarization uses the same retry budget, but its `summarization_retry_*` events are
not surfaced through ACP. Pi's generic "provider returned error" match may also retry
a wrapped permanent error; Molly's final diagnostic checks permanent categories first
but does not change Pi's native retry decision.

The maintainer deferred the bare-code/network matching, wrapped permanent-error and
Retry-After defects to [#143](https://github.com/LeonEthan/molly-design/issues/143),
outside #137's merge acceptance. They remain unresolved pending released upstream
fixes; Molly keeps the SDK unmodified and adds no retry-policy workaround.

In RPC mode Pi binds select/confirm/input/editor/notify to the existing ACP form dialog
([session.ts](src/session.ts), [extension-ui.ts](src/extension-ui.ts)). Terminal components,
widgets, footers and autocomplete are unavailable.

## Credentials and models

The host grants the selected connection's key over the private fd-3 pipe for each run.
The worker pins its first granted key with `setRuntimeApiKey` and uses Pi's public
`InMemoryCredentialStore` and `InMemoryModelsStore`; `modelsPath: null` keeps old profile
models out of session construction. Connection configuration remains registered in memory.
No native login or `auth.json` / `models.json` publication serves child runtimes anymore.
Workers sharing a Pi provider ID keep separate runtimes and cannot replace another
connection's endpoint or key. A changed grant retires the worker before replacing its key;
rotation needs a fresh worker and never automatically replays the fenced run. The CLI replaces a used OAuth worker before its next prompt, restoring the same native
history and granting the current token to a new epoch. This adds startup and MCP reconnection
to each OAuth follow-up; API-key workers retain their ordinary reuse policy. Existing
profile files are neither imported nor deleted; product history restores independently.
This stops new profile credential copies, not prior copies or keys held by old processes.

Before upgrading from a build that bundled `pi-subagents`, finish or stop outstanding old
foreground, background and scheduled extension tasks. The old package exposes
`subagent({ action: "stop", id: "<run-id>" })` (and `/subagents-stop`); a stop request alone
is not proof that a detached process exited. Upgrade only after old tasks have exited;
when that cannot be established, defer the upgrade. The new build does not kill unrelated
processes, revoke old provider keys or erase old profiles. Detached-process settlement has
not been validated by this retirement's synthetic checks.

[model-connection.ts](src/model-connection.ts) registers the selected connection in memory,
including declared compatible models for Anthropic Messages, OpenAI Chat Completions,
OpenAI Responses and Gemini Native generateContent. Runtime, discovery and response checks
share base-URL normalization for Responses/Gemini: trailing slashes, repeated version segments
and a pasted resource suffix do not duplicate the request path. Gemini keeps the version
in the base URL and uses Pi's native Google adapter, including its streaming/tool/thinking
and abort handling. Compatible Anthropic Messages and Chat Completions connections accept an explicit
empty key through the existing bound run grant. Responses/Gemini reject empty keys
before persistence, admission and transport; missing credentials never become a
placeholder key. A credential-only native provider keeps the
SDK catalog/transport and omits Authorization for an empty stored key; it never reads an
ambient key. The SDK's nonempty placeholder is internal to request construction and never
becomes a persisted or brokered credential. Compatible models preserve saved
`usageInStreaming` values; an absent declaration omits `stream_options` so discovery
does not presume endpoint support. Pi applies a provider endpoint override to every
model of that provider, so a connection on its preset's default endpoint
(`PROVIDER_PRESET_DEFAULT_BASE_URLS`) registers no override and each model keeps its own SDK
endpoint: OpenRouter serves Anthropic-protocol models at `/api` and the rest at `/api/v1`.
A custom endpoint still replaces every model's. Since Pi 1.3.0
([#10720](https://github.com/earendil-works/pi/issues/10720)) Kimi Code uses OpenAI Chat
Completions at `https://api.kimi.com/coding/v1`; a connection saved with the earlier default
`https://api.kimi.com/coding` (with or without a trailing slash) is migrated to the new default
on load by the shared saved-connection schema, preserving identity, revision and credentials.
Vault, IPC and runtime reads share that normalization. Typed addresses on `api.kimi.com` must use
`/coding/v1`, with or without a trailing slash. API-key and OAuth checks both list
`https://api.kimi.com/coding/v1/models` with Bearer authentication; saving neither verifies
account access nor chooses a model. When a connection lists `models`, the
conversation picker offers only those catalog models and the worker refuses any other with
`harness_model_not_in_catalog`; without the list it offers the whole preset catalog. Settings'
free key check follows `PROVIDER_PRESET_CHECKS`, which a test keeps in step with each preset's
SDK protocol. Model and thinking selection are fixed per
worker; hooks in [host.ts](src/host.ts) retire the worker if an extension changes them.

Responses/Gemini keep the unmodified Pi wire adapters. The existing native provider
registration composes both `stream` and `streamSimple`: Responses receives a fetch
that forces `redirect: 'error'` after request options; Gemini awaits the existing
payload callback, preserves its replacement, then forces the same policy through
`config.httpOptions.fetch`. Caller fetch/payload options cannot replace enforcement.
Completion helpers, native compaction and personal-memory extraction use these same
registered methods. Existing protocols and native presets retain their transport.

Pi remains 1.3.0. The exact pnpm override
`@earendil-works/pi-ai@1.3.0>@google/genai: 2.23.0` supplies Google's published public
fetch hook; mem0ai's Google 1.52.0 graph is unchanged. Molly owns compatibility of
this override: changes require native streaming/tool/reasoning/cancel and redirect
regressions, Pi-relative resolution in the staged closure, manifest/hash verification
and the existing packaged synthetic smoke. `build-embedded-harness.mjs` asserts the
staged Pi-relative Google version; update that assertion with the reviewed override.
There is no SDK patch, global fetch replacement or worker dispatcher policy.

## ACP adapter

[agent.ts](src/agent.ts) and [session.ts](src/session.ts) adapt the lifecycle of
[`victor-software-house/pi-acp` 0.17.1](https://github.com/victor-software-house/pi-acp/tree/9c027cf6c5fc76ea85433139e750e18f87e706ba)
to the current SDK; [translate/](src/translate) is copied from that revision
([MIT license](src/LICENSE.pi-acp), shipped in the bundle). Success requires native
settlement and a final assistant entry; cancellation, truncation and handled commands are
reported distinctly. Native usage is projected to Core usage notifications
([usage.ts](src/usage.ts)).

For the compatible Responses/Gemini types, Settings checks the selected model with one
unretried generation request capped at 512 output tokens; it may incur provider usage.
Visible text at normal completion or an output-token-limit stop proves a response;
failed or reasoning-only replies do not. Model discovery remains separate and does
not establish that the selected model can respond. Other protocols retain one GET.
Gemini discovery requests pageSize=1000 and follows opaque
page tokens on the same endpoint with redirects refused, one 15-second abort signal,
a 2 MiB aggregate response budget, 2,000 models and at most 100 pages.

Final managed model errors use the static ACP diagnostic `harness_model_request_failed`
with a category: context overflow, authentication, quota, content policy, invalid request,
endpoint/model not found, server unreachable, transient (retries exhausted), or unknown. HTTP 402, payment-required and exhausted-credit
errors map to quota. Explicit blocked-request, policy, prompt-injection, moderation,
safety or guardrail evidence takes precedence over HTTP 403's authentication fallback.
Permanent evidence takes precedence over Pi's transient classifier. The shared `embedded-run-contract` owns the category vocabulary and exhaustive mapping to
`ModelRequestFailureCode`, derived from `ChatFailedCodeSchema`; missing or unknown categories
map to `model_request_failed`. The CLI uses this mapping in the existing
upstream-service notice and retires the failed worker, preserving conversation and draft
files for an explicit new message. Provider text/bodies never enter this diagnostic;
unknown host failures retain their generic static code. Worker retirement never replays
the dispatched prompt/turn.

ACP MCP servers, including Molly's design and image servers, are registered through Pi's
native `createMcpExtension`, `createCodemodeExtension` and `createToolSearchExtension`
([mcp.ts](src/mcp.ts)). Protected MCP credentials arrive once per worker on fd 3.
Catalog labels may contain spaces or non-ASCII characters. The adapter keeps names
already accepted by Pi unchanged; other labels use a short deterministic native name
derived from the existing catalog ID, or the original name for standalone ACP servers.
Their readable label remains in the native description. Catalog IDs, revisions,
credential bindings and saved names are unchanged; duplicate native names are refused.
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
Since Pi 1.0.4 ([#10249](https://github.com/earendil-works/pi/issues/10249)), shutdown also
closes a server that is still connecting before it returns; a harness test covers this.

Live tool activity preserves native call IDs, canonical names and parent IDs in the
existing product history and activity rows. On native-only restore, Pi's bounded
`nestedCalls` summaries supply child names, arguments and recorded statuses, but no
original child results. Recovered rows say that results are unavailable; incomplete
records remain unknown. Existing product results survive reopen, and history restore
does not run scripts, repeat paid calls or commit artwork.

The shared [`embedded-run-contract`](../shared/src/embedded-run-contract.ts) builds and checks
run snapshots, MCP and session bindings, and request/response `_meta` envelopes. The CLI
builds snapshots; only the managed host ([host.ts](src/host.ts)) accepts them against the worker.
The host
fences the run with an exclusive record in `<private>/runs` before reading credentials
([run-journal.ts](src/run-journal.ts)), adds Molly's system prompt, host time, the
read-before-edit reminder and recalled personal preferences through `before_agent_start`
once per session. Since Pi 1.2.0 that hook also fires for idle extension
`sendMessage(..., { triggerTurn: true })` runs (`messageType: 'custom'`); Molly dispatches
only user prompts, so any other or undispatched run retires the worker with
`pi_acp_host_dispatch_missing`. The complete built string is stored as a versioned
`molly_host_system_prompt` custom native entry together with the worker's `toolsetHash`
and `pluginSetHash`, then reused byte-for-byte on later turns and fresh worker reloads,
including when host configuration changes. A reload whose tool or plugin set differs
rebuilds the prompt once, with current time and memory through the same hook, and
appends a new entry; this costs one provider cache miss but keeps the SDK tool list
honest ([#157](https://github.com/LeonEthan/molly-design/issues/157)). Version 1 entries
have no fingerprint and rebuild once the same way. When several entries exist, the latest
decides. A well-formed entry with a later integer version (above 2) and a string prompt also
rebuilds once, so a future format followed by a downgrade cannot brick a session; any
malformed entry refuses the session with `pi_acp_host_invalid_system_prompt_snapshot` rather
than being skipped. Both hashes sort by plain code-unit order, never the host locale. A Pi
upgrade that only rewords the base prompt without changing any tool keeps the saved prompt:
existing sessions are not refreshed. Earlier histories
without an entry capture it on their first subsequent inference. New sessions sample
current time and memory; changes within a conversation apply to its next session.
The host extracts new preferences after completion ([personal memory](../../specs/personal-memory.md)).
The native completion receipt is durably settled before extraction starts. Later
turns retain their pre-inference memory read for extraction revision fences; those
records never replace the frozen preference context. Caller
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

[process-lock.ts](src/process-lock.ts) provides the history writer guards. It publishes a fully staged,
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
with Node-API 10, matching Pi 1.3.0 and the SQLite binding.
The Settings capability reader verifies the staged question package's `package.json`
and `LICENSE` against that manifest and exposes only public package metadata.
`apps/cli/scripts/smoke-embedded-harness.mjs <cli-output> [node]` starts the bundled worker
in a temporary root, checks package commands and tools, runs one turn against a loopback
synthetic model, executes native Codemode and a nested file read, and checks the granted
key reaches only the synthetic endpoint without creating profile auth/model files. It also
checks the retired package, tools and commands are absent. This exercises the sealed QuickJS worker/WASM resources rather than only
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
[profile-races.test.ts](tests/profile-races.test.ts) forces stale-marker
history-owner races with explicit barriers; [process-lock.test.ts](tests/process-lock.test.ts) checks
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

The dated runs above precede [the #72 retirement record](../../.agents/notes/implemented/simplification/2026-10-04-remove-pi-subagents.zh.md); current removal checks and limits are recorded there.
