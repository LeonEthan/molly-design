# Designer batch 5: plain wording, a cleaner Archive, and a lighter locale file

Status: implemented
Translation: pending

PR: pending

## Abstract

Six cleanup items from the 2026-10-07 audit (#23, #26, #27, #28, #30, #31). All are copy, layout or documentation changes; none touches Spec intent.

## Decisions and reuse

- **Shortcuts (#23).** Command titles are plain sentence case ("Toggle focus layout", "Search commands and chats", "Switch reasoning level", "Pin or unpin current conversation"). "Reasoning" matches the model picker's label. Only titles in `locales/` changed; the English fallbacks in `built-ins.ts` are untouched.
- **Canvas shortcuts the audit asked for do not exist in Molly.** Duplicate (⌘D) and arrow nudge are early returns while the host bridge is attached, and Bento has no V/T/R tool keys, so listing them would be false. The page gains one real row, "Reset zoom ⌘0", which Bento handles and the read-only key filter lets through. Copy and paste were not verified, so they are not listed. A real ⌘0 key press on the native canvas was not exercised.
- **Archive (#26).** Reused `SessionRowArtworkThumbnail` (now takes a `className`) for a 36 px tile. Rows drop the agent icon, PR link, branch, diff counts and owner avatar, which all came from the coding product; the owner avatar was the "L" column. Project groups show the folder name and keep the path as a tooltip. The list is capped at `max-w-3xl`, and the default grouping is now "One list", matching the sidebar.
- **Settings dim (#27).** The canvas is covered by a captured frame while a dialog is open, and that frame does sit under the overlay, so the page dims as a whole. The gap the audit saw is that 25% black over a pale artboard barely reads. The overlay is now 35% (55% in dark).
- **Sidebar (#28).** The footer buttons had hard-coded English screen-reader text and no visible hint. They now show a translated tooltip (`settings.title`, new `sidebar.help`, `archive.title`). Rows cut titles early mainly because the sidebar is narrow, and the 20 px end slot is a deliberate reserve for the archive button, so it stays; the row's link now carries the full title as a hover hint.
- **Locale keys (#30).** 1,112 keys in `en.json` and `zh_CN.json` were removed. A key was kept if its full string appears anywhere in `apps`, `packages`, `e2e`, `scripts`, `specs` or `.agents` (tests and stories included), or if it matches a dynamic prefix or a template-literal pattern. The two keys `en` has that `zh_CN` lacks are plural forms Chinese does not use.
- **Fresh worktrees (#31).** The audit guessed missing patches. The cause is install order: `git worktree add` leaves the two required submodules empty, so a first `pnpm install` cannot link them and the build fails with `Cannot find module 'acp-extension-core'`. CONTRIBUTING now says to initialise the submodules first and to re-run install if the build fails that way.

## Not done

- The sidebar end-slot reserve and the stopped-row "Retry Stop" copy are unchanged.
- Hiding "New tab" from the shortcuts list: it still works in design sessions, so it stays listed.
- Keys matched only by a broad template pattern were kept even when they look dead (about 590); removing them needs a per-prefix review.

## Verification

- `pnpm check` and `pnpm run docs check` pass (the docs check still prints the unrelated stale translation for `specs/session-validation-hotfix.zh.md`).
- New tests: Archive rows show a thumbnail and title with no coding metadata and no folder path; the shortcuts list is sentence case without jargon and includes Reset zoom.
- In the app on a clone of the owner's data: the Archive page, footer tooltip and shortcuts page render as described; the Settings overlay was checked at the old 25% and then raised.
