# Designer batch 3: restore points, one design list, names, layers and print sizes

Status: implemented
Translation: pending

## Abstract

The 2026-10-07 audit found that designers could not get back to how a design looked before an AI edit, saw coding-style Projects/Chats sections and raw-prompt names, and had no layer list, precise properties or print sizes. With the owner's approval, each Agent turn now records a "Before Molly's edit" version in the existing Git history; the sidebar defaults to one design list; and new designs start as "Untitled design" until Molly names them. A native Layers panel, built on the existing validated command channel, adds stacking order, position, size, rotation, opacity and text spacing, and the size picker gains print sheets. Layers cannot be hidden or locked, because the document format has no such fields, and print sizes are pixel presets without bleed. The Spec records the revision and stays `draft`.

## Decisions and reuse

### Restore point before each Agent turn (#6)

- **Reused:**
  - The artwork's Molly-managed Git history and its `append` path.
  - The reachability check that "before-restore" protection already uses.
- **New:** a third entry kind, `before-agent`.
- **When it is recorded.** `materializeDesignTurnInput` gains an `onFrozen` callback, which fires once the turn input is durable and never on re-dispatch.
- **What is recorded.** The callback records the exact frozen baseline.
  - Because the entry comes from the frozen baseline, it doesn't race the turn's later commit.
  - It is written in the background, so the prompt hot path isn't held up by Git.
- **When it is skipped:**
  - Blank canvases are skipped, so a new design doesn't start with a blank restore point.
  - Content that history already holds is skipped.
- **What stays unchanged:**
  - The entry doesn't move the selected base, so "Based on V1 · has changes" stays accurate.
  - Failure is logged and never blocks the turn.
- **Rejected:**
  - An "Undo this change" button on each reply. It needs the same snapshot plus cross-row UI.
  - A parallel snapshot store. Git is the only history backend.

### One design list (#13)

- **Reused:** the sidebar's existing Updated mode, which is already one flat list.
- **Changes:**
  - Updated mode becomes the default.
  - The organize options are renamed "All designs" / "By project".
  - "Chats" headings and the Archive group become "Designs".
  - Project-picker wording is now "Choose a project", "No project" and "Add a project folder".
- **Fixed in passing:** the Updated list's heading had never been translated, because `loro-app-sidebar` didn't pass its labels.
- **Preferences:** an explicitly saved organize mode is kept.
- **Spec:** the Spec never described the sidebar sections, so the revision only records the new default.

### Names (#14)

- **Cause.** Built-in Molly sessions run no title model. A design is renamed only when Molly commits a `design.yaml` `title`, and the skill already asks for one.
  - Until then, the home page used the prompt as the draft title.
  - Stopped or failed first turns therefore kept raw prompts.
- **Fix.** The draft title is now the artwork's existing default name, "Untitled design".
- **Unchanged:**
  - The commit-time rename and user renames.
  - Existing sessions with prompt titles are not migrated. Their provenance is ambiguous, because `draft` also marks meaningful names such as save-as copies.

### Layers and properties panel (#10)

- **Rejected first: reusing Bento's built-in property panel.**
  - It is the presentation editor's panel, with Slideshow, Morph, Presenting and Speaker-notes sections.
  - It edits the native view document, which Molly's `a1a2-native-mutation-seal` patch rejects.
- **Rejected next: the floating selection toolbar.** It is already dense, and it has no list of elements.
- **Built:** a Molly adapter, `packages/design-bento/src/layers-panel.ts`, opened from a new Layers dock button.
  - It lists elements top-most first and selects them, with Shift/⌘ to add or remove.
  - It edits position, size, rotation, opacity, text line height and letter spacing, and arrangement.
- **Commands.** Edits use the existing validated toolbar endpoint and selection epoch.
  - New protocol entries: a `transform` verb, an `arrange` verb, and `lineHeight` / `letterSpacing` on `text-style`.
  - The builder adapts the assembled `boot.ts`, using anchored replacements that fail the build if upstream changes. The adaptation executes these with the kernel's existing `setRotation`, `setStyle`, `setText` and `setZOrder`, where array order is stacking order.
  - No vendored file changes.
- **Edit ordering.** The panel queues its commands. Each command is built only after the previous one has applied, from the element's current bounds, and keeps the selection epoch from when the edit was made.
  - Without this, editing X then Y restored the old X.
  - A queued edit could also land on a newly selected element.
  - Both were found by the read-only Codex review and are now covered by tests.
- **Not possible:** BentoDoc has no hidden or locked field, so the panel cannot hide or lock layers. Adding those would change the document format.

### Print sizes (#12)

- **Where.** The size chip's popover gains a Print group:
  - A4, A5 and US Letter at 300 DPI.
  - A3 at 240 DPI, because 300 DPI would exceed the 4096 px canvas limit. The earlier proposal of 250 DPI was also over the limit.
  - A 90 × 54 mm business card.
- **How sizes are stored.** Sizes are plain pixel presets. There is no DPI metadata, millimetre unit or bleed.
- **Home tiles.** They keep the screen formats only, so the home page doesn't get crowded.

## Verification

- **Automated:**
  - New tests cover the `before-agent` entry (skipped for blank canvases, recorded once, base unchanged, later saves still work) and the once-only `onFrozen` callback.
  - New panel tests cover stacking order, selection, epoch-bound commands, range checks and the read-only state.
  - The dock test now treats Layers as a view toggle that stays enabled while read-only.
  - CLI history and turn-input suites, the canvas suites, component typecheck, i18n lint and the canvas build (`tsc -b`) pass.
- **In the rebuilt app, against an APFS clone of the owner's data:**
  - The sidebar shows one "Designs" list by default.
  - The size popover lists the print group, with US Letter shown as 8.5 × 11 in.
  - On the Urban Bloom poster, the Layers dock button opened the panel with all eight elements, top-most first. Clicking "URBAN BLOOM" selected the `wordmark` element.
  - Rotation 5°, opacity 60%, letter spacing 4 and line height 1.1 applied through the real toolbar endpoint, and "Send backward" moved the element one step down.
  - Autosave reported saved, the `design.yaml` projection kept all four fields, and the values survived an app restart.
  - The panel was checked in both canvas themes. Row alignment was fixed after the first screenshot, because shared toolbar button styles had centred the rows.
- **Testing gotcha.** An earlier attempt failed because the screen was locked. Chromium doesn't render the hidden canvas view while the screen is locked, so no canvas attached, and a `main` build failed identically.
- **Not verified:**
  - No Agent turn or paid request was made, so the "Before Molly's edit" entry and its History label were not observed in the app.
  - The Chinese UI and multi-element arrange were not exercised in the app.
