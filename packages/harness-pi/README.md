# Molly embedded Pi

This package isolates the pinned public Pi SDK dependency closure from the desktop
renderer and CLI host. The host owns ACP, queueing, permissions, secrets and design
transactions; Pi owns its native conversation state and model loop.

The package is not an installed-user CLI and does not discover a global Pi command.
Production and development launch the same compiled sibling entry in the CLI bundle.
The old external Pi launcher and separate design/MCP extensions are no longer
emitted. The public
reminder, native outcome and MCP tests cover the retained responsibilities;
removing the shim does not modify user Pi installations or old native histories.

## Ownership and execution

`resource-loader.ts` validates approved extension registrations before SDK construction.
It rejects native/host name collisions, duplicate extension
tools and differing registration/definition names. Duplicate host definitions fail
before private state is created; one host-guarded native definition remains valid.
The loader snapshots approved extension order and appends its public
`before_agent_start` context hook last. For each prompt the hook samples the host
clock and `Intl` timezone, adds UTC ISO time, local date/time and the IANA zone,
then preserves the optional read-before-edit reminder. The SDK starts each hook
chain from its base system prompt, so a later prompt refreshes this context without
accumulating older timestamps; subsequent model requests in the same tool loop
keep the prompt's snapshot. Host time is separate from the task or event date.
The host supplies no geographic location; explicit user-provided location remains
usable and is not inferred from the host zone.
Injected time sources support deterministic real-SDK tests across a local day/year
boundary and timezone changes. No settings, history fields or location lookup are added.
This is not a security boundary for arbitrary native code.

`question-extension.ts` selectively registers the dialog-backed `ask_question` tool
from MIT-licensed `pi-ask-question` 0.4.0, pinned to the commit and hashes in
[`vendor/pi-ask-question/manifest.json`](vendor/pi-ask-question/manifest.json).
It uses public SDK registrations and no resource discovery. The adaptation omits
terminal rendering and the optional grill-me mode, bounds input and explicitly makes
timeout non-consensual. Its only retained answer state is native tool-result history.
The build verifies adapted-source/license hashes and includes provenance and license
resources in the sealed closure; TypeBox shares the SDK's pinned version.

Auto-review ([Spec](../../specs/generative-layered-design-workflow.md)) is the
permission mode the host freezes into every Molly run; the composer offers no
selector and earlier `ask` snapshots stay readable. `sandbox.ts` starts one
`@anthropic-ai/sandbox-runtime` 0.0.77 manager per worker on first use (macOS Seatbelt;
Linux bubblewrap with `bwrap`, `socat` and `rg`; otherwise unavailable). It denies reads
of credential stores and Molly private data while re-allowing the session cwd, limits
writes to the cwd and a per-worker temp directory, and pre-allows package registries,
GitHub, font/icon services and common CDNs. On macOS, native tools such as `sips` also
need the current user's native temp directory even when `TMPDIR` is set. The worker
allows that exact canonical directory from `getconf DARWIN_USER_TEMP_DIR`; resolution
failure grants no extra path. Its ancestors stay protected, and shutdown removes only
the worker-owned temp. Tool caches should use the workspace or `$TMPDIR`.
`auto-review-policy.ts` decides by effect:
sandboxed shell, Molly design tools, local attachment sharing and file tools inside the boundary run; a bash
`outside_sandbox` request, a protected read, a write outside the workspace and a
sandbox connection to another domain are escalations. `browser-approval.ts` reviews
the first public browser site grant through the same classifier and reuses it only
within the active run/epoch (at most eight sites). External MCP tools
retain their ordinary approvals; host URL/DNS and dispatch checks remain in force. `auto-review-classifier.ts` judges an escalation with the run's
session model through the same journaled provider path, using the reviewer prompt,
decision parser and context projection adapted from Apache-2.0 `pi-auto-approval` 0.1.1
([`vendor/pi-auto-approval/manifest.json`](vendor/pi-auto-approval/manifest.json)); its
hook, commands, config files and audit log are not used. A deny, failure or timeout asks
the user. The run journal records each approval's tool, source and decision without
arguments. Classifier records also carry a bounded `reviewOutcome`: allow, deny,
timeout, invalid_response, failed or cancelled. Older records remain readable;
no raw rationale/provider response is persisted. Cancellation and a failed journal
write deny without a prompt. Sandbox feedback preserves the command's error and
identifies observed denials as potentially incidental, not proof of its cause.
Local attachment sharing still validates workspace paths and symlinks at the host;
its response carries a local machine identity without a download URL.

