# 01: Deliver the approved three-scene bilingual opening and setup handoff

**What to build:** A first-time user sees the approved collage, dance-poster example, and expressive typography as one localized three-scene opening, advancing at three-second intervals and handing off to the existing Agent setup. Deliver the final sharp artwork, real localized interface text, and responsive layout together with this working path.

First make the setup shell's existing artwork selection independent of the opening scene list, keeping its appearance unchanged; then replace the opening. This narrow prerequisite belongs in this ticket, not a new rendering abstraction or separate refactor project.

Obtain the approved comparison preview and original concept references from the design workspace before producing assets; the approved reference images are available locally. Preserve that approved direction. No additional image or paid music calls are authorized by this ticket; use available approved material, and obtain narrowly scoped authorization if additional production calls are necessary.

**Blocked by:** None (can start immediately). Approved visual references must be retrieved from the design workspace before faithful production; this is an input requirement, not another ticket dependency.

**Status:** accepted

Code, assets, and bounded real-desktop technical acceptance are complete. See [QA record](../../../design-qa.md) and its bilingual production screenshots. The earlier blank reload was not reproduced; its root cause is unknown. The user subsequently requested committing this slice and starting step 02 after the connector correction.

- [x] Exactly three scenes appear in the approved order: collage, dance-poster creation example, Make your mark. typography. No fourth page or extra welcome ending.
- [x] Three production-resolution artwork assets are shared by Chinese and English. The six-panel review image is not stretched/cropped into production screenshots; interface text and controls are real localized text.
- [x] All headings, supporting text, example callout, example label, and control labels match the approved specification’s bilingual copy. Do not duplicate Unexpected connections. in the English heading area; remove invented event dates/venues.
- [x] Foreground default playback shows scenes at elapsed 0, 3, and 6 seconds. Scene 3 remains indefinitely; Start setup works immediately when it appears and never waits for music.
- [x] Pages 1 and 2 have Skip, page 3 has Start setup without a duplicate Skip action. Both actions reach the same existing Agent setup. Three segments and / 03 page counts reflect the current scene.
- [x] The existing handwritten Molly mark, light appearance, and theme lifecycle are preserved; default 900 × 670, minimum 620 × 600, supported zoom, and high-density rendering remain readable and operable.
- [x] Existing saved-language/system-language/English-fallback behavior is reused, including Simplified Chinese for Chinese variants. No language chooser or new locale.
- [x] Setup retains its previous background artwork and existing phases. Preserve settings Back, setup phase recovery, and completed-user launch behavior; do not add a welcome-seen flag.
- [x] Extend the existing mounted opening/onboarding tests with fake timing for scene boundaries, terminal hold, exact locale copy, and setup handoff. Retain relevant existing language/theme/launch regression checks.
- [x] Review both localized versions on the real desktop surface against the approved preview, record agent visual review and asset provenance, and update affected opening guidance. Default/minimum sizes and the original 150%/200% zoom failures pass; see QA for precise coverage.
- [x] After reviewing the connector correction, the user requested committing step 01 and starting step 02 (2026-09-24). This accepts the slice for progression; the parent feature remains incomplete.
- [x] Current audio remains operational during this slice; replacing it and its recovery policy belongs to ticket 03. This ticket does not silently change sound defaults or grant media-generation budget.
