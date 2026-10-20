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
stale-selection checks on the receiving path. Element outlines
(`window.molly.highlight`) are transient screen feedback keyed by element id:
they never mutate the document or intercept input, main validates them, and
only `working` outlines carry over to new preview frames. A group may carry a
notes-run badge number (`working` shows the number, `changed` a check); the pin
hover preview uses an in-page-only `hover` tone that never crosses IPC. Note pins are
screen-only state keyed by element id; requests carry only their epoch. The dock comment
tool (`C`) turns plain clicks into pins and sets `body[data-commenting]`; the dock brush
tool (`B`) sets `body[data-brushing]`. The two are mutually exclusive, `V` returns to select,
and neither is on while readonly. One Escape closes an open note editor (a written note stays,
an empty one is dropped) and returns to select for either tool; Escape during IME composition
does not exit, and `V` typed in the editor is text. Both keys are consumed in the
capture phase so Bento's legacy `c` handler never sees them. Unsent pins survive an in-session
frame reload: the shell snapshots them (`window.molly.notesSnapshot`) before the old frame is
destroyed and restores them (`window.molly.restoreNotes`) into the next one. A failed snapshot
(`null`) keeps the last good one; an empty successful snapshot clears it. Restore releases the
snapshot only after it lands, and a failed attach keeps it for the retry. Restored pins are
memory-only and prune missing targets. Pins are dropped on send, clear, or when their target is
gone; only teardown forgets the snapshot. Pins stay snapshotted while a send is in flight.
A drag on an image in comment mode draws a box region, and a drag on an image in brush mode
draws a stroke region (ordered points thinned and resampled to `DESIGN_STROKE_POINTS_MAX`). Both use
image-normalized coordinates (`image-regions.ts`) and set the note's `region`; a click stores a `pin`
at a point normalized to its element's box. Regions cover one image per read; `window.molly.marked(epoch)` returns the marked copy
of that image with the note numbers drawn on it. Requests carry only their epoch, and main reads the
marked copy. Test visual changes with real
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
