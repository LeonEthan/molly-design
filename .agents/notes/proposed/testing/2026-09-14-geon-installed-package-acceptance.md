# Molly Design installed-package human acceptance checklist (Issue #32)

Status: proposed
Translation: pending

## Abstract

The Molly Design 0.1.0 macOS arm64 release DMG has been built from the release packaging
script for the final installed-package acceptance originally required by
[Issue #32](https://github.com/LeonEthan/molly-design/issues/32). After #32 was closed,
this checklist and the remaining release work moved to
[Issue #34](https://github.com/LeonEthan/molly-design/issues/34). This note records the
artifact identity and checksums, the acceptance checklist, and the limits of what
can be verified automatically. The visual identity verdict and the onboarding
audio/video behavior checks require a human reviewer; no automated assertion can
replace human judgment on these items.

## Artifact

Built on the `codex/independent-release` branch from the same source that passed
the in-app update acceptance round.

| File | Path | SHA-256 |
|------|------|---------|
| DMG | `apps/electron/dist/MollyDesign-0.1.0-arm64.dmg` | `dbf8ed7ddb443c8b14cd2d015c3962fe98e1f320c44ecc97259a737aa70b6732` |
| ZIP | `apps/electron/dist/MollyDesign-0.1.0-arm64.zip` | `0dfc581e5479f7f67eb9d966521fa7bd6725f7d4f55eea385f396d010b5f856e` |

Packaged app identity:

- `CFBundleIdentifier`: `dev.molly-design.app`
- `CFBundleShortVersionString`: `0.1.0`
- `SUFeedURL`: `https://github.com/LeonEthan/molly-design/releases/latest/download/appcast.xml`
- `SUPublicEDKey`: `eo5wdjstR0vesa7qYOKvxMXd977lOVLkd44OGzG/XiI=`

The public key is the local throwaway acceptance key because no Apple Developer
or release Sparkle signing credentials are available in this environment. The
DMG is ad-hoc signed and not notarized, so first launch requires the user to
right-click the app and choose **Open** rather than double-clicking.

## Human acceptance checklist

Reviewer: perform these checks on a clean macOS account or after removing any
prior `~/Library/Preferences/dev.molly-design.app.plist`, `~/Library/Application Support/Molly Design`,
and `~/.molly` state.

### Visual identity

- [ ] Mount `MollyDesign-0.1.0-arm64.dmg`; the volume name, background image, and
  `.VolumeIcon.icns` show **Molly Design** branding, not Lody/Folio jellyfish or old
  underwater/aurora artwork.
- [ ] Drag `Molly Design.app` to `/Applications`; the app icon in Finder and Launchpad is
  the new Molly Design identity.
- [ ] Launch the installed app; the Dock icon and menu-bar menus are labeled
  **Molly Design**, not Lody/Folio.
- [ ] Open **Molly Design → About Molly Design**; the about panel shows **Molly Design** product name,
  version `0.1.0`, and the Molly Design repository link.
- [ ] Inspect `~/Library/Preferences/dev.molly-design.app.plist` after first launch; the
  bundle identifier is `dev.molly-design.app` and no Lody/Folio defaults leaked in.

### Onboarding

- [ ] On first launch, the onboarding window appears and the app does not
  auto-enter the product without user action.
- [ ] Any intro animation/video autoplays as designed; if autoplay is blocked by
  the system, the app presents a clear manual entry (e.g. a play button or
  "Start" control) rather than hanging on a blank or broken frame.
- [ ] A mute/unmute or volume control is reachable during onboarding if audio is
  present.
- [ ] A skip control is reachable and exits onboarding into the product cleanly.
- [ ] Completing onboarding without skipping lands on the local bootstrap/product
  entry as expected.

### Autoplay-blocked entry

- [ ] With system autoplay disabled (or by simulating a blocked media context),
  the onboarding media does not silently fail; the blocked state is detected and
  a fallback entry (tap-to-play, static frame with button, or alternate first
  step) is shown.

## Automated verification already performed

- DMG mounts successfully and contains `Molly Design.app` plus an `Applications` symlink.
- `Molly Design.app/Contents/Info.plist` has the correct bundle id, version, feed URL,
  and Sparkle public key placeholder.
- The packaged app launches through the existing Playwright harness in an
  isolated environment and reaches the onboarding/product surface (see
  [in-app update acceptance](../../implemented/testing/2026-09-14-geon-in-app-update-acceptance.md)).

## Outcome

This note is a **proposed** checklist awaiting human review. Once the reviewer
marks the checklist above and confirms no Lody/Folio identity leaks, the
installed-package acceptance item of Issue #32 can be considered complete.

## Related decisions

- [Molly Design in-app update acceptance](../../implemented/testing/2026-09-14-geon-in-app-update-acceptance.md)
- [Independent brand release proposal](../../proposed/feature/2026-09-13-geon-independent-brand-release.zh.md)
