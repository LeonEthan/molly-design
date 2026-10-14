# Browser cookie reader

Molly builds rookie-cookies 0.6.0 at the revision in `source.json`. The pinned
archive, Rust compiler, patch digest, target and staged file hashes form its build
identity. The addon is loaded directly from `resources/browser-cookie-reader`;
the npm package supplies TypeScript declarations only.

The local patch keeps upstream discovery, SQLite snapshotting and Chromium
unsealing. Resource version `0.6.0+molly-native-keychain.3` preserves native filesystem
EPERM for the selected source and explicit Keychain user-cancellation/authentication
failure. EACCES, generic permission errors and other Keychain failures remain unavailable
sources rather than offering a privacy-settings recovery they do not establish.
It replaces the macOS Keychain helper with Security.framework calls
inside Molly, frees and zeroizes returned credential bytes, and marks that lookup
cooperative because an OS authorization dialog cannot be force-cancelled. No
credential is supplied by JavaScript. Metadata access starts only after Import;
real native access may trigger system authorization. There is no separate grant API,
non-interactive permission probe or guarantee that denial can prompt again.
A native SQL preflight and staged-row budget
reject more than 50,000 rows or 32 MiB of cookie payload before exposing a result.

Molly opts into the private `mollyInventory` read mode. It preserves decoded rows
before portable HTTP-header octet filtering and partition normalization so main
can select websites, validate import candidates, and count raw partition skips.
Ordinary upstream snapshot behavior stays unchanged. Genuine row/decryption/host
failures remain fatal, and inventory rejects expiration values that JavaScript
cannot represent exactly. The main-only reader type and resource version prevent
an older addon from silently ignoring this mode; npm declarations remain unchanged.

`pnpm --filter @molly/electron build:cookie-reader` builds/stages the addon. Build,
dev and packaging run the same step. macOS arm64/x64 requires Rust 1.99.0 and the
corresponding target. Windows has no reader resource and cannot import accounts.
Packaging verifies the staged seal for every target, probes loading on the host
architecture, and uses the existing native signing reseal mechanism. Runtime checks
the resource seal and patched version; it never loads the upstream helper package.

Run `pnpm --filter @molly/electron test:cookie-reader` for synthetic native checks:
an open SQLite/WAL database, rejected profile bounds, running/stopped Worker
isolation, clearing all website data with paused Workers, and exact rollback with
host/path/partition variants. The standard test suite covers pure filtering/merge,
lifecycle cancellation, renderer behavior and
native signing seals. These tests do not read real profiles or establish retained
Keychain authorization, Developer ID distribution, upgrades or website sign-in.

Upstream: [rookie-cookies](https://github.com/teng-lin/rookie-cookies/tree/c934548faa1bab23984a9d82e4d62bd67230a1f9),
[license](LICENSE.md). The [implementation note](../../../../.agents/notes/implemented/feature/2026-10-11-whole-profile-browser-import.md)
records the scope and validation limits.

The [permission-intent revision](../../../../.agents/notes/implemented/bug-fix/2026-10-11-browser-import-intent-permissions.md)
records delayed profile discovery and narrow native permission-error propagation.
A classified browser-file denial stays silent in the dialog (selections kept for
an explicit retry); a Keychain denial reports its own reason. Synthetic reader
checks do not establish first/retained grants, launcher attribution or denial
behavior in a real signed application.
