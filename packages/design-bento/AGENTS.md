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
capture phase so Bento's legacy `c` handler never sees them. Unsent pins are pushed to main
(`notes-sync` on `/ws/<id>/toolbar`) after every change, debounced by `NOTE_PUBLISH_DEBOUNCE_MS`
through an injectable clock. Every publish carries the pins epoch and the page's instance id —
epochs restart when the canvas is recreated — and is an awaited POST; only the
dispose flush (`pagehide`) uses `keepalive`, and only when the body is under
`DESIGN_NOTES_KEEPALIVE_BODY_LIMIT` (64 KiB,
Chromium's keepalive cap). A failed publish keeps the pending flag, so the next change or flush
retries. Points are rounded to `DESIGN_NOTE_COORDINATE_DECIMALS` (4) on the canvas; that is 0.4 px
at a 4096 px edge. The largest body the schema admits (10 notes, 200-point strokes, 4000-character
prompts) is about 73 KB, above the keepalive cap, so that case relies on the awaited POST and the
pagehide flush can be dropped by the browser. Main-driven teardown (reload, conflict reload,
version restore, discard, copy) first calls `window.molly.flushNotes()` through
`retireDesignInstance`, bounded by `DESIGN_NOTES_FLUSH_TIMEOUT_MS` (1500 ms); a failed or timed-out
flush keeps the last published copy and still tears the instance down. A failed initial load tears
down without a flush, because that page never became ready and holds no unsent notes. Main keeps
the last valid push per artwork and host (`design-note-retention-core.ts`); an invalid push is
rejected by the request schema and leaves that copy. A crashed frame cannot be asked to flush, so
it loses only edits made since its last successful publish. Every attach restores the copy with `window.molly.restoreNotes`, which
merges into the pins, prunes missing targets and never fails the attach. A failed restore keeps the
copy for the next attach. A pending publish is never sent while a send is in flight, so a reload
cannot put sent notes back. The tray's Send stages the notes in the chat composer — an "N comments"
chip plus the annotated whole-artwork snapshot and the one marked copy as ordinary image
attachments — while ⌘/Ctrl+Enter in the note editor or the tray sends a turn at once. Staging never
consumes the retained copy; a direct send moves it into a flight, and an accepted send — staged or
direct — retires the copy whose epoch and page instance the message carried, so pins edited since
staging or restored into a recreated canvas stay.
A settle with `sent=false` merges the flight back into
the copy and into any live canvas. Clear, delete and an emptied editor publish the new state.
A drag on an image in comment mode draws a box region, and a drag on an image in brush mode
draws a stroke region (ordered points thinned and resampled to `DESIGN_STROKE_POINTS_MAX`). Both use
image-normalized coordinates (`image-regions.ts`) and set the note's `region`; a click stores a `pin`
at a point normalized to its element's box. Regions cover one image per read; `window.molly.marked(epoch)` returns the marked copy
of that image with the note numbers drawn on it. For a staged draft, main renders the saved artwork
offscreen and serves it once on `/ws/<id>/notes-snapshot`, and
`window.molly.annotateNotesSnapshot(epoch)` draws every note's number where it sits — pins at their
points, region outlines around their marks — before main validates the bytes like the marked copy.
Requests carry only their epoch, and main reads the marked copy and the annotated snapshot.
Hold-to-compare shows main's prepared pre-turn render: `window.molly.showCompare(src|null)` drives
the overlay (`compare-overlay.ts`), which is display-only, blocks stage pointer input while shown
and tracks the stage through zoom and pan; holding `\` in the canvas asks main for the frame with a
`{type:'compare'}` request. Neither path writes the document, history or a sync loop. Test visual changes with real
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
