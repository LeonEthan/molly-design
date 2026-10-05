# Atelier: a high-end, artwork-first visual system

Status: proposed
Translation: current

PR: [#82](https://github.com/LeonEthan/molly-design/pull/82)

[中文](2026-10-04-atelier-redesign.zh.md)

## Abstract

On 2026-10-04 the owner asked for a complete UI/UX redesign that makes designers want
to try Molly, and delegated the design decisions. A first pass ("Studio Pop": a violet
accent, a bold grotesk, a gradient aurora and candy-coloured format tiles) was rejected
the same day as "too normal", with a request to research high-end interfaces first.
The adopted direction, Atelier, follows what premium creative tools share: the artwork
supplies the colour, the chrome stays near-monochrome with hairline rules and tonal
depth, display type is a regular-weight editorial serif, and one vermilion signal marks
only focus and live or changed state. The home page becomes an editorial launchpad with
the composer in the hero and a "Your work" gallery, and the first-launch guide adopts the
same type and paper. Visual quality still awaits the owner's review; the canvas was checked
in dark mode only.

## Problem

After the 2026-10-02 [designer UI upgrade](2026-10-02-designer-ui-upgrade.md) removed the
coding-tool feel, the app was tidy but lifeless: grey grounds, black Inter, outlined
format boxes and no motion. The owner's interview answers named four problems: too plain,
not made for designers, static, and the wrong layout and flow. The reference was Lovart.

## Research

- [Krea](https://www.webdesignhot.com/design.md/krea/): a pure-black stage, regular-weight
  display type (never bold), 8% white hairlines, depth from tone rather than shadow, one
  accent kept for the call to action, and an explicit "no gradients, meshes or glow" rule.
- [Framer](https://www.webdesignhot.com/design.md/framer/): black on white, theatrical
  pacing, gradients only as atmosphere and never on actions.
- Editorial trend surveys ([daisyUI](https://trends.daisyui.com/editorial-art-inspired-ui/),
  [Superdesign](https://superdesign.dev/library/tech-editorial)): large serif display
  against small, quiet supporting text, captions, numbering and grid rules.

The rejected first pass did the opposite on every point: hue everywhere, glow and gradients,
and bold display type. That explains why it read as a generic AI-startup template.

## Decision

- **Palette.** The Molly Light and Dark VS Code themes are repainted: a bone-paper ground
  (`#f2efe8`) with warm-white panels, or a near-black ground (`#0b0b0c`) with tonal steps;
  warm ink text; primary actions as the ink inversion; tonal selection. One vermilion
  (`#e8461e` light, `#ff5a2e` dark) is reserved for the focus ring, the active-tab accent
  and the `--signal` token used for live or changed state. The theme contract test asserts
  these channels and roles.
- **Type.** Instrument Serif (OFL, self-hosted through Fontsource) is the display face via
  `font-editorial`, with Songti/Noto Serif SC for Chinese. Inter stays the reading and chrome
  face. Uppercase mono `eyebrow` labels and mono dimensions supply the catalogue detail.
- **Home.** A mono eyebrow with a slow-pulsing signal dot, a large serif heading with one
  italic word ("What shall we _make_ today?"), a one-line promise, the composer in the hero,
  one line of italic prompt starters (they fill the composer and never submit), hairline
  format outlines with pixel dimensions, and a masonry "Your work" gallery of recent artworks
  with mono dates. The gallery reuses the sidebar thumbnail cache; its short edge rises from
  48 px to 560 px, the cache moves to `design-thumbnails-560`, and the retired 48 px cache
  directory is deleted on the first write. Elements enter with a short blur-and-rise reveal;
  under reduced motion they only fade.
- **Canvas and session.** The canvas toolbar shows its status as a mono eyebrow with a signal
  dot when there are unsaved changes, and Export becomes an ink pill. Inside the canvas, the
  Molly-owned injected CSS overrides Bento's palette variables: a light-table ground one step
  off the shell, hairline dock, zoom bar and save pill, and a soft cast shadow under the
  artwork. The vendored Bento tree is untouched.
- **Sidebar.** Section labels use the mono eyebrow style.
- **First-launch guide.** The three opening scenes keep their artwork and paper colour
  (#fafaf7; the collages were painted on it, so a warmer ground exposes their edges), but
  headings move from Georgia to the shared serif display, every subtitle uses the same
  sans style, and the ink matches the app. The setup steps replace the cool blue-grey
  grid with warm paper and a faint dot grid, set step titles in the serif display under a
  mono "Molly · Setup" eyebrow with the signal dot, use warm ink, and show the setup
  artwork at full strength. The project and first-task steps could not be reached in the
  dev build without a working built-in agent, so they are unverified.

## Alternatives considered

- **Keep Studio Pop and tone it down.** Rejected: the owner judged the whole direction too
  normal, not too loud.
- **Krea-style pure black, no light theme.** Rejected: Molly keeps both themes, and print
  designers judge colour on paper-like grounds.
- **A colour accent for primary actions (Krea cobalt, Framer blue).** Rejected: blue was
  rejected twice in September 2026, and an ink primary keeps the chrome out of the artwork's
  way. Vermilion stays a small signal.

## Review corrections (2026-10-05)

PR #82 identified two interaction regressions. The hero's scroll viewport had
stopped reserving space for an overlaying native keyboard. It now reuses the
existing session-composer shell's keyboard-height margin and adjusted bottom
safe-area padding. Reusing that shell keeps one implementation of the inset
behavior; replacing it with new keyboard state or restoring the old docked
layout was unnecessary.

The canvas-entry marker also survived a visit to a non-design session, so returning
to the previous design could restore its closed panel instead of opening the
canvas. The existing render-phase session-switch reset now clears the marker.
Ordinary rerenders still preserve the user's panel choice; there is no new
session-id effect or persisted entry state.

The 24 focused landing/layout/initial-state tests and the local desktop build
passed. An isolated built-Electron probe seeded synthetic design A and non-design
B, closed A's right panel, navigated A → B → A, and observed the canvas panel open
again; a subsequent close remained closed after a resize and a session-title
update. At a 390 × 844 viewport with a simulated 350px keyboard inset, the scroll
viewport ended at y=494 and the
focused prompt ended at y=382.57; the Send button also remained above the keyboard.
The first probe selected the navigation-sidebar toggle because both controls
shared a label; the corrected
probe targeted the right-panel toggle and passed. No user profile was used.

Read-only Codex CLI review (`gpt-6-astra`, high reasoning) found no concrete P0/P1
in these two fixes. It was source review; its additional review tools were
unavailable. Desktop geometry does not establish native iOS keyboard delivery,
focus scrolling, or nonzero `env(safe-area-inset-bottom)` behavior.

## Not done yet

- **Conversation on the right (Lovart-style).** Approved in the plan but not built. It
  touches the traffic-light offset, tab focus regions and panel collapse invariants in
  `desktop-session-detail-layout.tsx`, and deserves its own change.
- **Conversation styling.** The shared conversation components only inherit the new tokens.
- **Selection handles.** These keep their colour until real composite screenshots of every
  element kind in both themes can be taken, as the design-bento rules require.

## Verification

- `pnpm lint:i18n`, `pnpm lint` (0 errors), and typechecks for `@molly/components` and
  `@molly/electron` pass. The `@molly/components` test suite passes after updating the theme
  contract, the ThemeProvider dark-ground expectation and the dark sidebar-border contrast.
- The model-setup and summary steps and all three opening scenes were checked in the
  running app; onboarding tests (7 files) pass.
- Home, light and dark themes and the sidebar were checked in the running dev app with real
  local data through CDP screenshots. The canvas was checked in dark mode through a window
  capture: near-black light table, hairline dock with an ink active tool, mono save pill,
  and the floating text-selection toolbar. The canvas in light mode is unverified.
