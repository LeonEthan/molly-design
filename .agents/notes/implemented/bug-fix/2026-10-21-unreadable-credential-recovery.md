# Explicit recovery for unreadable model credentials

Status: implemented
Translation: pending

## Abstract

An unreadable encrypted credential vault prevents both language-model and image settings
from loading, leaving Retry as the only available action. The existing vault now supports
explicit recovery: confirm the affected services, preserve the original ciphertext, then
start saving new connections. Recovery refuses a healthy vault or ciphertext changed after
confirmation. It cannot recover credentials whose encryption key has been lost; users must
reconnect services, and no reset of an existing installation is implied by this code change.

## Evidence and decision

A local read-only Electron probe reported available protected storage and a successful
synthetic in-memory encryption/decryption round trip, while decrypting the saved vault
failed. This establishes that the existing ciphertext is unreadable with the current key,
not whether the original key was replaced or the ciphertext damaged. No credential values
or captured user logs are included here. Electron documents [application-scoped Keychain
storage](https://www.electronjs.org/docs/latest/api/safe-storage/); availability alone does
not establish that previously saved ciphertext can be decrypted.

The reuse ladder led to the existing `ModelConnectionStore`, its serialized operations,
strict parser, OS cipher and settings forms. Retry remains useful for temporary access
failures, but cannot replace a missing key. Existing row deletion requires a readable vault,
so it cannot unblock this failure. A small explicit backup/reset operation at the same
storage boundary avoids adding another credential store or cryptographic implementation.

Recovery is prepared with a ciphertext SHA-256 digest. After confirmation, the store reads
again, compares the digest and checks that decryption/schema validation still fails. It
renames the original ciphertext to a UUID-named encrypted backup and syncs the directory
on supported platforms. Subsequent ordinary saves create the existing vault format with
the current OS key. Provider-side grants are not revoked, and historical encrypted backup
residue is retained. Both settings sections observe one transient recovery revision and
reload their snapshots after success; errors other than unreadable storage keep Retry only.
When replacing MCP credentials, settings reads the existing public vault metadata. If the
old binding is absent, explicitly entered replacement values create a fresh binding; an
existing different binding remains a conflict. No missing credential is silently retried
without authentication, and catalog rows remain unchanged until explicitly saved.

## Verification and limits

The deterministic store tests reproduce shared model/image failures with an injected lost
key, preserve ciphertext through recovery and subsequent saves, and reject healthy, missing,
changed or unavailable storage. A key becoming readable again after confirmation prevents
reset. UI tests cover confirmation cancellation, English/Chinese copy and refreshing both
sections together. Storybook includes unreadable and failed recovery states.

`pnpm check`, `pnpm run docs check`, changed-source Prettier checks and `git diff --check`
passed. The first sandboxed repository run failed when socket tests received `listen EPERM`;
the complete rerun with local socket access passed. The focused settings/MCP suite passed
150 tests, and the credential/OAuth/IPC suite passed 98 tests.

No real provider inference or sign-in is required by these tests. Native Keychain failure
diagnosis does not prove why an old key became unavailable, and the synthetic tests do not
prove native Keychain recovery or visual acceptance. The platform Spec remains draft.
