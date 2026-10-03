# macOS development browser account import

Status: implemented
Translation: pending

## Abstract

Website-account import was blocked in unpackaged Molly, and removing that gate still left the button unusable when macOS denied profile-folder access. The maintainer approved development import into memory-only sessions while retaining package signing requirements. Native diagnostics identified the launching terminal as the permission subject; human-granted Chrome access and Molly's existing Refresh restored a selectable profile and enabled Import. The UI now distinguishes unreadable sources from a completed empty listing and explains launcher permissions. Real-account transfer and Keychain authorization remain unverified.

## Decision and reuse

The [September signing restriction](../../proposed/architecture/2026-09-22-embedded-browser-account-import.zh.md#2026-09-23-反复钥匙串提示的修正) addressed repeated Keychain authorization after rebuilding ad-hoc packages. This revision partially replaces its development-import restriction, not its persistence or packaged-signing rules. The workbench [Spec](../../../../specs/graphic-design-platform.md#embedded-web-research-and-assets) remains draft and describes the revised intent.

- Reuse unchanged was insufficient: one gate denied unpackaged macOS before the existing importer could run.
- Adapt the existing `accountImportReadinessError`: it already governs summary, profile listing and import execution. Stable signing is required only for packaged macOS import; secure storage and macOS remain required everywhere.
- Reuse `BrowserAccountsSetting` unchanged for execution: it already distinguishes `importAvailable` from `persistent`, shows the restart-loss warning and offers explicit browser/profile selection, pending authorization and manual retry.
- Reuse `publicBrowserPartition`, the native `rookie-cookies` reader and the existing cookie transaction. No new configuration, protocol, credential storage or reader was needed.

The unsupported-platform reason is now `macos-required`, with matching localized guidance; it no longer incorrectly tells a development user to package the app. The unreadable-browser notice points to human macOS browser-data permission handling, including the launch terminal, and explicit refresh. `noSources` is shown only after both source and unreadable lists are empty; a read failure does not establish absence. Refresh reuses the existing listing flow and never starts cookie import.

A separate development opt-in would add another consent state without a present requirement: the maintainer selected development support, and importing still requires the user's site-specific action. The requested read-only Codex CLI opinion (`gpt-6-astra`, high reasoning) recommended this narrow gate change, with the counterargument that unpackaged runtime shape is not a trusted signing identity. The recommendation was advisory, not native acceptance.

## Profile-access recovery

The first native probe's `EPERM` alone did not identify the protection layer. The follow-up used macOS permission attribution for the actual development process: its accessing binary was Electron, while the responsible app was Otty (`io.appmakes.otty`). System Settings → Privacy & Security → Files & Folders → Otty showed Google Chrome access disabled. The user manually enabled that browser-specific entry; no Full Disk Access was requested and no agent toggled permissions.

The [Apple privacy guidance](https://developer.apple.com/videos/play/wwdc2023/10053/) separates user intent, other-app data access and broader disk access. A second read-only Codex opinion (`gpt-6-astra`, high) suggested a native folder-selection access attempt, while warning that `defaultPath` does not constrain the OS grant and native success would require human evidence. The maintainer instead selected current-machine authorization. The existing OS permission UI and Molly Refresh sufficed; no picker, bookmarks, permission database changes or new import mechanism were added.

## Boundaries

Development imports select the existing non-`persist:` partition, even when source cookies have expiration dates. The UI must not imply restart persistence or verified website sign-in. Packaged macOS persistence and import retain stable-signing requirements; cookie-encryption packaging checks are unchanged. OS authorization is handled by the user, not bypassed or automatically retried. Cookie values remain in main; profile/site validation, CHIPS rejection, Agent pause, replacement confirmation and rollback are unchanged.

## Verification and limits

- The real service regression was red before the change: unpackaged macOS returned `importAvailable: false` with `package-required`.
- Seven service cases passed after the change: development and signed-package success; unavailable OS storage; unstable package signing; Windows/Linux rejection. They execute summary, listing and import methods against synthetic cookies and assert destination partitions and no acquisition on denial.
- Focused service/signing/source suite: 23 tests passed. The settings suite has 5 passing tests for enabled memory-only import, pending authorization, explicit retry, blocked unsigned packages, unreadable-versus-absent sources and manual refresh restoring a profile and button without automatic import. The unreadable-source assertion was red before the UI correction.
- Initially, an isolated normal unpackaged Electron arm64 process loaded the pinned reader's profile, report and detailed APIs but returned three unreadable browsers and no profiles. Direct browser-data directory access returned `EPERM`; temporary probe profiles were removed. This initial failure remains evidence, not a successful import.
- After the human permission change, the unchanged product `listImportSources(['chrome'])` returned one browser, one profile and no unreadable Chrome entry. In the actual running development app, a single Refresh displayed the Chrome selector and enabled `Import from Google Chrome`. Edge and Brave stayed unreadable; their permissions were not needed to enable Chrome. No Import action, source cookie read or Keychain approval was performed.
- `pnpm check`, `pnpm format` and `pnpm run docs check` passed after the change; component files were formatted with their owning Prettier configuration. The full check used `TMPDIR=/tmp` to avoid the context sandbox's known macOS Unix-socket path-length artifact. An instrumented follow-up injected `__CM_FS__` statistics into a CLI subprocess's stderr and failed its empty-stderr assertion; the same 20 focused cases and the complete uninstrumented check then passed without changing unrelated tests. Lockfile validation found no dependency or lockfile change. Real browser sign-in transfer and human Keychain authorization are not established by these synthetic tests or native loader evidence.

No publication, account transfer or agent-driven permission changes were performed.
