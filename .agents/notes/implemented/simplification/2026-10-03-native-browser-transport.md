# Reuse native browser transport without destination restrictions

Status: implemented
Translation: current

[中文](2026-10-03-native-browser-transport.zh.md)

## Abstract

Molly's Agent browser rejected ordinary websites when a user's TUN proxy returned fake-IP DNS answers or connection addresses, even though native browsing worked. The implemented simplification removes Molly's destination and transport verification, per-site scopes, WebRTC disablement, ordinary-download denial and run-wide freeze after an uncertain browser action. Navigation and selected-image fetching reuse the existing Chromium session and the user's network rather than adding DNS settings, address exceptions or another proxy. Full repository checks, the local OSS build and isolated native probes passed, including browsing with TUN unchanged and retained ownership controls. The changed Spec stays draft, and private-network isolation is no longer a browser guarantee.

## Decision and scope

Remove all eight network restrictions identified in the browser inventory:

- Protocol, embedded-credential and destination-class filtering beyond native URL parsing.
- Public-host-only Agent navigation, proxy-must-be-`DIRECT`, Node DNS preflight and public response-peer verification.
- Forced cache disablement, Service Worker bypass and network-verified-document readiness. Native loading/actionability and finite timeouts remain.
- The independent Node image downloader's public-address pinning. Selected images use Electron's native request transport bound to the owning Chromium session.

Also remove per-site scopes, explicit WebRTC disablement, ordinary page-download denial and freezing the entire current run after an uncertain action. Browser operations retain the existing tool permission flow. An operation still rejects late or cancelled output and never replays an unknown action automatically; a fresh observation can continue the same task.

Manual address entry keeps the existing loopback-only Managed Preview routing. Agent navigation stays on its native page, including loopback, rather than switching engines. Managed Preview itself still accepts only the agent machine's loopback targets, and its page-authored navigation cannot silently pivot to the user's LAN.

## Reuse and responsibilities

The existing `WebContentsView`, official Playwright MCP driver and pinned VS Code CDP adapter already provide the page and Agent operation lifecycle; they remain the first reuse choice. The higher-level Electron `Session.fetch` was checked first for selected-image bytes. In pinned Electron 39.5.1, `redirect: 'manual'` rejected a 302 with `Redirect was cancelled` instead of returning a redirect response, so it cannot supply the existing per-hop Cookie decisions and five-redirect limit. Electron `net.request` bound to the existing browser session is the next reuse choice: native redirect events adapt those retained bounds while Chromium handles DNS, proxy, TLS and sockets. A new DNS resolver, named proxy integration, forwarding gateway or alternative browser backend would add a second network policy without serving the chosen product contract.

The browser service owns page identity, human/Agent exclusion and lifecycle. The owner-only control socket binds requests to the active run, launch and page; obsolete requests and late results remain rejected. Design services continue to own media publication and complete PNG/JPEG/GIF decoding. Ordinary browser downloads do not publish artwork assets.

Lease registration and revocation listeners now precede the initial blank-document await. Previously, revocation during that load missed the unregistered lease and initialization could continue into the adapter. Initialization rechecks the same lease before attaching, and its failure cleanup removes only that lease, preserving a replacement. The deterministic regression failed on the old ordering and passes with revoked initialization rejected and the replacement still alive.

The existing image Cookie policy retains its initial site context, with `www.` normalized, while native main-frame pages stay on that site or its descendants. A real cross-site document resets the context. Each image hop carries Cookies only for HTTPS addresses inside that context; Chromium selects the actual Cookies, while other targets use `omit`. Origin-only Referer and the existing Cookie-size bound remain. This context controls credential attachment, not navigation or network reachability; retaining it avoids narrowing sibling asset hosts after a page moves into a child host.

Retained boundaries include native sandboxing and web security, denied webpage permission requests, password-field input refusal, the existing popup policy, bounded snapshots/screenshots/queues/timeouts, main-only Cookie values, account-import integrity, and the finite MCP action union. The Agent still receives no arbitrary JavaScript, raw CDP, external Chrome control or download-management API.

## Evidence and alternatives

