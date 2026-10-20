# Updater check, prompt, and relaunch (#187)

Status: implemented
Translation: pending

## Abstract

Settings > About could stay on a spinner after Check for Updates, and a finished
download never offered Install and Relaunch. A late `getState` snapshot could
overwrite a newer updater push, and a manual check then replaced `downloading`
or `downloaded` with `checking` even when Sparkle ignored the new check. Quit
also cancelled Sparkle's terminate, so the package installed on the eventual
quit and the app did not reopen. The About button and the sidebar prompt now
follow the check, up-to-date, download, and ready states; Install and Relaunch
saves work and stops local services before the native quit; declining still
installs on the next quit. A check that never leaves `checking` becomes a
retryable error.

## Evidence and limits

The stuck spinner matches a renderer that applies an older `updater.getState`
result after `updater.state` has already moved on, plus `checkForUpdates`
forcing `checking` while a Sparkle session is still open. The missing relaunch
matches `before-quit` calling `preventDefault` after Sparkle has already been
told to install. Both are fixed in the desktop main and renderer code. This
workspace cannot run a packaged Mac build, so Sparkle's real terminate-and-reopen
path and a 0.1.2 feed download remain unverified here.

## Decision

Keep one updater snapshot. Ignore `getState` when a push arrived while it was
in flight. Do not move `downloading` or `downloaded` back to `checking`; push
the current snapshot again so a stale About panel recovers. After 30 seconds
still in `checking`, publish `UPDATE_CHECK_UNANSWERED`, drop the
electron-updater in-flight lock, and leave the button usable. The lock field
is private on `AppUpdater`, so the release reads it as a structural property
and clears it only when the value is a promise or empty. A Sparkle check that
is still open is cancelled through the bridge's stored user-driver cancellation
before the next check starts; events from that retired session are ignored
until the next `checking` event. `electron-updater` installs on quit again
(`autoInstallOnAppQuit`); the explicit button still uses relaunch. Install and
Relaunch saves open designs and stops the local CLI, and does not close the
design worker or browser views. If installation does not start, the CLI is
started again.

The sidebar Later action only hides the prompt. It does not answer Sparkle's
install reply, so a declined update still applies on quit.
