# Designer UI audit fixes (2026-10-23)

Status: implemented
Date: 2026-10-23
Translation: pending

## Abstract

An owner-requested audit of the dark-theme Molly Preview found 21 designer-facing
defects. On the main path, the home footer wrapped onto two rows, every dialog title
rendered a faux bold that Instrument Serif does not ship, canvas overlays covered
the artwork, and coding-tool vocabulary remained in tabs, logs and commands. Polish
issues covered menus, sizes, the sidebar, the archive and Settings. Fixes reuse
existing primitives and Bento's own layout hooks instead of adding new surfaces, and
keep the Spec's sidebar, tab bar, composer, Files and browser-panel structure. The
largest trade-off is that a height-bound artboard now fits about 68px smaller, so
the selection toolbar has a free strip at fitted zoom.

## Decisions

- **Composer footer.** The footer is one unwrapped row of same-style chips. The image
  model moved into the run-config menu as its last row
  ([composer note](2026-10-20-composer-provider-hierarchy.md)). Named canvas presets
  show their name; custom sizes and every dimension readout share one
  `formatCanvasDimensions` helper ("1080 × 1080", mono, tabular).
- **Dialog titles are fixed at the primitive.** `DialogTitle`, `AlertDialogTitle` and
  `SheetTitle` are regular-weight `font-editorial` at 22px. Per-dialog size and weight
  overrides were removed so every dialog speaks the Atelier voice. Settings keeps its
  30px override.
- **The AI models readiness strip was deleted.** It had a single mount and repeated
  the connection cards below it, and it listed Pinterest, which is a website account.
  Deleting it also removed the Pinterest cookie-count plumbing.
- **One segmented control.** General, Appearance and Advanced share
  `shared/segmented-control.tsx`, with a `selection`-tinted segment and roving
  arrow-key focus. The Advanced page no longer uses Radix `Tabs`.
- **Canvas.**
  - The Layers panel reserves its width on the stage. Bento refits when it opens and
    closes, and manual zoom keeps its multiple of the fit.
  - The fit's vertical margin is 66px (toolbar plus gap), or 32px for stages under
    360px tall. The least-covered fallback still applies at user zoom.
  - X/Y left the floating toolbar because the Layers panel owns geometry. W/H stay.
  - The toolbar no longer says "No versions yet". The history popover keeps its
    empty state, because history feedback must never imply autosave success.
  - Export is a tonal button, since the accent means only "selected / act here".
- **Coding-tool vocabulary.**
  - New tabs read "Untitled design" (zh 未命名作品) and carry a palette icon. The
    agent-icon fallback is no longer a robot.
  - Work-log rows map Molly MCP tool ids to labels, humanise unknown MCP names, and
    show work-folder paths as relative. The raw title and command remain available
    in the row's title and in the expanded block, so the log stays honest.
  - Command and shortcut copy says design (zh 作品) instead of conversation or session.
  - The sidebar hover card no longer adds a "Chat" row for designs without a
    project; it shows only the title and time.
- **Home.**
  - The project and machine menus open below their triggers.
  - A single-action "+" runs that action directly.
  - Starter prompts are always visible, so nothing shifts.
  - The gallery shares the composer's column.
- **Title case (#21) is Agent output, not a code bug.** The committed `design.yaml`
  title replaces the generated draft title at turn end, and `sanitizeTitle` never
  changes case.

## Verification and limits

- `pnpm check`, `pnpm format` and `pnpm run docs check` pass.
- Changed surfaces were rechecked in a rebuilt Preview in the dark theme only.
- Not checked: the light theme, first-launch onboarding, the Chinese UI and narrow
  windows.
- Browser MCP tool names use the humanised fallback rather than dedicated labels.
- Not changed: the off-ladder 10–11px type, hard-coded amber and emerald status hues
  in secondary surfaces, the agent activity text glow, the share-card gradients,
  and remaining daemon, machine and MCP copy reported by the source scan.