`extension-ui.ts` adapts select/input/confirm/notify to an owning host using existing
Core question metadata. It binds run/caller/lifetime cancellation, clears timers,
retires each pending request before releasing its answer. Other UI operations use
the SDK's headless defaults.
Synthetic SDK tests cover question execution, native-history restore without replay,
session isolation, multi/custom answers and timeout/cancellation. Production ACP enables
the tool only when the host advertises form elicitation and `mollyQuestionUI` version 1.
The existing permission history/UI owns each question, bound to its active run and worker
epoch. The private `_molly/dismiss_question` handshake waits for host cancellation
persistence; its five-second deadline fails closed. Late answers cannot resume a stopped
run. Native question errors stop inference and report `extension_question_failed`.
Host tool/plugin hashes bind native registration and curated question/reminder identity;
MCP discovery and tool updates belong to the standard adapter.
Synthetic ACP tests exercise these paths; native desktop UI acceptance remains open.
Slash-command dispatch is not implemented by selecting a plugin without commands.
T10/A14 remain open.

Approved extensions register their native commands normally. ACP refuses implicit
command dispatch before inference; command completion is not model completion.
Model prompts keep template expansion disabled. Explicit command UI remains a
separate host capability.

SDK hook errors use a separate `bindExtensions.onError` callback, including when no
question UI is enabled. The factory latches failure per native context, requests
native cancellation without awaiting it inside the hook, and fences subsequent model
transport (including compaction). Startup hook failure refuses session creation;
an active run reports `extension_hook_failed`, even if the model already completed.
The same failed context cannot accept another prompt. A private in-process owner
identity prevents a retired context's notification from failing a replacement run.
Only static failure signals cross this boundary; raw extension diagnostics are dropped.
Synthetic native hooks verify startup, before-agent, context and completion failures.

`session-factory.ts` supplies a private ModelRuntime, in-memory credentials, explicit
settings, native SessionManager and resource loader. The SDK never discovers project
or global Pi configuration. Native history belongs to the product session, with
connection folders recording its creation partition. Restore validates its identity.
Before acknowledging a new ACP identity, the factory persists the SDK's own empty
header exclusively and reopens it through the public API. Pi otherwise delays file
creation until the first assistant message, which cannot survive pre-prompt failure.
This never repairs an existing missing/corrupt history or synthesizes messages.
Restore validates the tree without repairing the file or replaying product transcript messages. An
explicit idle-time connection/model change retires the worker before creating a new
epoch over the same native history. Legacy ACP provider changes never reuse that identity.

Kimi Code membership keys use the explicit `kimi-coding` preset and the SDK's
native Anthropic-compatible provider; Moonshot Open Platform remains `moonshot`.
Known mismatched official endpoints are rejected without silently changing providers.
The settings form labels both services and requires local key re-entry when changing
the provider. Existing encrypted records remain readable and are not auto-migrated.
Model IDs remain explicit (`kimi-for-coding` is a catalog option, not a default).
The SDK's Pi identity is retained; no Kimi CLI/Claude Code identity is spoofed.

Advanced `openai-compatible` connections now carry up to 32 explicit `customModels`
on their existing encrypted, revisioned row. The form declares model ID/name, text
and optional image input, context/output limits, tool support, streaming usage,
the max-token field and supported thinking levels. The protected catalog publisher
projects those declarations per connection, never into the bundled SDK catalog.
Legacy advanced rows without models remain readable but cannot select a fallback.

The worker registers these models through the public SDK's `openai-completions`
provider composition. This is standard Chat Completions SSE, not Responses or
vendor-specific thinking dialects. `reasoning_effort` uses the declared levels
(`off` maps to `none`); unsupported levels/tools fail before transport. Store and
developer-role extensions are off; explicit finish reasons remain required.
No user headers, scripts, per-model endpoints, model discovery or auth-file lookup
are accepted. Same model IDs on different connections retain independent metadata,
endpoints and credentials. Configuration changes reuse existing revision revocation.
The SDK requires numeric cost rates internally; zero placeholders are not known
prices and are not published as invoices. ACP retains only measured token buckets,
omitting usage receipts when streaming usage was declared unavailable.
An all-zero SDK result is also left unmeasured when the compatible response supplies
no positive token evidence; the declared capability alone is not a measurement.

