# Design renderer resources

Root repository rules apply. `CLAUDE.md` links here; edit `AGENTS.md` only.
Read [README.md](README.md) and preserve pinned vendor bytes and provenance. The
`bento/` tree is vendored upstream source with the Molly adaptations recorded in
`source-manifest.json` already applied; change it only through a recorded refresh,
never as an untracked edit.

The builder assembles local adaptations in a temporary copy. Product defaults
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
Canvas copy is never hardcoded in one language: key it into the shell's `design.*`
locale entries, list the key in `DESIGN_CANVAS_LABEL_KEYS`, and let Electron
translate main-process copy with `translateUi`.

The generic viewport API reports screen scale and canvas-coordinate center; fit
reuses native zoomReset. Neither knows Agent or version lifecycle. Electron fits
new renderers and resized containers, retaining zoom for unchanged hide/show.
Adapt only the assembled checkout.

Before changing image painting, read [IMAGE-SAMPLING.md](IMAGE-SAMPLING.md).
Sampling buffers are derived renderer state; preserve source assets, canonical
bounds and every nonzero-alpha pixel. Keep editable frame coordinates separate
from paint transforms. Require the native transparent-margin regression to pass
without relaxing its zero-difference assertion.
