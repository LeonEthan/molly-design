# Compatible Responses and Gemini connections

Status: implemented
Date: 2026-10-20
Translation: pending

## Abstract

[#181](https://github.com/LeonEthan/molly-design/issues/181) enables the two previously gated compatible protocols, OpenAI Responses and Gemini Native generateContent. The backend reuses Pi's unmodified native adapters and the existing connection/vault contracts, adding shared endpoint normalization and Gemini model-list parsing. An explicit check now asks the selected model for a short response for these two protocols; it may incur usage, and listing models alone cannot pass it. Synthetic tests cover transport behavior and persistence; real provider and desktop acceptance require separate evidence.

## Reuse and decisions

The existing compatible API enum, presets, schema normalization, encrypted vault and
`configureModelConnection` already carry protocol identity. They are extended rather
than replaced with a provider registry or parallel storage. The missing-api fallback
remains OpenAI Chat Completions. Save/reload/save/run-grant tests cover every protocol
for [#190](https://github.com/LeonEthan/molly-design/issues/190), alongside editor
snapshot/reopen/remount coverage.

Pi 1.3.0 already implements Responses and Google streaming, tools, thinking and abort.
Molly registers the declared protocol and normalized endpoint through its existing
public model runtime. It adds no transport patch, retry policy or custom adapter.
Google's adapter deliberately rejects a distinct top-level custom fetch. Molly uses
the public Google HttpOptions.fetch hook for redirect enforcement, as described below.
Native behavior fixtures inject synthetic responses; security regressions use a public
MockAgent dispatcher without replacing global fetch or opening sockets.

Normalization happens before the host freezes the selected model's resolved base URL.
The existing exact model/endpoint and provider-configuration guards stay intact.
Managed ACP admission tests complete actual runs for trailing-slash and repeated-path
Responses/Gemini URLs; another host or another path is refused before inference.
Response checks require visible text after settlement: a Gemini STOP candidate with
non-thought text, or a completed Responses response/message containing output_text.
Thought-only replies, incomplete/failed responses and unfinished messages do not pass.

Shared base normalization removes trailing slashes, repeated adjacent API-version
segments and pasted Responses/models resource suffixes before the existing consumers
append their paths. Existing Anthropic and Chat Completions request conventions stay
unchanged. Gemini discovery uses x-goog-api-key, reads native model names and token
limits, and excludes declared methods lacking generateContent. Responses discovery
honors explicit responses endpoint declarations.

The existing free model-list check cannot prove model response. The two new protocols
therefore use one bounded, explicit, unretried POST to the selected model; a key check
without a model ID or a model-list-shaped reply fails. Existing native/key-list and image
checks retain their behavior. The shared check input gains optional modelId so current
callers remain compatible; the two new protocols require it at execution.

## Frontend

The picker reads the shipped list, so all four types enable with their exact labels once
shared ships them; the gated-entry mechanism stays for future protocols. The editor keeps
a typed key across type switches, while applying a preset still clears it — the preset
changes the destination, and changed destinations require renewed credential consent.
The two new protocols never auto-check on settle: the possibly billed model-response POST
runs only from an explicit Check connection click or the row menu, and the form sends the
first declared model ID as `modelId`. Their success reads "Connected. Model responded.";
their failure copy lives in a dedicated `settings.check.modelFailures` family (exact
acceptance strings for key rejected and network) plus `failures.not_found` for a 404, so
the free list-check copy everywhere else is unchanged. Mid-chat the new
`model_endpoint_not_found`/`model_server_unreachable` codes map to the same strings.

The inspected baseline already persists `compatibleApi`, initializes the form from it,
and defaults missing types to `openai-completions`. The reported #190 symptom did not
reproduce against that source. This change enables all types and protects the existing
identity path with editor save/reopen/remount and vault save/reload/grant regressions,
covering all four types and the legacy fallback. Native Electron verification also
preserved every saved type through unchanged saves and an application relaunch.

The shared automatic check hook keeps its existing return contract for image callers.
The model editor uses its controller variant for explicit checks. New model-specific
error translations leave existing image check copy and callers unchanged.

Local native Electron verification passed the existing three smoke scenarios (18 steps)
and a synthetic connection-editor probe with 42 checkpoints. It exercised exact labels,
required masked keys, presets, normalized discovery/check requests, success and
401/404/network copy, key retention on type switches, and four-type persistence.
Evidence and screenshots remain local in ignored artifacts. Live Responses and Gemini
are **not verified, no endpoint**; cloud Linux desktop acceptance is unavailable.
Canvas inference and mid-chat errors are covered by native-adapter/unit tests rather
than this editor probe.

Upstream bodies stay in main/worker. Static shared failure categories add not_found and
unreachable, mapped to model_endpoint_not_found and model_server_unreachable. They let
the existing chat failure notice show the same fixed 404/network copy as Settings.
Authentication retains model_auth_rejected. Policy and billing evidence keep precedence.
These categories do not change Pi's retry decisions or the deferred #143 defects.
The published Google SDK recognizes a raw JSON error chunk during streaming; an
error wrapped only in an SSE `data:` envelope can instead lose its status and end
with Pi's generic missing-finish-reason error. This upstream limit is preserved,
without patching the adapter.

## Protocol references

- [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create): selected model, text input and bounded output.

- [Google models](https://ai.google.dev/api/models): native names, supported generation methods and token limits.
- [Google generation](https://ai.google.dev/api/generate-content): generateContent and streamGenerateContent request/response shapes.
- [Pi 1.3.0 Google adapter](https://github.com/earendil-works/pi/blob/v1.3.0/packages/ai/src/api/google-generative-ai.ts): versioned base URL and native streaming.
- [Pi 1.3.0 Responses adapter](https://github.com/earendil-works/pi/blob/v1.3.0/packages/ai/src/api/openai-responses-shared.ts): response text, reasoning and function events.

## Evidence and limits

Backend fixtures use synthetic keys, model IDs and in-memory HTTP responses. They test
native streaming and thinking deltas, actual tool execution plus result serialization,
active cancellation, static final HTTP/network error diagnostics, protocol-specific
listing and response checks, and encrypted save/reload/save/run grants. No captured
transcripts, paid inference or live network occurs in these tests. Executed on the
final backend changes: the complete harness suite passed 360 tests, including 20
protocol cases, 64 managed-host cases, 64 redirect cases and two managed native
redirect cases. The selected shared suites passed 46 tests and Electron
connection/discovery/vault services passed 94. Eight managed-host cases cover
normalized-URL admission and alternate-endpoint refusal;
response checks reject thought-only and incomplete replies. Shared, harness and
Electron main type checks, public-boundary checks and docs checks passed.
Desktop/provider acceptance remains with integration; fixture coverage alone does
not establish a live endpoint or visual acceptance.

## Security review follow-up

The independent review reproduced two defects. Native Google streaming followed a
cross-origin 307 and forwarded x-goog-api-key and the prompt; Responses forwarded
the prompt while fetch stripped Authorization. The host's base-URL admission guard
checks the original endpoint and cannot prevent a later redirect. Empty compatible
credentials could also become a placeholder key on the Google wire.

The explicit integration decision selected the narrow public-options solution.
Pi 1.3.0 pins Google 2.21.0, whose HttpOptions lacks a fetch hook. The scoped override
`@earendil-works/pi-ai@1.3.0>@google/genai: 2.23.0` adopts the published version that
exposes `HttpOptions.fetch`, retaining Pi 1.3.0 and mem0ai's Google 1.52.0 dependency
graph. No quarantine exception, SDK patch, fork or vendored package is used. The
CLI's existing dispatcher was considered; it lives in another process and lacks
model redirect admission. A worker dispatcher architecture and the unnecessary
Google 2.30 upgrade were rejected in favor of the public hook.

`configureModelConnection` composes the captured native `stream` and `streamSimple`
methods at the existing native-provider registration. Responses forces a top-level
fetch that sets redirect:error after request init. Gemini leaves its unsupported
top-level fetch option alone: it awaits the existing onPayload callback, keeps its
replacement (or mutations when it returns undefined), then overwrites only
config.httpOptions.fetch with the enforced fetch. Serialization, tools, reasoning,
cancellation and other options stay owned by the native adapters. Callers cannot
supply a fetch or replacement callback that restores redirect following. The
runtime's complete/completeSimple methods and compaction/extraction inherit the
same registration; no main-loop-only enforcement or global fetch patch is added.

Responses/Gemini now reject empty or absent credentials before transport, managed
admission refuses empty grants, and vault saves cannot inherit an empty legacy
credential. Discovery requires a key too. Compatible Anthropic Messages and Chat
Completions retain their prior empty-key behavior without ambient fallback.

Molly owns the compatibility cost of the scoped override. The build asserts
Pi-relative Google 2.23.0 resolution in the staged closure; the existing manifest
verifier checks resources, package and lock hashes. Future dependency updates must
review the override and assertion together and rerun native behavior, redirect,
lifecycle and packaged smoke checks. Passing the SDK version alone is insufficient.

The no-socket redirect regression uses undici MockAgent without replacing global
fetch or patching an SDK. Its 64 cases cover both protocols, stream/streamSimple and
complete/completeSimple, same- and cross-origin 307/308, and awaited callback
replacement plus attempts to restore redirect following. Each observes the original
request and confirms that the redirect destination receives no key, prompt or
request. Managed native-session tests additionally exercise redirected personal
memory extraction and manual compaction: extraction preserves the completed turn,
and compaction fails without forwarding content. Real-provider/desktop acceptance
remains separate from these synthetic security checks.

The staged CLI closure contains Pi 1.3.0 and resolves Google 2.23.0 relative to Pi.
The staged Google entry bytes match the installed package; its resource hash and
the manifest lock hash match. The existing verifier passed all 19,667 resources
across 222 locked packages. The existing packaged synthetic smoke passed six
commands, native tools and Codemode using its synthetic loopback service. That
smoke validates the packaged worker, not live Responses/Gemini endpoint acceptance.
mem0ai still resolves Google 1.52.0. The public-boundary check passed after the
manifest/lock change.


## Final integration verification

Integrated main `f2352db6` before final validation. Frozen install, root formatting,
`pnpm check`, docs check, desktop build, three smoke scenarios (18 steps), and the
42-checkpoint synthetic editor probe passed. Independent backend and frontend
reviews reported no remaining P0/P1 findings. Image connection files, picker,
settings drawer, updater, and website are outside the diff. The primary checkout
remained clean. Live-provider and cloud Linux limits above still apply.
