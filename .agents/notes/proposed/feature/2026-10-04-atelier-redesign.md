# Atelier: a high-end, artwork-first visual system

Status: proposed
Translation: current

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
the composer in the hero and a "Your work" gallery. Visual quality still awaits the
owner's review, and the canvas restyle could not be checked in the running app because
the display was asleep (macOS reports the window as occluded, so the canvas cannot attach).

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

## Alternatives considered

- **Keep Studio Pop and tone it down.** Rejected: the owner judged the whole direction too
  normal, not too loud.
- **Krea-style pure black, no light theme.** Rejected: Molly keeps both themes, and print
  designers judge colour on paper-like grounds.
- **A colour accent for primary actions (Krea cobalt, Framer blue).** Rejected: blue was
  rejected twice in September 2026, and an ink primary keeps the chrome out of the artwork's
  way. Vermilion stays a small signal.

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
- Home, light and dark themes and the sidebar were checked in the running dev app with real
  local data through CDP screenshots. The canvas restyle is unverified, for the reason given
  in the abstract.
