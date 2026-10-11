# Keyless model execution and OpenAI reauthorization

Status: implemented
Translation: pending

## Abstract

Compatible endpoints could list models without authentication but could not save or run that connection. OpenAI reauthorization also created a new client registration and discarded the account hint. Explicit empty credentials now traverse the existing protected run path, and a main-process OpenAI login adapter retains and validates the registration identity. SDK refresh and inference remain unchanged; synthetic tests establish request and lifecycle behavior, while live provider authorization remains unverified. Reauthorization cleanup cannot safely revoke a grant sharing the retained OpenAI registration.

## Reuse and boundaries

[PR 119](https://github.com/LeonEthan/molly-design/pull/119) owns these corrections, following
the [replacement and discovery fix](2026-10-10-model-oauth-replacement.md).
The existing form, encrypted vault, per-connection mutation queue, run lease and fd-3 grant
are reused. Omitted keys retain the saved value only for its original destination; an
explicit empty key represents no authentication and is accepted only for a compatible
connection. Existing entries require an explicit keyless choice when clearing their key
or changing destination. Native, image and OAuth grants retain their nonempty requirement.

An additional `authType: none` catalog/grant variant was considered but adds persisted
state without removing the SDK adaptation. Pi's `setRuntimeApiKey('')` ignores a falsy
override, and `authHeader: false` alone does not suppress the OpenAI client's bearer header.
The existing model declaration and transport are therefore composed through the public
`registerNativeProvider` API with a credential-only resolver. An empty in-memory credential
uses the SDK's internal nonsecret placeholder and `Authorization: null`; no placeholder is
saved or brokered, and ambient keys cannot supply authentication. Missing credentials stay
unconfigured. The provider is installed before the worker captures its identity guards.

The pinned OpenAI login implementation always dynamically registers and discards the ID
token. `LoginOptions`, a scratch credential store and rewriting the notified URL cannot
repair its callback parser or validate identity. The public `auth.oauth.login` seam is
adapted instead, retaining `openaiProvider`, its refresh/inference behavior and the existing
sign-in service. JOSE was already locked transitively and is now a direct Electron dependency.
No SDK patch, vendor copy, second store or provider retry is introduced.

## Registration identity and cleanup

The [official OpenAI contract](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
requires returning authorization to reuse its issued client ID and host ID, with the
retained ID token as a hint. The adapter binds an edited row/revision before starting,
uses fresh state/nonce/PKCE, accepts an omitted returning callback client ID and rejects
a supplied mismatch. JOSE validates signature, issuer, audience, expiry and nonce; a saved
subject must match, and direct-use scope must be present. Initial registration alone sends
Molly's name. Legacy rows reuse their issued client ID without a fabricated identity/hint;
successful reauthorization establishes the validated subject.

The encrypted OAuth record retains subject, ID token and scopes. Refresh replaces its
access/refresh tokens, expiry and granted scopes while preserving the identity/hint.
Authorization URLs remain in main because they can contain the ID token. Browser-open
failure cancels the attempt, obsolete attempts cannot open a browser, and the callback
listener closes on completion, startup failure and cancellation. An issued grant arriving
after cancellation is cleaned up inside the adapter, independently of the SDK's abort race.

Sign-out, deletion, conversion and replacement with another registration retain queued
best-effort revocation. Reauthorization within the same OpenAI registration does not revoke
its predecessor: distinct token strings do not establish independent renewable sessions.
Abandoned-grant cleanup also preserves any retained matching OpenAI client, or matching
refresh token, rather than invalidating the saved account. This narrows the earlier note's
unconditional replacement revocation. If the provider rotates or creates a session during
a subsequently cancelled attempt, the remote effect cannot be rolled back atomically;
cleanup must prioritize the retained registration. No new local credentials are saved on
cancellation or identity failure.

## Independent opinion and evidence

A read-only Codex CLI opinion (`gpt-6-astra`, high reasoning) recommended the empty-versus-
omitted credential distinction and public provider composition. It independently exercised
the SDK's header handling with a synthetic transport and identified the renderer hint leak,
late-grant cancellation and shared-registration revocation risks. Its strongest objections
were the less explicit empty-string representation and ownership of security-sensitive
authorization code. These tradeoffs remain; a future verified upstream login implementation
would permit removal of the main-process adapter.

The new keyless form case failed before the fix while its keyed counterpart passed.
Synthetic regressions cover saved/reopened empty credentials, exact destination/revision
binding, OAuth-to-keyless revocation, actual SDK request headers with an ambient secret,
worker execution and broker refusal for native empty grants. OpenAI tests sign synthetic
JWTs and exercise registration reuse, missing/mismatched callback client IDs, state,
issuer/audience/expiry/nonce/subject/scope checks, cancellation, refresh retention and
secret-free renderer snapshots. No live provider requests or user credentials are used.

A final read-only review of tracked and new files reported no P0/P1. Full repository
type checks and lint passed, as did CLI 2,948, components 3,038, harness 175 and shared
1,221 tests. Electron's first stage passed 337/338; its unchanged signing fixture lacks
`resources/agent-browser/manifest.json`, independently corrected on main in
[PR 125](https://github.com/LeonEthan/molly-design/pull/125). The remaining Electron stage
passed 19/19 separately. Quick/public-boundary checks, docs validation, formatting and
the OSS Electron Vite production build passed. Live OAuth/inference and native desktop
packaging were not verified; the earlier full-build browser-driver toolchain limit
remains recorded in the PR.