Synthetic real-SDK tests cover successful SSE, image request encoding, both output
limit fields, a native tool loop, thinking restrictions, separate connections,
history restore without HTTP and ACP accounting. Vault and UI tests cover persistence,
revision invalidation, editing, missing/duplicate models and translated limitations.
They do not establish native desktop or real compatible-service acceptance.

The fixed worker accepts a public bootstrap and scoped credential grants on inherited
fd 3. ACP carries only public snapshots. The host broker binds each grant to an active
model run/epoch or selected MCP session/epoch and retires it when the main host
disappears or the connection is revoked.
Model fetch is origin-bound and refuses redirects. Provider errors remain bounded; MCP schemas/results/errors use the adapter's
standard behavior and the producing server owns credential redaction.

`acp-adapter.ts` owns one native session. It durably fences a run before inference and
requires settled native evidence before returning success. A repeated run is refused,
including after restart. Only an exclusive-open collision becomes the structured
`harness_run_already_dispatched` ACP diagnostic. The existing record is untouched and
the adapter requests neither a credential nor inference for the repeated run. Other
storage failures retain their original error. The host finalizes the failed recovery
and pauses queued dispatch until explicit Continue; a fresh run identity remains usable.
Each actual provider HTTP attempt also receives a durable run-journal request ID before
transport, including compaction. Missing settlement remains uncertain and consumes an
attempt; errors never become zero-cost invoices. Measured successful token buckets are
restored across worker replacement and reported through Core's cumulative usage extension,
qualified by connection and model. These receipts are accounting, not a request-budget gate.
`tool-presentation.ts` supplies the same native file target and ACP operation kind to
tool updates and permission requests. Relative paths are displayed against the worker
cwd; arguments and native execution semantics remain unchanged. MCP path arguments
are not treated as local file locations.
Native bash titles include the exact command because the pending-permission card
does not display raw tool arguments.
`mcp-extension.ts` converts the selected ACP servers to the public
`createMcpAdapter({ config })` configuration and loads **pi-mcp-adapter 3.2.0**
through Pi's `DefaultResourceLoader.extensionFactories`. The dependency is unmodified.
It owns tool discovery/naming, catalog updates, schemas/results, proxy/direct/script
execution, connections, cancellation and session shutdown. Molly uses its public
approval event to call the existing host permission policy. The public timeout
setting is 210 seconds. Resource discovery from approved factories uses the SDK loader;
ambient packages, project extensions, settings and skills remain disabled.

Protected MCP credentials are acquired once for the selected session/worker epoch,
matched to workspace/server/destination/revision, and sent only over inherited fd 3.
They become normal config headers or stdio environment values. Subsequent turns
reuse the same adapter and native session. Rotation, deletion, selected-catalog
changes or host loss retire the worker. The model credential remains run-scoped.
The old ACP preparation method and per-turn connection/session rebuilding are removed.
Header values beginning with `!` use the adapter's documented literal escape; values
containing adapter environment interpolation syntax are refused because they cannot
be represented literally by this release. Child environments use `inheritEnv: false`
and `literalEnv: true`. Their explicit environment starts with the existing
`createToolEnvironment` allowlist, then applies server values and selected MCP
credentials. This preserves PATH, HOME, locale and platform launch variables
(including `ELECTRON_RUN_AS_NODE`) without inheriting model credentials, proxy
settings or runtime injection variables. There is no implicit OAuth discovery for
host-configured HTTP.

Molly image generate/edit tools save validated files and return ordinary paths.
The Agent reads and uses those files with standard tools; final design collection
retains schema/replay/asset/version/CAS validation. External MCP schemas and results
remain native. The custom bridge, resource dispatcher, paid-operation journal,
image bindings/import callbacks/recovery tool and cancellation transport are retired.
Existing native history, assets, drafts and old operation files are not migrated or deleted.
No cancellation or tool result establishes exactly-once execution or absence of billing;
Molly adds no automatic paid retry.

