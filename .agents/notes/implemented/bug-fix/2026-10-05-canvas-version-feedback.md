# Canvas version feedback

Status: implemented
Translation: pending

## Abstract

An artwork with no versions opened an empty history menu, while an unversioned-change
signal appeared beside the canvas's independent saved status. Phase 1 distinguishes
history loading, empty and failed reads and describes version state with words.
Bento remains responsible for reporting actual autosave results. Native canvas
occlusion while menus are open was left for [phase 2](2026-10-05-canvas-overlay-continuity.md).

## Decision and reuse

Reuse DesignCanvas's version/state reads and request generation fence, the shared
menu primitives and Bento's existing save-status labels. A small presentational
feedback component allows the real loading, empty and error states to be used in
Storybook. Failed reads offer manual retry; stale failures cannot replace newer
results. Saving a version retains the existing execution and processing gates.

The shell says No saved version, Vn, or Vn with changes not versioned; it never
infers autosave success from the version comparison. The English Bento success
label now says Autosaved, matching the existing Chinese label. Save version text
appears at a 520px toolbar container width, keeping the compact icon below that.
Navigation sidebar and right-panel controls have distinct accessible names.

A new save-state store or protocol was unnecessary: the editor already owns real
save status and the shell owns versions. Removing native-view occlusion was not
part of this change because it protects shell menus from rendering behind Bento.

## Verification

Component regressions exercise deferred loading, empty history, failure and retry,
failed version saves, unchanged versions and execution locks. Existing receipt and
attachment-error checks remain in place. The components suite passed 412 files and
3,155 tests; component typechecking, scoped lint, translation-key validation and
documentation checks passed. Browser inspection confirmed loading, empty and
failure states using the production feedback component in Storybook.

A read-only Codex CLI review with gpt-6-astra at high reasoning found no P0/P1
issues. Its attempted nested review was blocked by its sandbox. Full native
desktop layout, including the responsive toolbar, has not been visually validated.
No commit or publication was performed.
