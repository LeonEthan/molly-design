# Normalize browser response peers before public-address checks

Status: implemented
Translation: pending

## Abstract

Design research can fail even when a public website returns a successful document because Electron supplies bracketed IPv6 response addresses and Molly validated the unnormalized string with Node's `isIP`. An isolated run of the product browser controller confirmed an HTTP 200 document rejected solely by this format mismatch. DNS preflight and response verification now share IP normalization before public-address classification, also closing a dotted IPv4-mapped address classification gap. Known network denials also take precedence over generic driver failures, so the Agent receives the actual rejection instead of a misleading loading message. Regression tests cover address forms and error precedence; site accessibility remains separate.

## Findings

Both recent manual research runs reported the existing public-response-peer
verification error after browser navigation. Historical logs did not retain the
peer address or response flags, so they cannot independently prove which specific
response failed at each site.

A separate anonymous Electron 39.5.1 process used the current product controller
and Playwright MCP driver, a fresh temporary profile, and Pinterest's public root
page. It observed a main Document with HTTP 200, `DIRECT` proxy resolution,
`fromDiskCache: false`, `fromServiceWorker: false`, and a bracketed public IPv6
`remoteIPAddress`. The host classifier returned `public`; Node `isIP` returned
zero for the same bracketed string. The response verifier rejected it. This is
direct evidence of a Molly compatibility defect, not evidence of a site login or
general connectivity failure. No account cookies, model or image service were used.

The mismatch is in
[public-browser-agent-policy.ts](../../../../apps/electron/src/main/services/public-browser-agent-policy.ts):
DNS preflight normalized IPs, whereas `isVerifiedAgentBrowserResponsePeer` called
`isIP` directly on the CDP representation. The hostname classifier itself removes
IPv6 brackets, but the earlier validation had already failed.

Two behaviors obscured or amplified the original error:

- Every response and redirect is checked, including subresources; one rejected
  response makes the whole lease unreadable.
- Before the follow-up error fix, `execute` awaited the browser driver before
  checking the lease's network error. Its 15-second navigation timeout became
  “still loading”; only the next screenshot or snapshot exposed the peer rejection.

An independent anonymous HTTP check also received a 403 from Behance. Therefore
fixing peer normalization does not establish universal site accessibility or
authenticated research acceptance. Image generation follows another network path
and can succeed while the browser rejects its document.

## Implementation and verification

The existing normalization helper accepts a complete bracket pair only around a
valid IPv6 literal, validates with `isIP`, and obtains the canonical hostname from
Node's URL parser. Both DNS preflight and response verification use this helper.
Canonicalizing dotted IPv4-mapped IPv6 to its hexadecimal form lets the existing
classifier reject its embedded private address. Removing brackets alone would
fix the observed public IPv6 failure while leaving that classification gap.

Missing or malformed peers, zone identifiers, local/private/reserved addresses,
and unverifiable cache/service-worker responses remain denied. Tests use the real
hostname classifier with injected DNS and proxy results. Before the fix, three
groups failed for bracketed public IPv6, mapped loopback IPv4, and zone identifiers;
afterwards all 13 policy and asset-fetch tests passed. The policy tests now run in
the existing Node transform-types group because the shared classifier uses
TypeScript constructor parameter properties. No dependency version changed.

A fresh anonymous Electron 39.5.1 run then used the product controller and driver
against Pinterest again. Its HTTP 200 documents carried bracketed public IPv6
peers and passed verification; navigation completed and the isolated process
exited successfully. This verifies the observed address mismatch with native
Chromium, without account cookies or a model. It does not establish authenticated
research acceptance or availability of other websites.

The follow-up error fix keeps the ordinary driver operation lifetime intact. After
an operation fails, the controller first rechecks the same lease and then reports
an already-recorded network denial before propagating a generic driver failure.
An ordinary timeout retains its loading message, and a new navigation clears any
previous denial before execution. Revocation and replacement keep their ownership
errors. The deferred native stop and response-verification rules are unchanged.

The deterministic controller regression bundles the actual controller and driver
and injects only a synthetic MCP completion plus a rejected response event. Before
the fix, both the timeout and transport-error cases hid the peer rejection; after
the fix all five cases pass, including ordinary timeout, old-error clearing, and
revocation/replacement. No public network, model, real timeout or application
restart participates. The fix changes error precedence, not how long the driver
may take to settle. Response scope, MCP integration and paid-call behavior remain
unchanged.

The existing
[native crash fix](2026-09-28-browser-response-navigation-crash.md)
addresses synchronous navigation re-entry after rejection; it does not fix the
address mismatch. Raw user histories and response captures are not committed.
