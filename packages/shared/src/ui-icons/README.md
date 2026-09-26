# Molly UI icons

Editable SVGs in `svg/` are the source for the product's operation and status icons.
Volume2 and VolumeX reuse Lucide 0.525.0 geometry with the catalog's 1.5 outline;
their upstream copyright and ISC terms are retained in `LICENSE-lucide`.
They share a 24×24 grid, 1.5 outline, round endpoints and generous interior space.
Families use related geometry: file folds, rounded panels, hollow status enclosures
and segmented priority bars. Color and interaction states belong to the caller.

Run `pnpm --filter @molly/shared icons:generate` after editing SVGs. The generator
accepts only static shapes and produces tree-shakeable named nodes. `icons:check`
runs before shared tests and rejects stale output. No SVG parser runs in the app.

`@molly/shared/ui-icons` exports nodes and `renderUiIconSvg` for native Bento chrome.
The React facade is `packages/components/src/ui/icons.tsx`; its build alias also
covers the editor's inherited Lucide imports. Streamdown, Sonner and image/diff
viewers have adapters at their existing shared wrappers. Branding and content SVGs
are outside this operation icon catalog. Add new icons here and expose them through
the facade rather than embedding a separate path in a feature component.
