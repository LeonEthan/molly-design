# Welcome opening — implementation QA

Date: 2026-09-24
Result: **passed** for the bounded step 01 and step 02 desktop checks, step 03 audio integration and in-app hearing, and step 04 native foreground and packaged restart acceptance. The owner also accepted the final three-page bilingual visual composition. Historical status statements below describe each step at the time it was tested.

## Reference and actual artifacts

The `output/` paths below identify ignored, local-only review artifacts. They are not included in a fresh checkout or available as repository links. The committed probes under `.scratch/welcome-onboarding/` retain the relevant reproduction steps.

- Approved bilingual concept (`output/welcome-redesign-2026-09-24/three-page-bilingual-comparison.png`).
- Actual default-window bilingual comparison (`output/welcome-redesign-2026-09-24/implemented-bilingual-comparison.png`), Chinese left, English right, three rows.
- Actual minimum-window bilingual comparison (`output/welcome-redesign-2026-09-24/implemented-minimum-comparison.png`).
- Both comparisons use native Electron `webContents.capturePage()` screenshots, resized only for the review sheet. Individual captures and layout results (`output/welcome-redesign-2026-09-24/verification/matrix-results.json`) are retained alongside them. Native captures are used because Playwright page screenshots at non-default Electron zoom did not cover the full native surface reliably.

## Design comparison

| Surface            | Observation                                                                                                                                                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composition        | Inspected the approved concept and both actual six-panel sheets. Three subjects, their order, shared artwork and final setup CTA are preserved. The taller native frames have more vertical space than the concept panels; artwork uses contain sizing.                                                   |
| Type and copy      | Real localized headings, supporting text, callout and example labels match the approved copy. English Unexpected connections. appears once. Chinese serif rendering uses the platform font fallback, rather than reproducing the concept's generated lettering.                                           |
| Color and surfaces | Warm near-white shell, dark text, thin divider, three dashes and final pill CTA follow the reference. Artwork retains its yellow/slate accents.                                                                                                                                                           |
| Assets             | Three authorized edits produced standalone artwork: collage 1254 × 1254, others 1851 × 849. No artificial upscaling or invented date/venue. Brush texture and small details are generated interpretations, not pixel-identical copies. Exact source/edit provenance is adjacent to each production asset. |
| Icons              | Existing Molly mark retained. Sound icons use licensed canonical Lucide geometry through the shared icon registry. Sound state follows the retained audio policy rather than the concept's static muted glyph.                                                                                            |
| Interaction        | Three-second boundaries and final hold work. Skip and Start setup enter Connect a model; Back returns to scene 1. The old editorial setup image remains independent of the opening.                                                                                                                       |
| Accessibility      | Real text, button labels and focus styling remain. At enlarged zoom, vertical scrolling exposes the controls without horizontal overflow. Interactive progress and reduced-motion manual playback belong to step 02; those are not claimed as completed here.                                             |

## Reproduced layout defect and narrow fix

The initial real Electron matrix reproduced a layout failure when zoom reduced the CSS viewport below the frame's 540px minimum height: centered overflow put the sound control above the scroll origin. At the narrowest enlarged width, the footer also overflowed horizontally by 6px.

The fix changes only two layout declarations: safe vertical centering on the scroll host, and wrapping on the footer. This preserves normal-window composition while allowing enlarged layouts to scroll from the top and wrap the action when necessary.

To avoid excessive testing, the final run covers only both languages, three scenes, and these four conditions:

| Native window | Electron zoom | Result                        |
| ------------- | ------------- | ----------------------------- |
| 900 × 670     | 100%          | Passed                        |
| 620 × 600     | 100%          | Passed                        |
| 900 × 670     | 150%          | Passed; original failure case |
| 620 × 600     | 200%          | Passed; original failure case |

All 24 scene states passed header visibility, horizontal overflow, heading bounds, footer separation and action hit-testing after scrolling where needed. All eight language/window/zoom paths passed terminal hold, Start setup, Back and Skip; no renderer page errors were observed. Image decode and font readiness were awaited; scene timing uses an injected clock. The app uses isolated renderer/runtime data and restores the previous saved window bounds. No full suite was rerun for the CSS fix.

## Earlier blank reload observation

The earlier blank native capture (`output/welcome-redesign-2026-09-24/verification/electron-reload-blank.png`) remains historical evidence, not an established code diagnosis. After the user requested continued debugging, real Electron diagnostics checked first paint and two actual `webContents.reload()` operations, awaiting document load and checking both renderer and native pixel captures. All showed visible artwork and the setup CTA. Native keyboard refresh also showed normal rendering with both an isolated profile and the original review profile: native refresh (`output/welcome-redesign-2026-09-24/verification/reload-cua-comparison.png`), original profile (`output/welcome-redesign-2026-09-24/verification/reload-original-profile.png`).

The blank surface did not recur. Its root cause remains unknown; no speculative runtime change was made, and this record does not claim that the earlier symptom has been fixed. The prior outstanding desktop checks are now complete within the stated coverage.

## Supporting checks and scope

