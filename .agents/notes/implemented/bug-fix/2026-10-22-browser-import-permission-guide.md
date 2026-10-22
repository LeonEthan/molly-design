# Browser import permission guide

Status: implemented
Date: 2026-10-22
Translation: pending

## Abstract

[#220](https://github.com/LeonEthan/molly-design/issues/220) combines browser-data
permission guidance with the Preview empty-profile failure. macOS 27 can deny access
without offering a prompt; the previous UI swallowed that typed denial and showed an
empty disabled picker with an Import button that only retried listing. The owner
confirmed a refined neutral prototype and requested implementation across onboarding
and Settings. Both now explain access before reading metadata, guide a denied source,
and recover the profile list on return without importing cookies.

## Decision and reuse

The existing `BrowserAccountImportDialog` already owns both surfaces, browser/profile
selection, cancellation and import reports, so those are adapted together. Existing
Dialog, Select, Button, InfoTip, icons and theme tokens provide the presentation;
a small shared `BrowserImportAccess` composes them because no existing component
represents these three permission states. A neutral settings sketch uses the actual
application name, including Molly Preview. Readable access is one quiet status row;
privacy detail stays in InfoTip. The website catalog and selected-site import remain.
Profile and website disclosure controls use the same trailing inset, correcting the
arrow misalignment found during prototype review.

Opening only discovers installed sources. The explicit Open Settings action first
attempts native metadata listing: this lets macOS register the application/source
entry, or directly shows profiles when access already exists. A typed file denial
opens the fixed Files & Folders destination through trusted-sender main IPC. No caller
URL, new permission store, separate grant probe, entitlement or reader patch is added.
The existing `.8` reader and file/Keychain error classification remain authoritative.
Keychain denial keeps its own reason. A genuinely readable empty catalog remains empty.

While denied, native window foreground, renderer focus or explicit recheck refreshes
the profile list. The native event retains and immediately emits its current value,
so its subscription is stable rather than recreated on each access-state change.
A ref reads current access state; serialized refreshes and request generations reject
late results and survive StrictMode effect replay. Closing cancels pending listing.
Returning never reads cookies or automatically picks among multiple profiles.

## Verification

Deterministic coverage includes both panel/dialog states, explanation before metadata
access, denial with no prompt, retained native foreground, explicit recheck, actual
Preview identity, multiple-profile selection, empty readable catalogs, settings-launch
failure, cancellation and StrictMode. Main tests constrain the exact macOS URL and
unsupported/failure outcomes. Storybook has the three shared presentation states.

The full `pnpm check`, E2E metadata check and documentation check passed. The final
arrow adjustment also passed all 42 targeted browser-import/readiness tests; scoped
formatting passed. The two main destination tests passed. Existing unrelated Preview
packaging changes were preserved; package generation used the existing installer.

## Signed Preview acceptance

The final installed bundle is `dev.molly-design.preview`, version
`0.1.2-preview.gf69da6a3.dirty`, Developer ID signed. Its `app.asar` SHA-256 is
`5404c1cdda150480cc56a09222cf637c2acfc723127e356119802505abb4a5db`.
The version retains the same source commit plus dirty suffix as the earlier build;
the archive hash distinguishes this revision. The sealed reader remains `.8`.
No notarization or distribution acceptance is claimed.

On macOS 27.0.1, onboarding and Settings both displayed the explanation before an
explicit metadata action. With Molly Preview's Google Chrome switch off, each
reached the guide without an OS prompt rather than an empty profile catalog. The
Open Settings action was verified to navigate from another settings page to
Files & Folders, including the Molly Preview entry; it does not open Full Disk Access.

An explicit recheck in the same onboarding panel after enabling Chrome access listed
three actual profiles, selected none and kept Import disabled. The prior 26/27 site
selection survived. Settings was also reviewed in English and Chinese, including
before, denied and readable states. No Cookie import was performed during these
checks. Private screenshots stay outside the repository; real profile names and
account records are excluded.

A second pass backed up and isolated both existing Preview data directories before
launching the final package. It showed the actual first-launch welcome, empty model
configuration and optional browser setup; no onboarding completion marker was reused.
Its permission entry remained the existing Preview identity, controlled with the
owner's authorized Chrome toggle, rather than resetting unrelated OS grants.

The still-open first-launch onboarding panel recovered automatically after a real
application switch, without clicking recheck, reopening or restarting. The owner
confirmed switching from System Settings back to Preview without closing the panel.
The restored profile picker remained unselected and Import disabled. Background AX
clicks did not provide reliable foreground transitions; they were not counted as
failed recovery or as successful automatic-recovery evidence. Settings recovery was
verified with the explicit recheck in its still-open dialog. Readable final Settings
screenshots in English and Chinese also show the corrected trailing icon alignment.

Preview was quit normally and verified stopped before both original data directories
were restored by directory rename; their directory identities were checked. The
isolated test data is retained separately outside Git. The Chrome access switch was
left enabled as authorized. No models or paid image calls were used.

A follow-up PR screenshot pass reused only the retained isolated Chinese test profile
and reset its own onboarding completion marker. It captured all three Chinese
onboarding states in the same installed Preview; denied access recovered with the
explicit recheck, leaving profiles unselected and Import disabled. Both original data
directories were moved aside and restored with identity checks for this pass too.
This is a localized visual/recovery pass, not another clean-install or fresh TCC
entry claim. The PR screenshots cover both surfaces, both languages and all three
states. Preview channel/installer changes used to build the acceptance package were
pre-existing local work and are excluded from the permission-guide commit.

Fresh Keychain prompts, explicit native Deny where prompting is supported, Cookie
import, website sign-in, package upgrade retention and fresh TCC entry creation are
outside this pass. The shared native denial classification is exercised synthetically.

## Commit preparation follow-up

A new deterministic case reproduced an initial source-catalog failure whose generic
Retry listed profiles before showing any access explanation. Retry now refreshes only
the source catalog until a browser has been identified; a recovered catalog returns to
the explanation and requires the explicit access action. Retries after an explained
profile read retain their existing listing behavior. This final one-line control-flow
correction is covered by the red/green regression and full checks; the signed Preview
screenshots predate it and cover the unchanged normal access and recovery paths.

## PR review follow-up

PR #229 identified two gaps in the first revision. Both Spec translations still
contained the superseded silent-denial paragraph beside the new guide. They now
state one permission flow and distinguish continuing an already pending native
read from starting a new import after a settings visit. The historical October 14
note remains historical; the current contract links to this revision.

Profile metadata can be readable even when opening the Cookies database returns
`source-access-denied`. The shared import session now retains that copy-stage
denial while focus/foreground and explicit metadata rechecks run. Open Settings
uses the observed denial directly, without letting another successful listing
bypass Files & Folders. Only a successful settings launch releases that retained
reason; launch failure keeps the guide and retry available. Returning or rechecking
then restores profile choices, and cookie reading still needs a new explicit Import.
Switching source browsers clears the source-specific retained denial.

This adapts the existing import session, denial guide and main-owned settings action;
no new native probe, IPC contract or persistent permission state is needed. The two
old renderer cases assumed metadata success could clear copy denial. Their
replacements reproduced three failures before the fix and now cover both panel and
dialog, metadata-only foreground/recheck, successful settings navigation, launch
failure/retry, unselected multiple profiles and explicit import retry. All 43 targeted
browser-import/readiness tests pass. Full `pnpm check`, `pnpm format`, scoped
Prettier and `pnpm run docs check` also pass. Pre-existing dirty files were preserved
byte-for-byte. The copy-time denial is a deterministic fixture;
the earlier signed Preview screenshots and acceptance do not establish this new
failure/recovery case in a native package.
