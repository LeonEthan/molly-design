# 02: Let users revisit scenes and read with reduced motion

**What to build:** Users can select any of the three progress segments to read or revisit a scene at their own pace. Manual selection stops automatic advancement for the rest of that opening visit. Users who prefer reduced motion navigate manually without entrance or transition movement.

Deliver the interaction, localized accessible state, keyboard behavior, and observable flow tests as one complete reading experience. Sound controls continue to follow their existing lifecycle; this ticket does not seek or restart music when a scene changes.

**Blocked by:** Ticket 01 — Deliver the approved three-scene bilingual opening and setup handoff.

**Status:** implemented-technical-qa-passed

- [x] Each of the three segments is a usable scene selector for pointer and keyboard input, with visible focus, a localized accessible name, and an exposed current/selected state.
- [x] Selecting a segment immediately displays the matching artwork, localized copy, page count, and Skip/Start setup action.
- [x] After manual selection, advancing the fake clock never automatically changes the scene again during that visit, including when the selected scene was already active.
- [x] Manual selection does not reset opening elapsed time or seek, restart, or pause audio.
- [x] Reduced-motion preference removes entrance/transition movement and automatic scene advancement; all three scenes remain reachable manually. It does not imply muted audio.
- [x] A fresh opening visit through existing setup Back starts at scene 1 with the appropriate default/reduced-motion behavior; no manual-mode or page-index persistence is introduced.
- [x] The three-page layout remains faithful and operable in Chinese and English at supported desktop sizes; adding hit targets/focus indication does not hide copy or the main action.
- [x] Mounted flow tests use deterministic timers and media/preference signals to assert scene state, visible actions, keyboard usability, reduced motion, and absence of unwanted advancement. Do not test private implementation details or mock call counts.
- [x] Document this behavior alongside the opening's existing guidance. Background pause/resume composition is owned by ticket 04.


Implemented after step 01 commit `d893fa07`. Focused tests: 3 files / 18 tests. Real Electron: Chinese and English, normal and reduced-motion flows, native Tab/Enter/Space, setup Back, and minimum-window 200% keyboard reachability. The desktop's existing global Tab suppression required a scoped full-screen opt-in; unrelated chrome still suppresses Tab after leaving the opening. See [QA record](../../../design-qa.md). No music or background lifecycle work was started.
