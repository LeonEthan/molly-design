# Pi MCP adapter migration triage

Status: proposed
Translation: pending

## Abstract

The selected direction for issue #41 is ordinary Pi extension integration with an unmodified, pinned `pi-mcp-adapter`, and the Molly image MCP server acting as an ordinary tool server. The earlier host-managed compatibility experiments successfully reproduced the old bridge's behavior, but that preservation target and its upstream-PR/dependency-patch adoption route are superseded. The existing image server already saves assets and returns usable paths on its ordinary MCP path; its private byte-return/host-import branch is not required for a generic client. The target now removes custom client semantics rather than preserving them elsewhere, using the published configuration/extension interface and the server's ordinary image behavior. The standard integration is now implemented with separate [current evidence](../../implemented/simplification/2026-09-28-standard-pi-mcp-integration.md); historical passing checks below remain evidence for the superseded candidate only.

## Current decision: ordinary integration, no customization

The chosen chain is `Pi Agent → unmodified pi-mcp-adapter → Molly image MCP server → image service`. Use the published `createMcpAdapter({ config })` extension factory and normal Pi extension loading. The 3.2.0 package documentation describes supplied configuration as an isolated snapshot, so using Molly's selected server configuration does not require a new upstream interface or ambient configuration discovery.

Withdraw the recommendation to submit Molly-specific upstream PRs, maintain a pnpm dependency patch or fork, or gate migration on upstream acceptance of extra host-managed controls. Existing source patches and archives are retained for historical traceability, not as the implementation plan. Their requirements and test counts must not be carried forward as evidence that the ordinary chain is complete.

The final host-managed review bundle is retained with its original hashes in the
[rejected candidate record](../../rejected/architecture/2026-09-28-molly-mcp-host-managed-candidate.md).

The simplification applies to Molly's side as well: do not wrap the ordinary adapter in the previous catalog revalidation, per-turn connection reconstruction, special tool naming, paid-call journal, resource-child receipt or private import machinery. Do not relocate that machinery wholesale into the image server. Ordinary public configuration/extension wiring is sufficient; image-tool parameter/credential/file validation and saving images are the server's own responsibilities. The standard adapter owns MCP behavior, including its real recovery and output semantics. An ordinary MCP integration does not imply exactly-once execution or cancellation of remote billing, and those guarantees are no longer imposed through a Molly-specific MCP layer.

