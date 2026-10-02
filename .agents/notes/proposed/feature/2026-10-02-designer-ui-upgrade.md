# Designer UI upgrade: from coding workbench to design tool

Status: proposed
Translation: pending

## Abstract

A 2026-10-02 review of the running desktop app found that Molly still reads as the
coding workbench it was forked from. Developer words and concepts appear before
anything else (“Let's ship something”, a machine chip, code-only line counts, a
Daemon row), the canvas gets about half the window, and Agent replies read like
engineering reports. The owner set the order: remove the coding-tool feel first,
then refine the look. The colour freeze is lifted in favour of a restrained, elegant
direction, and reopening sidebar thumbnails or an artwork-centred home is approved.
Phase 1 is subtractive (copy, visibility and canvas localisation) and changes no Spec
intent. Later phases remain proposals, and visual quality still awaits human review.

## Evidence from the review

The review used the built app from `main` at `3ce3f1fd` on real local data
(2482 px window, light theme). Observations:

- Home: heading “Let's ship something”, “New chat”, “Local Projects”, a machine chip
  showing the host name with a “Local” badge, and a “Select a project” chip.
- Composer placeholder “Press '@' for mentions, '$' for skills.”
- Settings: “Show code-only line changes (exclude docs, tests, dev files)”, Queue/Steer
  wording, Daemon Restart/Terminate next to everyday preferences, and Personal-memory
  text and button rendered outside the card padding.
- Session hover card showing the local host name.
- Canvas: a hardcoded Chinese save status (“已自动保存”) inside an English UI, and
  bilingual “中文 / English” dock tooltips and read-only reasons.
