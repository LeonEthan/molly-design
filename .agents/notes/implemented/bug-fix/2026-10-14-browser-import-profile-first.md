# Browser import lists profiles first and reports per site

Status: implemented
Date: 2026-10-14
Translation: pending

## Abstract

A first import silently read the default Chrome profile because the dialog only
checked that Chrome existed and the import path took `profiles[0]` when one profile
was listed before macOS access was granted; the signed-in account lived in another
profile and Pinterest stayed logged out. The dialog now lists the real profiles when
it opens (where the OS prompt appears), requires a pick when several exist, re-lists
and verifies the chosen profile's path before reading, reads a private copy of the
Cookies database, and reports discovered/imported/skipped/failed per website. Development builds keep
their own persisted partition. The trade-off is that the OS prompt moves from Import
to dialog open and that the dialog quietly shows no profiles after a denial.
Synthetic unit, native and UI checks cover the contract; real multi-profile
Pinterest verification is a separate human/computer-use pass.

## Decisions (owner, 2026-10-14, issue #138)

1. **List first.** `getImportProfiles` runs on open for the preselected browser
   (Chrome, else the first source) and on demand for another browser. A single profile
   is displayed by name and still waits for Import; several require an explicit pick.
2. **Verify before read.** Main remembers each listed profile ID's path. Import
   re-lists and fails closed with `profile-changed` when the ID is missing, moved, or
   was never listed by this process; the dialog re-lists and asks again.
3. **Copy then read.** Main copies the Cookies database and `-wal`/`-shm` (when present)
   into a private `mkdtemp` directory, opening each with `O_NOFOLLOW` and comparing
   `fstat` with `lstat`; symlinked profile directories, intermediate directories,
   databases or sidecars are refused. Source size/mtime are compared before and after
   the copy (three attempts, then `source-incomplete`). The addon reads the copy
   through `fromPath` with the browser identity as the credential source and
   `mollyInventory`; the directory is removed in `finally`.
4. **Per-site result.** `{ siteId, discovered, imported, skipped, failed }` replaces the
   totals. Skipped = expired or CHIPS-partitioned; failed = invalid, duplicate or
   oversized rows (previously the whole import aborted with `source-invalid`) and
   write-time expiry is counted as skipped. No total hides a failed site.
5. **Silent denial.** After an OS denial of the listing the dialog shows no error,
   tutorial or link; it re-lists on window focus and when Import is clicked.
6. **Development persistence.** Unpackaged builds use `persist:molly-public-browser-dev-v1`;
   packaged signed builds keep `persist:molly-public-browser-v1`; packaged ad-hoc macOS
   builds keep the in-memory partition and cannot import.
7. **Copy.** Website accounts: one short line, Import, Clear, per-site saved-cookie
   list. Dialog: title, pickers, site checkboxes, Import, then the four-column table.

## Where the copy lives and why

The addon's `read` discovers a profile itself and already snapshots DB+WAL privately,
but it follows symlinks and cannot be pointed at a path, so a TypeScript copy could
not be read through it. The smallest change that makes the TypeScript copy the thing
the addon reads was a 10-line patch adding `mollyInventory` to `fromPath` (resource
version `0.6.0+molly-native-keychain.6` after the follow-up); the Keychain/decryption path is unchanged
(`fromPath` with `browserId` uses the same registry key provider). Refusing symlinks
inside Rust instead would have kept `read` but left no way to prove which file bytes
were read. `-shm` is copied when present although SQLite rebuilds it from the WAL.

## Review follow-up (same day)

Three review findings were fixed before commit.

1. **Symlinked profile directories** were canonicalized by native discovery, so the
   TypeScript `lstat` only saw the resolved directory. Discovery now skips a profile whose
   lexical path is a symbolic link (`profile_is_symlink`) before canonicalizing.
2. **Quit left copies.** `shutdownForQuit` now awaits a revoked read (bounded at 5 s) so its
   `finally` removes the copy, then synchronously removes every tracked copy; copies are
   named `molly-cookies-<pid>-*` and a constructor sweep removes those of dead processes.
   A second review found the same hole one level up: a flat-layout browser (Opera keeps
   `Cookies` directly in its user-data root) whose root is a link. Discovery now also
   refuses a symlinked installation root (`installation_is_symlink`) before canonicalizing,
   for every Chromium-family browser (resource version `.6`).
3. **`fromPath` dropped extraction failures.** The patch now folds the Chromium row
   issues into the result's warnings like the registry route, so main reports
   `source-incomplete` rather than a silent partial import. Resource version `.5`.

## Reuse ladder

- Reused unchanged: `getImportSources`, `getImportProfiles`, the account operation
  lease/cancellation, `importBrowserAccountCookies` merge/rollback, the site catalog,
  the `Select`/`Collapsible`/`Dialog` primitives.
- Reused with adaptation: `listImportProfiles` (now returns main-only path/sources),
  `selectBrowserCookies` (per-row failure counts), `publicBrowserPartition`.
- Patched: the native `fromPath` request (one option).
- Rejected: renderer-supplied paths (forbidden by the IPC schema), a second picker
  protocol, a persistent profile-path store (the listing is recomputed per process).

## Verification and limits

Synthetic tests: Local State with three profiles, a symlinked database/profile/sidecar,
a moved or unlisted profile, per-site counts, the multi-profile pick gate and silence
after denial; the native suite covers `fromPath` inventory. Not established: real
multi-profile Chrome, a real Keychain approval, an actual macOS App Data prompt/denial,
or a signed-DMG regression; copying a live database is bounded by the before/after
comparison, and a swap of a parent directory between the `lstat` pass and the open is
not excluded. The development partition is not covered by the packaged cookie-encryption fuse.
