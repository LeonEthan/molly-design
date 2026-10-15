# Bounded native model retries and one execution notice

Status: implemented
Translation: pending

## Abstract

Transient model failures ended design turns immediately, and inference failures were
labelled as session creation failures with a second diagnostic in the design receipt.
The managed profile now uses Pi's native three-retry budget and reports a static final
failure category through the existing chat notice. Failed design outcomes remain durable
without repeating that notice. The adapter preserves native tool and settlement semantics;
upstream classifier and streaming limits remain explicit.

## Decision and reuse

[Issue #137](https://github.com/LeonEthan/molly-design/issues/137) and its locked acceptance
criteria set the behavior. The accepted addendum keeps three retries (four requests total)
and interprets idempotence as repeating only the failed model request after completed tools,
without replaying the prompt/turn or executing tools from an errored response.
This replaces the retry-disabled policy in the
[earlier model-error repair](2026-10-10-design-continuation-and-model-errors.md), retaining
its static diagnostic, worker retirement, dispatch fence and draft preservation.

Reuse Pi 1.0.4's unmodified agent retry, existing retry activity projection, `RequestError`,
`recordChatFailure` and the design outcome store. Adapting these paths supplies the required
behavior; a separate retry loop, storage layer or tool-replay mechanism is unnecessary.
The pure classifier checks context overflow, auth, quota, content policy and invalid request
before Pi's transient match. Only static category/details leave the worker. The CLI keeps
the upstream reason and retirement policy, adding the category-specific failure code.
After session binding, the create path uses the ordinary turn error context.

## Evidence and limits

Synthetic real-SDK tests use production settings and fake timers. They observe overload
then success with native completion identity and retry activity; four failed requests with
static diagnostics and retirement; permanent categories; transient then auth; cancellation
during backoff; and exactly one filesystem side effect across a later retry whose errored
response also contains a tool call. Production retry values are pinned separately.
CLI regressions cover category mapping, bound first-turn failure labeling, diagnostics-free
model outcomes, and diagnostics retained for other failures without changing the canvas.
The final harness suite passed 213 tests and the focused CLI regressions passed 245;
both package typechecks, scoped lint and formatting passed. Existing MCP watcher tests
hit `EMFILE` in the restricted sandbox and passed outside it with synthetic providers.
The read-only Astra review found no P0/P1 issues, including a separate final check of
JSON authentication/quota categories; its own additional test attempts were sandbox-blocked.
The local desktop build and computer-use startup check passed in an isolated profile,
including a canvas-size operation and an unannotated application screenshot. Isolation
used the existing E2E host endpoint setting and a short socket-path alias. No model
request was made through the desktop in this check.

Pi's bare `529`/`ECONNRESET` matching gap, fixed backoff without Retry-After, abandoned
partial streamed text and unsurfaced summarization retry activity remain unchanged. Its
generic "provider returned error" pattern can also retry a wrapped permanent error;
Molly's final category precedence does not change that upstream scheduling decision.
No Pi package is patched.

## Retry control and desktop acceptance

The renderer reuses the existing `ChatFailedMeta.code` subtype and the capacity-retry
button styling. Model codes render one line without the detail modal; only the latest
transient or unknown notice offers Retry, which resends the nearest preceding user message
through the ordinary send path (`buildResendInputBlocks`). The UI adds no automatic retry.

On 2026-10-14 the locally built desktop app ran on a cloned profile on the Mac mini, with a
DeepSeek connection routed through a local proxy that injected HTTP 503s. With three
injected failures the turn showed only the inline "Retrying…" row; the proxy logged
retries about 1s/2s/4s apart, then a forwarded 200. The turn then completed and saved
the artwork. With failures injected on every request, exactly four requests were made, followed by the one line
"Model temporarily unavailable" and Retry. The DOM contained none of "View details",
"Failed to create session", "not retried automatically" or "The artwork was not
updated". One Retry click resent the original message as a new message, which succeeded
after injection stopped. An injected 401 produced one request and the authentication
line without Retry. Two genuine upstream connection resets during a build turn were also
retried automatically. Light and dark screenshots of each state were captured, unannotated.
This is functional evidence, not human visual approval or Spec approval; the
429/Retry-After path and the zh_CN copy were not exercised in the desktop run.