The build compiles the published adapter entry to JavaScript and stages its unchanged
resources and dependency closure, including the scripting worker/WASM and native keyring.
The generated package entry points to that JavaScript; no runtime TypeScript loader,
source patch, fork or upstream PR is needed. The sealed manifest covers these files.

## Verification and remaining gates

`tests/provider-contract-matrix.test.ts` exercises real pinned SDK adapters with
injected synthetic HTTP responses. Its explicit model IDs are fixtures, not defaults.
For each passing row it covers text completion, a native read-tool loop, 401, 429,
network failure, truncated streams and unknown-model rejection. Dispatch/settlement
ordering, selected destination/credential, error sanitization and native outcomes
are checked; no real provider account is contacted.

| Preset            | Fixture protocol                          | Synthetic contract result |
| ----------------- | ----------------------------------------- | ------------------------- |
| OpenAI            | Responses                                 | Passed                    |
| Anthropic         | Messages                                  | Passed                    |
| xAI               | Responses                                 | Passed                    |
| DeepSeek          | Chat Completions                          | Passed                    |
| Moonshot          | Chat Completions                          | Passed                    |
| Kimi Code         | Messages (`k3-256k/high`)                 | Passed                    |
| Z.AI              | Chat Completions                          | Passed                    |
| MiniMax           | Messages                                  | Passed                    |
| OpenRouter        | Messages for the selected Anthropic model | Passed                    |
| Google Gemini API | Google Generative AI                      | Blocked before HTTP       |

Pi 0.85.1's Google adapter explicitly rejects a custom `fetch`. Molly requires that
per-request boundary for origin binding and pre-dispatch accounting, so Google
currently fails before transport even though its models appear in the catalog.
The characterization test records that failure; it is not Google acceptance.
Resolving it requires a reviewed native adapter or an explicitly approved SDK
baseline change. Neither global fetch replacement nor a silent compatible-protocol
fallback is an acceptable workaround. These fixtures also do not establish regional
endpoint compatibility, every model's capabilities or real-service support; the
partial live Kimi evidence below remains a separate evidence class.

Run package `test` and `typecheck` scripts for synthetic SDK/ACP, isolation, recovery,
credential-pipe and MCP boundary tests. After a CLI bundle build,
`apps/cli/scripts/smoke-embedded-harness.mjs <cli-output-directory> <runtime-executable>`
verifies the manifest and performs offline ACP initialize/newSession in an owned polluted
temporary workspace. It makes no model request and is not installer acceptance.
Add `--question-ui` to verify negotiated curated-plugin identity in the actual worker;
it composes with `--protected-mcp` but does not open a desktop question or run inference.
Add `--compatible-model` to construct an explicit synthetic Chat Completions model
through the bundled worker; it also composes with those two flags without inference.
Add `--measure=10` to repeat that same probe and emit raw samples plus nearest-rank
p50/p95 summaries for process spawn, ACP initialization, session readiness, optional
protected-MCP session startup, idle shutdown and point-in-time worker RSS. Each sample
uses a fresh process/private directory; OS caches are not cleared. Manifest checks
and fixture setup precede the startup clock. The report identifies the exact build,
machine and separately probed child Node/Electron versions. RSS observation currently
requires native macOS/Linux `ps`; it neither changes the worker nor measures its peak.
This is a benchmark, not a timing-sensitive unit assertion or installed-app acceptance.
No threshold is inferred from measured results. The default probe never uses a real
credential or inference.

Combine `--measure=N --compatible-model --exercise-turns=20` for a same-worker
synthetic run series: twenty completed prompts, one stream cancelled after ACP text
delivery, then one explicit successful continuation. The bounded helper
`packaged-turn-benchmark.mjs` listens only on an ephemeral loopback address and checks
the exact synthetic model/credential; it never contacts a model vendor. It verifies
native outcomes, per-request journal settlement, no additional HTTP dispatch, secret
absence and cancellation socket closure. Protected MCP configuration is reused
across turns; the probe executes the stock proxy and scripting tools against the
protected synthetic server, with one startup grant and no native session rebuild.
Raw per-turn measurements distinguish first/warm/cancelled/after-cancel phases;
separate distributions cover prompt settlement and cancellation/HTTP closure.
macOS additionally observes numeric file-descriptor counts with field-only `lsof`,
without collecting paths or contents. Linux reports RSS without that descriptor metric.
These observations are not performance pass/fail thresholds. The recorded 52-turn
protected-MCP run showed increasing RSS, so sustained memory stability remains unproven;
constant descriptor observations do not prove the absence of every kind of leak.
Live model latency, actual UI cancellation and full installed-app cold startup also
remain separate acceptance work.