- Earlier focused opening/flow/language/theme/audio/completion regression: 6 files / 32 tests passed; Electron launch/language checks: 6 tests passed.
- Earlier full components run: 418 files / 3205 tests passed before two added handoff cases. It was not repeated during this debugging follow-up.
- Electron app build, including its type checks, passed after the CSS fix. Existing bundle-size warnings remain.
- Earlier translation-key and icon-source checks passed; changed-file lint had no errors and two existing shell warnings.
- Final documentation and whitespace checks passed; documentation retains 16 existing rule-size warnings.

At this step 01 checkpoint, there was no commit, PR, Issue update, additional image call or music generation. Steps 02–04 were still unimplemented and audio was still the old cue. Human production-artwork acceptance was not inferred from the concept or automated checks; the later explicit acceptance is recorded under step 04 below.

## Follow-up correction — creation callout connector

The user identified a missed visual requirement: the original dance-page reference has a thin leader from the lower-left FORM selection handle to the callout's left edge, with a dot at the label. The isolated raster intentionally removed that external line, but the localized UI failed to restore it. The earlier agent visual review missed this discrepancy; its technical checks did not establish complete visual fidelity.

Restored the connector as non-interactive UI. Its start follows the actual contained artwork's selected corner; its end follows the localized callout. Resize observation handles window/zoom changes and is disconnected on unmount. The source raster, copy, timing and later steps are unchanged.

Follow-up result: **passed**. Real Electron checks were limited to scene 2 in both languages at 900 × 670 / 100%, 620 × 600 / 100%, and 620 × 600 / 200%: six states. The line remains attached after live resizing/zoom, has a visible stroke, ignores pointer events, and introduces no horizontal overflow or renderer error. Inspected native captures against the original reference, including the scrolled enlarged view. Updated second-page bilingual capture (`output/welcome-redesign-2026-09-24/creation-connector-bilingual.png`) and scoped results (`output/welcome-redesign-2026-09-24/verification/creation-connector-results.json`). The default/minimum six-panel comparisons above now include the corrected second page.

Electron app build/type checks, changed-file formatting and documentation checks passed (16 existing documentation warnings). No additional unit tests or full-suite rerun for this local visual fix.

## Step 01 commit gate

The user requested committing this slice and proceeding to step 02 after the connector fix. Ran `pnpm format` and `pnpm check`. Workspace type checks passed; new lint errors were corrected and the gate resumed from lint without repeating completed type checks. Full CI tests passed (components: 418 files / 3207 tests), as did translation and import/platform checks. Public-boundary checking identified two asset provenance files containing internal absolute paths; these now retain only artifact identifiers and pass the boundary check. The vendor Claude tsconfig lookup emitted a non-fatal diagnostic during component collection; the retained vendor checkout was not changed.

## Step 02 — manual reading and reduced motion

Result: **passed**. Progress segments are now native buttons with localized accessible names, `aria-current` state and keyboard-visible focus. Pointer activation, Enter or Space selects immediately and stops automatic advancement for that visit, including activation of the already-current segment. Reduced motion prevents automatic advancement and fades without muting audio. Setup Back begins a fresh visit; no new persisted state or audio timeline was introduced.

The first real-desktop Tab check failed because Electron's existing capture-phase handler cancelled default traversal on ordinary buttons. Added a full-screen `data-native-tab-surface` opt-in for the opening, including Tab entry from the unfocused document. The native probe verifies general chrome still cancels Tab once the opening unmounts. This is a scoped host integration fix, rather than relying on browser-only tests or mislabelling the screen as a dialog.

Evidence: Chinese keyboard focus (`output/welcome-redesign-2026-09-24/verification/step2-zh_CN-standard.png`), English reduced motion (`output/welcome-redesign-2026-09-24/verification/step2-en-reduced.png`), 200% keyboard setup focus (`output/welcome-redesign-2026-09-24/verification/step2-en-reduced-200.png`), native results (`output/welcome-redesign-2026-09-24/verification/step2-results.json`). Captures were inspected against the approved composition and the corrected step 01 page: artwork, connector, copy and action layout remain intact. Keyboard focus adds a visible ring around the segment; pointer presentation retains the three dashes.

- Focused mounted regression: **3 files / 18 tests passed**, using fake clocks and explicit preference/media signals. No new full-suite run for step 02.
- Real Electron: four Chinese/English × standard/reduced-motion flows, using the default Chinese window and minimum English window. Verified keyboard entry, Tab/Enter/Space activation, selected labels, terminal hold, fresh Back behavior, no horizontal overflow or renderer errors, plus one 200% minimum-window keyboard handoff.
- Electron app build/type checks, changed-file lint (zero errors, one warning), translation-key validation, documentation checks and whitespace checks passed. Existing bundle-size and 16 documentation warnings remain.

New nine-second music, explicit blocked-audio recovery and foreground/background pause/resume remain steps 03–04. This result does not claim those behaviors are implemented.

## Step 03 audio integration

The user-supplied MiniMax track was made into a nine-second cue and bundled in the Electron renderer. The user listened to the final standalone file and replied “LGTM” on 2026-09-24. [Cue source and processing](packages/components/src/assets/molly-opening-v2.source.md) retain the source hash, extracted interval, measured duration and level. The old twenty-second asset was removed.

