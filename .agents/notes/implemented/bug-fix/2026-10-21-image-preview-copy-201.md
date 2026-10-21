# Image preview copy: embedded image reads

Status: implemented
Translation: pending

## Abstract

Allow the existing image-export helper to read embedded images under the renderer
CSP. A native regression probe verifies original-resolution clipboard PNGs and
unchanged save payloads for all three local preview URL schemes.

## Cause and scope

[Issue #201](https://github.com/LeonEthan/molly-design/issues/201) reports an empty
clipboard after choosing Copy Image in the chat lightbox. A focused native probe
found that the renderer CSP allowed displaying `data:` images but blocked the
export helper's `fetch(dataUrl)`. The real export path returned `copy-failed` with
`Failed to fetch`. The same PNG through a `blob:` URL copied at its original size.
Native menu selection and Electron 44's asynchronous clipboard API worked in the
isolated probes. These findings identify a supported-source failure; they do not
prove every originally reported image used that source scheme.

The fix permits `data:` reads in the renderer's existing `connect-src` directive.
It retains the menu entries and labels, original-byte source selection, PNG
clipboard encoding, and original save encoding. Current chat thumbnails have no
image context menu, so this patch adds no thumbnail menu.

## Reuse and regression

Reuse is direct: `ZoomableImageViewer` already selects the original asset;
`runImagePreviewContextMenu` already fetches and converts it at intrinsic size;
`image-export-service.ts` already owns the native clipboard and save dialog.
No replacement component, main-process URL downloader, IPC contract, or storage
is needed. Electron 44 uses `ClipboardItem` and `clipboard.write`; the older
`clipboard.writeImage` suggestion does not match the pinned API.

`node apps/electron/scripts/image-preview-export-probe.mjs` reuses the product
renderer CSP and export helper, plus the real clipboard service. It runs in an
isolated temporary profile with synthetic 1600 × 900 PNG/JPEG fixtures. Each
fixture is copied and saved through `data:`, `blob:` and `molly-resource:` URLs.
Every copy starts with an empty clipboard, then checks the system PNG's dimensions;
save payloads must match the original bytes. The probe reconstructs writable
clipboard items before testing and restores them before exit.

Before the fix, the command failed on `data/png` with `Failed to fetch`. After the
fix, all twelve source/format/action combinations passed on macOS arm64 with
Electron 44.7.0. The existing renderer menu/export and main save-name/filter tests
are complementary checks.

Repository `pnpm check`, `pnpm run docs check`, changed-file formatting and
`git diff --check` passed. The full check needed an unsandboxed run for local
IPC/listening tests; the sandboxed attempt stalled in those tests.

## Limits

The probe selects actions through a synthetic IPC menu response and intercepts save
payloads. It does not verify the packaged menu, save dialog, Linux desktop, actual
uploaded/generated conversation records, or pasting into Preview/Figma/Messages.
The separate isolated native-menu check observed click, close, then resolution in
that order. Packaged-app cross-application paste remains a manual acceptance item.

Independent standards/security and issue/spec reviews found no P0/P1 findings.
They did not establish Issue #201 acceptance: inspected chat lightbox paths use
`blob:` or `molly-resource:`, which were already permitted before this fix. The
original report still needs a packaged-app reproduction tied to its actual source.
