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
  - a session's Browser sidebar shows **Sign in** on Pinterest pages. It opens the same dialog and reloads the session page when the dialog closes. (It first navigated the session's own page to the login URL; see the third review fix below.)
- Import stays available as a collapsed "Already signed in … Import it" section and lists profiles only after the person opens it.

## Agent pause (PR review fix)

Codex's GitHub security review of #106 found a P1. The sign-in page shares the website profile with every Agent page, so an Agent run that was still active could act with the new Pinterest session while the human was signing in. Import and cookie clearing already paused every active Agent page (`pauseAgentsForAccountChange`); the first version of sign-in did not.

Both sign-in entry points now call that same pause through a new `publicBrowser.pauseAgentsForAccountSignIn` IPC method before the login page loads. The dialog shows a pausing state and does not open the page if the pause fails. Main already syncs its takeover state to the CLI on every host poll, so paused pages stay paused until someone clicks **Resume Agent** in that session.

A second Codex review then found that this pause only covered runs that already held a page lease. A run that had not yet asked for a page, or whose request was still queued in the daemon, could start browsing during sign-in. The pause now fences at the run layer:

- A new main-only daemon RPC, `browser/pause-all`, takes over every session with an active turn, whether or not it has a page lease, and returns those runs.
- Main records each returned run as a human takeover, so its later page requests are rejected and the session shows **Resume Agent**. It also revokes current leases both before and after the RPC, which catches a lease created while the RPC was in flight.
- A paused run may have no page yet. Main still reports its takeover state for that session, and the session's Browser panel shows **Resume Agent** without a loaded page. Creating a blank page for each paused run was rejected because pages are capped at eight and extra hidden pages would evict real ones.
- If the daemon cannot be reached, the pause fails. Sign-in, import and cookie clearing all stop instead of continuing unfenced.

Import and cookie clearing use the same method, so they gained the same fence.

A third Codex review found that the run-level pause was still a one-off snapshot. A run that started after the pause but while the sign-in page was open, whether queued, automated or in another session, was not covered. A follow-up run in an already-paused session also cleared the old run's takeover. The sign-in now holds a fence for its whole lifetime:

- The dialog calls `publicBrowser.beginAccountSignIn(website-sign-in-<site>)`. Main adds a fence, then runs the same pause. While any fence is held, every Agent page operation is rejected with "Agent browsing is paused while the user signs in to a website."
- Closing or unmounting the dialog destroys its sign-in page. Agent browsing stays blocked until native destruction completes; see the reload correction below.
- The session sidebar now opens the same dialog instead of navigating the session's own page. In-page sign-in had no clear end, so there was nothing to hold a fence against; the dialog gives one surface with a defined open and close.
- Runs that start after the dialog closes browse normally with the new sign-in, which is the purpose of signing in.

## Renderer reload correction (2026-10-09)

[PR #106's fourth review](https://github.com/LeonEthan/molly-design/pull/106#discussion_r4227663875) found that clearing the fence on renderer navigation left its native sign-in view alive. React cleanup does not own document navigation, so the old page could still accept credentials after Agent access resumed.

Main now associates pending sign-ins with their owning window and reuses `destroy` for full renderer navigation and window destruction. It removes and closes the owner's sign-in views while retaining ordinary Session pages. Same-document and subframe navigation preserve the dialog. Window cleanup is registered before the pause RPC, so it also cancels sign-ins that have not created a view yet, and late creation is rejected. `destroyAll` includes those pending opens.

The existing window observer and record disposal were reused with adaptation. Merely clearing the IDs or hiding the native view was rejected because neither establishes the end of its credential surface. Live sign-in WebContents retain a separate transient hold through their `destroyed` event, including asynchronous close and a reopened dialog with the same ID. This adds no storage or RPC.

Deterministic main-service regressions cover navigation filtering, native disposal before release, pending pause completion after cleanup, old-window events, and delayed destruction during a new sign-in. The native browser probe passes 14 checks and confirms that Electron's `close()` returns before `destroyed`; it also verifies renderer navigation and the retained Session page.

The independent read-only Codex review (`gpt-6-astra`, high) found one additional P1 in the initial repair: allocating tracked contents before bounds validation could orphan a hold when the window shrank. The final repair validates bounds before native allocation. A new regression verifies that closing a rejected sign-in allows Agent browsing again; all 18 main-service tests pass. The follow-up read-only review found no remaining P0/P1 and passed 30 service/controller/state tests. Full repository checks, documentation checks, formatting, and the native probe pass. This implements the existing sign-in guarantee without changing Spec intent.

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
