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
Synthetic unit, native and UI checks cover the contract. A computer-use pass on
native `.7` also confirms real multi-profile import, Pinterest sign-in and
development restart persistence; fresh OS authorization remains a separate limit.

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
version `0.6.0+molly-native-keychain.7` after the follow-ups); the Keychain/decryption path is unchanged
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
after denial; the native suite covers `fromPath` inventory. Fresh Keychain approval
and an actual macOS App Data prompt/denial remain unverified. The owner waived the
signed-DMG regression for this task; this is not distribution acceptance.
Copying a live database is bounded by the before/after
comparison, and a swap of a parent directory between the `lstat` pass and the open is
not excluded. The development partition is not covered by the packaged cookie-encryption fuse.

### Native `.7` real-app acceptance (2026-10-15 UTC)

The Mac mini pass used runtime revision `91eb9dfd` from
[PR #140](https://github.com/LeonEthan/molly-design/pull/140), rebuilt with
`pnpm start:local`. Separate product and Electron data directories and a free
local host port isolated it from existing workspaces. The existing E2E scripted
model server supplied a synthetic completed conversation for the Browser panel;
no external model or image request was needed. Native manifest/file hashes matched
the `.7` patch, and the running process mapped that exact reader resource.

| Check | Observed result |
| --- | --- |
| Profile picker | Three real profiles; none preselected; Import disabled until an explicit pick |
| Pinterest, light and dark | 13 discovered / 13 imported / 0 skipped / 0 failed |
| All selected sites | 27 sites reported; every failed count was 0 |
| Same-session sign-in | Pinterest opened its authenticated Business Hub |
| Complete quit and relaunch | A fresh Pinterest navigation remained authenticated without reimport |
| Temporary copies after quit | Zero `molly-cookies-*` directories in both OS temp locations |
| Shortened UI | Settings, picker and results verified in light and dark themes |

Screenshots remain outside the repository for private handoff. The full
`pnpm check` and all seven synthetic native-reader tests passed on this runtime
revision. A separate signed application with an isolated test identity was prepared
for OS permission testing; direct CLI launch inherited launcher access, so that
launch does not establish a fresh grant. LaunchServices launch showed a quiet empty
picker, but the computer-use tool could not operate the system permission dialog.
The fresh prompt, user-selected Deny and subsequent grant/recovery sequence remain
unverified. No shared launcher permission was reset.

## PR #140 review follow-up

- A copy-path `source-access-denied` (EPERM or EACCES from main's own file operations)
  now enters the same silent state as a denied listing: the profile choice and list are
  cleared and focus or Import re-lists. The native reader's EACCES classification is
  unchanged.
- The account operation's signal reaches the snapshot copy loop and each file pipeline,
  so cancellation, closing or navigation stops the filesystem read and frees the lease.
- Discovery now refuses a symlink in any lexical component of the user-data root or
  profile path, not only the final directory, before canonicalizing (resource version
  `.7`). This replaces the earlier allowance for a linked parent such as
  `Application Support`; a home or Application Support folder reached through a link
  now lists no profiles.
- The P1 journey's no-explanatory-copy check ignores paragraphs inside a `role="alert"`,
  so the Windows `macos-required` notice does not fail it.
