# Molly embedded Pi

This package isolates the pinned public Pi SDK dependency closure from the desktop
renderer and CLI host. The host owns ACP, queueing, permissions, secrets and design
transactions; Pi owns its native conversation state and model loop.

Implementation is in progress under the
[implementation plan](../../.agents/notes/proposed/architecture/2026-09-19-embedded-pi-harness-implementation.zh.md).
The package is not an installed-user CLI and does not discover a global Pi command.
Production and development launch the same compiled sibling entry in the CLI bundle.
The old external Pi launcher and separate design/MCP extensions are no longer
emitted. Their shared cancellation delivery transport remains here. The public
reminder, native outcome and MCP tests cover the retained responsibilities;
removing the shim does not modify user Pi installations or old native histories.

## Ownership and execution

`resource-loader.ts` validates approved extension registrations before SDK construction.
It rejects native/host name collisions, Molly/MCP namespace claims, duplicate extension
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
`auto-review` Molly permission mode. `sandbox.ts` starts one
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
within the active run/epoch (at most eight sites). Ask mode and external MCP tools
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
its response carries a local machine identity without a download URL. Ask mode retains
the ordinary approval for these tools.

`extension-ui.ts` adapts select/input/confirm/notify to an owning host using existing
Core question metadata. It binds run/caller/lifetime cancellation, clears timers,
retires each pending request before releasing its answer and rejects terminal UI.
SDK shallow-copying requires an opaque theme object whose operations fail explicitly.
Synthetic SDK tests cover question execution, native-history restore without replay,
session isolation, multi/custom answers and timeout/cancellation. Production ACP enables
the tool only when the host advertises form elicitation and `mollyQuestionUI` version 1.
The existing permission history/UI owns each question, bound to its active run and worker
epoch. The private `_molly/dismiss_question` handshake waits for host cancellation
persistence; its five-second deadline fails closed. Late answers cannot resume a stopped
run. Native question errors stop inference and report `extension_question_failed`.
Frozen tool/plugin hashes include the actual registration and curated source identity.
Synthetic ACP tests exercise these paths; native desktop UI acceptance remains open.
Slash-command dispatch is not implemented by selecting a plugin without commands.
T10/A14 remain open.

Until command mappings exist, resource loading rejects native command registrations
with `harness_extension_command_unmapped`. ACP separately refuses a registered command
before the run journal or credential request, and invokes model prompts with implicit
SDK command/template expansion disabled. Ordinary slash-prefixed text stays model input.
Approved skills remain system resources; there are currently no prompt templates.
This closes an implicit execution path, not the remaining command-discovery/dispatch
requirement. Read-only, configuration-changing and execution-triggering commands still
need explicit host-owned mappings and acceptance before they can be offered.

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

The fixed worker accepts a public bootstrap and run-bound credential grants on inherited
fd 3. ACP carries only public snapshots. The host broker binds each grant to an active
run/epoch and retires it when the main host disappears or the connection is revoked.
Model fetch is origin-bound and refuses redirects. Provider/MCP error diagnostics are
replaced before native persistence; successful content is not rewritten.

`acp-adapter.ts` owns one native session. It durably fences a run before inference and
requires settled native evidence before returning success. A repeated run is refused,
including after restart.
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
`tool-operation-journal.ts` records minimal dispatch receipts,
not a second transcript: MCP can make paid or irreversible calls outside the product's
existing subagent Operation workflow, so it needs a pre-call replay fence of its own.
Unknown outcomes stay recorded as unknown across worker reloads, and a dispatched
tool-call ID is never replayed. Dispatches within one run settle in order; an unknown
MCP result or dispatched image failure returns to the model as an ordinary tool
result or error, and the Agent decides whether to call again
([generative layered design](../../specs/generative-layered-design-workflow.md)).
The harness adds no run stop or retry of its own. The built-in image receipt distinguishes
pre-dispatch refusal, upstream rejection and uncertain delivery/import. Successful image
digests are retained for recovery; receipts themselves do not import or commit a canvas.
When a dispatched call throws, its existing receipt may also retain a fixed `failureStage`:
`dispatch` covers invocation and linked resource delivery, `receipt` covers built-in receipt
validation, `import` covers the owning-host import boundary, and `persistence` covers
settlement writes. These labels never contain the original error, response or credentials.
They identify the failing boundary, not the upstream cause. A provider-reported unknown
result, an interrupted worker or a failed diagnostic write can still have no stage;
absence does not establish where the failure occurred or authorize another paid request.

