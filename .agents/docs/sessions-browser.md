# Session Browser engines, Managed Preview, HTML viewer, annotations

The two browser engines, the loopback-only Managed Preview boundary, static HTML rendering, and visual annotation.

Scope: `packages/components/src/components/sessions`. Binding rules and the
pointer to this page live in
[that directory's AGENTS.md](../../packages/components/src/components/sessions/AGENTS.md);
this page is the full text of the rules summarised there.

- Complete `.html` / `.htm` viewer text may switch between Monaco source and Managed Preview without
  a Machine RPC endpoint. Build a policy-owned `srcdoc` from the current complete viewer text,
  inject the shared annotation runtime, and run it in uncached static-document mode
  (`allow-scripts` only, opaque origin). Static frames must be destroyed as soon as the file
  tab or rendered mode becomes inactive; never park their JavaScript in the Browser frame cache.
  Keep CSP/referrer/base policy and the annotation runtime ahead of source scripts, map runtime
  messages to a file-path logical URL whose namespace distinguishes relative, POSIX-absolute,
  Windows-drive, and UNC paths. Same-document `#fragment` links stay inside the `srcdoc`; leave
  rendered mode on every other navigation request because local subresources/pages are not part of
  the single-document contract. HTML starts in code mode,
  and truncated documents are never executable. The iframe is a permission boundary, not a promised
  renderer-process/thread boundary; do not claim arbitrary user JS cannot consume the app renderer.
  Likewise, CSP governs the initial `srcdoc`, not an arbitrary later self-navigation. Require
  credentialless iframe support before offering the toggle, and do not describe the
  self-contained/no-network rule as a hard browser guarantee. The rendered frame exists only while
  its viewer tab and containing sidebar are visible. Key the file viewer by session + tab so switching
  session targets always returns HTML to code mode before the new file can execute.
- Session Browser has strict dual engines, split on exactly one question: is the address the
  agent machine's own LOOPBACK? Only that uses Managed Preview, where the machine opens one
  approved port on itself; those are the only pages eligible for Visual Annotation. Everything
  else — public sites AND private LAN / `.local` / `host.docker.internal` — uses the declared
  public-browser capability (Electron `WebContentsView` today), which is the user's own browser
  on the user's own machine reaching the user's own network. Never fall back from a missing
  public engine to iframe, system browser, CLI, Preview Gateway, or a different Machine RPC plane.
  INVARIANT — a managed preview is never a pivot: routing a LAN address through the machine
  would let whoever holds the tunnel reach hosts behind that machine that they could never reach
  themselves, and the approver sits on the OTHER side of the tunnel, so approval cannot make it
  safe. `parseBrowserAddress` never routes LAN there and `PreviewTargetApproval.targetClass` is
  the literal `'loopback'`, but the CLI's `normalizeTarget` is the authoritative rejection.
  Manual public browsing remains hostname-routed and does not impose the Agent's DNS
  restrictions, preserving existing fake-IP proxy behavior for the person. Agent access
  uses the same visible `WebContentsView` with a separate run-bound guard: public
  destinations and DNS, direct proxy, verified response peer, approved top-level site,
  and no page read until the guarded main document reaches DOM-ready. A denied
  subrequest is cancelled without poisoning an otherwise verified page; an unsafe
  main-frame request or response peer still blocks Agent reading. Saving an image
  requires a current upstream ref resolving to a loaded IMG in the main document. Fake-IP or unverifiable proxy
  sessions fail closed for Agent access. The engine split alone is by hostname TEXT;
  a public name that resolves to loopback still opens for manual use, so never describe
  manual routing as resolution-accurate. A non-human NAVIGATOR also exists and is handled here, not in
  Electron: a Managed Preview page is served by the agent machine, so the navigation requests
  its injected script posts up (`handleManagedNavigationRequest`) are agent-authored. Those
  carry `fromPageContent`, and `openAddress` refuses a private-LAN destination for them —
  public is an ordinary external link and loopback still needs its own approval in the managed
  branch, but a LAN address would open silently on the USER's network at a page's request.
  Only the address bar may reach one.
  The built-in `molly_browser` tool is available to active local design runs while
  Electron polls the owner-only control socket. It exposes navigation, bounded accessibility
  snapshot/screenshot, current-reference input/click/scroll, and selected-image save;
  Official `@playwright/mcp` 0.0.82 owns snapshots, string refs (`e5` / `f1e5`),
  actionability and input through its locked Playwright dependency. An attributed,
  unchanged VS Code adapter connects only the granted WebContents and its worker/frame
  descendants through an in-memory CDP transport. No browser is launched or listener opened.
  Molly exposes only its strict action union; upstream arbitrary code, caller-supplied
  evaluate, filenames and dynamic website tools are unavailable. Host-authored evaluate
  only checks password fields, scrolls, or resolves the selected image's metadata.
  The private MCP output directory is cleared after every operation and removed on revoke;
  only bounded snapshot text or image bytes leave main, never upstream file links.
  screenshots are bounded JPEG MCP images and need a model with image input;
  the Agent gets no arbitrary JavaScript, CDP target list, cookie values, external
  Chrome control, or download API. The selected image path validates every redirect
  and pins public socket addresses before writing supported PNG/JPEG/GIF bytes to the
  design media directory. Normal page downloads remain denied. The MCP catalog
  advertises a flat, required-`kind` object because the OpenAI-compatible
  adapter erases top-level JSON Schema unions; the MCP handler revalidates every
  request against the strict action union before dispatch. The Pi permission request
  may grant a run-scoped site; takeover revokes Agent observation and action
  until the user explicitly resumes. While Agent control is active, Electron blocks
  human mouse/keyboard events on that page. Only synchronous `Input.*` dispatch
  opens that gate; it is closed again before any Playwright wait. Toolbar navigation
  takes over first. Detachment revokes pending output and preserves the human page.
  A hidden Agent page reattaches when the Browser
  panel opens; opening the panel must not navigate it again.
  A packaged Molly with a stable macOS signing identity stores site sessions in a
  separate persistent partition. Development and ad-hoc macOS builds use a
  memory-only partition and cannot import Chrome accounts; their Keychain trust
  does not reliably survive rebuilds. On a signed macOS package with secure
  storage, Settings lists Chrome profile names and
  imports only Pinterest cookies (the first-release scope) from the selected
  profile through `rookie-cookies`. The domain-filtered detailed read must match
  the extraction report; CHIPS, unknown contexts, or conflicting identities reject
  the import before writes. A temporary blank view checks destination partition
  metadata via CDP because Electron's flat Cookie API cannot safely back up CHIPS.
  Existing site CHIPS also blocks replacement. The user may need to approve macOS Keychain
  access. The initial native report allows five minutes for human authorization;
  the pinned detailed reader has no timeout parameter. Settings shows a pending
  hint and manual retry guidance, with no automatic retry. A failed read leaves
  Molly cookies unchanged. Cookie bytes stay in Electron main and are written to Molly's separate
  partition; no extension, daemon import RPC, temporary export file, or second
  account catalog is involved. The import pauses active Agent page access and
  reloads an open page for that site. The user verifies the actual website login;
  Cookie counts do not prove sign-in. Clearing Molly cookies does not remove Chrome
  cookies or guarantee server-side logout. The Browser sidebar links to Settings
  and leaves manual sign-in in the visible page. Image labels and refs follow the
  upstream accessibility snapshot; use screenshots for visual selection.
  Pi converts only known Molly browser failures (denied destination, unsupported image,
  stale image reference, unavailable image, unverified document, blocked network
  response and user takeover) into fixed safe codes; raw website or transport
  error text remains hidden from the Agent. CDP and WebContents may encode the
  same verified document query differently, so comparison normalizes query
  encoding without skipping the response-peer check.
  The composer info-bar Browser action is an explicit candidate-navigation request, not merely a
  panel-open action. It opens the reported candidate even when another page is already visible.
  That click IS the approval for that exact target: a remote route creates (or replaces) its tunnel
  immediately, with no confirmation dialog, because the CLI only accepts LOOPBACK targets from an
  agent report. A typed loopback address and Share still go through the confirmation flow. The
  approver is the session initiator, the same person the CLI already requires.
  Consume the request after handling it so a later panel remount cannot replay stale user intent —
  but NOT while the candidate is still in flight. Session meta carries only the candidate status;
  its target lives in the session doc `preview` state, and the two planes sync independently, so a
  click landing between those writes must wait for the doc (bounded by the doc reaching `synced`)
  instead of consuming the request and leaving an empty panel.
  An empty Browser must always say WHY it is empty — a bare globe reads as a broken panel. With no
  reported candidate the empty state names that (the agent never called `molly_report_preview_candidate`,
  which is the common case, not a bug); with one, it points at the address bar.
  Annotation mode installs a full-viewport transparent interaction layer inside the managed page;
  it must remain the pointer target while hit-testing temporarily ignores it to inspect the page
  below. Do not revert to listener-only interception, which lets page pointer handlers activate.
  Draft and persisted comment UI render outside the iframe, so both must be registered with the
  injected runtime as tracked anchors. Their overlay position must come from refreshed resolved
  rects on page scroll; an initial click rect is only a pre-resolution placeholder.
  Injected annotation target payloads use path-relative `page.url` values; resolve them against the
  logical preview URL before stripping capability parameters. Treat parse failures as visible runtime
  errors instead of silently dropping the selection message.
  Creating a new preview comment immediately stages its visual-annotation reference in the matching
  session composer through the idempotent `addVisualAnnotationReference` path. Existing-comment
  controls use the separate toggle path so users can remove or re-add a staged reference.
  Preview comment create/resolve/unresolve/submitted writes MUST go through
  `runtime.writer.mutatePreviewVisualComments`; never call the preview comment store's `setState`
  from UI code. Preview comments are renderer-authored user data on every platform.