For diagnosis only, add `--diagnose-gc` to the synthetic turn exercise. It preloads
`apps/cli/scripts/diagnostics/gc-observer.cjs` into the owned test child with exposed
GC and a separate IPC channel; production worker arguments and sealed resources are
unchanged. Numeric before/after memory buckets and native-history byte lengths help
separate allocation from retained history. At the first, every tenth and cancellation
checkpoints, Node's experimental `v8.queryObjects(..., { format: 'count' })` checks
the pinned public SDK constructors: exactly one AgentSession and one ModelRuntime
must remain. It never requests object summaries or heap snapshots. SDK identity is
resolved only after normal worker isolation, against the already-loaded sealed entry.
Full GC/object counting changes latency and allocation behavior, so these samples
are diagnostic evidence, not normal-run performance acceptance. The initial 52-turn
checkpoint run retained one session/runtime throughout; it does not exclude every
kind of leak or establish a long-running natural-GC memory bound. Deadline failures
are reported as probe failures, not provider or product cancellation outcomes.

Image settings now use the same main-process encrypted vault as model connections.
Legacy Flock migration encrypts a backup before acknowledging exact-row removal;
it is restart-safe and does not erase historical CRDT data or old backups. The UI
warns about those copies and recommends key rotation. MCP discovery receives public
metadata only; paid calls request a key against an active model-run lease. Explicit
settings probes run in main and do not generate images. Synthetic tests cover migration;
live configured credentials have been exercised through main-host run leases. Historical
secret removal and migration of all old records have not been audited.

The protected host exchange registers one available Molly Agent and projects the
checksummed offline SDK model catalog into existing ACP capability storage. The existing
composer selects an explicit connection/model/thinking combination; its placeholder is
not executable. Registration does not change the default or migrate existing sessions.
Historical acceptance below predates the standard adapter migration and is not
evidence for the new MCP implementation.

The bundled macOS build has exercised protected local stdio MCP credentials through
native settings, per-turn approval, settlement and a new explicit turn after restart.
Both turns used the same native history; restarting itself made no model request.
The synthetic credential canary was absent from native history and run/operation records.
This does not establish real external HTTP service or historical-secret-erasure acceptance.
Full asset recovery, full design/UI integration, native community-extension UI acceptance,
native Session/Role migration acceptance and legacy UI/download/packaging retirement remain open.
The CLI launch resolver, direct Session startup and generic spawn boundary now refuse
external harness targets; the old login runner has been removed. This does not prove
all entry-point UX or installed-build retirement acceptance.
The bundled macOS build has live Kimi inference, image generation/editing and
native-history restore/image-reading evidence. An assisted synthetic nine-element
poster continuation also passed intake, preview-image reading and current-artwork
commit; native UI verified V1/V2 saving, manual geometry editing, version switching,
PNG export and restart persistence. The initial and first repair runs failed and
remain recorded. This is not acceptance for other providers,
full native installers, the complete design journey or human visual quality.

## Personal preference memory

When the design host provides memory, the adapter recalls bounded preferences into
`before_agent_start` system context. After successful native settlement it asks the
selected journaled ModelRuntime for a strict preference change plan, then requests
a revision-checked host save before retiring the run credential. Extraction uses
only current user text and existing preferences, excludes project/brand facts, has
a 30-second bound and never retries. Cancellation suppresses late saves. Memory
failures are reported separately from native completion. See
[personal memory](../../specs/personal-memory.md).

Personal memory reuses this run lifecycle independently of the session-lived MCP
adapter. Recall follows the durable duplicate-run fence; extraction and capture
finish before the model credential is retired. The host retains the active run
identity solely for callback ownership checks, clearing it on settlement. No
per-turn MCP preparation or private image callbacks are restored.
