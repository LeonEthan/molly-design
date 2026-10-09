# Website research in Molly

[The main Skill](../SKILL.md#2-inspect-references-and-research) owns the research
requirement and its explicit exception. Use this reference to perform required
research or inspect a user-specified website.

## Search from the direction

Build queries from the direction words, their synonyms and the pictures they
call up, not only from the category: for a quiet herbal brand, "apothecary
shelf", "morning steam" or "pressed botanicals" find more than "tea poster".
Choose queries that help decide composition, palette, type treatment or image
style while preserving the user's direction. Include at least one source outside
the category and outside current design feeds: historical posters, fine art,
architecture, packaging from another field. If every result looks alike, the
search is too narrow; widen it once.

Make one focused pass of a few queries, then move on to choosing. If the
results stay thin, say so in the report rather than browsing without end.

## Inspect and keep sources

Open relevant results and inspect
their actual visual content; screenshots or image reading are needed to judge
appearance. Search snippets and page text alone do not establish visual research.
Keep the actual inspected reference URLs and briefly connect the observed choices
to the design. A search-results URL alone does not identify individual references;
if those pages could not be opened, report exactly which visible results you used.
Save an image only when it is needed as a supplied asset or a prescribed
template; observation alone does not require downloading it.

## Keep a few references, each with a job

Learn from references; do not copy one. From what you inspected, keep three to
six that answer the direction words and note what each contributes, one quality
per reference:

- palette: three to five recurring colors;
- type direction: serif, grotesque, humanist or display, and why it fits;
- imagery: photograph or illustration, lighting, crop;
- texture or material;
- a layout structure.

Take the quality, not the object: a reference with a purple cube may give the
palette, not a cube. Drop anything attractive but off the direction words. Work
drawn from only one or two references reads as a blend of them: before building,
check that the chosen direction is not recognizably one source with new copy.
Found references guide your prompts and blockouts; they are never `edit` inputs.
Respect source artwork and asset permissions; being legal is not the same as
being fair to the original designer. When the user prescribes a template to
reproduce, following it is their decision.

## Browser tools

Use the `molly_browser` tools only when they are available: callable from
`codemode` scripts (find them with `searchTools`). They control the Session's
built-in browser, not Chrome; `describeNamespace("molly_browser")` gives their
mechanics (refs, re-observing, takeover, account changes). Open the relevant
site, read it with `snapshot`, and use `screenshot` when layout or image
appearance matters. A script can filter
`(await tools.mcp__molly_browser__snapshot({})).structuredContent.snapshot`
before you read it. Screenshots are for your inspection only: when the user asks
to see a reference, share its inspected source-page URL or save the image with
`save_image` and use its returned path. Include a local image in your reply only
after a successful save or file read confirms that exact path exists.

If these tools are absent, assess the research capabilities actually available to
you. Report the actual access limit and the research left incomplete.
A blocked attempt does not establish completed visual research.

Use the reported page and image URLs from `save_image` as source information
for your response, and its relative path in `design.yaml`. Native page downloads
do not publish design assets or supply a saved design-relative path.

## Sign-in

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

Report access or format failures as they occur.
