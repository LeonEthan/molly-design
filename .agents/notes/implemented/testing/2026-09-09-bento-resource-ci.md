# Bento resource CI verification

Status: implemented
Translation: pending

## Abstract

Folio needs evidence that its pinned Bento resource closure builds on macOS,
Windows and Linux. A dedicated verification branch runs the same builder and
resource hash probe on all three GitHub-hosted platforms. It publishes no app
and uses a read-only repository token. All three platforms passed after canonicalizing Windows temporary paths.

## Scope

The branch contains only the resource package, submodule registration and CI
workflow. The package README records source provenance and license boundaries.
Checkout disables automatic CRLF conversion so source hashes and patches retain
their pinned bytes on Windows. This tests resource compilation and integrity;
it does not establish Windows/Linux Electron runtime or installer support.

## Initial run

Linux and macOS passed. Windows reached Vite but failed because its TEMP directory
used an 8.3 alias while Vite resolved HTML modules through the full path. The
builder now canonicalizes the created directory with `realpathSync.native` before
constructing any worktree or tool paths. The same three-platform job is the
regression check; its second run passed on every platform.

## Verification

[Run 34350883149](https://github.com/LeonEthan/Folio/actions/runs/34350883149)
passed at commit `e64edec462a732003966bea2b1795224d4a4c124`. Both the resource
builder and integrity probe passed on `macos-latest`, `windows-latest` and
`ubuntu-latest`. Local full `pnpm check`, formatting and documentation checks
also passed. Windows/Linux application runtime and installer support remain
outside this resource-only verification.