MCP tools use the existing ACP server list, frozen schemas and the host permission UI.
They revalidate availability/schema after approval and deliver cancellation before closing
the transport. `mcp-content.ts` maps bounded text/image and embedded-resource results.
Resource links use only the producing MCP client's `resources/read`, after separate
approval and a durable dispatch receipt; capability absence is explicit. The returned
URI must match exactly. Local-file/data/credential-bearing URIs and unsupported binary
resources are refused, with no host filesystem or direct URL fetch fallback. Same-result
duplicate links share one read. Output has aggregate byte/block limits and canonical
base64 checks; the call and its reads share a 210-second execution deadline, with each
resource read capped at 30 seconds. Ordinary resources deliver model context only;
declared image results additionally pass the owning-host import gate described below.
Only built-in `molly_render_preview` maps exact Molly-owned font failures to
`harness_render_font_failed` and known native capture/layout failures to
`harness_render_failed`. Unknown server text and transport diagnostics remain
`harness_mcp_tool_failed`; an external tool with the same name gains no exception.
The built-in preview's validated asset-admission metadata maps to
`harness_render_asset_too_large` or `harness_render_asset_format_unsupported`, with
the bounded `media/<filename>` path and actual/allowed bytes or declared asset kind.
The producer builds its text from the same validated fields. Invalid paths, unknown
fields, forged error text and transport exceptions retain the generic failure;
raw diagnostics never become asset metadata.
These signals add no retry, repair or completion gate.
The built-in MCP producer supplies its public contract revision. Image dispatch instead
records the image connection revision frozen at run start; later configuration changes
revoke the owning lease. Workspace MCP writes establish a local monotonic revision; historical
rows must be explicitly saved before embedded execution. Selected catalog edits/deletion
retire the owning worker, including same-revision legacy writes and changes during approval.
No-auth external connections carry their catalog identity. Raw headers/env and ambient-variable
interpolation are excluded from embedded startup, as are HTTP URL credentials/query/fragment.
Settings store explicit MCP values in the main vault and only their reference in the catalog.
The host acquires a run/epoch-bound grant before authenticated discovery, matching workspace,
server, destination and revision. Values travel on fd 3; the private ACP preparation method
carries public metadata only. Discovery rebuilds the SDK session through public APIs over
the same native history, freezes the final toolset, and only then permits model credentials
and inference. Protected clients close and are dropped at settlement; the next turn requires
a new grant. Preparation is bounded and cancellation/revocation retires its worker.
Legacy agents refuse protected references. Saving still does not test a connection.
Explicit settings saves move current literal fields into the vault, but there is no
background migration or erasure of old plaintext history/backups. Draft resubmission uses existing launch ownership
and design CAS; Molly cannot attest completion through legacy Pi hook messages.

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

Workspace MCP settings optionally declare a version-1 `imageBinding` on the existing
catalog row. The embedded resolver forwards it only for selected, revision-guarded
servers. It names separate generate/edit tools and maps top-level prompt/model/size,
plus ordered string images and optional mask for edit. No scripts, nested paths,
arbitrary constants, secret values or implicit model selection are introduced.
The bridge replaces a compatible tool's input with normalized fields, injects the
configured image model, validates the exact native schema without coercion, then
shows those mapped arguments for approval. Catalog changes retire the worker;
schema changes still fail the post-approval check. Incompatible mappings retain
ordinary tool behavior with an explicit unavailable description, not image readiness.

In design sessions, compatible mappings import PNG/JPEG/GIF inline/resource results through
the owning host's private ACP callback. The host matches the native allow-once
title/argument digest, active run/epoch/turn/session and selected catalog revision;
the design service resolves the draft from live Session metadata and frozen inputs.
The operation stays dispatched until import settles. Only host receipts supply
asset digests; the model receives those paths instead of server-authored receipts,
and can inspect the files through native reads. Import never commits artwork.
Other sessions keep inline model-context delivery without design import.
Image references are forwarded unchanged, never interpreted as host files or uploaded.
Bound image resource links resolve within the original dispatch before host import.
Each child read requires separate native approval and receives a durable receipt
linked to its parent. Its scoped callback fixes the run/server/revision and only
permits `resources/read`; it expires at parent settlement. The journal drains reads
before settling the parent and serializes unrelated calls outside this fence, avoiding
a nested queue deadlock or premature success. Ordinary tools retain their separately
approved read path. Denied, cancelled, mismatched or lost linked results leave the
paid parent unknown and return a tool error, without regenerating. A declared image
tool's returned failure is recorded as failed and returned to the model. External `_meta` image receipts
are ignored. Host import, edit inputs and recovery use bounded full-pixel decoding,
preserving original bytes; native decoder resources ship with the CLI. Arbitrary URL
text is not downloaded; MCP URIs never become host fetch/filesystem authority. Remote
recovery of a prior provider operation remains open. Saving a
mapping is not a connection/schema probe or evidence of live vendor support.

Design workers also receive `molly_recover_images`: a native read-only tool backed by
the owning host, not the external MCP connection. It lists local import intents and
verifies one operation's retained files after single-use approval. Current run/epoch
and exact query are bound over the private callback; source Session/artwork and frozen
turn paths are checked by design services. It never calls a provider, writes assets,
changes paid state or commits artwork. Missing/corrupt files stay unavailable.
Managed built-in generate/edit now defer publication through private MCP metadata:
the producer returns bytes, and the same owning-host import service validates them,
persists an intent before publication and supplies the asset digests. This binds the
frozen image connection, not the built-in MCP contract revision. The worker settles
success only after host import and presents host paths rather than raw image bytes.
These new built-in results are locally recoverable through the same tool. Earlier
built-in assets without intents and results never received by the host remain
unrecoverable through it; no history is fabricated or paid request repeated.

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
protected-MCP preparation, idle shutdown and point-in-time worker RSS. Each sample
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
absence and cancellation socket closure. Optional protected MCP preparation is renewed
for every run through the real private grants and native session rebuild path.
Raw per-turn measurements distinguish first/warm/cancelled/after-cancel phases;
separate distributions cover prompt settlement, preparation and cancellation/HTTP closure.
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