The sound button now exclusively recovers blocked opening music at the elapsed opening position; unrelated input still unlocks separate interaction sounds but cannot restart the cue. Muting keeps opening time moving, recovery at or after nine seconds stays silent, and the setup action stops the player before navigation. Foreground/background pause remains step 04.

- Focused mounted audio and onboarding-flow tests: **2 files / 14 tests passed**, with fake time and controllable media promises. The component type check and changed-file lint passed.
- Electron `build:app` and its node/web type checks passed. Its emitted MP3 has the same SHA-256 as the source-tree cue. The build retained existing bundle warnings.
- Documentation and whitespace checks passed. At this step 03 checkpoint, human listening of early exit, mute/unmute and blocked recovery inside the actual Electron opening was outstanding; its later explicit acceptance is recorded under step 04 below.

## Step 04 foreground pause and resume

The opening now uses one foreground elapsed clock for the scene intervals and music. A native Electron window signal pauses both on minimize, hide or blur and resumes them on a focused visible window; document visibility and focus remain the browser fallback. Preload retains the most recent native state for an opening mounted after the first window event. Manual reading, reduced motion, mute, blocked autoplay and the final cue state remain independent of focus changes.

The need for the native signal was reproduced on macOS: minimizing the previous build emitted neither renderer `visibilitychange` nor `blur`; real MP3 playback advanced from 0 to 4.869 seconds during a five-second minimized interval. A repeat without Playwright's clock advanced to 4.933 seconds. The updated build passes Electron node/web type checks and emits the new main/preload/renderer bridge. Five mounted interruption tests pass, including stale Chromium focus with a native background event, alongside the existing audio and flow tests.

The local arm64 unpacked-app package completed, including its embedded CLI, native-binding and image-decoder probes; it was not published. The MP3 inside `Molly.app/Contents/Resources/app.asar` matches the source asset byte-for-byte (SHA-256 `818f68f42f8bbdaf18450e844b4c83fdbb6494974aa93054de1c331f58cefeae`). The [native foreground probe](.scratch/welcome-onboarding/verify-background-resume.cjs) checks a 2.4-second partial scene, minimized and unfocused intervals, return position, manual reading, cue expiry and setup handoff against the real player. Its original run could not establish focus while the Mac was locked. On the unlocked Mac, both the development app and the unpacked packaged app passed with separate temporary profiles and CLI endpoints. In the packaged run, minimizing for ten virtual seconds held the first scene and player at 0.491 seconds; restoring resumed at 2.409 seconds, then advanced to scene 2 after its remaining interval. A five-second blur held player time at 2.464 seconds and preserved manual page 1; setup stopped playback and removed its source. The local result (`output/welcome-redesign-2026-09-24/verification/background-resume-results.json`) reports `passed: true` with no page errors.

The packaged [audio interaction probe](.scratch/welcome-onboarding/verify-audio-interactions.cjs) observed blocked autoplay in the real player, no recovery after unrelated scene selection, explicit recovery at 2.123 seconds, immediate mute/unmute state changes, and a paused, source-free player on early setup entry. Its ignored result is `output/welcome-redesign-2026-09-24/verification/audio-interactions-results.json`. The owner confirmed the actual bilingual six-panel composition as final visual acceptance, then listened to the nine-second cue, mute/recovery and early setup entry in an isolated packaged Molly window and confirmed the in-app hearing acceptance in the task conversation on 2026-09-24.

The [packaged lifecycle probe](.scratch/welcome-onboarding/verify-lifecycle.cjs) used the existing E2E harness with a pinned packaged source commit, one isolated profile and independent CLI endpoint. It passed three verified restarts: quitting during the opening returned to scene 1; quitting in setup restored the providers phase with the previous `molly-editorial-v3.png` artwork decoded and visible in the light theme; completing the skip path wrote the native completion marker, and the next launch went directly to the product. Six checkpoints and screenshots are retained locally under `output/welcome-redesign-2026-09-24/verification/lifecycle-lqUzK2/`; `results.json` reports `passed: true` with no page errors. The packaged source commit was `152f239648b6a99fe04521d5a788d144c4025fa2`.

The [packaged layout probe](.scratch/welcome-onboarding/verify-installed-layout.cjs) passed eight native states: all three scenes in Chinese at 900 × 670, all three in English at 620 × 600, the Chinese creation scene at 150% zoom, and the English final scene at 200% zoom. On the 2× macOS display, native captures retained full 2× pixel resolution; the 150% and 200% states had device pixel ratios of 3 and 4. All three production artworks decoded, the scene-2 selection leader and callout rendered, sound and setup controls remained reachable after scrolling where needed, and there was no horizontal overflow, footer overlap, or renderer error. All eight screenshots were inspected. The ignored result is `output/welcome-redesign-2026-09-24/verification/installed-layout-1790297966465/results.json`.

For the final acceptance record, `pnpm format`, `pnpm check`, `pnpm run docs check`, and `git diff --check` passed. Documentation check retained 16 pre-existing rule-size warnings and no errors. This follow-up adds only reproducible acceptance probes and documentation; it does not change the merged product runtime.
