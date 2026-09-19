# Design renderer resources

Root repository rules apply. `CLAUDE.md` links here; edit `AGENTS.md` only.
Read [README.md](README.md) and preserve pinned vendor/submodule bytes and provenance.

The builder assembles local adaptations in a temporary checkout. Product defaults
are rendering decisions: omitted canonical fields stay omitted. The isolated
canvas must bundle its own licensed Inter font faces; fonts loaded by the React
shell do not cross WebContents boundaries. Preview and export consume the same
assembled resources and wait for fonts and images. Record font identity and hashes
in `build.json`, include its license, and verify actual font loading in the native
design acceptance probe after changing font assembly.

Selection controls and their popups live in the native canvas, outside the zoom
transform. Geometry stays local; commands and reference actions use the bounded,
host-bound toolbar endpoint and selection epoch. Keep readonly, hidden-view and
stale-selection checks on the receiving path. Test visual changes with real
Electron composite screenshots for each supported element kind in both themes.

The generic viewport API reports screen scale and canvas-coordinate center. It
contains no Agent or version lifecycle; Electron preserves camera state when
replacing isolated renderers. Adapt only the assembled checkout.
