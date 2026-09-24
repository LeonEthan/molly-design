# Welcome opening — step 01 design QA

Date: 2026-09-24
Result: **passed** for the bounded step 01 technical and agent visual review below. Production artwork remains subject to the user's visual judgment; this does not accept steps 02–04.

## Reference and actual artifacts

- [Approved bilingual concept](output/welcome-redesign-2026-09-24/three-page-bilingual-comparison.png).
- [Actual default-window bilingual comparison](output/welcome-redesign-2026-09-24/implemented-bilingual-comparison.png), Chinese left, English right, three rows.
- [Actual minimum-window bilingual comparison](output/welcome-redesign-2026-09-24/implemented-minimum-comparison.png).
- Both comparisons use native Electron `webContents.capturePage()` screenshots, resized only for the review sheet. Individual captures and [layout results](output/welcome-redesign-2026-09-24/verification/matrix-results.json) are retained alongside them. Native captures are used because Playwright page screenshots at non-default Electron zoom did not cover the full native surface reliably.

## Design comparison

| Surface | Observation |
| --- | --- |
| Composition | Inspected the approved concept and both actual six-panel sheets. Three subjects, their order, shared artwork and final setup CTA are preserved. The taller native frames have more vertical space than the concept panels; artwork uses contain sizing. |
| Type and copy | Real localized headings, supporting text, callout and example labels match the approved copy. English Unexpected connections. appears once. Chinese serif rendering uses the platform font fallback, rather than reproducing the concept's generated lettering. |
| Color and surfaces | Warm near-white shell, dark text, thin divider, three dashes and final pill CTA follow the reference. Artwork retains its yellow/slate accents. |
| Assets | Three authorized edits produced standalone artwork: collage 1254 × 1254, others 1851 × 849. No artificial upscaling or invented date/venue. Brush texture and small details are generated interpretations, not pixel-identical copies. Exact source/edit provenance is adjacent to each production asset. |
| Icons | Existing Molly mark retained. Sound icons use licensed canonical Lucide geometry through the shared icon registry. Sound state follows the retained audio policy rather than the concept's static muted glyph. |
| Interaction | Three-second boundaries and final hold work. Skip and Start setup enter Connect a model; Back returns to scene 1. The old editorial setup image remains independent of the opening. |
| Accessibility | Real text, button labels and focus styling remain. At enlarged zoom, vertical scrolling exposes the controls without horizontal overflow. Interactive progress and reduced-motion manual playback belong to step 02; those are not claimed as completed here. |

## Reproduced layout defect and narrow fix

The initial real Electron matrix reproduced a layout failure when zoom reduced the CSS viewport below the frame's 540px minimum height: centered overflow put the sound control above the scroll origin. At the narrowest enlarged width, the footer also overflowed horizontally by 6px.

The fix changes only two layout declarations: safe vertical centering on the scroll host, and wrapping on the footer. This preserves normal-window composition while allowing enlarged layouts to scroll from the top and wrap the action when necessary.

To avoid excessive testing, the final run covers only both languages, three scenes, and these four conditions:

| Native window | Electron zoom | Result |
| --- | --- | --- |
| 900 × 670 | 100% | Passed |
| 620 × 600 | 100% | Passed |
| 900 × 670 | 150% | Passed; original failure case |
| 620 × 600 | 200% | Passed; original failure case |

All 24 scene states passed header visibility, horizontal overflow, heading bounds, footer separation and action hit-testing after scrolling where needed. All eight language/window/zoom paths passed terminal hold, Start setup, Back and Skip; no renderer page errors were observed. Image decode and font readiness were awaited; scene timing uses an injected clock. The app uses isolated renderer/runtime data and restores the previous saved window bounds. No full suite was rerun for the CSS fix.

## Earlier blank reload observation

The earlier [blank native capture](output/welcome-redesign-2026-09-24/verification/electron-reload-blank.png) remains historical evidence, not an established code diagnosis. After the user requested continued debugging, real Electron diagnostics checked first paint and two actual `webContents.reload()` operations, awaiting document load and checking both renderer and native pixel captures. All showed visible artwork and the setup CTA. Native keyboard refresh also showed normal rendering with both an isolated profile and the original review profile: [native refresh](output/welcome-redesign-2026-09-24/verification/reload-cua-comparison.png), [original profile](output/welcome-redesign-2026-09-24/verification/reload-original-profile.png).

The blank surface did not recur. Its root cause remains unknown; no speculative runtime change was made, and this record does not claim that the earlier symptom has been fixed. The prior outstanding desktop checks are now complete within the stated coverage.

## Supporting checks and scope

- Earlier focused opening/flow/language/theme/audio/completion regression: 6 files / 32 tests passed; Electron launch/language checks: 6 tests passed.
- Earlier full components run: 418 files / 3205 tests passed before two added handoff cases. It was not repeated during this debugging follow-up.
- Electron app build, including its type checks, passed after the CSS fix. Existing bundle-size warnings remain.
- Earlier translation-key and icon-source checks passed; changed-file lint had no errors and two existing shell warnings.
- Final documentation and whitespace checks passed; documentation retains 16 existing rule-size warnings.

No commit, PR, Issue update, additional image call or music generation. Steps 02–04 remain unimplemented; the current audio is still the old cue. Human production-artwork acceptance is not inferred from automated checks or the approved concept.

## Follow-up correction — creation callout connector

The user identified a missed visual requirement: the original dance-page reference has a thin leader from the lower-left FORM selection handle to the callout's left edge, with a dot at the label. The isolated raster intentionally removed that external line, but the localized UI failed to restore it. The earlier agent visual review missed this discrepancy; its technical checks did not establish complete visual fidelity.

Restored the connector as non-interactive UI. Its start follows the actual contained artwork's selected corner; its end follows the localized callout. Resize observation handles window/zoom changes and is disconnected on unmount. The source raster, copy, timing and later steps are unchanged.

Follow-up result: **passed**. Real Electron checks were limited to scene 2 in both languages at 900 × 670 / 100%, 620 × 600 / 100%, and 620 × 600 / 200%: six states. The line remains attached after live resizing/zoom, has a visible stroke, ignores pointer events, and introduces no horizontal overflow or renderer error. Inspected native captures against the original reference, including the scrolled enlarged view. [Updated second-page bilingual capture](output/welcome-redesign-2026-09-24/creation-connector-bilingual.png) and [scoped results](output/welcome-redesign-2026-09-24/verification/creation-connector-results.json). The default/minimum six-panel comparisons above now include the corrected second page.

Electron app build/type checks, changed-file formatting and documentation checks passed (16 existing documentation warnings). No additional unit tests or full-suite rerun for this local visual fix.

## Step 01 commit gate

The user requested committing this slice and proceeding to step 02 after the connector fix. Ran `pnpm format` and `pnpm check`. Workspace type checks passed; new lint errors were corrected and the gate resumed from lint without repeating completed type checks. Full CI tests passed (components: 418 files / 3207 tests), as did translation and import/platform checks. Public-boundary checking identified two asset provenance files containing internal absolute paths; these now retain only artifact identifiers and pass the boundary check. The vendor Claude tsconfig lookup emitted a non-fatal diagnostic during component collection; the retained vendor checkout was not changed.
