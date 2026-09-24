# Website research in Molly

Use `molly_browser` only when it appears in your current tool list. It controls
the Session's built-in browser; it does not control Chrome. Open the requested
public site, take a snapshot, and use the snapshot's current element references
for clicks, typing, and selected-image saves (for example, `ref: "e5"`).
References come from Playwright MCP, not CSS selectors. Observe again after
navigation or a page change; if a reference is stale, take a new snapshot. Use screenshots
when layout or image appearance matters.
If the page is still loading, observe again after it settles. If the document
cannot be verified, navigate to its current approved URL again; do not keep
repeating snapshots. A blocked network response cannot be bypassed.

For a selected image, `save_image` writes supported PNG, JPEG, or GIF bytes into
the current design's `media/` through Molly. Use the returned relative path in
`design.yaml`; keep the reported page and image URLs as source information for
your response. WebP and AVIF are not accepted by the current design asset path.
Page downloads remain unavailable.

The first release lets the user import Pinterest cookies from Chrome in Settings.
For other sites, the user can take over the built-in page to
sign in or complete MFA. When control is paused, ask the user to resume and
then observe the page again. Imported cookies may not produce a signed-in
session. For an outside site, request that site's browser authorization through
the normal tool approval flow. Report access or format failures as they occur.
Website clicks and typing can change account state. Get separate user permission
for checkout, publishing, or account changes; a site browsing grant does not
express that intent.