A source inspection at the triage baseline corrected a prior premise: [the image server](https://github.com/LeonEthan/molly-design/blob/3e91e746b1426e1db8af122e6a833768ec0ba99d/apps/cli/src/mcp/molly-mcp-server.ts) branches on `HARNESS_INLINE_IMAGE_RESULT_META`. Only that managed branch returns private image bytes for later host import. Without the private flag, it already calls `generateImageAsset`/`editImageAsset` and returns a standard text result containing the saved path, dimensions and media facts. Therefore the claim that connecting a generic adapter inherently loses image-file persistence was too broad. Reuse the existing ordinary path rather than introduce another import subsystem.

The revised target and acceptance scope are recorded in the [English Spec](../../../../specs/molly-embedded-pi-harness.md#mcp-and-paid-images) and [Chinese Spec](../../../../specs/molly-embedded-pi-harness.zh.md#mcp-与付费图片), both still draft. The [implementation record](../../implemented/simplification/2026-09-28-standard-pi-mcp-integration.md) now documents the unmodified chain, removal of obsolete client plumbing and updated scoped runtime rules. Retain user sessions, artwork and history. Validate ordinary discovery, generation/editing, saved-file use, errors, cancellation and the packaged runtime, without recreating the superseded host contract to satisfy old tests.

The following sections preserve the earlier investigation and its results. Their recommendations, production gates and proposed ownership are historical where they conflict with this decision.

## Scope and evidence

- Request: [issue #41](https://github.com/LeonEthan/molly-design/issues/41); background: [the final correction in #38](https://github.com/LeonEthan/molly-design/issues/38#issuecomment-5870490763), which explicitly recognizes external-server safeguards.
- Molly source inspected at `3e91e746b1426e1db8af122e6a833768ec0ba99d`. Current intent remains the [embedded Pi Spec](../../../../specs/molly-embedded-pi-harness.md), with ownership in the [harness README](../../../../packages/harness-pi/README.md), [harness rules](../../../../packages/harness-pi/AGENTS.md) and [shared catalog rules](../../../../packages/shared/AGENTS.md).
- Upstream baseline: release `3.1.0`, commit [`3ce9716fe6982dfafdea947b316521acb1ebbc73`](https://github.com/nicobailon/pi-mcp-adapter/tree/3ce9716fe6982dfafdea947b316521acb1ebbc73). Its [package manifest](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/package.json) declares MIT licensing, the Pi peer range, MCP client 2.x and a native keyring dependency. This is a research baseline, not an installed or approved dependency pin.
- This note supplements the [embedded harness implementation record](2026-09-19-embedded-pi-harness-implementation.zh.md). It does not reopen its deferred installer/provider acceptance matrix or supersede existing safeguards.

## Corrections to the issue's starting assumptions

1. The current bridge does handle `notifications/tools/list_changed`: [mcp-bridge.ts](https://github.com/LeonEthan/molly-design/blob/3e91e746b1426e1db8af122e6a833768ec0ba99d/packages/harness-pi/src/mcp-bridge.ts) makes the connection unavailable on notification and compares tool schema identities before and after approval. It lacks live catalog refresh, rather than notification handling altogether. A refreshed adapter cache is not equivalent to Molly's frozen execution catalog.
2. Issue #38 is closed as of the triage read. The current bridge and content handler contain its bounded server-error behavior. Migration must preserve that baseline, not wait on an assumed unimplemented prerequisite.
3. External servers already depend on the durable dispatch journal, exact credential binding, producing-client resource reads and external image-import gate. Keeping the built-in `molly` server on the old bridge does not exempt external migration from any of these requirements.

## Safeguard-to-integration map

| Safeguard and current owner | Adapter evidence | Proposed connection point / verdict |
| --- | --- | --- |
| Protected discovery only after a run/epoch grant; close protected clients at settlement. `acp-adapter.ts` validates preparation, obtains values, rebuilds tools over native history and closes the protected bridge in `finally`. | `createMcpAdapter({ config })` snapshots programmatic configuration. Public options expose only `config` and `configPath`; normal initialization is extension/session owned. | Reuse Molly's grant and native-history orchestration. Need a supported explicit connect/ready/close lifetime controlled by the host; configuration alone does not prove turn-scoped secret lifetime. |
| Frozen tool identities and catalog revocation. `mcp-bridge.ts` checks availability and schema around approval; host catalog edits retire the worker. | `freezeDirectTools` freezes direct registration only; its documented contract still refreshes proxy/search/cache metadata. | Retain host revision retirement and freeze the actual executable descriptors, not only the prompt. Need notifications and connection generations exposed to the host, with deterministic refusal of stale calls. |
| Dispatch receipt before I/O; never replay a dispatched ID; keep unknown outcomes. `tool-operation-journal.ts` persists prepared/dispatched records and fences image child reads/import settlement. | Direct and proxy execution use `withSessionRecovery`, which reconnects and invokes the callback again once for selected session-expiry failures. | **Blocker:** expose a no-resend execution policy and wrap the exact raw operation with the existing journal. A Pi outer tool hook cannot establish one receipt per inner network invocation when the adapter retries internally. |
| Destination/credential isolation and transport error sanitization. `mcp-bridge.ts` injects `createBoundModelFetch`; it rejects origin changes and redirects and replaces transport diagnostics. | `McpServerManager` internally constructs HTTP transports/fetch composition. No public factory option accepts host fetch/transport. | **Blocker:** upstream a per-connection guarded transport/fetch seam covering every enabled request path. The trial must trace the issue's URL/DNS requirement to the host implementation; inspection of the bridge's origin/redirect guard alone is not proof of DNS pinning. |
| Resource links use only the producing connection, with separate permission and durable child receipts; returned URI must match. `mcp-bridge.ts`, `mcp-content.ts` and the journal own this. | Adapter resource paths can reconnect, transform content and expose resources as tools. The approval broker includes resource origin, but is not a raw result or settlement hook. | Need a connection-generation-bound raw resource read under Molly's existing permission and receipt path. Retain URI validation and the parent dispatch fence; do not substitute URL/file loading. |
| External image mappings approve native mapped arguments; only the owning host imports bytes and supplies digests. `mcp-image-binding.ts`, bridge and journal own this. | Adapter direct results transform MCP content and then apply output limits. Bounded result details are not a lossless pre-settlement result API. | Need raw result interception before formatting/spill/import, with settlement deferred until approved child reads and host import complete. Preserve fixed image model, mapping validation and exact approval identity. |
| ACP approval and auto-review. Existing `ToolApproval` remains host owned. | `pi-mcp-adapter:tool-approval-request` supports claimable asynchronous decisions and cancellation. It carries server/tool/args/origin, but no Molly run/epoch or native `toolCallId` field. | **Useful existing feature, partial fit:** enable approval for every relevant operation and bind requests to the active host invocation. Do not use session-wide allow decisions. Prove cancellation, revocation, argument identity and denial before dispatch; broker presence alone is not sufficient. |

Local implementation: [ACP adapter](../../../../packages/harness-pi/src/acp-adapter.ts), [bridge](https://github.com/LeonEthan/molly-design/blob/3e91e746b1426e1db8af122e6a833768ec0ba99d/packages/harness-pi/src/mcp-bridge.ts), [journal](https://github.com/LeonEthan/molly-design/blob/3e91e746b1426e1db8af122e6a833768ec0ba99d/packages/harness-pi/src/tool-operation-journal.ts), [bound fetch](../../../../packages/harness-pi/src/model-transport.ts), [content](https://github.com/LeonEthan/molly-design/blob/3e91e746b1426e1db8af122e6a833768ec0ba99d/packages/harness-pi/src/mcp-content.ts), [image binding](https://github.com/LeonEthan/molly-design/blob/3e91e746b1426e1db8af122e6a833768ec0ba99d/packages/harness-pi/src/mcp-image-binding.ts).

Upstream integration evidence: [public options and approval contract](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/types.ts#L580-L729), [programmatic factory](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/index.ts#L2098-L2109), [HTTP construction](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/server-manager.ts#L1510-L1656), [session recovery](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/session-recovery.ts#L86-L157), [direct call and content transformation](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/direct-tools.ts#L264-L423).

## Other adoption gates

- **Command registration:** the stock extension registers management/auth commands; Molly's [resource loader](../../../../packages/harness-pi/src/resource-loader.ts) rejects any unmapped native command. A supported embedded mode or explicit reviewed host mappings are required. Do not bypass that validation or suppress registrations with an ad hoc runtime patch. See [upstream command registration](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/index.ts#L1248-L1480).
- **Error confidentiality:** the direct-call catch formats `error.message` into model-visible text. Output limits are not redaction and may spill full output to disk. Preserve #38's distinction between bounded server-authored `isError` content and fixed transport/client codes before model history, diagnostics or spill. See [direct error path](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/direct-tools.ts#L381-L423).
- **Keyring:** native loading is lazy through `loadKeyringEntryClass`, not an unconditional module-level native import. Explicit `auth: false`/`oauth: false` disables OAuth support; leaving auth unspecified can inspect saved credentials during HTTP connect. This is promising source evidence, not Electron Node-API 10 or sealed-bundle acceptance. See [keyring loader](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/secure-keyring.ts#L129-L139), [OAuth support predicate](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/mcp-auth-flow.ts#L1243-L1255) and [HTTP auth initialization](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/server-manager.ts#L1589-L1614).
- **Ambient behavior:** programmatic config avoids dotfile merging, but does not remove metadata-cache and environment inputs. Review those against Molly's existing sanitized worker environment/private root. Explicitly disable imports/plugin discovery, install actions, script execution, sampling, elicitation, OAuth, UI resources and semantic-search services for the initial trial; do not enable task execution without its own reviewed lifecycle. These settings must be verified against source/defaults; no feature becomes approved because the adapter supports it.
- **Literal credential injection:** adapter stdio configuration inherits/expands environment values by default; existing `literalEnv: true` and `inheritEnv: false` controls reduce that concern, although SDK platform defaults still apply. Its HTTP configuration supports command-derived headers. Host-granted values must remain literal and scoped to their selected connection; programmatic configuration alone does not establish that. Verify or upstream a literal injection path rather than routing vault values through command/interpolation semantics. See [stdio construction](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/server-manager.ts#L1048-L1082) and [header construction](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/server-manager.ts#L1510-L1551).
- **Dependency closure:** public package exports do not expose the manager/client. Deep-importing private internals or vendoring the full adapter would defeat the intended supported-client ownership split. Exact dependency pin, transitive/native resources, licenses and public-boundary checks belong to eventual implementation.

## Proposed disposition and first deliverable

Keep #41 as the migration umbrella. It is ready for a bounded compatibility trial, not a production replacement. A suitable triage disposition is `needs-decision` pending agreement on the upstream seam approach; no GitHub labels or comments were changed by this task.

The trial should answer one question: can an exactly pinned adapter release execute through Molly's existing grant, dispatch and import boundaries using supported APIs? Draft the smallest upstream surface for host-controlled connection lifetime, transport injection, no-resend execution and lossless raw results. The initial preference was one coherent embedded-client boundary. The upstream decision discovered below changes the proposal to an opt-in host profile within the existing adapter pipeline; a new raw-client API is no longer the proposed ask. API names remain provisional. The reviewed proposal was subsequently submitted as [upstream #716](https://github.com/nicobailon/pi-mcp-adapter/issues/716); submission does not establish acceptance.

Reuse existing synthetic fixtures to demonstrate only the decisive behaviors: denied/revoked credentials never connect or dispatch; catalog changes cannot alter an active toolset; a session-expiry/lost-response case never replays the same dispatched ID; child resources use the producing connection and separate receipts; external image settlement waits for owning-host import; transport-secret canaries never reach history or spill; OAuth-off startup never loads native keyring. Include cancellation/settlement on the real packaged worker once the API is viable. No real provider or paid image calls are needed for this trial.

If those gates pass, migrate external servers while retaining the same safeguard owners. Decide on the built-in `molly` server afterward, including private image receipts and preview/browser classifications. Do not infer full MCP capability acceptance from client adoption.

The alternative is an extension-only integration using Pi hooks and the approval broker. It could require less upstream work and reuse more extension behavior, but current source does not expose enough control over internal replay, transport construction or raw results to demonstrate the required guarantees. The strongest cost of the proposed upstream approach is dependency on maintainer agreement and potentially maintaining a new public API; if that support is unavailable, pause migration rather than silently fork or weaken safeguards.

## Verification and limits

This is source-based triage, not a runtime proof or a security audit of the adapter. No dependency was installed in Molly, no production code or Spec intent changed, and no remote issue was edited. Existing regression files were inspected for reuse; runtime tests and packaging were not rerun for a documentation-only task.

The required advisory Codex CLI second opinion was attempted with `gpt-6-astra`, high reasoning and read-only sandbox after model availability was verified. It failed before analysis: `failed to initialize in-process app-server client: Operation not permitted (os error 1)`. No opinion was obtained and no automatic retry was made. The independent upstream source research informed this note; it does not replace that missing advisory opinion or human acceptance.


## Follow-up: upstream fit and execution contract

The next-step request authorizes preparation of a concrete integration proposal. Further source and issue review found two relevant upstream decisions:

- [#475](https://github.com/nicobailon/pi-mcp-adapter/issues/475) is closed as `not_planned`. The maintainer [declined a generic inter-extension invocation API](https://github.com/nicobailon/pi-mcp-adapter/issues/475#issuecomment-5498974312), identifying a new authority boundary and requiring any future trusted integration to retain existing approval, cancellation and output paths. This is evidence against proposing a raw-client export as an easy upstream contribution. It does not establish whether the narrower host profile below will be accepted.
- [#476](https://github.com/nicobailon/pi-mcp-adapter/issues/476#issuecomment-5497616380) was closed after its reporter recognized that runtime server registration already solves duplicate adapter installation. Molly's need is different: the owning application needs control of its own admitted connection and execution lifetime, not a second extension registering servers in an existing adapter.

Consequently, the proposed upstream ask is a trusted host profile, passed only to the programmatic factory. It retains the adapter's normal approval/execution path while giving the constructing application explicit control at transport and operation boundaries. The callbacks are not discoverable Pi events and cannot be enabled by server-authored metadata, project config or another extension. No public raw client or general invocation API is requested. There is no claim that this revised proposal has upstream acceptance.

### Ownership and ordering

The host continues owning credential grants, frozen selection/schema identity, ACP decisions, durable receipts, unknown outcomes, cancellation deadlines and asset imports. The adapter continues owning MCP protocol negotiation, client construction, supported protocol parsing/validation, connection events, tool presentation and its ordinary extension behavior. Host transport injection reuses the pinned SDK transport interface; it is not a second wire protocol or a second MCP implementation.

The proposed hosted path has this sequence:

```text
Host validates selection + run/epoch grant
  -> create hosted adapter with supplied transport factory
  -> adapter discovers tools and reports ready
  -> host freezes executable descriptors, then enables inference
  -> adapter produces final native arguments
  -> existing approval broker / ACP permission decision
  -> host rechecks connection + schema + active run
  -> host writes durable dispatched receipt
  -> single-use adapter dispatch continuation
  -> host processes raw result and approved child resources
  -> owning host imports images and supplies receipts
  -> host persists settlement
  -> adapter presents host-approved output through output guard
  -> at run settlement: host closes adapter and drops protected references
```

Connection identity is opaque and instance-bound, not a mutable server-name lookup. Tool changes fence the affected connection before notifying the host; they cannot silently refresh the executable schema while approval is pending. A replacement instance requires fresh admission and frozen metadata. Closing fences dispatch synchronously before awaiting cleanup; failures remain failures and never authorize a retry. Cancellation delivery must retain Molly's existing bounded drain behavior.

The operation continuation is callable at most once and only while its owning callback is active. The host must recheck revocation/cancellation immediately before invoking it. An exception after a dispatched receipt remains unknown even if the adapter believes session expiry means the server rejected the request. A returned server `isError` result is an ordinary known tool failure. Neither case authorizes automatic resubmission. These are host policy requirements, not claims that the adapter's default recovery is a bug.

Linked reads reuse the producing connection and inherit a scoped parent identity, but receive their own approval and journal record. They execute inside the parent's existing resource-read fence, not through the top-level serialized queue. The parent drains children before import and settlement; a failed child cannot be hidden by a caught callback exception. The scoped reader expires at settlement and cannot survive reconnect or run replacement. No public nested-call engine or persistent operation store is added to the adapter.

### Source changes that would be required upstream

This is a source impact assessment, not an implementation or effort estimate.

| Existing source owner | Required change for the proposed profile |
| --- | --- |
| `index.ts`, `init.ts`, runtime owner | Opt-in programmatic host profile with an explicit readiness/close handle; register only admitted MCP tools; exclude management commands, dynamic admission and load-time connection before host admission. Existing factory behavior remains compatible. |
| `server-manager.ts` | Take a supplied transport through the existing client setup/cleanup path; exclude auth stores, command-secret resolution, endpoint probing and transport fallback for this profile. Ensure notification invalidation and no replacement-by-name calls. Retain protocol validation. |
| `direct-tools.ts`, `proxy-modes.ts`, `resource-tools.ts` | Share one trusted operation boundary after broker approval and before I/O, including resource calls; surface exact final arguments and operation provenance; gate raw-result handling before conversion, UI delivery and spill. No secondary unhooked execution path. |
| `session-recovery.ts` and SDK transport options | A profile-specific no-resend route through recovery. Transport/SDK-level retries must also be examined with synthetic wire evidence; skipping this one helper is not sufficient proof. |
| content/diagnostic owners and package exports | Host processing before any raw materialization or diagnostics; fixed diagnostic categories in this profile; packed-import coverage without TUI/keyring side effects. Reuse the current public build/package checks. |

The existing client setup automatically advertises UI capability and attempts task attachment unless disabled, and HTTP failure enrichment may perform an endpoint probe. Those paths must be excluded by the hosted profile; disabling visible UI tools alone does not prove no side effect. See [client capabilities/setup](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/server-manager.ts#L1193-L1395). Existing `literalEnv`/`inheritEnv` controls are useful for normal stdio configuration; they do not solve HTTP command-secret interpretation or hidden transport construction.

### Bounded compatibility trial after upstream agreement

Use the current synthetic fixtures and high-level observable signals. Do not create a separate client implementation that merely demonstrates its own assertions.

| Scenario | Required observation | Existing Molly evidence to adapt |
| --- | --- | --- |
| Missing/retired grant or close during connect | No admitted connection/inference; late readiness cannot resurrect the closed instance; next run requires a fresh grant. | `tests/acp.test.ts`, `tests/control-and-dispatch.test.ts` |
| Catalog edit during permission | Approval cannot send the stale schema/connection; toolset identity is fixed before inference. | `tests/session.test.ts`, `tests/mcp-bridge.test.ts` |
| Expiry or lost response after durable dispatch | Synthetic server's operation trace has no resend; journal recovers unknown and a repeated dispatched ID remains refused. | `tests/control-and-dispatch.test.ts` |
| Image resource child, denial or URI substitution | Same producing connection, separate child receipts, no nested-queue deadlock, no successful parent settlement/import on failed child. | `tests/mcp-bridge.test.ts`, `tests/control-and-dispatch.test.ts` |
| Transport/stdio diagnostic canary and raw result | No canary in model/UI/log/spill; full allowed `_meta`/structured/image data reaches host before presentation; unsupported data receives a fixed failure. | `tests/mcp-content.test.ts`, `tests/mcp-image-binding.test.ts` |
| Packed hosted import and cancellation | No native keyring/TUI discovery; guarded transport receives all enabled traffic; cancellation drains within the existing bound; current standard extension regressions remain valid. | Existing embedded worker smoke and upstream `public-exports.test.mjs` |

Only after those gates pass should a Molly runtime diff pin the upstream release and change the bridge integration. The existing Spec remains draft and unchanged at this proposal stage. The missing Codex CLI opinion recorded above remains a verification limit; the same failed invocation was not retried automatically. No runtime tests, provider calls or paid operations were performed during proposal preparation. After explicit authorization to publish, the exact reviewed issue body was posted as [upstream #716](https://github.com/nicobailon/pi-mcp-adapter/issues/716) on 2026-09-28 and read back to verify its title and body. No implementation or upstream acceptance is claimed.

## Submitted upstream proposal

The following is the submitted body of [upstream #716](https://github.com/nicobailon/pi-mcp-adapter/issues/716), with heading levels adapted for this note. Its closing question asks upstream about project fit before committing either project to a new API.

### Issue title: Support a host-managed execution profile for embedded Pi integrations

> Prepared with AI assistance; source assessment against pi-mcp-adapter 3.1.0, commit 3ce9716fe6982dfafdea947b316521acb1ebbc73. This is a design request, not a report of an adapter vulnerability.

#### Context and relationship to #475

We are evaluating pi-mcp-adapter as the MCP client for [Molly's embedded Pi harness](https://github.com/LeonEthan/molly-design/issues/41). The host already owns run-scoped credential grants, ACP permission cards, a durable dispatch journal, and approved image imports.

I read the [decision on #475](https://github.com/nicobailon/pi-mcp-adapter/issues/475#issuecomment-5498974312). This request is for trusted callbacks supplied by the application that constructs the adapter. It would not expose raw SDK clients, create an inter-extension invocation API, or let another extension acquire authority by knowing a server name. The ordinary extension behavior would remain unchanged.

Would you support a host-managed profile that stays within the adapter's existing execution pipeline, with these boundaries?

#### Proposed boundaries

1. **Explicit lifetime and a readiness barrier.** The application creates one adapter instance after admitting a frozen server selection and granting credentials. It can await discovery before inference and close that instance at settlement. Close immediately fences new work, cancels/drains existing work within a bound, releases connection references, and cannot reconnect implicitly. Calls from a retired instance remain retired even if a replacement has the same server name. The hosted profile registers only the requested MCP tools; it does not register management/auth commands, install tools, or UI surfaces.
2. **Host-supplied transport construction.** A trusted factory supplies each admitted connection's transport, using the adapter's pinned MCP SDK transport interface. The factory carries a sanitized stdio environment or guarded HTTP fetch and literal credentials in memory. This profile does not resolve command secrets, discover configuration, read OAuth/keyring state, probe alternate URLs, or fall back to another transport. Every enabled connection/request path uses that supplied transport. The profile advertises only the capabilities its host enables.
3. **A single execution boundary after approval.** Every executable tool/resource path exposes immutable final arguments, server/tool identity, the original Pi tool-call identity (or a separately identified child resource read), and an opaque connection identity to a trusted host callback. Approval still happens through the existing broker; the host checks schema/revocation again after approval. The callback can durably record dispatch before invoking a single-use continuation. This profile uses a no-resend policy: session expiry, connection loss or uncertainty returns an error, with no second invocation hidden inside session recovery. No retry policy is inferred from a tool annotation. A new user/agent call is a separate operation.
4. **Raw result handling before presentation.** The same trusted execution callback receives validated, complete MCP results, including `content`, `structuredContent`, `isError` and `_meta`, before transformation, blob materialization, UI forwarding or output spill. It can validate/import images and return the result intended for the normal output guard. A linked-resource continuation stays bound to the producing connection and parent operation, requires a separate broker decision and host receipt, and expires when its parent settles. It cannot choose another server or become a general invocation API. Transport/client failures must be classifiable without first formatting or logging raw exception text; the hosted profile uses fixed diagnostic categories.

The callback boundary must preserve the distinction between a server-authored `isError` result and an exception whose delivery outcome is uncertain. The host retains its own journal and asset storage; the adapter would not implement billing, run/epoch identity, or product-specific import rules. Cancellation is not proof that a remote action stopped.

API names and exact types are open. A factory returning an extension factory plus an explicit ready/close handle seems sufficient; trusted transport/execution callbacks would be constructor inputs unavailable through JSON configuration or shared Pi events. The SDK's existing MCP result and transport types should be reused.

#### Why current options do not establish these contracts

- `createMcpAdapter` accepts programmatic configuration, but [its public options](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/types.ts#L724-L727) do not provide transport or execution injection.
- [`withSessionRecovery`](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/session-recovery.ts#L93-L157) deliberately reconnects and invokes a request again on narrowly defined expiry errors. That is reasonable for the ordinary extension, but conflicts with this host's stricter no-resend contract once dispatch is recorded.
- `freezeDirectTools` preserves registration while proxy/search/cache metadata can still refresh. This host must retain the actual approved executable schema and retire stale connections.
- [Direct-result processing](https://github.com/nicobailon/pi-mcp-adapter/blob/3ce9716fe6982dfafdea947b316521acb1ebbc73/direct-tools.ts#L308-L423) transforms/guards results and formats exception messages before an application can apply its import and diagnostic policy. A later Pi `tool_result` hook cannot undo prior blob writes, UI forwarding or output spill.

#### Focused acceptance

Synthetic transport/server fixtures should demonstrate: no connection before host admission; denied/cancelled/revoked operations do not dispatch; catalog mutation during approval invalidates the call; one recorded call is never resent on expiry/lost response; linked resources and image import settle inside the original operation; error-secret sentinels never reach model/UI/log/files; and the hosted import works without Pi TUI or native keyring loading. The normal extension's approval/recovery/output behavior must retain its existing regression coverage.

Would this opt-in host profile fit the project's intended boundary? If so, we would first agree on the smallest callbacks and lifetime contract before preparing an implementation. If retaining session replay or pre-host materialization is mandatory for every integration, please say so; that would make the current adapter unsuitable for this host's contract without changing that contract.


## Isolated compatibility prototype

The authorized experiment tests whether trusted host hooks inside the actual adapter pipeline can preserve Molly's dispatch and result-processing boundaries. It changes no Molly runtime, workspace dependency or Spec. The result is **feasible for the tested direct-tool path**, not a production migration or an upstream-supported API. The source remains throwaway and unsubmitted.

The [reproducible source bundle](2026-09-28-pi-mcp-compat-prototype.tar.gz) contains the source patch, executable fixtures, locked dependencies, copied-source provenance, licenses, synthetic report and reproduction instructions. Archive SHA-256: `a91999bc2fccc8608cf6133f3ea9a8ea9cf6f5bc6ecfb61ac2f21b05ca67ee6b`. Extract it and run `python3 reproduce.py` with Python 3.9+, Node 22.14+ and npm. Setup downloads the pinned adapter archive and locked dependencies into a new temporary checkout; scenario execution uses injected HTTP responses without network sockets or paid/provider calls. No machine-local configuration, captured conversation, installed dependency tree or real credentials are bundled.

### What the experiment actually exercises

- Adapter 3.1.0 at the commit identified above, MCP client/core 2.0.0 and Pi 0.85.1. Three small source seams inject transport creation and an opt-in direct-executor branch; one experimental module composes approval, immutable arguments, a single-use dispatch continuation and host processing before upstream output conversion.
- Actual adapter manager, SDK negotiation/discovery, Streamable HTTP transport, approval broker and output guard. The supplied Fetch implementation responds to synthetic protocol requests. Standard direct execution retains its original implementation.
- Byte-identical Molly journal, content resolver and bound-fetch runtime sources, plus their shared runtime types/schemas. A manifest records source paths and SHA-256 values; one approval type is extracted only for typechecking. Tool/resource requests inspect the real on-disk journal before responding, and a reopened journal verifies refusal to reuse an uncertain operation ID.
- A synthetic image-import callback checks fixture bytes, writes a test asset and returns a schema-valid host receipt. Explicit deferred signals keep import or approval pending for observations. This callback does not exercise actual ACP caller verification, Electron services, full image decoding or a real design draft.

### Observations and verification

All 21 deterministic compatibility scenarios passed. Stock session recovery is a control that sends the operation on two sessions; the experimental route sends once after durable dispatch, retains an unknown outcome on expiry/loss, and refuses replay of that ID even after reopening the journal. A separately identified new operation can succeed.

Other passing cases cover missing/mismatched grants, bound destinations, approval denial/cancellation, revocation or schema change while approval is pending, notification invalidation, single-use continuation, server-declared failure, transport diagnostics, linked-resource denial or URI mismatch, parent receipt remaining dispatched through image import, host digests replacing a forged server receipt, expired resource readers, cancellation and refusal after close. Synthetic credential sentinels were absent from captured diagnostics and owned receipt/asset files; no automatic adapter output directories or native-keyring entries in the Node require cache were observed. These are scoped observations, not a full confidentiality or module-loading audit.

Both adapter and probe TypeScript checks passed. The unchanged upstream direct-tools, tool-approval and session-recovery suites passed all 108 tests (56, 21 and 31 respectively). The bundled reproduction script was then run against a fresh pinned source download and locked npm install; both typechecks, all 21 scenarios and all 108 upstream tests passed again, with an identical synthetic report. The initial image fixture incorrectly assumed the image was content block zero; Molly emits a description first, so only that assertion was corrected. No production bug was changed.

### Limits and next decision

The experiment does not establish a public hosted factory, complete Pi session startup/command suppression, protected history rebuild, frozen toolset hashing, discovery/import teardown races or bounded cancellation-delivery failure. It covers direct tools only: proxy, script, task, iframe, prompt and generic resource-tool routes are not migrated. Catalog comparison covers the fixture's single page and input schema; complete descriptors, output schemas and pagination remain acceptance work. Real network redirects/DNS, stdio environment isolation, modern protocol negotiation, other SDK retry cases, packaged Electron/Node-API loading and the actual host image-import service are also untested. The previously failed Codex CLI initialization still leaves independent review unavailable; it was not automatically retried.

The evidence supports discussing minimal upstream callbacks using this direct-path patch and expanding acceptance coverage before any Molly bridge replacement. The earlier trial proposal assumed upstream agreement first; explicit authorization allowed this local throwaway feasibility experiment while that decision remains open. No new upstream comment or PR was published. At this experiment stage, [upstream #716](https://github.com/nicobailon/pi-mcp-adapter/issues/716) was unresolved. The released-API findings below supersede that upstream status; the existing Spec status remains unchanged.


## Hosted lifecycle coverage

The authorized follow-up extends the isolated direct-tool prototype with an experimental hosted entry point and 23 deterministic lifecycle scenarios. It uses the real Pi 0.85.1 public resource loader and extension runner, the adapter's runtime owner, manager, approval broker and direct executor, and the MCP SDK transport with synthetic responses. It deliberately does not enter the ordinary configuration/OAuth/management initializer; the unchanged upstream index lifecycle suite covers that normal path separately. No Molly runtime, workspace dependency or Spec changes are included.

The [combined lifecycle reproduction bundle](2026-09-28-pi-mcp-lifecycle-prototype.tar.gz) preserves both probes, both reports, the complete source patch, copied-source hashes, licenses and locked reproduction setup. Archive SHA-256: `a1ea20e30c291dd9060932f2a4d620808031c374097115f6b0c2568adc99c43b`. Extract and run `python3 reproduce.py` with the same prerequisites as the first bundle. The original direct-only bundle above remains unchanged as prior evidence.

### Lifecycle behavior exercised

The factory opens no connection and registers no tools, commands or flags at extension load. Session startup first validates the complete admitted selection, awaits all discovery, rechecks grants and validates tool-name collisions, then publishes direct tools and resolves readiness. A caller's `ready()` check rejects after retirement, even if initial startup once succeeded. Every instance is single-run; a repeated startup retires it, and a replacement needs a new instance with fresh admission.

Close fences execution synchronously and invokes host grant revocation before asynchronous cleanup. It drains the existing manager, startup and tracked execution/transport-send promises. An injected deadline reports `incomplete` if cleanup is still pending; an experimental diagnostic promise observes eventual drain separately. Failed cancellation delivery or transport disposal remains observable. The shutdown hook reports a fixed error through Pi's runner on failure or incomplete cleanup; Pi catches hook exceptions, so hosts must inspect readiness, close outcomes and runner errors rather than treating event resolution as success. The one-second prototype default is not a proposed product timeout.

The pending host-import fixture now receives the operation's abort signal and checks it before its synthetic side effect. At a close deadline its durable receipt can still be dispatched; after the blocked callback resumes and rejects, the receipt becomes unknown, no asset is imported and no late output is admitted. This preserves uncertainty rather than claiming that cancellation stopped remote work or that timeout proves local drain.

### Discovered gap and correction

Close during an asynchronous transport factory exposed a gap in the initial injection seam: the SDK client did not yet own the late returned transport, so closing that client did not dispose the transport. The experimental manager seam now disposes an already-aborted returned transport before any handshake. Disposal failure uses the manager's existing cleanup-failure classification, so close cannot report a clean result after a failed late disposal. Fixtures verify both cases with no protocol traffic and no tool publication. This is a correction to the throwaway patch, not an upstream vulnerability claim or a Molly runtime fix.

An initial fixture also used the journal's recovery read to inspect in-flight state. Recovery intentionally maps dispatched to unknown; the fixture now observes the actual on-disk receipt during dispatch, matching the first probe. No journal implementation was changed.

### Verification

All 23 lifecycle cases pass: startup/readiness and command suppression; close before start or during factory, handshake and discovery; late-factory cleanup failure; restart or revocation during discovery; single-server and partial multi-server discovery failure; close during approval, dispatch and import; stalled or failed cancellation delivery; stalled or failed transport cleanup; shutdown-hook failure reporting; registration collision and registration failure; fresh admission of the same server; and refusal to restart a retired instance. Gates and an explicitly advanced deadline control races without sleeps or passing assertions based on elapsed time. The watchdog only fails a hung probe.

The original 21 direct compatibility scenarios still pass, for 44 total probe scenarios. Both TypeScript checks pass. Seven unchanged upstream suites pass 279 tests: direct-tools (56), tool-approval (21), session-recovery (31), runtime-owner, server-manager close ownership, server-manager runtime ownership and index lifecycle (158). The final bundle was reconstructed from a fresh pinned source archive and locked dependency install; all checks passed again and both synthetic reports matched exactly. Setup uses network, while probes use no sockets, providers or paid calls. Debug diagnostics and runner errors, including Error object text, contain no synthetic credential sentinel; the lifecycle probe observed no unexpected global Fetch use.

### Remaining boundaries

This demonstrates the narrow experimental hosted lifecycle, not a complete AgentSession/inference loop, native-history reconstruction, frozen toolset hash, packaged Electron runtime or actual ACP/image-import service. Retired Pi runners still contain registered tool definitions because Pi has no unregister API; their callbacks fail closed, and the host must use a fresh instance for the next admitted run. The import callback remains a synthetic abort-aware stand-in. Complete catalog/output-schema/pagination contracts, other execution paths, modern protocol negotiation, stdio/provider behavior and packaging remain acceptance work.

A bounded close cannot force an uncooperative transport factory or callback to complete. The experiment reports incomplete cleanup and observes later drain; it does not claim memory erasure or garbage collection of pending stacks. The earlier independent Codex CLI initialization failure remains a review limit, with no automatic retry. The next production-facing gates are actual host image import, packaged runtime acceptance and agreement on a supported upstream API. No new upstream message or PR was published, and the migration decision remains proposed.


## Released 3.2.0 API and remaining migration work

Upstream implemented the requested host-managed profile in [PR #719](https://github.com/nicobailon/pi-mcp-adapter/pull/719), merged as `5b64f92db3059531857103325554d3b96559b611`, and closed [#716](https://github.com/nicobailon/pi-mcp-adapter/issues/716). Published package `pi-mcp-adapter@3.2.0` identifies source commit `b6e06a162d95322bb991b8b6214bb6fb10a90b7d`; the downloaded npm artifact's SHA-512/SHA-1 matched its registry metadata. This supplies a real supported `pi-mcp-adapter/host-managed` entry, superseding the invented hooks in the earlier local experiments. It does not by itself establish compatibility with Molly.

The released entry accepts host-created transports and an `onToolCall` callback with single-use dispatch and separately approved linked-resource reads. `ready()` connects and freezes selected tools before extension registration; the extension registers only tools. Its source does not enter configuration discovery, OAuth, keyring or session recovery. Calls must still pass the approval broker. The official loader test verifies that auth/config/recovery modules are not loaded; this remains distinct from sealed Electron acceptance.

### Published failures and proposed fixes

Fourteen focused checks run against the untouched published entry: three pass and eleven fail. Passing cases cover multi-page enumeration, a notified catalog change before dispatch, and output-schema failure after one dispatch. Failures establish these specific gaps:

- Registration strips `$schema` and `additionalProperties`, while the host callback receives the original input schema.
- Duplicate raw tool names are overwritten. SDK 2.0.0 silently stops on a repeated pagination cursor, allowing an incomplete catalog.
- Without a notification, changing description, input schema, output schema, annotations or title during approval is not detected before dispatch (five separate cases).
- Memoized readiness can resolve after close. A successful host callback completed after close can still be presented.
- Close resolves successfully after its deadline even while host work remains pending.

The [reviewable upstream patch](2026-09-28-pi-mcp-released-api.patch) corrects schema preservation, rejects ambiguous/incomplete catalogs, adds opt-in full-descriptor revalidation, refuses readiness/late results after close, tracks pending factories and late transport disposal, and makes failed or incomplete cleanup observable. This patch is local and unsubmitted. It changes close's contract to reject with fixed text on failed/incomplete cleanup; callers must handle that result. It does not claim a deadline stops an uncooperative callback or remote work.

Revalidation is opt-in because it adds three catalog reads around approval and dispatch. Default host-managed calls retain notification-based checks, and the ordinary extension is unchanged. The pagination fix uses the SDK's public typed per-page request API because its aggregate helper does not expose cursor cycles as failures. These are explicit trade-offs under upstream's VISION policy, not approved upstream design decisions or measured performance improvements. An SDK-level fail-closed pagination option would be preferable if available. Narrow submissions should separate catalog correctness, lifecycle outcomes and host-specific revalidation.

### Reproduction and evidence

The [released-API reproduction bundle](2026-09-28-pi-mcp-released-api-gates.tar.gz) contains the patch, published-package fixtures, pinned dependency manifest/lock, checksums, license, synthetic verification report and a reproduction script. Archive SHA-256: `87aa7809927a43747f3ecc45e60f98110afbadbdbdc47b50ccc4dde2e982953c`. Extract it and run `python3 reproduce.py` with Python 3.9+, Git, npm and a supported Node 22.14+ runtime. Setup verifies both the npm archive and the exact upstream source archive before installing locked dependencies with lifecycle scripts disabled. It expects the eleven published failures, then applies the proposed patch and requires the patched checks to pass.

A fresh reproduction passed TypeScript and 312 tests across nine suites: 17 focused cases plus 295 upstream tests. Two upstream lifecycle tests now assert the explicitly changed close-failure contract with fake timers; the other regression expectations are retained. The three added cases verify cooperative late-factory disposal without connection, failed late disposal, and eventual disposal after an incomplete close deadline. Focused scenarios use injected HTTP responses, deferred gates and fake timers without external servers or providers. An initial test adaptation accidentally retained the old real-time close wait; it was corrected to explicit fake-timer advancement before the clean reproduction. No production Molly source was changed to make a test pass.

The independent Codex CLI initialization failure remains a review limitation; it was not retried automatically. The root worktree still contains only the research note and source artifacts. At that stage, a separate temporary Molly clone had the exact candidate adapter/MCP dependencies installed but no runtime replacement. The integration results below supersede that intermediate state.

### Recorded remaining gates at the released-API stage

1. **Host integration contract.** Preserve Molly's exact raw server/tool identity, hashed model tool names and image-binding schema. The released API has no public complete frozen-catalog view or custom naming callback; sanitized names cannot safely reconstruct raw names and may collide. Prove the smallest necessary supported adaptation before adopting it. Also retain catalog tool-count/whole-discovery bounds and Molly's existing cancellation-delivery allowance rather than equating it to the adapter's five-second close deadline.
2. **Real session and journal.** Wire the external-server candidate through Molly's actual resource loader and AgentSession with a synthetic model stream. Verify frozen toolset identity, original tool-call approval identity, durable dispatch, protected-history rebuild under a fresh grant, cancellation and no replay after uncertain delivery. Keep built-in Molly servers on their current path until their separate contract is demonstrated.
3. **Owning-host image import.** Replace the earlier synthetic import stand-in with the actual caller-bound host service, image decoder and draft asset writer. Verify separate linked-resource approvals/receipts, parent settlement after import, cancellation, forged receipt refusal and no artwork commit.
4. **Transport/protocol acceptance.** Cover current negotiation behavior, stdio environment isolation, credential revocation, destination binding and SDK-level retry cases with deterministic fixtures and explicit observable outcomes.
5. **Sealed runtime acceptance.** Build the actual CLI worker and verify its dependency/license closure, absence of ambient loaders/auth, and unsigned local Electron runtime behavior using the repository packaging wrappers. Keep provider/paid calls and publishing outside these synthetic gates.
6. **Reviewable migration result.** Update affected implementation docs and provenance, run required package/public-boundary/docs checks, and prepare local patches with exact acceptance evidence. Production adoption requires an upstream-supported version supplying the needed contract; a local patch or passing synthetic check does not satisfy that gate.

These steps define the compatibility goal's scope; their completion evidence follows below. New external comments, PR publication and production adoption have not been authorized by the compatibility work and have not occurred. No Spec approval or implemented migration status is inferred from the experiments.


## Integrated candidate and packaging result

The six engineering gates above are now covered by an isolated candidate against Molly `3e91e746b1426e1db8af122e6a833768ec0ba99d`. External servers use the adapter's host-managed entry; built-in `molly` servers retain their existing client and private image/render contracts. The root worktree still contains only this note and research/review artifacts. The source changes live in a separate temporary clone and the patches below, with no commit, push, new external comment or PR.

### Review artifacts and reproduction

- [Molly migration patch](2026-09-28-pi-mcp-migration-candidate.patch): 21 changed/new files, including integration, exact dependency pins, the experimental pnpm patch/lock, tests, sealed packaging and owning README/AGENTS updates. SHA-256: `02b8c3f44bcce15d53e60f3859bb2e103a11cd733cd51a2b310fb9cf1e33613e`.
- [Upstream host-integration patch](2026-09-28-pi-mcp-host-integration.patch): proposed corrections, embedding options, tests and documentation against upstream `b6e06a162d95322bb991b8b6214bb6fb10a90b7d`. SHA-256: `056d57b812b00f9e7c498e1002396b491958e462115c7565806e132886fb93bc`.
- [Integration review/reproduction bundle](2026-09-28-pi-mcp-integration-candidate.tar.gz): both patches, licenses, exact source/artifact hashes, verification report, review decisions and executable reproduction instructions. SHA-256: `242771c364da6c429b15fed23a779836875130b1b45e7be4a87da8a340b444c7`.

Extract the bundle and read its README. `python3 upstream/reproduce.py` downloads checksum-pinned source/npm archives, installs locked dependencies with lifecycle scripts disabled, expects the original eleven published failures and requires all patched checks to pass. `python3 verify-candidate.py --source /path/to/molly-design` creates a fresh clone of the recorded base, applies the Molly patch and verifies all 21 changed file hashes. Omitting `--source` fetches the public repository. The README gives the exact default-submodule, frozen-install, check, build, unsigned-package and packaged-Helper smoke commands. No private data or captured user/Agent transcripts are included.

A fresh upstream reproduction passed TypeScript and all **319 tests** in nine suites: 24 focused checks plus 295 upstream regressions. The original published baseline remains **3 passed, 11 failed**, with no unhandled errors. A fresh Molly patch replay reproduced all 21 tested source files exactly. The final archive's complete artifact manifest was verified. Earlier prototype bundles remain unchanged as historical evidence.

### Contract and integration decisions

The minimal additional host contract consists of complete frozen descriptors for custom naming, catalog count/whole-read bounds, separate resource timeout, explicit output-guard control and producing-connection resource capability. Molly retains its existing hash-based model tool names, raw server/tool identity and mapped image arguments. Revalidation compares complete descriptors around approval/dispatch and preserves the full input schema; duplicate tools and cursor cycles fail closed. It remains opt-in because it adds three catalog reads to each ordinary execution. No public raw-client/invoke API or duplicate MCP wire implementation is added.

The upstream approval broker is bound to the actual native call and exact mapped arguments. Molly's existing journal persists dispatch before transport and refuses replay after an uncertain response or reopen. The actual Pi AgentSession model loop and native-history restoration are tested, as are fresh protected grants and context retirement after failed cleanup. The transport wrapper preserves both SDK generations' capabilities and assigned callback identity, keeps the existing 30-second cancellation-delivery allowance, then lets the adapter report failed/incomplete five-second cleanup. A timeout never proves remote work stopped or retained credentials were erased.

Image coverage now crosses the actual AgentClient single-use approval, EmbeddedHarnessControl run/epoch check, host importer, sharp decoder and draft writer. Seven scenarios cover successful import, cancellation, wrong epoch, wrong session, denied resource, missing resource capability and wrong URI. Child reads require separate permission and durable receipts from the producing connection; the parent stays dispatched until host import settles. Host-derived hashes replace forged server receipt fields, and no canonical artwork commit occurs. Together with adjacent host suites, this targeted run passes **140 tests**.

Transport coverage preserves bound Fetch, exact credential destinations and sanitized stdio environments. SDK 2 no-resend cases cover HTTP 401/403/404/429/503 and HeaderMismatch, in addition to uncertain delivery. The five supported legacy protocol revisions (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 and 2024-10-07) pass; modern-only 2026-07-28 is rejected before discovery/dispatch. This preserves the verified subset and does not claim DNS pinning or arbitrary external-service acceptance. Config discovery, OAuth, project-file servers, Claude plugins, automatic npx installs, UI iframes, sampling and mcpScript remain disabled.

### Packaging failure and fix

The first sealed-worker build failed at startup with `Dynamic require of "child_process" is not supported`: bundling SDK 2's stdio CommonJS dependency into ESM broke module loading. The candidate now stages pinned SDK 2.0.0 as an external alongside SDK 1.29.0 for built-ins. The adapter TypeScript entry is bundled into JavaScript, with no source-loader fallback. Nine bundled source packages have included-file hashes and copied licenses covered by the existing sealed manifest; no adapter keyring, QuickJS runtime or whole adapter package is staged. License manifest paths are normalized for portability.

The final sealed closure contains **218 staged packages and 13,996 files**. CLI output, Electron staging and the packaged app have the same build identity, `19b3618b92185deb90e39d1c25938cc23dba587a6da884fb23f1b5dd501b9c27`. Its bundled `host-managed.ts` hash exactly matches the proposed upstream source. The full local desktop build passed, followed by the final CLI rebuild/sync and the standard unsigned macOS arm64 package wrapper with publishing disabled. Native afterPack checks passed for the real packaged Helper, sealed Pi closure, image decoder, CLI startup and SQLite. The Helper reports Electron 39.5.1 and Node 22.22.0.

The existing synthetic packaged-worker driver passed 20 Node-runtime turns plus active cancellation and continuation. After the final cleanup refactor/rebuild, the actual packaged Helper passed three turns plus active cancellation and continuation, protected MCP preparation and question UI negotiation. These probes use disposable profiles, synthetic credentials and local synthetic servers. Measurement mode is required by the existing turn driver; no performance threshold, live-provider call, paid image generation, installed GUI, signed installer, notarization or update-channel acceptance is inferred.

### Final checks and remaining decision

The full candidate `pnpm check` passed: **8,629 tests passed, six existing tests skipped**, all package typechecks, type-aware lint, translation checks and import/platform/public-boundary guards. The harness slice passes 350 tests. Candidate and root documentation checks pass with warnings only. Changed executable/config source passes scoped formatting; the lockfile keeps pnpm's generated style. Generic Prettier on that lockfile would rewrite over 14,000 lines and is excluded. No commit is made; the repository's full format-before-commit rule still applies to a future commit.

Other failures were setup/fixture or candidate defects and are documented in the bundle: missing generated capability metadata, treating a type-only SessionId as a runtime schema, advertising no resources while registering its handler, a fake-clock-incompatible deadline, bounded server-error text lost during error wrapping, and four lint findings. Those were corrected before the final checks. Sandbox-blocked loopback/download attempts passed under scoped escalation without bypassing runtime acceptance. Nested unified-diff blank context markers can produce whitespace warnings while adding the pnpm patch; the exact patch bytes are preserved and apply successfully.

The engineering handoff is ready. Recommended next action is review of the upstream correctness/lifecycle changes and optional embedding contract, followed by an upstream-supported release and rerunning the affected gates against it. The Molly adoption patch must remain gated until then. The required independent Codex CLI opinion remains unavailable because its earlier initialization failed with `Operation not permitted`; repository instructions prohibit an automatic retry, and no independent-review result is claimed. This note remains proposed, translation pending, and does not approve or alter the Spec.
