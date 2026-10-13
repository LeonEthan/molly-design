# Model account replacement and discovery identity

Status: implemented
Translation: pending

## Abstract

Signing in from an edited model connection could update another account or create a second row, leaving existing sessions on the old credential. Provider-level replacement also discarded a renewable grant without revocation, and compatible-model discovery retained results after the endpoint or key changed. Sign-in now carries the edited identity and revision, while replacement shares the existing refresh queue and attempts revocation before local removal. Cancellation ends when irreversible revocation/commit starts; a failed commit may leave the predecessor denied. Discovery rejects stale responses and removes picked discovery drafts when the request target changes, preserving manual declarations.

## Responsibilities and reuse

[PR 119](https://github.com/LeonEthan/molly-design/pull/119) owns these three additional review corrections.
This partially supersedes [the earlier OAuth review fix](2026-10-10-model-oauth-review.md):
its cancelled replacement-chain rollback is retired because restoring a revoked predecessor
does not restore a working account. The earlier heartbeat, worker replacement and host-ID
decisions remain applicable.

The form passes its existing connection ID and expected revision through settings IPC.
The existing vault transaction validates that exact row and preserves its ID, credential
reference, saved name and enabled state. Same-provider model restrictions survive; a provider
change drops them. An edit refuses an unrelated OAuth row for the destination provider.
Add retains the current one-account-per-provider behavior, replacing that provider's row.

The existing per-connection refresh queue now also owns grant replacement, key replacement
and deletion. Provider I/O stays outside the global vault lock. Metadata-only saves remain
available during refresh; compare-and-swap prevents their changes being silently overwritten
by replacement. Candidate schemas, revision and provider uniqueness are checked before
revocation and again before persistence. Queueing before reading the grant also fixes
sign-out/key conversion racing a rotated refresh token.

The existing `revokeOAuthGrant` is reused for all discarded OAuth grants; no provider retry,
SDK patch, protocol or second store is added. `mutateOAuth` alone cannot replace API-key rows
or enforce provider uniqueness, so its queue pattern is adapted into the vault's connection
mutation path. A new replacement protocol or durable pending-grant journal was rejected as
unnecessary for the current scope.

After authentication, target validation and queue acquisition, the service checks cancellation
and enters commit without an intervening await. It clears the authentication timeout and
keeps the sign-in slot occupied through settlement. Cancel or a second begin cannot interrupt
revocation/commit. If commit fails, only the matching surviving predecessor is marked denied
when storage remains available. Abandoned newly issued grants are revoked after checking the
vault; unreadable storage or an uncertain write that actually persisted the grant prevents
blind cleanup of the saved account.

Discovery borrows `useConnectionCheck`'s request sequence and invalidation pattern, without
its debounce/automatic execution because discovery remains an explicit action. The identity
contains provider, endpoint, typed key and saved ID/revision. Changes reset completed results
and discovered drafts; sequence and identity checks reject late responses even after an input
is changed back. Saved/manual declarations remain editable.

## Independent opinion and limits

A read-only Codex CLI opinion (`gpt-6-astra`, high reasoning) recommended a non-cancellable
commit phase and identified refresh races in the earlier deletion/conversion helpers.
Its strongest counterargument is that closing or changing the form after that boundary can
still save the account. The renderer's completion callback refreshes the authoritative list;
the user guide and draft Spec explain the boundary. The suggested serialization is applied
to credential changes; metadata-only edits keep their earlier nonblocking refresh behavior.

Revocation and disk persistence cannot form one atomic transaction. A crash or unavailable
storage after remote revocation can leave the old grant unusable. Revocation is best-effort,
and neither synthetic tests nor a successful build proves live OpenAI/Kimi interoperability.
The draft Specs stay draft; no approval is inferred from code or checks.

## Evidence

Deterministic vault/OAuth tests passed 53/53, settings-form tests 40/40, and shared boundary
tests 8/8. They exercise exact API-key/OAuth edits, provider collisions, Add replacement,
rotation before deletion/conversion, cancellation on both sides of commit, a fake-clock
timeout during revocation, write failure and an uncertain persisted outcome. Four discovery
regressions failed before the fix and passed afterward, including clearing discovered drafts
while retaining manual declarations. No real provider requests, browser callbacks or sleeps
are used in these new tests.

The final read-only Codex CLI review reported no introduced P0/P1 across the complete diff,
including this note and the compressed service/settings rules. It did not rerun tests or
exercise live providers.

`pnpm check` passed type checks, lint and CLI 2,946, components 3,037, harness-pi 172 and
shared 1,221 tests. Electron passed 318/319 in its first stage; the same unchanged macOS
signer fixture still omits `resources/agent-browser/manifest.json`. The remaining stage
passed 19/19 separately. Current main now supplies the missing fixture; that independent
fix is absent from this branch. `pnpm check:quick`, format, docs governance against `origin/main`,
and the separate OSS Electron Vite build passed. The service/settings rules merge cleanly
with main at 8,127/8,081 bytes, below the 8 KiB gate. The earlier full-build limitation
from the missing Rust 1.99.0 browser-driver toolchain remains; it was not rerun here.
