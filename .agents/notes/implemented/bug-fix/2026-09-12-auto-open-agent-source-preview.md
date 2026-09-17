# Show intermediate Agent edits in the open canvas

Status: implemented
Translation: pending

## Abstract

An open Current artwork canvas stayed on the canonical editor throughout Agent
execution, so valid intermediate PPTD changes were invisible until the final
commit reloaded the artwork. When a design Agent turn starts with Current artwork
selected, the component now enters the existing readonly authoring preview and
receives its normal watched snapshots. A later explicit source choice is respected;
previewing still does not commit, unlock, or alter canonical artwork.

## Cause and decision

`DesignCanvas` initialized its local preview choice to false. Both the initial
`refreshPreview` call and the `design.preview` event subscription were conditional
on that choice, while live Agent status only disabled version mutations. The
Electron source-preview service and watcher already rendered valid intermediate
snapshots correctly, but the default Current artwork call site never became their
consumer.

The component now detects the transition into a live Agent run for the current
Session. It switches to the existing preview only when the user is viewing Current
artwork; an already selected source preview or history version is preserved. The
transition is consumed once per observed live interval, so choosing Current artwork
afterward is not undone while that status stays active. Successful final receipts
continue through the existing guarded canonical sync before returning to Current
artwork.

No watcher, conversion, Agent lifecycle, Bento state, storage, or commit protocol
was added. Invalid or incomplete source states retain the preview service's existing
last-valid-snapshot behavior.

## Regression evidence and limits

The focused component regression mounts the real `DesignCanvas` on Current artwork,
starts a live Agent turn, supplies a valid initial source snapshot, then publishes
a second `design.preview` snapshot. It requires the canonical canvas to hide, both
intermediate source identities to become visible through the preview, and an
explicit switch back to Current artwork to remain selected.

With the final test and the production transition removed, the focused suite failed
at `previewVisible === false` while its other four source-preview cases passed. With
the correction restored, all five cases passed. This deterministic component proof
does not replace a normal installed run with an actual Agent writing PPTD files;
the later installed evidence is recorded below.

Root verification passed the five source-preview and six receipt regressions,
followed by `pnpm check`, `pnpm format` and `git diff --check`.
Correction: the initial document command omitted `run` and opened a package website
instead of checking documents. Its zero exit was not validation. The correct
`pnpm run docs check` found two oversized AGENTS.md files. After shortening them without dropping their constraints, the actual check
passed with no errors; pending translations and size warnings remain visible.
The completed checks establish correctness only at their tested scope;
installed intermediate-file evidence is recorded below.


## Installed intermediate-file evidence

The normal macOS arm64 package from `8456d0286a2c071e11aa120622be741e4b5ae567`
completed the observed product sequence in the isolated READY3 run:
missing draft subscription without clicking Unsubmitted preview, native Claude
writes of first valid / invalid partial / second valid PPTD, visible readonly
Bento updates, unchanged canonical revision during preview, and final Saved
receipt followed by the new editable canonical content. The model provider was
local and synthetic; no external model or image request ran.

Evidence remains outside Git in
`folio-t28-intermediate-preview-GFCujU/evidence` under the macOS temporary directory.
The two intermediate screenshots show distinct heading and background changes;
both corresponding WebContentsViews were visible with 916×794 bounds while the
provider held completion. The invalid page retained the exact first surface.
Root inspected both images and the trace: calls 171/173 observe completion and
Saved, 175 reads the changed canonical document, and 177 confirms preview controls
have closed. Zero manual preview clicks remained true through call 183.

READY3 exited 1 at its final assertion about the fixture's permission-handler
bookkeeping, after all the above product checks. Its `approvedPermissions` array
was empty; expecting three local handler invocations was not an invariant of this
preview contract. Preserve that failure and do not call the entire run green.
The native tool results and written bytes were checked separately at each provider
step. Cleanup reported no errors, and root confirmed no remaining process from
this installed package. The earlier READY2 fixture failed before Agent execution
because it confused the version combobox with the composer; it is also retained.

Package identity: DMG SHA-256
`e8821e63da4f303652c1d78d2be76d50e50634aa5095a90fdc1a8949c33c3640`,
ASAR SHA-256 `949f3fc1b82d34ed7ebead4487fff2efcd35750db4a0dd25b38909b5975fb3a8`.