- Layout: three columns (sidebar, chat, canvas); the canvas gets roughly half the width
  although the [Spec](../../../../specs/graphic-design-platform.md#workbench-and-boundaries)
  asks for “a larger canvas”. The canvas panel also carries editor tab chrome.
- Conversation: the Agent's final reply lists YAML paths, PNG filenames and tool names,
  and the first-turn size instruction appears as a second user bubble.
- Sidebar rows such as “Design a modern, minimal…” cannot be told apart.

## Owner decisions (2026-10-02)

1. The main dissatisfaction is “feels like a coding tool”. Phases 1–3 go first.
2. Colour is no longer restricted, but the result must be more restrained and elegant.
   This lifts the colour freeze of the
   [monochrome chrome record](2026-09-16-monochrome-chrome-visual-refresh.zh.md);
   the decision not to refresh the shadcn base stays.
3. Reopening sidebar artwork thumbnails or an artwork-centred home is approved. It
   changes Spec intent, so that Spec revision returns to `draft` when written.
4. Phase 1 may start, delivered as a draft PR with before/after screenshots.

Earlier rejections still apply: ask what is wrong before proposing a new visual for
the start page or welcome sequence, and validate in the real app rather than with
static mock-ups.

## Phased plan

| Phase                    | Scope                                                                                                                                  | Reuse ladder                                                                                    | Spec impact                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------- |
| 1. Speak designer        | Copy, hiding single-choice and coding-only controls, Advanced section, canvas localisation, size instruction shown as a chip            | Existing locale keys, `githubIntegration` capability, toolbar presentation labels, menu locale | None                              |
| 2. Canvas-first layout   | Default canvas around 65–70% of the width, remove single-surface tab chrome, merge the two current-artwork indicators                    | Existing split layout, adaptive tab strip, focus mode                                          | Implements the existing intent    |
| 3. Agent as partner      | Skill-level reply style (direction, editable parts, next tweaks; technical detail folded) and design-aware auto-naming                 | Product skill and the existing auto-naming prompt                                              | Skills only                       |
| 4. Type and spacing      | One display size, quieter metadata, consistent spacing, a restrained accent; dark-mode audit                                            | Existing radius and size tokens                                                                | None                              |
| 5. Navigation and home   | Sidebar thumbnails and/or a recent-artworks home; start-page redesign after a dissatisfaction interview                                | Existing session list and the canvas renderer's preview image                                  | Changes intent; Spec back to draft |

## Phase 1 implementation

- **Copy:** the home headings ask what to design, “New chat” becomes “New design”,
  “Local Projects” becomes “Projects”, and composer placeholders lead with
  “Describe a design or a change”. Chinese copy follows, but keeps its existing headings.
- **Machine chip:** `DesktopMachineMenu` hides itself when the selected local machine is
  the only choice. Remote-only and multi-machine cases keep the menu. Sidebar hover cards
  drop the host name for sessions on this computer.
- **Settings:** the code-only line toggle is shown only with the existing
  `githubIntegration` capability, as Auto-archive already is. The queue setting is
  reworded. Daemon becomes “Background service” in a new Advanced section. Prevent sleep
  gains a helper line, and the Personal-memory body now sits inside the card padding.
- **Canvas localisation:** the Bento page keys its status, dock and shape copy to
  `design.*` locale entries. These arrive with the existing toolbar-presentation labels
  (`DESIGN_CANVAS_LABEL_KEYS`), with English fallbacks until then. Electron translates
  read-only reasons and the unsaved-canvas dialog through `translateUi`, which reuses the
  menu's locale state after extraction into `ui-locale.ts`. `DesignCanvasAccess` now
  reports a reason kind instead of display text, so its Node-tested core stays free of
  locale files.
- **Size instruction:** the durable first-turn text block is unchanged, as the Spec
  requires. The conversation renders a block that matches any shipped
  `design.requestedSize` template as a small “Canvas W × H px” chip, keeping the full
  instruction in its tooltip. Other text stays a normal bubble.

Alternatives considered:

- Passing a `lang` query parameter to the canvas page was rejected because the
  presentation-label channel already carries translated strings.
- A new input-block type for the size instruction was rejected because it would change
  the durable session contract.

## Phase 2 implementation

Phase 1 merged as PR #62; the owner then authorised phase 2.

- **Canvas-first split:** design sessions size the conversation for a 460px reading
  width, clamped to 22–40% of the window. On the review window (2482px) the canvas
  gets 78% instead of 60%. The split is saved under a new layout id, so saved splits
  from the old 40/60 default are reset once. The alternative of keeping the old id
  would have left every existing user on the old proportion.
- **One chrome row:** when the canvas is the only side-panel tab, the tab strip is
  replaced by the canvas action row. `DesignCanvas` portals its toolbar into a host
  element lent by the side-panel tab bar (`soloPanelContent`), so version, save and
  export state stay in the canvas instead of being lifted into the session shell.
  The add-panel and hide-panel controls stay in the row; opening another panel
  restores the tab strip. Review of PR #63 found that at narrow panels (365px in a
  900px window, down to the 280px minimum) the non-wrapping merged row pushed canvas
  actions under the add/hide controls. The merge now needs 440px of row content,
  which the full English row (about 436px) fits; narrower panels keep the tab strip
  and the canvas's own wrapping row. A responsive compact row was not built because
  even icon-only actions plus the panel controls do not fit at 280px.
- **One artwork indicator:** the conversation header shows “Show artwork” only while
  the canvas is hidden. The canvas status now says “Current artwork” before a first
  version, matching the Spec's wording.
- **Focus canvas hides the sidebar too:** after reviewing the narrower conversation,
  the owner chose full collapse over an icon-only rail. Session rows are text-only, so
  an icon rail would show identical icons until phase 5 thumbnails exist. Focus now
  sets the transient `designCanvasFocusAtom`, which hides the navigation sidebar the way
  Zen does without writing the saved collapse preference. Leaving focus, switching
  away from the canvas, or explicitly showing the sidebar (button or shortcut) restores
  it. While leftmost, the canvas row reserves the macOS traffic-light inset and leads
  with the existing show-sidebar button. The
  rejected alternatives were writing `sidebarCollapsedAtom`, which would persist a
  transient state and override the user's own choice, and reusing Zen, which also
  hides the side panel that holds the canvas.

