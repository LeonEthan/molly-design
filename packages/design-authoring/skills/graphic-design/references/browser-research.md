# Website research in Molly

[The main Skill](../SKILL.md#2-inspect-references-and-research) owns the research
requirement and its explicit exception. Use this reference to perform required
research or inspect a user-specified website.

Choose queries that help decide composition, palette, type treatment or image
style while preserving the user's direction. Open relevant results and inspect
their actual visual content; screenshots or image reading are needed to judge
appearance. Search snippets and page text alone do not establish visual research.
Keep the actual inspected reference URLs and briefly connect the observed choices
to the design. A search-results URL alone does not identify individual references;
if those pages could not be opened, report exactly which visible results you used.
Save an image only when it is needed as an asset or edit reference; observation
alone does not require downloading it. Borrow ideas while respecting source
artwork and asset permissions.

Use `molly_browser` only when it appears in your current tool list. It controls
the Session's built-in browser; it does not control Chrome. Open the relevant
site, take a snapshot, and use the snapshot's current element references
for clicks, typing, and selected-image saves (for example, `ref: "e5"`).
References come from Playwright MCP, not CSS selectors. Observe again after
navigation or a page change; if a reference is stale, take a new snapshot. Use screenshots
when layout or image appearance matters. Browser screenshots are inline tool
images for your inspection; they do not supply saved workspace files. When the
user asks to see a reference, share its inspected source-page URL or save the
selected image with `save_image` and use its returned file path. Include a local
image in your reply only after a successful save or file read confirms that exact
path exists. If only the screenshot was inspected, report that observation and
link the page instead of presenting a guessed screenshot filename.
If the page is still loading, observe again after it settles. If a browser action
times out or returns an uncertain result, observe the page before choosing the
next action; do not blindly repeat a click or submission. The failed operation
does not freeze browser access for the rest of the task. Browser navigation and
selected-image fetching use the user's normal Chromium network, including
proxies and TUN, without Molly site, DNS or response-IP restrictions.

If this tool is absent, assess the research capabilities actually available to
you. Report the actual access limit and the research left incomplete.
A blocked attempt does not establish completed visual research.

For a selected image, `save_image` writes supported PNG, JPEG, or GIF bytes into
the current design's `media/` through Molly. Use the returned relative path in
`design.yaml`; keep the reported page and image URLs as source information for
your response. WebP and AVIF are not accepted by the current design asset path.
Native page downloads are available separately; they do not publish design
assets or supply a saved design-relative path. Use `save_image` for that purpose.

The first release lets the user import Pinterest cookies from Chrome in Settings.
For other sites, the user can take over the built-in page to
sign in or complete MFA. When control is paused, ask the user to resume and
then observe the page again. Imported cookies may not produce a signed-in
session. A cookie count is not proof of authentication. When a login overlay
obscures the references, observe whether it can be dismissed once; do not repeatedly
scroll behind it and claim to have inspected covered work. If the user expects an
existing login, report the mismatch and let them verify the account in Molly.
Use another accessible design source for an open brief while this is unresolved;
if the user requires this specific source, keep that part explicitly blocked.
After the user signs in, inspect the page again before claiming success.

Use the normal tool permission flow when required; browser access has no
per-site authorization scope. Report access or format failures as they occur.
Website clicks and typing can change account state. Get separate user permission
for checkout, publishing, or account changes; permission to browse does not
express that intent.
