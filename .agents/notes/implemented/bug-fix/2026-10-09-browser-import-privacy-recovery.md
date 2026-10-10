# Browser-import privacy recovery after sign-in-first

Status: implemented
Translation: pending

PR: [#99](https://github.com/LeonEthan/molly-design/pull/99)

## Abstract

PR #99 conflicted with the later sign-in-first website-account flow and its single native read decrypted unrelated websites' cookies. The merge keeps sign-in inside Molly as the primary path and retains the existing site-scoped native reader. Only the privacy-settings recovery fix survives: after opening the optional import section, a separate action opens Files and Folders whenever any browser is unreadable, including when another browser can be imported. Repeated Keychain prompts remain possible; this change neither grants permissions nor verifies website sign-in.

## Evidence and scope

The [sign-in-first decision](../feature/2026-10-08-sign-in-first-website-accounts.md) replaced import as the main login path, but explicitly retained collapsed, user-initiated browser import. Main still lacked #99's privacy-settings action, so closing the old PR as fully superseded would lose that recovery fix.

The original [native-reader P1](https://github.com/LeonEthan/molly-design/pull/99#discussion_r4225839707) identifies `read().detailedCookies` decrypting the entire source profile before JavaScript filters by website. The merge restores `browser-account-source.ts` and its tests exactly from main, retaining native domain filtering, partition metadata and fail-closed diagnostics. The proposed single-read optimization remains deferred. The original advice to permanently authorize `/usr/bin/security` is also removed, preserving main's authorization guidance.

The [recovery P1](https://github.com/LeonEthan/molly-design/pull/99#discussion_r4225839716) identifies an unavailable settings action when one browser is readable and another is blocked. A separate recovery button now covers both entirely and partially unreadable listings. The normal import button retains the selected readable profile. Recovery probes the listing before opening settings, tolerates a rejected probe, and reports settings-launch errors. It never imports cookies. External profiles remain unread until import is explicitly expanded.

The [development launcher evidence](2026-10-05-browser-import-launcher-attribution.zh.md) still applies: permissions may belong to the terminal or coding agent that launched development Molly. Guidance does not promise that macOS will list Molly or that opening settings grants access.

## Reuse and alternatives

- Reuse `BrowserAccountsSetting`, `Button`, `Collapsible`, `listSources` and its pending/error handling. The existing import action alone cannot recover an unreadable browser; substituting that action only when all sources fail misses mixed listings.
- Adapt #99's existing helper, trusted-sender IPC method and inferred Electron bridge; preserve `beginAccountSignIn` and main's sign-in lifetime fence.
- Borrow `NotificationService.openSystemSettings`' fixed-URL, platform-gated `shell.openExternal` pattern. Calling it unchanged opens Notifications, so the Files and Folders targets remain in their own existing helper. No generalized settings protocol is needed.
- Keep main's reader unchanged. Adopting the whole-profile single-read API violates the current native-read boundary; a new native reader or dependency change is outside this conflict-resolution scope.

## Verification and limits

Component regressions cover recovery while pending, mixed readable/unreadable sources, manual refresh after authorization, and rejected listing/settings opens. Existing sign-in-first tests remain in place, as do the native site-scoping tests. The helper tests use injected platform and URL opening; they do not establish that an installed macOS build opens the correct pane or appears in its permission list.

The independent read-only Codex CLI review (`gpt-6-astra`, high reasoning) found no P0/P1 in the disk version and recommended retaining the reduced recovery fix before deleting its branch. Its component tests passed 8/8; a native fixture test was blocked by the read-only sandbox's temporary-database restriction. The full local repository checks subsequently pass, including the native fixture. The reviewer also confirmed that abandoning #99 is safe if the remaining recovery fix is deliberately declined, but that would not mean all its fixes landed in main.

`pnpm check`, `pnpm format` and `pnpm run docs check --base origin/main` pass. Existing configured test skips remain. Installed macOS permission dialogs, the pane's actual opening and real-account import were not re-tested. Closing an abandoned PR is different from claiming its recovery fix is in main. Branch deletion after landing this reduced fix still requires the normal merge decision.
