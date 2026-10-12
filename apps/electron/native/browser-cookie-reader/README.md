# Browser cookie reader

Molly builds rookie-cookies 0.6.0 at the revision in `source.json`. The pinned
archive, Rust compiler, patch digest, target and staged file hashes form its build
identity. The addon is loaded directly from `resources/browser-cookie-reader`;
the npm package supplies TypeScript declarations only.

The local patch keeps upstream discovery, SQLite snapshotting and Chromium
unsealing. It replaces the macOS Keychain helper with Security.framework calls
inside Molly, frees and zeroizes returned credential bytes, and marks that lookup
cooperative because an OS authorization dialog cannot be force-cancelled. No
credential is supplied by JavaScript. A native SQL preflight and staged-row budget
reject more than 50,000 rows or 32 MiB of cookie payload before exposing a result.

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
