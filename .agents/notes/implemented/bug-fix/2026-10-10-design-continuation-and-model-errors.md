# Design continuation paths and native model errors

Status: implemented
Translation: pending

## Abstract

A completed delegated operation could fail before resuming a design because its
durable turn ID contains colons, while design input paths accepted only ordinary
filename characters. Design preparation, preview and collection now share a
filesystem-safe mapping while keeping the original turn identity in history and
receipts. Separately, native model failures were flattened into an internal host
error; the managed adapter now reports a static model-request diagnostic through
the existing upstream-error presentation. These changes preserve drafts and the
no-replay boundary; they cannot eliminate failures in an external model service.

## Evidence and responsibility

The real `getOperationCompletionTurnId` producer emits
`operation-completion:<sessionId>:<operationId>`. A synthetic integration test
reproduced `unsafe turnId` in chat, ordinary project and Git project contexts at
`materializeDesignTurnInput`, before model dispatch. The continuation ID is valid
product identity, not a filename or a request to change the storage root.

An installed-package failure independently ended with Pi's native assistant
`stopReason: error` after an upstream HTTP 500 / HTTP/2 stream failure. The adapter
discarded that classification and the host returned only
`pi_acp_host_execution_failed`. A real-SDK synthetic-provider test reproduced the
same masking without a paid request. No user transcript, credential, native history
or machine-local record is included in fixtures or this note.

## Reuse and trade-offs

- Reuse the existing `designTurnInputDir` resolver, immutable input manifests,
  draft directories, receipt store and operation identity. Ordinary turn paths
  stay unchanged. Colon-containing IDs get a deterministic digest in a separate
  directory namespace; raw IDs remain authoritative metadata. Relaxing the
  filename check alone would leave Windows-incompatible colons and independent
  path readers, while changing the producer would invalidate durable delivery IDs.
- Adapt existing preview and collection readers to the same resolver. Do not add
  storage, a migration, a new workflow or a separate replay mechanism. Traversal
  and overlong IDs remain rejected; existing draft workspace redirection checks
  are unchanged. Frozen inputs retain their existing workspace-bookkeeping trust
  boundary, rather than becoming an isolated store.
- Reuse ACP `RequestError`, the host's existing safe-error pass-through and the
  CLI's `acp_upstream_api_error` UI. Only the static structured
  `harness_model_request_failed` code marks this managed failure. It also retires
  the already-invalid worker; ordinary upstream ACP errors retain their previous
  lifecycle. Raw provider error text is unnecessary and could contain credentials.
- Keep unknown host failures generic, keep native failure distinct from completion,
  and keep the durable dispatch fence. The user chooses a new message; there is
  no automatic model retry, artifact commit, failed-turn replay or rewrite of old
  native history.

## Verification and limits

Regression tests first reproduced both defects. Design coverage exercises frozen
input reuse, current-workspace resolution, live preview, collection and original
receipt/history identity. Harness coverage uses the production profile and a
synthetic provider to check the static error, absent provider payload, worker
retirement and no repeat inference. CLI coverage verifies presentation and cleanup
without broadening stale-connection retry behavior.

The focused design tests passed all 77 cases; the adapter and host tests passed
58, and CLI error classification and execution passed 187. `pnpm check` passed,
including all 168 harness tests, 3,068 CLI tests, 3,224 component tests, types,
lint, translations and repository boundaries. The full run retained six existing
skips. `pnpm format`, `pnpm run docs check` and the local desktop build passed;
documentation reports only existing size warnings and no protected topics.

Codex CLI's independent read-only review (`gpt-6-astra`, high reasoning) reported
no P0/P1 findings after checking identity/path consumers, error payloads, worker
retirement and replay behavior. The opinion is advisory and did not apply edits.
The local macOS arm64 DMG `0.1.0-dmg-fix.1` passed packaging resource checks,
CLI boot/native binding checks and ad-hoc signature verification. A copy taken
from its read-only mounted image passed the sealed Pi smoke using its own Helper
executable: native package commands, tool discovery and nested Codemode file reading
all worked against a synthetic loopback service.

The isolated native P1 design probe did not complete. Both direct and ordinary
LaunchServices startup stalled before design evidence was produced; process sampling
located the main thread in macOS Keychain access (`SecItemCopyMatching`). No system
authorization was bypassed. The failed rounds remain in ignored local acceptance
evidence. Saving, reopening, exporting and visual quality are therefore not claimed
as verified in this package. The artifact is a local ad-hoc build, not a notarized
release, and the user's installed application and data were not replaced.
This is a repair of existing behavior, not a change to Spec intent or approval.
No real provider request or manual visual acceptance is implied by synthetic tests.
