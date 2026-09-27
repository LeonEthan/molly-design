# Geon in-app update acceptance (Issue #32)

Status: implemented
Translation: pending

## Abstract

Completed the real acceptance round for Geon's independent in-app update path on
macOS arm64. Two distinguishable Geon versions (0.1.0 and 0.1.1) were built from
the same source using the release packaging script, served over a loopback-only
Sparkle feed signed with a throwaway EdDSA key, and driven through install-and-
reopen using the existing Playwright Electron harness. The positive lane verifies
onboarding, scripted-agent configuration, design canvas edits, a pasted attachment,
theme change, update download, the install gate that blocks a running Agent, a
last-minute edit, actual Sparkle replacement of the bundle, and survival of all
user data after reopen. Three negative lanes verify rejection of a rogue-signed
appcast, recoverable download failure, and disabling the updater when the bundle's
Info.plist points at a foreign feed. The existing Lody/Geon updater UI and services
were reused unchanged; the work was in repairing the stale two-version rig and
building an isolated, evidence-collecting driver.

## Scope and ownership

This acceptance covers the **应用内更新的真实验收** item of
[Issue #32](https://github.com/LeonEthan/Geon/issues/32) and the
[independent-brand-release proposal](../../proposed/feature/2026-09-13-geon-independent-brand-release.zh.md).
[Issue #32](https://github.com/LeonEthan/Geon/issues/32) has since been closed;
remaining release work (installed-package human acceptance, GitHub App
registration, spec approval, proposal migration, and public DMG/appcast
publication) is tracked in
[Issue #34](https://github.com/LeonEthan/Geon/issues/34).

## Driver and evidence

- Driver: `e2e/scripts/update-acceptance.mts`
- Rig builder: `apps/electron/scripts/verify-sparkle-update.mjs`
- Evidence (git-ignored): `e2e/artifacts/acceptance/update-<lane>-<timestamp>/`

Lanes are run separately; each is one immutable round. The driver:

- Creates isolated `LODY_DATA_DIR`, Electron user-data dir, and CLI host port per
  lane.
- Copies the rig's pristine `old` app to a per-lane scratch location so Sparkle's
  in-place replacement never mutates the shared rig.
- Resets Sparkle's persisted `NSUserDefaults` state (`dev.geon.app` domain) before
  and after each lane; macOS resolves this domain through the real home directory,
  not `$HOME` or `--user-data-dir`.
- Serves the feed with `Cache-Control: no-store` so a cached appcast or zip cannot
  mask a later negative lane.
- Captures the native bridge's NSLog lines (Sparkle check results, install errors)
  in `app-<lane>.log`.

## Positive lane checkpoints (20/20 passed)

1. `bootstrap-onboarding` — local-only onboarding completes.
2. `scripted-agent-configured` — custom scripted ACP provider is created and ready.
3. `old-version-is-0.1.0` — updater state reports current version 0.1.0.
4. `design-session-created` — a design session is created via scripted reply.
5. `canvas-edits-visible` — text and shape elements exist in the Bento snapshot.
6. `attachment-sent` — a pasted PNG is stored on disk under the isolated data dir.
7. `theme-dark-applied` — `html.dark` class is present.
8. `update-downloaded` — phase reaches `downloaded` with version 0.1.1.
9. `install-gate-blocks-running-agent` — while an Agent turn is held, clicking
   "Update & Restart" is rejected with `Wait for Agent execution and design
   processing to finish before updating`.
10. `last-minute-edit-present` — a final canvas edit before install is visible.
11. `old-app-quit-for-install` — the old app process exits after the install click.
12. `bundle-replaced-from-zip` — the scratch app plist is 0.1.1 and the update
    verification marker (only present in the new zip) is found.
13. `stray-relaunch-contained` — Sparkle's automatic relaunch is detected and
    terminated so the next launch uses the isolated environment.
14. `installed-bundle-signature-valid` — ad-hoc codesign verification passes.
15. `artwork-survives-update` — element ids match before and after reopen.
16. `attachment-survives-update` — the attachment name is still visible after reopen.
17. `theme-survives-update` — dark theme persists after reopen.
18. `new-version-is-0.1.1` — updater state reports current version 0.1.1.
19. `export-png-after-update` — PNG export through the real save-dialog stub
    produces a valid PNG with expected dimensions.
20. `attachment-bytes-unchanged` — the stored attachment's SHA-256 is identical
    before and after the update.

## Negative lane checkpoints

- `bad-signature` (3/3): Sparkle rejects the rogue-signed appcast with
  `The update is improperly signed…`; app stays on 0.1.0 and remains usable.
- `download-failure` (2/2): missing enclosure reports a download error; restoring
  the zip and retrying reaches `downloaded` for 0.1.1.
- `tampered-plist` (2/2): a bundle whose `SUFeedURL` points at a foreign feed has
  updater phase `disabled` with reason `geon_update_configuration_unavailable`,
  the update action button is hidden, and the app remains usable.

## Key repairs to the verification rig

The checked-in `verify-sparkle-update.mjs` could no longer work after the brand
remake introduced `requireSparkle` validation:

- It did not pass `SPARKLE_APPCAST_URL` at runtime, so the packaged local-feed
  app disabled its updater as a configuration mismatch.
- It used pre-rename app paths and a single packaged app copy, so both "versions"
  had identical in-app version 0.1.0 even though the plist was rewritten to 0.1.1.
  Sparkle then reported `You're up to date!` and refused to download.

The repaired rig now performs two full `package-electron.mjs` runs (one per
version), verifies the bundle's short version string, and correctly launches the
old app with the runtime feed override.

## Limitations and known pre-existing failures

- The acceptance uses ad-hoc codesign only; Gatekeeper/notarized DMG behavior is
  not verified here.
- `pnpm check` reports two pre-existing failures in
  `apps/cli/src/agent/acp-authentication.test.ts` (`probeBuiltinAuthentication`).
  They fail because the test expects a configured Claude credential store that is
  not present in this environment; they are unrelated to the update work.
- Windows/Linux electron-updater paths are not exercised by this macOS Sparkle
  round.
- Publication of the actual release DMG and appcast is out of scope and not
  authorized.

## Related decisions

- [Brand remake and release-page work](2026-09-11-complete-design-acceptance.md)
- [Independent brand release proposal](../../proposed/feature/2026-09-13-geon-independent-brand-release.zh.md)
