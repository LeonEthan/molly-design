# Browser import lists profiles first and reports per site

Status: implemented
Date: 2026-10-14
Translation: pending

## Abstract

A first import silently read the default Chrome profile because the dialog only
checked that Chrome existed and the import path took `profiles[0]` when one profile
was listed before macOS access was granted; the signed-in account lived in another
profile and Pinterest stayed logged out. The dialog now lists the real profiles when
it opens (where the OS may prompt), requires a pick when several exist, re-lists
and verifies the chosen profile's path before reading, reads a private copy of the
Cookies database, and reports discovered/imported/skipped/failed per website. Development builds keep
their own persisted partition. The trade-off is that profile access can prompt at
dialog open and that the dialog quietly shows no profiles after a denial.
Synthetic unit, native and UI checks cover the contract. A computer-use pass on
native `.7` also confirms real multi-profile import, Pinterest sign-in and
development restart persistence. A separate signed fixture confirms silent OS denial
and successful import after a manual Settings grant; a fresh App Data prompt
remains unverified.

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
version `0.6.0+molly-native-keychain.8` after the follow-ups); the Keychain/decryption path is unchanged
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
and an actual macOS App Data prompt with a user-selected Deny remain unverified.
Silent OS denial and manual Settings grant recovery are covered below. The owner waived the
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
revision.

### Isolated App Data denial and Settings recovery (2026-10-15 UTC)

**Correction to the initial acceptance report:** the quiet empty picker was not
evidence of a pending permission dialog. The owner saw no prompt. On macOS 27.0.1,
bounded TCC diagnostics attributed the App Data request to the separate signed
fixture and showed that the OS denied it because that binary was ineligible for
prompting. This remained true after moving the fixture to the user's Applications
directory, registering it with LaunchServices and resetting only its own
`SystemPolicyAppDataDetailed` entry. The original Molly and launcher grants were
unchanged. A direct CLI launch inherited launcher access and is excluded from this
permission evidence.

The fixture then appeared in Files & Folders with its Google Chrome switch off.
After the owner enabled that switch, an explicit Import retry in the still-open
dialog listed all three real profiles. None was selected and Import remained
disabled until an explicit choice. No app restart or dialog reopen was needed.
This establishes recovery through the existing retry path; raising the window
alone did not establish focus-triggered recovery in this pass.

Selecting the same profile and importing then produced Pinterest **13 discovered /
13 imported / 0 skipped / 0 failed**. All 27 selected sites reported zero failures,
and Website accounts showed the saved cookies after Done. The import completed
without another Import click; the fresh Keychain-prompt interaction itself was not
independently confirmed. The fixture was quit after capturing private evidence.

A read-only Codex second opinion advised checking OS responsibility and denial
reasons before changing the reader. The observed recovery uses the existing
profile listing and Import retry; no runtime change, new permission API or
entitlement change was justified. A fresh App Data prompt, a user clicking Deny
and same-request continuation after accepting that prompt remain unverified.
The signed fixture is not the waived DMG/distribution regression.

## PR #140 review follow-up

- A copy-path `source-access-denied` (EPERM or EACCES from main's own file operations)
  now enters the same silent state as a denied listing: the profile choice and list are
  cleared and focus or Import re-lists. The native reader's EACCES classification
  remained unchanged in that head; the later correction below closes that gap.
- The account operation's signal reaches the snapshot copy loop and each file pipeline,
  so cancellation, closing or navigation stops the filesystem read and frees the lease.
- Discovery now refuses a symlink in any lexical component of the user-data root or
  profile path, not only the final directory, before canonicalizing (resource version
  `.7`). This replaces the earlier allowance for a linked parent such as
  `Application Support`; a home or Application Support folder reached through a link
  now lists no profiles.
- The P1 journey's no-explanatory-copy check ignores paragraphs inside a `role="alert"`,
  so the Windows `macos-required` notice does not fail it.

### Native EACCES correction (2026-10-15 UTC)

The Codex review of `4e03f53a` found that native listing still treated EACCES as
`source-unavailable`. That preserved the earlier permission-settings distinction
after the UI had moved to silent denial and focus/Import retry, so an unreadable
browser directory could still show a generic error instead of entering that state.
The errno fixture reproduced the defect: EACCES returned `engine_failure` where
the listing contract required `molly_source_access_denied`.

Resource `.8` extends the existing errno checks to both EPERM and EACCES in the
chained discovery errors and the direct root-metadata path. Main's typed-error
mapping and the dialog's silent retry state are reused unchanged. No new IPC,
permission flow, storage or Keychain behavior is introduced. The synthetic cases
cover both error values in directory enumeration and root metadata, retain a
generic failure for EIO, and keep a readable profile available when another channel
is denied. The earlier real-account and Settings-grant evidence remains evidence
for `.7`; this correction does not claim a new real-account or first-prompt pass.

Validation passed: the nine targeted Rust tests, all seven sealed native-reader
tests, six Electron account-isolation/rollback probes and the full `pnpm check`.
Both macOS arm64 and x64 resources compiled and passed seal/architecture checks;
the arm64 resource also loaded in Electron. x64 execution was not claimed. A
read-only Codex CLI second opinion found no P0/P1 in this correction; it is
advisory and separate from the PR's GitHub review gate.
