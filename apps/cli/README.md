# Molly embedded runtime

This private package powers Agent execution and local design storage inside the
Molly desktop app. It is not a separately installed CLI product. Start desktop
development with `corepack pnpm start:local` from the repository root. Internal
process arguments and the workspace package name remain implementation interfaces.
The embedded service uses only the local installation identity. An explicit cloud
platform launch is refused; no product-cloud login or remote host is started.

## Settings MCP tool discovery

Settings lists a saved server's tools through the private `__internal mcp-list-tools`
helper. Electron supplies its explicit local platform and resolved data directory;
shell environment values cannot select another profile. Endpoint or credential edits,
including staged removal, disable listing until saved. The helper redacts saved values
of at least four characters, their authorization payloads of that size, and every
nonempty decoded Basic-auth username, password and combined value. Matching tool names
are omitted; titles and descriptions are redacted. This covers known credential echoes,
not arbitrary transformations of a secret. See the
[discovery fix record](../../.agents/notes/implemented/bug-fix/2026-10-04-mcp-settings-discovery.md)
for regression evidence and limits.

## Host port upgrades

The local host lease now uses loopback port `17792`. Explicit internal commands
`daemon stop` and `daemon restart` can also stop a detached Molly daemon from an
older build on `17790`, including while a new Electron host waits on `17792`.
The legacy lookup applies only to the default local TCP endpoint, outside E2E.
The live daemon's mode, PID and instance must match the active installation's
complete PID record before the existing token-authenticated shutdown is sent;
the request revalidates that identity and waits on the selected endpoint.
Foreign hosts never receive the token. No PID signals, data migration, legacy
lease acquisition or automatic desktop shutdown are added. Windows pipes,
cloud endpoints and isolated E2E endpoints retain their own scope.

## Design turn collection

`src/design/turn-outcome.ts` compares the collected PPTD project with the content
frozen at dispatch. A matching digest records `no_artifact` before import, even
when the current canvas differs. Identical rewrites do not prove a new attempt.
Existing files, candidates, history outcomes and commit receipts stay intact;
recorded outcomes and matching receipts still take precedence over collection.

Legacy manifests without dispatch content evidence retain the existing validated
import and atomic version check; missing evidence is not proof of unchanged
content. Changed projects retain structure, asset and version validation. Explicit
resubmission attempts and broader candidate retirement are separate work.

## Design image connection

Design sessions with an enabled URL/key/model connection expose
`molly_image` `generate` (JSON `/images/generations`) and `edit`
(multipart `/images/edits`, ordered workspace files and an optional PNG mask).
The user must provide a model; existing explicit values are preserved. Each call
returns a content-addressed workspace asset without changing or committing PPTD.
The connection probe checks `/models` only, not image endpoint support; provider
rejections remain visible without automatic paid retries or model fallback.
Attachments, image reading, preview rendering and existing artwork editing/export
remain independent.

## Design image viewing

Eligible design sessions expose `molly_view_image` in MCP `tools/list` using the
Session roots returned by `design/image-connection`, including when `connection`
is null and both image readiness flags are false. Coding or unknown sessions
receive no scope and no viewer. The embedded Agent declares the viewer directly
alongside `molly_render_preview` through the existing per-tool MCP exposure rules;
it does not require discovering the general Molly codemode namespace first.
The viewer also accepts `fonts: [{ file, face }]` (one to eight absolute
`.ttf`/`.otf`/`.ttc` files) with `text` (1–60 characters). Supply `path` and
optionally `region` to put a reference crop above the font rows. Image grid
`paths` is exclusive with font mode; `text` is valid only with `fonts`.
Font files must resolve to regular files in the Session workdir or the platform
font directories: macOS `/System/Library/Fonts`, `/Library/Fonts`, `~/Library/Fonts`;
Windows `%WINDIR%\Fonts`, `%LOCALAPPDATA%\Microsoft\Windows\Fonts`;
Linux `/usr/share/fonts`, `/usr/local/share/fonts`, `~/.local/share/fonts`, `~/.fonts`.
Preview directories do not grant font access; symlink escapes are refused.

Pango renders escaped literal text through sharp's `text` and `fontfile` input.
Rows are trimmed to ink, flattened on white and normalized to the reference ink
height clamped to 48–120 px (96 px without a reference). The sheet labels the
reference `R` and fonts `1..n`, with 8 px gaps and a 32 px label strip. Metadata
reports normalized `inkWidth`/`inkHeight`, the reference-relative `widthRatio`,
text and delivered JPEG dimensions/bytes. Rows exceeding the 1280 px sheet width
are uniformly reduced and report `downscaled` and delivered ink dimensions;
ratios retain the normalized widths. No reference means no `widthRatio`.
A render failure fails the whole call. The missing-face bitmap probe is
supplemented with SFNT/TTC name verification because Pango can use the supplied
file itself as its fallback; matching bitmaps alone cannot prove a missing face.
This does not verify individual glyph fallback or prove Pango's chosen face.

See the [font-row implementation record](../../.agents/notes/implemented/feature/2026-10-22-view-image-font-rows.md)
for the fallback limitation and fixture provenance.

See the [discovery regression record](../../.agents/notes/implemented/bug-fix/2026-10-21-design-viewer-exposure.md)
for evidence and verification limits.

## Browser reference images

`molly_browser` `save_image` converts downloads identified by WebP/AVIF magic bytes
to PNG before the existing design media publication. PNG/JPEG/GIF bytes remain
unchanged. Conversion retains the image byte, edge, total-frame pixel and decode
time limits; invalid images fail explicitly without fallback or retry. The active
browser run is checked again after conversion, before publication. Generated-image
intake elsewhere still accepts only PNG/JPEG/GIF.
