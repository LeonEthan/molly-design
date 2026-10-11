# Whole-profile browser import

Status: proposed
Date: 2026-10-11
Translation: pending

## Abstract

The owner asked for a Codex-app-style import: bring a browser profile's sign-in state into Molly without choosing websites, with as few permission prompts as possible. On 2026-10-11 the owner approved the [Spec revision](../../../../specs/graphic-design-platform.md#embedded-web-research-and-assets) with two amendments: show a website list with everything selected by default, and make import the only guided account path, retiring the in-Molly sign-in dialog. This note records the research and the implementation plan. Nothing here is implemented yet; the code still follows the site-scoped Pinterest import and sign-in-first flow.

This note supersedes the sign-in-first framing of [sign-in-first website accounts](../../implemented/feature/2026-10-08-sign-in-first-website-accounts.md) and the single-site scope of [development browser account import](../../implemented/feature/2026-10-03-development-browser-account-import.md).

## Evidence

- **Codex app.** Its in-app browser menu offers "Import cookies and passwords…". The dialog chooses a source browser and profile, toggles passwords, cookies, history and extensions, and lists no websites. It asks the user to close Chrome first. This comes from owner-supplied screenshots; how Codex reads the data was not established.
- **Why Molly prompts repeatedly.** `rookie-cookies@0.6.0` reads each Chromium "Safe Storage" password by spawning `/usr/bin/security find-generic-password` (strings in the darwin-arm64 binary). `readBrowserSiteCookies` makes two native reads per import (`browserReport`, then `chromiumBasedDetailed`), so one import can raise two Keychain prompts. The prompts are attributed to `security`, so "Always Allow" would let any local process read the key. Molly does not recommend it, so every import prompts again. `listImportSources` also enumerates all seven supported browsers' profiles, touching each browser's data directory (`kTCCServiceSystemPolicyAppDataDetailed`, see the [launcher attribution note](../../implemented/bug-fix/2026-10-05-browser-import-launcher-attribution.zh.md)).
- **Reader API.** rookie's `read({ browser, profile, appBound: 'disabled' })` returns the whole profile's `detailedCookies`, including partition context, in a single native read. PR #99 was blocked only because whole-profile decryption broke the site-scoped rule, and this revision intentionally removes that rule. On macOS rookie has no option to accept a caller-supplied Safe Storage password.
- **Device-bound sessions.** Chrome's Device Bound Session Credentials bind Google account sessions to a non-exportable hardware key and refresh short-lived cookies with it. Google made it generally available on Windows in Chrome 146 (2026), with macOS announced next ([The Hacker News](https://thehackernews.com/2026/04/google-rolls-out-dbsc-in-chrome-146-to.html)). Imported Google cookies can therefore stop working once their short lifetime ends. Third-party sites the user signed into with Google keep their own cookies, and those cookies are unaffected.

## Plan

1. **Dialog.** One import dialog opens from the embedded browser's ⋯ menu, from Settings → Website accounts, and from the existing just-in-time entry points (the Browser sidebar and the AI models Pinterest chip). It shows source browser, then profile, then a website list grouped by site with all items selected, then Import. Only cookies are imported: Electron has no password manager, and the Spec forbids extensions.
2. **Discovery without data access.** List browsers by checking application bundle locations. Read the profile list (`Local State`) only for the browser the user selects.
3. **One read per import.** Use `read().detailedCookies` once after the user selects a profile. Main keeps the result in memory under an opaque token and returns only site names and counts to the renderer. Confirming writes the selected sites; cancel, close or a timeout discards the token.
4. **Write.** Merge by cookie identity (domain, path, name) and keep Molly-only cookies. Skip partitioned (CHIPS) and expired cookies and report their counts. Pause all Agents through `browser/pause-all`, snapshot the cookies being overwritten for rollback, write, then flush. Profile-wide bounds replace the 200-cookie / 512 KiB per-site limits; set them after measuring real profiles.
5. **Retire sign-in.** Remove `WebsiteSignInDialog`, `beginAccountSignIn`, the sign-in fence and their IPC once import covers the entry points. Human takeover and Agent pausing during manual login or MFA remain.
6. **Persistent Keychain grant (follow-up).** Read the Safe Storage password in Molly's process through the Security framework, so the prompt names Molly and "Always Allow" adds only Molly's signed identity. This needs rookie to accept a supplied password. Ask upstream first ([teng-lin/rookie-cookies](https://github.com/teng-lin/rookie-cookies)); a local Chromium v10 decoder on the existing `better-sqlite3` dependency is the fallback.

Expected prompts after phase 6: on the first import from a browser, at most one macOS data-access prompt and one Keychain prompt; later imports from that browser raise none. Until phase 6 ships, each import still raises one Keychain prompt. Development builds re-prompt after each rebuild because their code signature changes.

## Reuse ladder

- **Reused:** `rookie-cookies` `read()`, the cookie import transaction and rollback, `pauseAgentsForAccountChange` / `browser/pause-all`, `PublicBrowserSurface`'s menu, `BrowserAccountsSetting`.
- **Adapted:** the import transaction (site filter becomes a merge with a site selection; partitioned cookies are skipped instead of failing the import).
- **Pattern borrowed:** Codex's single dialog without a website list.
- **Rejected:** a Chrome extension or CDP attach to the user's Chrome (forbidden by the Spec; Chrome blocks remote debugging on the default profile); a custom reader before the upstream change is attempted.

## Rules to update with implementation

`apps/electron/src/main/services/AGENTS.md` ("Native reads stay site-scoped… Imports cover Pinterest", rejection of partitioned source cookies), `apps/electron/src/AGENTS.md` ("explicit source Chromium profile/site selection", "site-only native reader", sign-in fence), and `site: z.enum(['pinterest.com'])` in `packages/shared/src/electron-ipc.ts`. They describe current code and change together with it.

## Open questions

- Profile-wide size bounds, and how the website list groups subdomains (registrable domain versus cookie domain).
- Whether macOS raises the data-access prompt once per source browser or once per Molly. This needs a signed-build probe.
