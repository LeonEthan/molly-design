# Brand and type clarity

Status: implemented
Translation: pending

## Abstract

Phase 6 refines the existing Atelier identity and makes its typography usable in
narrow content areas. The signature geometry and stored font preferences remain
unchanged.

## Decisions and reuse

MollyWordmark already supplies outlined, theme-aware signature artwork. Adjust its
existing navigation and About placements to 36px and 48px respectively rather than
introducing another logo. The existing Inter and Instrument Serif font assets,
Atelier tokens, CompactRow, HomeIdeaChips and CanvasFormatTiles cover this change;
no new font, asset, theme or visual runtime abstraction is needed.

Prompt starter buttons use 13px interface text rather than italic display type.
Format labels use 13px and their dimensions use 12px full muted text. Settings rows
use 13px labels with 12px vertical padding. Static format selection retains the
existing pressed state and ink border, with an ink dot; the decorative signal dot
is removed from the home eyebrow. Runtime status indicators are untouched.

A 360px-wide specimen exposed viewport-relative heading and padding growing with
the surrounding window instead of available content. Reuse CSS container sizing
on the landing root: heading size and horizontal inset now follow that container.
The actual controls, preset state, keyboard behavior and submit flow are unchanged.

The existing workbench Spec remains draft; this implements its near-monochrome
chrome and display-versus-interface typography rather than changing product intent.
Personal font settings are preserved. Visual quality remains the owner's judgment.

## Validation

The existing canvas-size and interface-font suites pass 12 tests. The shared
component typecheck passes. Storybook uses synthetic composer state and the actual
landing, wordmark, prompt, size and compact-layout components; it is a visual
specimen, not a full end-to-end application session. Its font baseline is scoped
to the story and does not write a saved preference. Keyboard Enter on a format tile
updates both the pressed tile and the existing size selector.

Final Electron build, component typecheck, scoped formatting and docs checks pass.
Native desktop home and About were inspected with the user's existing custom font
preserved. Default Inter specimens cover English light/dark and Chinese light/dark
at 360px content width. Computed heading type is Instrument Serif with the existing
Chinese serif fallbacks; controls resolve to Inter with the existing sans fallbacks.
Measured dimension-label contrast is 4.78:1 on light and 9.22:1 on dark. These are
specific colour-pair checks, not a claim of whole-application accessibility conformance.
No image generation, new dependency, saved preference change or publication occurred.
