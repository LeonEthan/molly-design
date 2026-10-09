# Sign-in-first website accounts

Status: implemented
Translation: pending

## Abstract

Importing a Pinterest account from Chrome repeatedly raised macOS Keychain and Files and Folders prompts (PR #99, on hold until upstream `rookie-cookies` can read only one site's cookies in a single call). The owner chose to make signing in on Pinterest's own page inside Molly the primary path, because it reads no other browser and so raises no system prompt. Chrome import stays as a collapsed secondary option that lists browser profiles only when opened. Google sign-in does not work in Molly's embedded browser, so the guidance names the QR code, a site password and import as alternatives. A real sign-in with a real account was not tested.

## Problem

`BrowserAccountsSetting` listed every supported browser's profiles on page load and again after each action, which can trigger the macOS "access data from other apps" prompt just from opening Settings. Each import also asked Keychain for the Chrome Safe Storage key twice (`browserReport`, then `chromiumBasedDetailed`), and every Chromium browser has its own item. PR #99's fix collapsed this to one native `read()`, but Codex found a P1: `read()` decrypts every site's cookies in main, which breaks the services rule that native reads stay site-scoped. The owner put #99 on hold. This note partially supersedes the import-first framing of [development browser account import](2026-10-03-development-browser-account-import.md); its import rules still apply.

The #99 copy also told users to choose "Always Allow" for `/usr/bin/security`. That adds Apple's tool to the ACL of Chrome's key, which lets any script on the Mac read it silently, so Molly should not recommend it.

## Decision (owner, 2026-10-08)

- Sign in inside Molly first. `WebsiteSignInDialog` opens Pinterest's login page in Molly's own browser profile (`publicBrowserPartition`), which Agent pages share.
- Guidance is just-in-time rather than a first-launch onboarding step, matching the Spec's "no mandatory setup up front":
  - the Settings → AI models Pinterest chip opens the dialog;
  - Website accounts leads with **Sign in to Pinterest**;
  - a session's Browser sidebar shows **Sign in on this page** on Pinterest pages. It navigates that page to the login URL, so the existing human-takeover pause applies.
- Import stays available as a collapsed "Already signed in … Import it" section and lists profiles only after the person opens it.

## Reuse

- **Browser view:** reused `PublicBrowserSurface` with one adaptation. It used to hide whenever any dialog was open; now it hides only under dialogs opened after the one containing it, since Radix portals stacked dialogs to `body` in opening order. Without this, a surface inside a dialog would never show.
- **Main process:** `publicBrowser.create/navigate/destroy` already accept any browser id and always use the shared website partition, so no main-process, IPC or storage change was needed. The dialog destroys its page when it closes.
- **Session sidebar:** the session panel reuses `openAddress`; no second view was created.

## Evidence

- **Probe (isolated test app, scratch data):** Pinterest's login page loads in Molly's browser and offers email/password, Google, LINE and a "Log in instantly" QR code.
  - Clicking "Continue with Google" does nothing. Google's button first tries FedCM, which logs `FedCM get() rejects with NetworkError` and then "Prompt dismissed", and no popup opens.
  - The browser's user agent also contains `Molly/0.1.0 … Electron/39.5.1`, which Google's embedded-browser block would likely reject even after a popup fix.
- **Comparison with Codex:** OpenAI's Codex app has the same limit. Its in-app browser docs exclude authentication flows, and [openai/codex#19276](https://github.com/openai/codex/issues/19276) reports `[GSI_LOGGER]: Failed to open popup window`. Codex routes signed-in work to a separate Chrome extension instead.
- **Live test of this change:** in the rebuilt app, the dialog's native page sits exactly inside the dialog above Settings. Done and Escape close only the sign-in dialog and remove its page. The chip opens the same dialog.
  - After an anonymous visit, the status read "3 cookies saved · Sign-in not verified". So cookie counts cannot gate the session prompt; that prompt is always shown on supported sites.

## Alternatives considered

- **Make Google sign-in work:** disable FedCM, allow real popups for `accounts.google.com` and spoof a Chrome user agent. Rejected for now: the outcome is uncertain and it loosens browser boundaries for one sign-in method.
- **Codex-style Chrome extension:** the Agent would drive the user's real Chrome. Rejected: the Spec forbids requiring an extension and forbids using the source browser as the Agent's browsing target, and it needs a published extension.
- **Computer use for all browsing:** rejected. It would need Accessibility and Screen Recording permissions, take over the user's screen, widen the security blast radius to the whole desktop, need a strong computer-use model, and multiply cost. It fixes only the Google sign-in edge case.
- **Optional onboarding step:** the owner chose just-in-time guidance instead.

## Limits

- No real-account sign-in was tested: email/password, the QR scan and LINE are unverified.
- The session-sidebar button is covered by component tests, not a live session.
- Import, Keychain behavior and PR #99 are unchanged; #99 stays on hold.
- The owner approved this Spec revision on 2026-10-08 ([record](../../../../.github/spec-approvals.md#2026-10-08-sign-in-first-website-accounts)); the Spec stays draft for its other unapproved revisions.
