# Browser response rejection without native navigation re-entry

Status: implemented
Translation: pending

## Abstract

Rejecting an unverified response in Molly's built-in browser could crash Electron's main process during ordinary Agent research. The response observer called `webContents.stop()` synchronously from a debugger callback while Chromium was still processing that navigation. Molly now denies Agent reads immediately and defers the native stop until the callback has unwound, checking that the same live lease still owns a blocked page. A loopback-only native reproduction matched the reported crash stack; the product-handler regression exercises rejection and cancellation without contacting a model or public website.

## Evidence and cause

Two native reports shared their initial 51 frames and an invalid-address access at
`0x24`. The official Electron 39.5.1 arm64 symbols matched the report's framework
UUID and resolved the fault to `GURL::SchemeIs`, called by
`NavigationRequest::CheckContentSecurityPolicy`. The pinned Chromium source accesses
`common_params_->url` at that point. Both application failures immediately followed
an Agent browser navigation, before any image generation call.

A minimal Electron 39.5.1 program with a loopback HTTP response, `Network.enable`,
and `stop()` inside `Network.responseReceived` reproduced the same 51 frames and
`SIGSEGV`. Moving only the stop into `setImmediate` survived and cancelled the
navigation. This isolates native re-entry; it does not establish a general Chromium
CSP defect or require weakening CSP.

Primary references: [Electron's pinned dependencies](https://github.com/electron/electron/blob/v39.5.1/DEPS),
[matching symbols](https://github.com/electron/electron/releases/tag/v39.5.1), and
[Chromium navigation implementation](https://github.com/chromium/chromium/blob/142.0.7444.265/content/browser/renderer_host/navigation_request.cc#L7264).
Raw machine reports and user histories are not committed.

## Fix and ownership

The [browser controller](../../../../apps/electron/src/main/services/public-browser-agent-controller.ts)
still owns response-peer verification, as described by the
[browser integration record](../../proposed/architecture/2026-09-22-embedded-browser-account-import.zh.md).
On rejection it synchronously sets the network error, clears verified document
identity and marks the page unreadable. Only the native loading mutation is deferred.
That callback requires the original, undisposed lease, an undestroyed WebContents,
and a still-present denial. Revocation, replacement or an explicit new navigation
therefore cannot be stopped by an obsolete callback.

No browser policy, MCP schema, adapter dependency, image pipeline, CSP or provider
retry behavior changes. The ordinary Pi/adapter/server integration remains intact.
This fixes implementation of the existing browser ownership and denial rules;
it does not change Spec intent.

## Separate restart symptom

The reported run-journal `EEXIST` occurred after the first crash, when restart
recovery attempted to dispatch the same unfinished user turn. The journal's
exclusive creation correctly prevented replay of a run with prior provider
attempts. Its existing regression still passes. Deleting the record, replacing
its run identity or permitting another dispatch would bypass that protection.
That generic recovery error was subsequently fixed in the separate
[interrupted-run recovery change](2026-09-28-interrupted-run-recovery.md).
This native crash change preserves journals, native history, artwork and drafts.

## Verification and limits

`node apps/electron/scripts/browser-response-guard-probe.mjs` bundles the actual
controller into an isolated Electron process and drives its response observer with
a held loopback document response. It passed immediate denial, native cancellation
(`ERR_ABORTED`, numeric code `-3`), and obsolete-stop checks for revoked, replaced,
destroyed and newly navigated pages. It uses no external model, paid image service
or user profile. Both the standalone synchronous reproduction and an ablated copy
of the compiled product handler matched the real crash's initial 51 frames; the
deferred product path survived.

The probe disables macOS window restoration for its own process using
`-ApplePersistenceIgnoreState YES`. An earlier launch stalled before `app.whenReady`
in `NSPersistentUIRestorer`'s post-crash modal; no product test steps ran in those
launches. No saved user state or global preference was removed.

`pnpm check`, Electron `build:app`, scoped ESLint, formatting and `git diff --check`
passed. The final probe assertions were run after the full check and then checked
again with scoped ESLint/formatting. `pnpm run docs check` reports only the three
preexisting metadata errors in the unrelated untracked
`molly-mcp-integration-review/REVIEW.md` record. Its later
[documentation placement correction](../../rejected/architecture/2026-09-28-molly-mcp-host-managed-candidate.md)
preserves the original review bytes. This targeted regression is separate
from public-site, signed-installer and complete poster-generation acceptance.

The required read-only Codex CLI opinion (`gpt-6-astra`, high reasoning) failed
before analysis with `failed to initialize in-process app-server client: Operation
not permitted (os error 1)`. It was not retried or treated as review approval.
