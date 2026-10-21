# Hide the native browser beneath the shared image lightbox

Status: implemented
Translation: pending

## Abstract

Opening a chat image left the native browser above the lightbox because overlay
detection required Radix open-state metadata. The shared viewer uses a different
portal without that attribute. Recognizing its mounted portal reuses existing
hide/restore behavior without changing appearance or browser lifecycle. Renderer
regression coverage does not establish native macOS scroll preservation or continued
Agent execution.

## Cause and decision

[Issue #200](https://github.com/LeonEthan/molly-design/issues/200) reproduces with the
real `ZoomableImageViewer` beside `PublicBrowserSurface`: the portal mounts but
requested browser visibility remains true. Existing tests constructed Radix-shaped
dialogs with `data-state="open"`, missing this integration.

Match `.molly-photo-slider.PhotoView-Portal` alongside the existing Radix selector.
Reuse the observer and `setVisible` bridge; main retains the page and moves leased
pages to its hidden host. Canvas geometry-based overlay handling was checked but
would broaden this repair. No new protocol, storage, snapshot, or styling is needed.
Mermaid and cross-application window behavior remain outside this fix.

## Verification and limits

The real-viewer regression failed before the selector change (expected hidden,
received visible). Afterward all four surface cases pass, including open/close
visibility transitions under human and Agent control states. Tests exercise real
components through a mocked bridge, without a website or paid model run. Native
macOS layering, page scroll and running Agent continuity require interactive acceptance.

Before commit, `pnpm check`, `pnpm format` and `pnpm run docs check` passed.
The first sandboxed full-check attempt encountered `listen EPERM` in local IPC tests;
the complete rerun with socket permission passed. Unrelated formatter changes were
restored before staging.
