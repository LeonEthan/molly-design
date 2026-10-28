# Website research in Molly

[The design-research Skill](../SKILL.md) owns the research requirement, its
exception and the gate that must hold before design options.
Use this reference for the technique of required research or of inspecting a
user-specified website.

## Search from the direction

Build queries from the direction words, their synonyms and the pictures they
call up, not only from the category: for a quiet herbal brand, "apothecary
shelf", "morning steam" or "pressed botanicals" find more than "tea poster".
Choose queries that help decide composition, palette, type treatment or image
style while preserving the user's direction. One of the three searches may look outside the category (historical posters, fine art, architecture, packaging from another field) on the same site. If every result looks alike, use a remaining search to widen once.

The research budget in the design-research Skill's gate (one site, three searches of two to four screens each, three saved picks) is the ceiling, not a target. Scroll before judging a search, and follow a promising thread with the next search rather than starting over. If the results stay thin, take the gate's shortfall exit.

Keep research shallow: one site, the searches you planned, the results you
opened. Do not crawl a site's structure — sitemaps, category or tag listings,
API endpoints — to map what exists; the gate needs inspected images, not a map
of the site. A search that returned nothing useful is evidence to widen or stop,
not to dig into the site's machinery. Write no scripts that fetch or crawl pages; read the site through the browser tools only.

## Survey a search in one script

Run each search as one `codemode` script that looks at several screens, so
scrolling is part of the search, not a later step:

    await tools.mcp__molly_browser__navigate({ url: '<the site search URL for this query>' });
    for (let screen = 0; screen < 3; screen++) {
      const shot = await tools.mcp__molly_browser__screenshot({});
      for (const block of shot.content) if (block.type === 'image') image(block);
      await tools.mcp__molly_browser__scroll({ deltaY: 900 });
    }

If the site has no search URL, type the query into its search box first in the
same script. If it has no working search, open one tag, mood, category or
designer page that fits the direction words instead; that page is the search.
Viewing one such page is not crawling the site. Judge the screens together; if
the last one still shows new results and none has two clear candidates, run one
more screen. Then scroll back
to the screen you pick from and take one `snapshot` for image refs. Choose the
next search from what these screens show: a strong thumbnail's designer, style
or term.

## Inspect and keep sources

Judge results from the grid screenshot first and look at picks through their saved files; the gate says what counts as inspection. Judge thumbnails for layout structure first, then palette and type. Open a detail page only when a thumbnail leaves a real doubt. A directly opened
and inspected image can provide evidence even when its source page is
unavailable. Report that provenance gap and follow the `graphic-design` skill's
Reporting section for inspected URLs and confirmed saved paths.
Briefly connect the observed choices to the design.
Save the inspiration images the gate requires, plus any supplied asset or
prescribed template, using the gate's persistence rule; observation alone does
not require downloading the rest.

## Keep a few references, each with a job

Learn from references; do not copy one. From what you inspected, keep those that
answer the direction words, as many as the gate requires, and note what each
contributes, one quality per reference:

- palette: three to five recurring colors;
- type direction: serif, grotesque, humanist or display, and why it fits;
- imagery: photograph or illustration, lighting, crop;
- texture or material;
- a layout structure.

Take the quality, not the object: a reference with a purple cube may give the
palette, not a cube. Drop anything attractive but off the direction words. Work
drawn from only one or two references reads as a blend of them: before building,
check that the chosen direction is not recognizably one source with new copy.
A saved inspiration image can be an `edit` input for a design option, with the
prompt naming the quality it lends and forbidding its objects, text and logos
(the recipe in [design-options.md](design-options.md)).
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
sign in or complete MFA. Only the exact tool errors
`The user has taken control of the browser page.` or
`The user has taken control of this browser page.` mean control is paused:
then ask the user to press "Resume Agent" in the session browser panel
and observe the page again afterward. For stale element refs or navigation
timeouts, re-observe the current page with `snapshot` before continuing. Use
fresh refs from that observation; retry only when the observed state confirms
the intended effect did not occur. Never replay mutating actions (click submit,
type, form post, etc.) whose outcome is uncertain; observe first. For a pending
WebMCP call, read its result before deciding what to do next. If recovery remains
blocked, quote the exact error text and report the access limit. Only the exact
takeover errors above mean waiting for the user to resume control.

Imported cookies may not produce a signed-in
session. A cookie count is not proof of authentication. When a login overlay
obscures the references, observe whether it can be dismissed once; do not repeatedly
scroll behind it and claim to have inspected covered work. If the user expects an
existing login, report the mismatch and let them verify the account in Molly.
Use another accessible design source for an open brief while this is unresolved;
if the user requires this specific source, keep that part explicitly blocked.
After the user signs in, inspect the page again before claiming success.

Report access or format failures as they occur.
