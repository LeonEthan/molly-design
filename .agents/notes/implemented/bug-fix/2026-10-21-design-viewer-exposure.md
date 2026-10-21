# Declare the design image viewer to the embedded Agent

Status: implemented
Translation: pending

## Abstract

The image viewer was left on native Pi codemode discovery while the preview was
declared directly. Add it to the existing direct-exposure rule and verify both
Agent startup metadata and daemon-backed MCP discovery independently.

## Finding

The #199 desktop poster run at `e2e/artifacts/ab-199/after/a-brief-poster/run-1`
records only `mcp__molly__molly_render_preview` among the direct Molly tools in
Pi JSONL entry 5 (`toolsAdded`). The Molly namespace is described as codemode.
The viewer occurs in skill guidance but is never called. This establishes a
missing direct declaration, not an absent upstream MCP `tools/list` entry:
the run did not capture that response or the image-connection response bodies.

`packages/shared/src/embedded-harness.ts` declared only `molly_render_preview`
in `MOLLY_BUILTIN_MCP_TOOL_EXPOSURE`. `agent-client.ts` sends those rules in
`mollyMcpToolExposure`; `harness-pi/src/mcp.ts` maps them to native Pi
`toolExposure`. Pi 1.3.0 `getMcpToolExposure` defaults unmatched tools to
codemode. Thus the viewer depended on namespace discovery while the preview
was already declared to the model. No namespace spelling change is needed.

The daemon handler resolves design workspace roots before consulting image
readiness. Its actual no-connection response includes `artworkWorkdir` and
`workspaceRoot`, with null connection/credential and false ready/available.
A regression test sends that handler-produced response through the real local
RPC client, scope resolver and MCP `tools/list`: eligible design sessions list
the viewer and coding sessions do not. This passed before changing exposure.
The Agent startup regression requiring direct viewer exposure failed before the
fix and passed afterwards. Scope/schema failure and native caching are not
established by the captured evidence. The run log records image-connection
lookups at lines 559/562 and 580/583, before/after the turn input freezes at
line 569; the MCP log's lines 2–5 describe paid image readiness, not viewer scope.

## Change and reuse

Reuse the existing direct-exposure rule for `molly_view_image`, preserving the
daemon's Session gate, both HTTP/stdio registration paths and Pi native MCP.
The current scope resolver already works with the real daemon response and
needs no adaptation. Native `read` remains useful but does not bound these PNGs;
the existing viewer already provides that behavior. No new protocol, cache,
retry, storage or runtime patch is needed. The design Spec's intent is unchanged.

## Browser save investigation (initially read-only)

JSONL entries 57 and 59 select the archive image “Bewegte Schrift” by Philippe
Apeloig; entry 60 records the PNG/JPEG/GIF byte-admission refusal. The failed
response contains neither original bytes nor the selected image URL, so the
historical encoding cannot be proven from this capture alone. The site's public
client bundle uses AVIF picture sources with JPEG fallbacks. A public read of
the matching poster variant
`https://images.typographicposters.com/search/apeloig/apeloig-poster-681b63bc765314b81fe0601b.avif`
returned HTTP 200, `image/avif`, 37,617 bytes and an `ftypavif` signature. This
supports AVIF as the likely historical encoding, without proving the uncaptured
response. The browser fetcher advertises WebP/AVIF and returns the selected bytes
unchanged; design
intake then rejects encodings outside PNG/JPEG/GIF. The smallest general fix would
normalize supported WebP/AVIF browser downloads to PNG before the existing intake
validation, with decode/pixel/byte bounds and cancellation retained. Merely
changing Accept cannot override an already selected AVIF URL. That would change
the current explicit-refusal behavior and needs separate implementation scope.
The owning publication seam is `message-handler.ts:5957`, before calling
`writeGeneratedImageAsset`; keep generated-image intake strict. No browser code
was changed in the initial exposure commit `956f72bd`; the owner-approved
follow-up below implements this separate scope.

## Validation

The focused CLI suite passes 86 tests across the viewer, HTTP host, daemon image
RPC and Agent startup files. The exposure assertion failed before the one-line
fix. Full `pnpm check` passes (CLI: 2,997 passed, three existing skips); the DSH
suite passes all 11 tests without its known flake. `pnpm format` passes, with
unrelated browser source formatting reverted. `pnpm run docs check` passes;
existing size/translation warnings remain. No Electron build was invoked.

## Verification limits

Deterministic synthetic tests exercise discovery and exposure without a model,
network provider or Electron launch. They do not establish live model tool
choice or visual acceptance. The concurrent desktop test build is deliberately
left untouched; a later rebuild/new run is needed to verify the changed exposure
in the real desktop. No captured transcripts are added to Git.

## Owner-approved browser save follow-up (#199)

The browser-only save path now recognizes WebP RIFF/WEBP signatures and AVIF
`ftyp` brands (including compatible brands), then converts those downloads to PNG
before `writeGeneratedImageAsset`. It ignores declared Content-Type for conversion.
PNG/JPEG/GIF stay byte-identical, and all other formats retain the intake refusal.
Reuse the existing sharp dependency and publication function; the screenshot
encoder resizes to JPEG for model inspection and is unsuitable for lossless PNG
publication. Generic generated-image intake remains strict, so no new admission
protocol or storage is needed.

Conversion uses the existing 16 MiB input/output admission cap, 16,384-pixel edge
cap, 64 million pixels across frames, four-channel bound, strict decoding and
15-second decoder timeout. Publication rechecks the active browser run after
conversion. Corruption uses the existing fixed decode error, without fallback,
repair, resize or retry. Human visual acceptance remains separate.

Synthetic sharp-generated WebP and AVIF fixtures exercise the real browser RPC
save handler and disk publication with the wrong declared MIME type. Tests check
PNG encoding and dimensions, unchanged PNG/JPEG/GIF bytes, corrupt AVIF refusal,
byte-limit refusal, cancellation before and after conversion, and continued
rejection by generic intake. This sharp build supports AVIF encoding; no network
or captured site bytes are used. Desktop output/resources and the concurrent
Electron test run are left untouched.

Follow-up validation: the regression first failed on valid WebP/AVIF browser saves;
the focused suite now passes all 86 tests. Full `pnpm check` passes (CLI: 3,007
passed, three existing skips). Its first sandboxed run failed on denied local
socket listeners and related timeouts; rerunning outside the sandbox passed.
`pnpm format` passes, with unrelated Electron source formatting reverted and the
new test formatted explicitly. `pnpm run docs check` passes with existing warnings.
No Electron build, launch, process termination, branch switch, push or PR is used.
