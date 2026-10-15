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
The maintainer deferred bare transient codes, wrapped permanent errors and Retry-After
to [#143](https://github.com/LeonEthan/molly-design/issues/143), allowing the completed
#137 scope to merge while these upstream defects remain unresolved.

## Decision and reuse

[Issue #137](https://github.com/LeonEthan/molly-design/issues/137) and its locked acceptance
criteria set the behavior. The accepted addendum keeps three retries (four requests total)
and interprets idempotence as repeating only the failed model request after completed tools,
without replaying the prompt/turn or executing tools from an errored response.
This replaces the retry-disabled policy in the
[earlier model-error repair](2026-10-10-design-continuation-and-model-errors.md), retaining
its static diagnostic, worker retirement, dispatch fence and draft preservation.

Reuse Pi 1.0.4's unmodified agent retry, existing retry activity projection, `RequestError`,
`recordChatFailure` and the design outcome store. Adapting these paths supplies bounded
native retry and final diagnostics; it does not repair upstream retry policy. A separate
retry loop or tool-replay mechanism is outside the accepted SDK boundary.
The pure classifier checks context overflow, quota (including HTTP 402 and credits), content
policy (including guardrail and prompt-injection 403s), then authentication and invalid
request before Pi's transient match, so a policy 403 is not reported as a rejected key. Only static category/details leave the worker. The CLI keeps
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
This earlier run was reported as functional evidence, not human visual approval or Spec approval; the
429/Retry-After path and the zh_CN copy were not exercised in the desktop run.

## Acceptance correction, 2026-10-14

Revalidation for [PR #142](https://github.com/LeonEthan/molly-design/pull/142) found
that the earlier claim of a sole retry line was inaccurate: the real Electron
renderer displayed both "Retrying..." and the generic "Thinking" footer. The
replacement evidence images also came from constructed UI fixtures, with added
annotations; they did not establish the required actual-app presentation.

`SessionChatStreamView` now suppresses that footer while the latest unfinished
assistant message carries an active native retry. This reuses the existing activity
projection and renderer; a second stored busy state or retry mechanism is unnecessary.
Completing the retry restores the ordinary activity label. A rendered regression
first failed with `Retrying...Thinking`, then passed after the fix; the existing
notice and activity suites also pass. English and Chinese retry copy use the same
ellipsis as their final-notice controls.

A separate real-SDK probe with synthetic responses and fake timers failed the
locked acceptance expectations for bare `529`, bare `ECONNRESET`, and wrapped
`Provider returned error: 401 invalid api key` (four requests instead of one).
Pi [1.2.0's tagged retry implementation](https://github.com/earendil-works/pi/blob/v1.2.0/packages/ai/src/utils/retry.ts) retains these classification gaps and the
fixed backoff; upgrading alone does not resolve them. The read-only Codex CLI
second opinion (`gpt-6-astra`, high) independently found no public retry-policy
seam satisfying all criteria without a workaround: settings expose no classifier
or response-delay callback, response hooks cannot choose a delay, message rewriting
changes persisted history, and continuation/provider wrappers add a separate policy.

At this review stage these were unresolved acceptance defects, not accepted exceptions. Keep the pinned
SDK unchanged under `packages/harness-pi/AGENTS.md`; full completion requires an
upstream fix or explicit human amendment of the boundary or acceptance criteria.
No Spec approval or merge approval follows from passing tests or this review.

The final desktop run used a fresh isolated profile, the built Electron/CLI/renderer,
and a loopback OpenAI-compatible wire fixture; all prompts, responses, model labels
and artwork were synthetic. No product UI was replaced or annotated, and no live
model or existing user profile was used. The six files in
[the evidence directory](../../../pr-evidence/137/) now show native window captures
of retrying, recovered and exhausted states in light and dark. Native capture is
necessary because renderer-only screenshots omit the separate canvas WebContentsView.

Three injected 503s recovered automatically, with measured gaps about 1s/2s/4s,
then native read/write calls changed and saved the poster. Persistent 503s made four
requests, left the artwork intact, and showed one final line plus one Retry button.
One click added exactly one copy of the original user message as a new turn; after
three further transient failures that turn recovered and saved. Both themes show
one retry row without the generic footer. An unwrapped 401 made one request and
showed the authentication hint without Retry or details. Simplified Chinese showed
the translated retry, exhausted, Retry-button and authentication states. The final
failed runs retained the latest saved headline size (70) in both draft and current
YAML; the current projection uses normalized formatting and adds derived fields.

The real desktop 429 probe returned `Retry-After: 10`, yet the next request arrived
1007ms later and succeeded. This is an observed failure of the locked criterion,
not a passing rate-limit test. The native policy remains unmodified.

Final `pnpm check` passed: harness 234, components 3155, CLI 2971 (3 skipped), plus
the remaining package suites, types, lint, i18n and public/platform boundaries.
`pnpm format`, `pnpm e2e:build`, and `pnpm run docs check` passed. A separate read-only
Codex CLI review of the footer fix found no introduced P0/P1; its queue/history and
virtualization assessment was source-based and it did not rerun Electron.

## Maintainer scope amendment, 2026-10-14 PT

The [acceptance amendment](https://github.com/LeonEthan/molly-design/issues/137#issuecomment-6183452896)
and [PR decision](https://github.com/LeonEthan/molly-design/pull/142#issuecomment-6183453552)
move exactly the three reproduced upstream gaps into [#143](https://github.com/LeonEthan/molly-design/issues/143).
They no longer block #137 / #142; deferral does not mean the original behavior is
implemented. Other acceptance requirements and the original long-term target remain.
The maintainer authorized merging the completed scope after its remaining checks pass.

Wait for released upstream fixes, then adopt and verify them; do not patch Pi or add a
Molly workaround. This preserves the existing SDK boundary and avoids maintaining a
second retry policy. The trade-off is that affected errors can still fail without a
retry, retry unnecessarily, or exhaust their budget before the server permits recovery.
The two latest review threads were resolved as explicitly accepted deferrals, not fixes.

Upstream [#10601](https://github.com/earendil-works/pi/issues/10601) and its unmerged
[PR #10600](https://github.com/earendil-works/pi/pull/10600) track Retry-After;
[#10941](https://github.com/earendil-works/pi/issues/10941) reports the network errno gap.
The focused [contribution proposal #10975](https://github.com/earendil-works/pi/issues/10975)
requests permission to fix wrapped authentication classification. Its extension-free
classifier reproduction confirms direct 401 is not retryable but wrapped 401 is, on
the installed Pi 1.0.4 and unchanged v1.2.0 classifier. Pi requires maintainer `lgtm`
approval before an upstream PR; `lgtmi` only permits subsequent issues. The proposal
was auto-closed by the new-contributor gate and awaits maintainer review; it does not
represent approval or an implemented fix. The harness Spec remains draft.
