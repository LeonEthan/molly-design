# Native browser CLI nullable replies

Status: implemented
Translation: pending

## Abstract

The pinned native browser CLI serializes absent optional response fields as JSON
null, but Electron previously allowed only omitted values. Normal successful
connection and snapshot replies therefore became unknown outcomes and revoked
Agent control before the page could be observed. The host now accepts null and
omitted data/error values through the existing parser while preserving validation,
revocation and no-replay behavior for malformed replies. Deterministic synthetic
child-process tests reproduce the exact unknown-outcome symptom before the fix;
the original real acceptance run did not capture raw native output, so this defect
is not claimed as its proven sole runtime cause.

## Evidence and reuse

The pinned Rust `Response` has `Option<Value>` data and `Option<String>` error
fields without omission-on-None serialization. Its JSON output uses that existing
structure directly. Electron's `BrowserAgentRuntime.call` parsed it with optional
record/string schemas, which reject null. Successful responses commonly include
`error: null`; native failures include `data: null`. This is a host compatibility
bug rather than a new browser protocol requirement.

Reuse ladder: retain the public CLI envelope, owned daemon, runtime call and driver
fallbacks. Adapt the existing schema with nullish fields. The old controller
fixture was examined, but it substitutes `runtime.call` and cannot expose the
parser defect. The new test reuses the repository's esbuild/VM fixture pattern
and injects synthetic child stdout/close events into the real runtime call path.
Changing the upstream Rust envelope, adding a second protocol parser, or retrying
an uncertain command would add mechanisms and alter existing ownership guarantees
without necessity.

The earlier read-only Codex CLI gpt-6-astra/high opinion independently identified
this mismatch but could not recover the missing raw child output from the original
real run. The implementation follows the source-backed diagnosis; it does not
convert that advisory opinion into real-site acceptance evidence.

## Validation and limits

Before the fix, `node --test
apps/electron/src/main/services/browser-agent-runtime.test.mjs` failed both nullable
success and nullable failure cases with the exact fixed user-facing unknown-outcome
message. The final test uses one synthetic child per call, matching production
process ownership. After the fix, the four runtime tests and eight existing
controller tests pass. They cover successful connect followed by snapshot,
preserved native errors, omitted-field compatibility, and malformed replies that
revoke the lease and reject later observations. No real sleeps, networks, accounts,
models or captured user transcripts are part of the tests.

Electron main-process type checking passes. No native patch, binary identity,
protocol version, capability, replay rule or website-account behavior changes.
Real signed-app, website snapshot/screenshot and model-tool regression remain the
acceptance runner's responsibility. Invalid output and transport loss still report
unknown outcomes; this fix does not promise recovery from every such failure.
