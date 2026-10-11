# Model OAuth review fixes

Status: implemented
Translation: pending

## Abstract

Model-account refresh held the credential vault lock while contacting the provider, so host heartbeats could miss their deadline. Normal token rotation also failed a follow-up after the native run fence had been created, and reauthentication removed the connection identity saved by existing sessions. The fixes serialize refresh per connection, compare the grant before persisting, preserve connection identity and replace used OAuth workers through the existing prompt boundary. OAuth follow-ups now pay worker startup and MCP reconnection costs; real OpenAI and Kimi sign-in remain unverified.

## Responsibilities and reuse

[PR 119](https://github.com/LeonEthan/molly-design/pull/119) owns these review corrections.
The native worker already rejects changed keys, but that guard runs after the journal fence
and cannot recover an undispatched prompt. The CLI's existing `needsReplacement` branch
can restore native history before granting a new epoch, so it is reused with an OAuth marker.
A separate credential preparation protocol and rotation-driven catalog revisions were
rejected: the former adds lease/replacement state, and the latter invalidates the pending
lease which requested refresh. API-key workers continue to reuse their existing epoch.

The encrypted vault remains the sole persisted credential record. `mutateOAuth` runs its
provider callback under a per-connection queue, outside the global vault transaction.
It commits only when the same credential binding and complete prior token set survive.
Unrelated metadata edits can merge with a completed refresh, preserving a rotated token;
new login, conversion or deletion prevents stale refresh from publishing. The host
coalesces each pending refresh request until its report is acknowledged, and retains
reports which arrive while an exchange is in flight. No provider retry is added.

Reauthentication advances the connection revision while preserving its ID, credential
reference and selected model subset. Cancellation rollback checks both ID and revision;
cancelled replacement chains use that same identity. Provider changes clear the form's
OAuth state, cancel the prior flow and reject late begin/complete results.

Settings save, sign-out and ordinary deletion share the existing best-effort revocation
path before discarding a grant. The OpenAI agent-host UUID is created once in the encrypted
vault and reused after restart, matching [OpenAI's registration contract](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).
The optional vault field keeps existing vaults readable by this version; older strict
readers do not recognize it. Provider revocation cannot be undone by reverting code.

Compatible-model requests reuse the existing Pi compatibility declaration. Saved streaming
usage choices survive, while unknown support defaults to false. An earlier review fix
preserved explicit values but retained the unsafe true fallback. A real SDK stream with
synthetic fetch reproduced an unwanted `stream_options` on a new model; the same request
now omits it, while explicit true still includes usage. No SDK patch or request middleware
is added.

## Independent opinion and evidence

A read-only Codex CLI opinion (`gpt-6-astra`, high reasoning) confirmed the heartbeat,
rotation and reauthentication defects and recommended reuse of the prompt-boundary worker
replacement. Its strongest counterargument was the startup/MCP cost on every follow-up.
Its suggested strict metadata-revision comparison could discard a consumed refresh token
after a name edit; the implementation instead checks the complete grant and destination,
while checking the request's revision before refresh starts.

The final read-only Codex CLI review found no introduced P0/P1 across the complete diff,
including new files. It assessed source and synthetic regression evidence, without running
the repository checks or exercising real providers.

Targeted deterministic tests passed: vault/OAuth 43, settings form 35, CLI control 15
and connection defaults 9.
They cover reads/saves during a held refresh, a concurrent name edit, stale refresh/rollback
after reauthentication, revocation before conversion/deletion, restart identity, a report
arriving mid-exchange, wrapped refresh denial, early registration failure, provider-switch
fencing and worker replacement before the next OAuth prompt.

`pnpm check` passed type checks, lint and the CLI (2,946), components (3,032), harness-pi
(172) and shared (1,220) tests. Electron's first test stage passed 308/309: the unchanged
macOS signer fixture omits `resources/agent-browser/manifest.json`. The fixture and signer
match `origin/main`; running that fixture alone reproduced the failure. The remaining
Electron test stage passed 19/19 separately. `pnpm check:quick`, including public-boundary
checks, `pnpm run docs check`, `pnpm format` and `git diff --check` passed.

`pnpm build` built the CLI/embedded harness but stopped at the existing browser-driver
prerequisite: Rust 1.99.0 for `aarch64-apple-darwin` is unavailable. The separate OSS
Electron Vite build passed for main, preload and renderer; its main bundle includes the
static OpenAI/Kimi OAuth registration implementations. Synthetic tests make no provider
requests; they do not establish live sign-in or provider interoperability.
