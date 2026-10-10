# Molly canvas startup and dock clearance

Status: implemented
Translation: pending

## Abstract

The canvas still painted Bento's startup brand, and fitting a tall artwork to the
entire viewport placed its lower edge beneath the floating dock. Assembly now
embeds the existing Molly wordmarks in a small themed startup screen. The product
scroll viewport reserves the dock's occupied bottom area, allowing native fit to
keep its usual 32px margin above the controls. Isolated Electron resource checks
passed; a packaged full-desktop startup was not exercised.

## Decision and reuse

The React `MollyWordmark` cannot mount before the isolated editor bundle starts;
its existing light/dark SVG assets are embedded directly instead. The builder
replaces the upstream splash only in its temporary checkout and redirects the
existing dismissal hooks. License notices and pinned source bytes are retained.

Reuse the existing `.ed-scroll` viewport and Bento `zoomReset`/centering described
in the [fit record](2026-09-19-canvas-fit-and-requested-size.zh.md). The dock height
and bottom offset are shared CSS variables, including the existing 640px layout
breakpoint. A custom camera offset or duplicated fit calculation was unnecessary.
Shrinking the scrolling area also keeps manually zoomed artwork clear of the dock.
Artwork geometry, persistence and export dimensions are not changed.

## Verification and limits

- Built the assembled resources, including their TypeScript check; resource hash
  and license verification passed.
- A temporary Playwright/Electron 39.5.1 probe used synthetic documents and an
  isolated profile. Holding the workspace response exposed the Molly splash in
  both themes; releasing it removed the splash at readiness.
- Native geometry checks covered portrait, landscape, square, long artwork,
  600px-wide and 420px-wide windows in both themes. Restoring the original viewport
  CSS reproduced 38px overlap; the corrected layout retained at least 32px clearance.
- Native screenshots included text, shape, image, line, icon, table and chart
  elements in both themes. Manual zoom and fit preserved canonical snapshots.
- The seven existing Electron viewport tests passed. The probe covered assembled
  canvas resources, not the full shell, installed packaging or Agent execution.
- Separate standards/spec reviews and the read-only Codex CLI second opinion
  (`gpt-6-astra`, high reasoning) found no P0/P1 issues. Before local integration,
  `pnpm check`, `pnpm format` and `pnpm run docs check` passed.
