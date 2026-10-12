# One-step browser account import

Status: implemented
Date: 2026-10-11
Translation: current
PR: https://github.com/LeonEthan/molly-design/pull/126

[中文版](2026-10-11-whole-profile-browser-import.zh.md)

## Abstract

The previous Pinterest-only flow listed every browser's profiles, read cookies twice,
and requested Keychain access through a generic system helper. The owner approved a
single Import action with browser/profile together and a collapsed, fully selected
catalog of design and commerce websites. This implementation reads one profile in
main, filters the selected catalog IDs, merges exact cookie identities, and requests
Keychain access inside Molly. Synthetic tests establish cancellation, isolation and
verified recovery; real signed authorization and website login compatibility remain
unverified. Imported counts are explicitly not evidence of sign-in.

The [permission-intent revision](../bug-fix/2026-10-11-browser-import-intent-permissions.md)
partially supersedes this record's profile-discovery, retry and native inventory
adaptation, and records later real Chrome/Pinterest acceptance. The
original native-read, transaction and signing decisions remain historical evidence.

## Approved scope and reuse

The [approval record](../../../../.github/spec-approvals.md#2026-10-11-whole-profile-browser-import)
supersedes this note's original preview-token and deferred-Keychain proposal. The
UI has one action and no preview token. The shared catalog contains 13 design and
14 commerce platforms. It shows exact domains when expanded, includes shared Adobe
and TikTok account domains, and excludes generic identity providers and arbitrary
Shopify stores. It is an import filter, not a verified login matrix.

Reuse ladder: existing Dialog, Select, Checkbox and Collapsible are adapted into
`BrowserAccountImportDialog`; existing settings, Browser menu and Pinterest setup
entry points open it. Existing Agent pause, partition/signing policy, cookie
transaction and native resource sealing are adapted. The pinned rookie `read()`
replaces its old report + detail reads; a small native patch replaces only Keychain
access and adds profile budgets. A custom Chromium decoder, browser extension,
source-browser CDP attachment, preview-token store and alternate session database
were rejected because existing modules supply the required capabilities.

## Source and authorization

Application bundle discovery touches no profile. Selecting a browser reads only
its profile metadata; main retains known opaque profile IDs. Import performs one
whole-profile native read with encrypted/session/expired cookies and partition
metadata. Main filters the selected catalog, skips/counts source CHIPS and expired
cookies, rejects partial/decryption warnings or unknown contexts, and keeps values,
keys and filesystem paths out of renderer and Agent responses. Limits are 50,000
rows and 32 MiB of core cookie payload, exercised with synthetic oversized input;
these are conservative product bounds, not measurements of customer profiles.

The native addon runs in Molly and uses Security.framework. Key bytes stay native
and are zeroized/freed. Only its sealed staged resource loads; npm supplies types.
Build/dev/packaging share the pinned archive, compiler and patch. Existing signing
reseals native bytes before the root app seal, and the encrypted-cookie fuse remains
required. Stable signatures may retain authorization, but OS policy, Keychain
settings and signature changes can prompt again. A cooperative timeout/cancel
cannot dismiss a system prompt. An aborted read retains its operation slot until
native settlement, discards late results and never writes.

## Destination and lifecycle

Matching domain/path/name cookies are updated while Molly-only data stays. The
write phase holds new Agent/page/navigation work, pauses active runs, closes and
drains owned WebContents, blocks new requests/responses, and closes connections.
A temporary blank page in the destination partition enumerates registrations and
starts/pauses every Service Worker with a native keepalive task; remaining Shared
Workers are paused too. Unsupported versions/targets fail before mutation. Closing
or stopping Workers alone was rejected: a Cookie Store subscription can restart a
Worker on a cookie change without network access. No global debugging port is added.

A complete CDP snapshot retains partition and cookie metadata. Conflicting target
partitions and quota pressure fail before mutation. Quota headroom is 170 cookies
per registrable domain and 3,000 overall for growing jars; unchanged/overwritten
identities do not consume extra capacity. Precise deletes and complete readback
verify the merge and rollback, excluding natural expiration. Unverified recovery
retains the isolation lease until explicit clearing. Clearing removes all Molly
website storage, cache and HTTP authentication state, not source-browser data.

Owner reload/close revokes pre-write operations. Accepted writes and rollback drain
on quit. Saved page URLs reopen after release, unless their owner or consumer has
closed. No Agent is automatically resumed. Manual takeover/MFA holds fresh runs
until explicit resume or native destruction; ordinary paused scopes remain tied
to their original run so later tasks can continue.

## Evidence and limits

- `browser-account-source.test.mjs`: curated boundary matching, one complete read,
  redaction, cancellation, limits, exact merge, quotas and verified rollback.
- `public-browser-service.test.mjs`: unavailable builds, owner loss, single native
  lease, late pages/runs, native destruction, quit drain, clearing and takeover.
- Renderer tests cover default collapsed/all-selected scope, one action, result and
  skip messages, retry, cancellation/finishing, unavailable builds and all entry points.
- `browser-cookie-reader.test.mjs`: sealed addon loads and reads a synthetic open
  SQLite/WAL database; a 50,001-row profile is rejected. No Keychain item was read.
- `browser-account-probe.mjs`: production isolation and transaction on Electron
  44.7.0 / Chromium 152.0.7977.130 held running and stopped cookie-change Workers;
  release let the queued write proceed. Clearing all website data succeeded while
  registered Workers were paused. Rollback preserved host-only/domain cookies,
  sibling paths, CHIPS and metadata.
- Native signing fixture verifies the addon resource reseal before root signing.
- `pnpm check`, `pnpm format`, `pnpm build`, and `pnpm run docs check` pass, covering
  workspace checks, the local OSS desktop build and documentation contracts.
- Codex CLI `gpt-6-astra`, high, read-only, first identified Worker restart as the
  isolation risk. Its implementation review found stale takeover records blocking
  later runs; run-scoped cleanup was restored with a regression test. No other
  actionable P0/P1 finding was established by that review.

No real account/profile data was accessed. No claim is made for new signed Keychain
prompts or retained grants, Developer ID/notarization/upgrade behavior, or 27-site
live login compatibility. The old importer’s real Pinterest acceptance is historical.
The earlier temporary HTML preview was blocked by browser policy; it was not bypassed
and does not provide visual approval for the runtime dialog. Spec status stays draft
for unrelated revisions and uncompleted acceptance.

Primary references: [upstream reader](https://github.com/teng-lin/rookie-cookies/tree/c934548faa1bab23984a9d82e4d62bd67230a1f9),
[Chromium Worker enumeration](https://raw.githubusercontent.com/chromium/chromium/152.0.7977.130/content/browser/service_worker/service_worker_context_watcher.cc),
[Electron Service Workers](https://www.electronjs.org/docs/latest/api/service-workers),
[device-bound credentials](https://blog.google/security/protecting-cookies-with-device-bound-session-credentials/),
[Amazon global marketplaces](https://sell.amazon.com/global-selling/),
[eBay marketplace domains](https://developer.ebay.com/api-docs/user-guides/static/mip-user-guide/mip-enum-marketplace.html),
[Lazada markets](https://www.lazada.com/en/contacts/).
