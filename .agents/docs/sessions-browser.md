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
- Manual Session Browser address entry has strict dual engines, split on exactly one question: is the address the
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
  Public browsing uses native URL parsing and the user's Chromium session transport,
  including system proxies and TUN. Agent access uses the same visible
  `WebContentsView` with a separate run-bound ownership lease. There is no Molly
  protocol/credential-in-URL filter, site scope, public-address DNS or response-peer
  verification, proxy restriction, or forced cache/Service Worker bypass. Native
  document readiness and finite operation timeouts remain. Agent navigation stays
  on its native page, including loopback; it does not switch to Managed Preview.
  Saving an image requires
  a current upstream ref resolving to a loaded IMG in the main document. The engine split alone is by hostname TEXT;
  a public name that resolves to loopback still opens for manual use, so never describe
  manual routing as resolution-accurate. A non-human NAVIGATOR also exists and is handled here, not in
  Electron: a Managed Preview page is served by the agent machine, so the navigation requests
  its injected script posts up (`handleManagedNavigationRequest`) are agent-authored. Those
  carry `fromPageContent`, and `openAddress` refuses a private-LAN destination for them —
  public is an ordinary external link and loopback still needs its own approval in the managed
  branch, but a LAN address would open silently on the USER's network at a page's request.
  Only the address bar may reach one.
  The built-in `molly_browser` MCP server is available to active local design runs while
  Electron polls the owner-only control socket. It has one tool per action: `navigate`,
  bounded accessibility `snapshot`, `screenshot`, current-reference `type`/`click`/`scroll`,
  and selected-image `save_image`. Results are structured (`{ url, title }`, the snapshot
  with a `truncated` flag, the saved asset); screenshots stay inline MCP images. Usage
  mechanics live in the server instructions, read through Pi's `describeNamespace()`;
  Pinned agent-browser owns snapshots, refs, interactions and WebMCP events.
  Molly binds refs to a returned observationId and invalidates observations on navigation,
  frame changes and mutations. The unchanged VS Code adapter exposes only the leased
  WebContents and descendants through a token-gated loopback WebSocket. One owned native
  daemon per lease uses private config/socket/output paths; its control messages require
  a host token, and parent pipe closure terminates it. No additional browser is launched.
  Native source, required host patches and build identity are tracked under Electron's
  `native/agent-browser`. Browser protocol v2 is explicitly negotiated and expires with
  host TTL. The strict action tools cover navigation, reading, forms, wait, frame and
  dialogs. Four WebMCP tools list schemas on demand, invoke once, poll without cancellation
  and request cooperative cancellation. Opaque website tool/invocation handles remain
  scoped to the lease and document. Pending invocations block other page mutations except resolving an existing dialog; unrelated iframe activity does not release that guard.
  Catalog and lifecycle events invalidate handles immediately, including identical
  remove/re-register cycles. A single-use permit is checked by the existing CDP
  interceptor immediately before invocation. Native listing keeps one successful
  subscription and drains lifecycle events; a known event-stream gap requires a
  fresh connection. This does not provide browser-side atomic registration identity.
  Website summaries stay bounded untrusted data, including on screenshots and errors.
  Accessibility image nodes receive upstream refs; the native selected-ref metadata
  extension preserves loaded IMG/currentSrc checks. Element waits resolve those
  refs in their owning frame with a deadline. Checkbox actions dispatch at most one
  click and report unconfirmed state without retrying it.
  screenshots are bounded JPEG MCP images and need a model with image input;
  the Agent gets no arbitrary JavaScript, CDP target list, cookie values, external
  Chrome control, or Agent download-management API. The selected image path uses
  Electron `net.request` bound to the same Chromium session, with bounded redirects and bodies,
  before writing supported PNG/JPEG/GIF bytes to the design media directory.
  Existing Cookie and origin-only Referer rules remain: the image Cookie site
  context survives main-document navigation into its descendants and resets on a
  real cross-site document; each image hop includes Cookies only for HTTPS inside
  that context, without limiting network destinations. Native page downloads are
  available separately and never publish design assets automatically. WebRTC uses
  Chromium's normal behavior; webpage permission requests remain denied. Each tool
  advertises a strict non-union object, which OpenAI-compatible adapters keep intact;
  the MCP handler revalidates every request against the strict action union before
  dispatch. Browser tools use the
  existing permission flow without per-site scopes; takeover revokes Agent observation and action
  until the user explicitly resumes. Resume clears the exact saved takeover even
  after its turn has ended, releasing Electron's shared-account pause for a later
  authorized turn. A different active invocation or an unknown takeover identity
  stays rejected. Handback does not restart a completed turn or replay a browser
  operation. While Agent control is active, Electron blocks
  human mouse/keyboard events on that page. Only synchronous `Input.*` dispatch
  opens that gate; it is closed again before any asynchronous wait. Toolbar navigation
  takes over first. Detachment revokes pending output and preserves the human page.
  A dispatched operation whose result is unknown is never replayed automatically.
  Cancellation, timeout or disconnect rejects that operation's late result without
  freezing browser access for the rest of the run; the Agent can observe again.
  A hidden Agent page reattaches when the Browser
  panel opens; opening the panel must not navigate it again.
  A packaged Molly with a stable macOS signing identity stores site sessions in a
  separate persistent partition. Development and ad-hoc macOS builds use a
  memory-only partition. With OS secure storage, unpackaged macOS development can
  import selected website accounts into that memory session; packaged ad-hoc/unsigned macOS builds
  remain blocked because their Keychain trust does not reliably survive rebuilds.
  The shared account dialog initially discovers installed Chromium browsers without
  accessing profiles. Import starts a cancellable source operation that lists the
  selected browser's metadata and allows real native access to request authorization.
  One profile proceeds automatically; multiple profiles return to the same picker
  for explicit selection before any Cookie read. Main re-enumerates and validates
  each selected profile rather than trusting a cached list. It then uses one bounded
  whole-profile `rookie-cookies` inventory read before header normalization and
  filters the shared design/commerce catalog IDs, validates selected fields, and
  retains Cookie values and keys in main. Expired and source CHIPS Cookies
  are skipped and counted; unknown contexts, conflicting identities and incomplete
  reads fail before writes. The [whole-profile import](../notes/implemented/feature/2026-10-11-whole-profile-browser-import.md)
  and [permission-intent revision](../notes/implemented/bug-fix/2026-10-11-browser-import-intent-permissions.md)
  replace the older Pinterest-only two-read flow.
  The [development-import decision](../notes/implemented/feature/2026-10-03-development-browser-account-import.md)
  separates import eligibility from session persistence. A temporary blank view
  snapshots complete destination Cookie metadata via CDP because Electron's flat
  Cookie API cannot safely preserve CHIPS. Conflicting target partitions block
  replacement. Native Keychain lookup uses Security.framework inside Molly, with
  a five-minute cooperative read deadline. Cancellation cannot dismiss a system
  prompt; the source operation keeps its native lease until settlement and discards
  late results. Typed browser-file denial, Keychain denial and other unavailable
  source failures stay distinct. A confirmed file denial is silent: the dialog
  returns to its ready state with selections kept and no settings fallback.
  Development file access can belong to the launcher; macOS may reject prompting
  it. A denied request never retries itself; retry is an explicit click. Authorization
  and metadata preparation leave Agents and Molly website data available. After
  the source is ready, the write phase pauses Agents, drains pages, isolates network
  and Workers, preflights quotas, merges exact identities, and verifies writes and
  rollback. Unverified recovery holds browsing until explicit clearing. A failed
  source read leaves Molly cookies unchanged. Cookie bytes are written to Molly's separate
  partition; no extension, daemon import RPC, temporary export file, or second
  account catalog is involved. Saved embedded page URLs reopen after write release;
  Agents do not resume automatically. The user verifies the actual website login;
  Cookie counts do not prove sign-in. Clearing Molly cookies does not remove Chrome
  data or guarantee server-side logout. Clearing covers all Molly website storage,
  cache and HTTP authentication. All website-account entry points use the same
  import dialog; human takeover still permits manual page login/MFA. Image labels and refs follow the
  upstream accessibility snapshot; use screenshots for visual selection.
  Host driver failures use fixed safe messages. MCP text/image blocks carry WebMCP
  updates through the existing Pi adapter, including errors; no Pi fork is introduced.
  Page ownership and cancellation checks remain independent of native loading success.
  The permission-intent record establishes real development Chrome/Pinterest
  import, sign-in and denied-file recovery. First-prompt grant continuation,
  signed-package behavior and other catalog websites remain unverified.
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