Before this change, the [destination policy at the inspected revision](https://github.com/LeonEthan/molly-design/blob/1809a324b9448c9c3a6d36bff4a18bfc155c633c/apps/electron/src/main/services/public-browser-agent-policy.ts) required public Node DNS results, `DIRECT` Chromium proxy resolution and public response peers. A native isolated probe reproduced a successful manual HTTPS load with fake-IP transport followed by Agent preflight rejection on the same network. No user profile or account was read by that probe.

Removing only the proxy check leaves DNS and response-peer rejection under TUN fake-IP. Public DNS overrides can recover some environments, but introduce a separate resolver decision and do not meet the chosen transparent use of the user's network. Allowing a particular fake-IP range or proxy vendor would encode environment-specific exceptions. Reusing Chromium transport removes the conflicting mechanism rather than maintaining compatibility exceptions.

The final scope removes protocol/download restrictions and permits Agent loopback navigation. Inspection also corrected the earlier assumption that a per-site approval prompt was implemented: navigation replaced the current scope directly, while the Spec's expanded-site approval was not implemented. Earlier [response-address normalization](../../implemented/bug-fix/2026-09-28-browser-response-ipv6-normalization.md) and [native response-stop crash](../../implemented/bug-fix/2026-09-28-browser-response-navigation-crash.md) evidence remains historical; their verification layer has been retired, not reinterpreted as current behavior.

The required read-only Codex CLI second opinion used `gpt-6-astra` with high reasoning. Its findings led to a final lease recheck after readiness waits, removal of both service/controller loopback gates for Agent navigation, and retained image Cookie context across descendant pages. Its higher-level `Session.fetch` recommendation was superseded by the fixed-version native redirect failure above; transport selection follows that executed evidence.

## Guarantees and limits

Molly no longer promises that Agent-readable pages and images cannot reach local or private services. Chromium's native platform behavior and the user's network determine reachability; native TLS, same-origin rules and sandboxing are not equivalent to the removed public-destination proof. Browser tool permission remains distinct from permission to import accounts, publish, purchase or change account state.

No image-format expansion, per-task Cookie isolation, automatic login retry, proxy configuration or DNS setup is included. Existing account import remains Pinterest-only and signed-macOS-only. Native downloads remain separate from the design asset path, and their availability does not establish automatic import of arbitrary downloaded files.

## Verification

Deterministic regressions passed: 29 shared browser URL tests, seven Electron controller tests and two retained policy-helper tests, 17 image-fetch tests including timeout cases, and 57 CLI host/MCP tests. The retained policy file now supplies only document-identity normalization and image Cookie host matching, without destination verification.

`node apps/electron/scripts/browser-navigation-probe.mjs` passed 11 native checks through the production page service: localhost navigation and observation, MCP input/click, password-input refusal, WebRTC, selected IMG bytes, bounded JPEG screenshot, cross-site page link, file/data navigation, takeover/resume without replacing the page, closed-page same-run refusal and normal native download. `node apps/electron/scripts/browser-asset-transport-probe.mjs` passed 19 synthetic native transport checks using an isolated profile. Neither probe used user accounts or a model.

The production mode of `browser-mcp-probe.mjs` passed six compatibility checks, including selected-image bytes, viewport JPEG, input gating, revocation and real-page observation. TUN remained enabled and system Node DNS still returned fake-IP results, so the successful browser path did not depend on changing DNS or proxy setup. This real-network compatibility check is separate from deterministic no-network regressions.

The first public-page assertion failed because an external heading had changed; the final check uses the actual URL and semantic page content. Initial native fixture launches also exposed a bundle runtime-alias omission and download-fixture initialization issue; those probe issues were corrected before the final successful runs. The `Session.fetch` manual-redirect failure remains the recorded reason for selecting `net.request`, rather than being described as a passed fetch result. No captured webpage text, account state or user transcripts are included here.

`pnpm format`, the restarted full `pnpm check` including the public-boundary check, and `pnpm build` passed. The build rebuilt and synced the CLI, validated Bento resources, and built the local OSS Electron main, preload and renderer. The first full check stopped on three image-fetch/fixture lint findings; those were corrected before the successful rerun. Workspace suites retain six preexisting skipped tests, three in Loro and three in CLI. After the initialization-lifetime fix, the navigation probe passed all 11 checks again. The [Spec](../../../../specs/graphic-design-platform.md) and [browser explanation](../../../docs/sessions-browser.md) reflect the chosen contract; both Spec language versions remain draft. Signed distribution and real-model Pinterest acceptance were not repeated; these checks do not establish account migration or universal site availability.
