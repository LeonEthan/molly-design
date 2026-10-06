# Home and shortcut clarity

Status: implemented
Translation: pending

## Abstract

Phase 5 brings recent artwork higher on the home screen, puts canvas keyboard
operations first in settings, and makes designer replies proportionate to the task.

## Decisions and reuse

Reuse WebChatLandingScreen, HomeArtworkGallery, the existing composer and format
controls. Remove the hero's 74% minimum height and reduce its heading and spacing;
keep gallery navigation, thumbnail caching, draft and submission ownership intact.
No replacement gallery, session model or shortcut engine is needed.

Reuse CompactSection, CompactRow and Kbd for a fixed canvas reference ahead of the
existing configurable command catalog. Bindings were checked against Bento's
editor/editor.ts keyboard handler, canvas.ts space-pan handler and the adapted
ui/dom/mount.ts group/delete handlers. Only supported undo, redo, group, ungroup,
delete, zoom and pan are listed. Guidance names canvas focus, text fields and the
Agent read-only interval. These rows cannot capture or change a binding. Application
and OS-level commands retain their registry and conflict handling.

Chinese archive and conversation-navigation labels use 对话 consistently; English
uses conversation for the same surfaces. Projects still mean projects, artwork
still means artwork. Archive and record deletion semantics are unchanged.

The existing graphic-design skill's reply section now leads with the result and
makes further suggestions conditional. Required limitation disclosures and honest
preview/save claims remain intact. Creative stages and runtime rules are unchanged.
This is presentation refinement under the workbench Spec, whose draft intent and
status remain unchanged.

## Validation

The targeted shortcut suite passes two tests, including fixed canvas rows preceding
editable application controls. Native desktop inspection confirms the first gallery
cards appear on the home screen and canvas guidance precedes application shortcuts.
Full `pnpm check`, the Electron application build, scoped formatting and
`pnpm run docs check` pass. Chinese and English shortcut previews were inspected.
No real artwork, model request, shortcut binding or user preference was modified.
Skill response length has not been evaluated with a paid live generation; the change
is guidance, not a runtime output-length guarantee.

## CI follow-up

[PR #86](https://github.com/LeonEthan/molly-design/pull/86) exposed two stale archive
selectors in the existing Session and WorkSession Page Objects. Both now match
Archive conversation / 归档对话 through the same accessible menuitem role. Runtime
behavior, lifecycle assertions, timeouts and retry policy are unchanged.
`pnpm e2e:check`, `pnpm e2e:build` and the real Electron `pnpm e2e:smoke` pass:
three scenarios and all 18 steps, including both previously failing lifecycle paths.