Verification for phase 2: unit tests cover the size clamp and the solo-panel slot.
In the real app (2482px window) the canvas attached at 95% zoom (91% before) under one
row of chrome. Focus mode hid the conversation and re-centred the canvas. Opening Files
from the + menu brought the tab strip and the “Show artwork” header button back, and
closing it restored the single row. A first attempt failed to attach the canvas while the
window was reported fully covered; an unchanged `main` build failed the same way then, so
that failure was environmental. Live Agent construction in focus mode was not exercised. After the sidebar change, focus
gave the canvas the full window width with the sidebar collapsed or not, and both the
minimise button and the show-sidebar button restored the previous layout. The focused
row sits about 7pt lower than the traffic lights because the canvas card keeps its top margin.
The + menu still offers the code-diff “All Changes” panel; that belongs to a later
subtraction pass.

## Phase 3 implementation

Phase 2 merged as PR #63; the owner then authorised phase 3.

- **Reply style:** the graphic-design Skill now ends with “Reply to the designer”:
  direction first, then what can be edited on the canvas, two or three next tweaks,
  and limits only when there are any. File paths, YAML fields, element IDs, tool and
  script names and diagnostic codes stay out of the reply unless the user asks or a
  limit needs them. The honesty rules are unchanged: previews are Agent review, and
  the turn does not claim the save that Molly's collection performs afterwards.
- **Design-aware naming:** built-in Molly names a session after the first sentence of
  the prompt, which is why sidebar rows such as “Design a modern, minimal…” look alike.
  The Skill now asks the Agent to name the artwork in the existing `design.yaml`
  `title` (two to five words, subject and format). When collection commits that
  artwork, the daemon passes the title through the existing title sanitiser and
  `setTitleIfSourceIn` guard, so draft and generated names follow the artwork and a
  user rename always stays.
- **Reuse ladder:** the existing `title` field, the existing commit result and the
  existing title guard carry the name; no storage, protocol or tool was added. Running
  the existing title prompt for Molly was rejected because it adds a second model
  request per session, which the embedded-harness decision avoided. Having the
  harness push `session_info_update` was rejected because the Agent would need a new
  naming tool. The plan table expected skills-only work; the naming needed this small
  daemon hook, which changes no Spec intent because the Spec only promises
  auto-naming.

## Phase 4 implementation

Phase 3 merged as PR #64; the owner then authorised phase 4. An audit of the built app
(2482px window, light and dark, Inter forced in memory because the local profile had
picked Chalkboard as interface font) found seven text sizes in one session view
(16, 14, 13, 12.5, 12, 11.9 and 11px), sidebar conversation rows at 14px beside 13px
project and section rows, and a leftover sky-blue on file links as the only hue.

- **Accent:** the owner compared current blue, monochrome, umber and deep green in the
  real app and chose monochrome. File links now match web links: ink with a muted
  underline. Primary, ring and toggles stay near-black, so no colour tokens change.
- **Type ladder:** sidebar conversation rows move to 13px, matching project rows and
  chrome. Activity headers and steps (“Worked for…”) move from 12.5px medium to 12px
  regular, and message timestamps from 11px to 12px, giving one quiet metadata size.
  The home heading is the only display size in the app; the onboarding heading keeps
  its responsive size from the earlier onboarding decision, and the composer `title`
  prop is only used by stories.
- **Dark mode:** row and footer dimming in dark mode is a deliberate recede, and the
  owner kept it. No other light/dark mismatch was found on the audited surfaces.
- **Spacing:** no inconsistency worth a change was found on the audited surfaces, so
  none was invented.

Remaining 11px text includes the context-usage ring label and many secondary
surfaces (172 occurrences); they were not swept because they sit outside the audited
designer path.

## Verification and limits

- Unit tests cover the machine-menu visibility rule, size-instruction parsing in both
  locales, canvas relabelling after presentation, and the contract that every canvas
  copy key is delivered and exists in both locales. The design-canvas sync core still
  passes under Node.
- Before and after screenshots of the real app were captured locally. They are not
  committed because they show local session content. Visual quality and copy tone are a
  human judgement and are not yet accepted.
- Limits: a canvas opened only as a read-only source preview gets no toolbar
  presentation, so its dock tooltips stay English. Size instructions written by a
  language later removed from the bundle would fall back to a plain bubble.
