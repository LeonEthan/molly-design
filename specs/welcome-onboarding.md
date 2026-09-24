# Molly three-scene first-launch opening

Status: draft
Translation: pending

Issue: [#7 — Redesign first-launch opening](https://github.com/LeonEthan/molly-design/issues/7)

## Problem Statement

Molly's first-launch opening does not yet express the intended graphic-design identity strongly enough. The current implementation presents four categories of finished design, advances every five seconds, and plays the existing twenty-second cue. The owner selected a more distinctive sequence of three artworks and approved a bilingual comparison preview.

A new user should encounter a short, coherent introduction to inspiration, creation, and personal expression, then enter the existing setup flow. They should be able to read at their own pace, control sound, and leave immediately without losing setup progress.

## Solution

Replace only the opening with three scenes, in this order: collage, editable dance-poster example, and expressive typography. There is no fourth scene, separate “Welcome to Molly” ending, or new setup step.

Use the approved light visual direction and existing handwritten Molly M. The app shows one localized sequence; the two-column, three-row comparison is a review artifact, not a six-screen product flow.

| Scene | Artwork and composition | Chinese copy | English copy |
| --- | --- | --- | --- |
| 1 — Inspiration | Cyan glass/water, architectural shadows, a cropped lowercase a, pale yellow geometry, and a fine looping line in an asymmetric collage | **让灵感相遇。** / 一张参考，一句话，一个新的开始。 | **Unexpected connections.** / A reference. A few words. A new beginning. |
| 2 — Creation | Black-and-white dancer, slate-blue rectangle, FORM / IN MOTION typography, a title selection outline, and one editing callout | **灵感成形，细节由你。** / 与 Molly 一起创作，亲手调整每一处。 | **Your vision. Your finishing touch.** / Create with Molly. Fine-tune every detail. |
| 3 — Expression | Oversized Make your mark. lettering, a sweeping black gesture, halftone, and crop marks | Artwork: **Make your mark.** / 做出你的样子。 | Artwork: **Make your mark.** / Your ideas. Your signature. |

The creation callout is “让标题再大胆一点。” / “Make the headline bolder.” Its example label is “创作示意” / “Design example”. Remove invented dates and venues from the demonstration artwork. On the Chinese inspiration page, the approved smaller English art phrase may remain; on the English page, do not duplicate the main heading.

The first two scenes show “跳过” / “Skip”. The third shows “开始设置” / “Start setup” without an additional Skip action. Both actions enter the same existing Agent setup step. Three progress segments and page counts 01 / 03, 02 / 03, and 03 / 03 remain visible.

Default foreground playback shows scene 1 at 0 seconds, scene 2 at 3 seconds, and scene 3 at 6 seconds. Scene 3 remains until the user acts. A new original nine-second instrumental cue ends naturally at 9 seconds; its completion never navigates.

## User Stories

1. As a new Molly user, I want three distinctive graphic-design scenes, so that I understand the product's creative character quickly.
2. As a new user, I want the opening to end on personal expression, so that an additional brand welcome page does not delay setup.
3. As a Chinese-speaking user, I want Chinese product copy and controls, so that I can understand the opening comfortably.
4. As an English-speaking user, I want natural English copy with the same meaning, so that the experience feels intentionally designed for me.
5. As a returning user with a saved language, I want that preference respected, so that the opening does not unexpectedly switch language.
6. As a first-time user, I want language selected from the existing system-language policy, so that I do not need another preliminary selection screen.
7. As a user with a different system language, I want English when no supported language matches, so that the opening remains usable.
8. As a viewer, I want each automatic scene to last three seconds, so that the opening feels brief.
9. As a viewer, I want the third scene to remain visible, so that I can decide when to enter setup.
10. As a user ready to continue, I want Start setup enabled as soon as scene 3 appears, so that music never forces me to wait.
11. As a user in a hurry, I want Skip on the first two scenes, so that I can enter setup immediately.
12. As a reader, I want to select a progress segment to revisit a scene, so that I can inspect the artwork and copy.
13. As a reader who navigates manually, I want automatic advancement to stop, so that the app does not take the page away again.
14. As a user who prefers reduced motion, I want manual scene navigation without entrance motion, so that I can read without automatic transitions.
15. As a keyboard user, I want operable progress, sound, and setup controls with visible focus, so that I can complete the opening without a pointer.
16. As a screen-reader user, I want real localized text and meaningful control names and states, so that the opening's meaning is not trapped in images.
17. As a viewer, I want a short, restrained instrumental score, so that sound supports rather than overwhelms the artwork.
18. As a listener, I want the cue to end naturally after nine seconds without looping, so that the final page can remain quiet.
19. As a user in a quiet environment, I want immediate mute control, so that I can stop audible playback.
20. As a user who unmutes, I want only the remaining cue, so that the opening does not restart its music.
21. As a user whose autoplay is blocked, I want the scenes to remain usable, so that audio permissions do not block setup.
22. As a user whose autoplay is blocked, I want sound enabled only through the sound button, so that an unrelated click or keypress does not unexpectedly start music.
23. As a user enabling sound late, I want playback aligned with the remaining opening time, so that the cue does not restart from its beginning.
24. As a user enabling sound after the cue window ends, I want no delayed playback, so that finished music stays finished.
25. As a user who manually changes scenes, I want the existing cue to continue without seeking or replaying, so that browsing does not create repeated musical starts.
26. As a user switching to another application or minimizing Molly, I want both timing and sound paused, so that I do not miss the opening or hear it in the background.
27. As a user returning to Molly, I want playback to resume from the pause point, so that neither scenes nor sound jump ahead.
28. As a user who already chose manual navigation, I want that choice preserved after a background pause, so that returning does not reactivate automatic advancement.
29. As a user entering setup, I want the cue to stop immediately, so that opening audio does not continue over setup.
30. As a user returning from setup to the opening, I want the established replay behavior preserved, so that Back remains predictable.
31. As a user closing the app during the opening, I want the next launch to start the opening from scene 1, so that no new partial-page recovery state is required.
32. As a user closing the app after entering setup, I want my existing setup phase restored, so that I do not repeat completed steps.
33. As a user who completed onboarding, I want upgrades to keep opening the product normally, so that a visual refresh does not force onboarding again.
34. As a user with a small desktop window, I want readable copy and reachable controls, so that the approved composition remains usable at supported sizes.
35. As a user on a high-density display, I want sharp artwork and real text, so that the opening does not look like a stretched review screenshot.
36. As a user entering setup, I want its current background and behavior preserved, so that this opening-only change has no unrelated visual side effects.
37. As a local desktop user, I want opening media available from the installed app, so that this experience does not depend on cloud access or send telemetry.
38. As a new user, I want the editing illustration identified as an example, so that I do not mistake it for a live Agent operation or an artwork already created for me.

## Implementation Decisions

1. **Scope and reuse.** Adapt the existing opening scene presentation, ceremony controls, audio lifecycle, localization, and onboarding integration. Keep the existing product renderer, route, platform composition, setup phases, and durable completion owner. Do not create a new renderer, onboarding engine, or persistent welcome state.
2. **Approved visuals.** Deliver three high-resolution artwork assets shared by the Chinese and English versions. Preserve the selected subjects, crops, visual hierarchy, palette, and existing Molly mark. Rebuild interface headings, supporting copy, controls, and page counts as localized text rather than rasterizing the entire screen. English lettering that belongs to the artwork remains artwork. The creation selection outline and callout are demonstration content, not an interactive canvas or a live Agent run.
3. **Responsive presentation.** Keep the approved light appearance and existing onboarding theme lifecycle. Validate the actual default 900 × 670 and minimum 620 × 600 desktop windows, as well as high-density rendering and supported zoom. Reflow spacing and arrangement instead of shrinking text into illegibility or clipping the main action. Keep the final setup action and navigation controls reachable. Do not add a separate dark artwork set.
4. **Scene timing.** The foreground opening timeline starts when the opening becomes active and visible. Automatic changes occur at elapsed 3 and 6 seconds. Scene 3 never advances or completes onboarding automatically, including after elapsed 9 seconds. Use restrained fades rather than new staged storytelling or a new animation system.
5. **Manual navigation.** Each of the three progress segments is an accessible scene selector. Selecting a scene disables subsequent automatic advancement for that opening visit. The active scene and accessible selected state update together. Selecting a scene does not seek, restart, or pause the cue.
6. **Reduced motion.** With reduced motion enabled, remove entrance/transition movement and use manual scene navigation. This is not an implicit sound preference: the ordinary nine-second audio rules still apply.
7. **One timing meaning.** Elapsed opening time excludes background pauses. Muting, blocked playback, and manual selection do not reset it; manual page choice is not converted into an audio timestamp. Keep scene selection and cue position consistent with that meaning without adding persisted state.
8. **New cue.** Produce a complete original nine-second instrumental with warm electric piano, sparse muted plucks, light restrained rhythm, and a connected motif across three three-second phrases. Finish the cadence and tail within the cue. No vocals, looping, abrupt truncation of the previous cue, or mandatory wait for musical completion. The earlier fifteen-/twenty-second proposals and 96 BPM/six-bar constraint are superseded. Package the cue locally and retain a restrained level through the existing audio path; final hearing acceptance remains required.
9. **Sound defaults and mute.** Attempt initial playback with sound enabled. Reflect the actual sound state in the control; the mute icon shown in the review image does not override the approved default. Mute silences immediately while opening time continues. Unmute within the cue window plays only its remainder; at or after nine seconds it does not restart the cue.
10. **Autoplay recovery.** If initial playback is blocked, continue the visuals and offer “开启声音” / “Enable sound”. Only deliberate activation of the sound control may attempt recovery. Remove opening-cue recovery from unrelated global pointer/keyboard gestures. At recovery, use the current elapsed opening time; if the cue window has ended, do not play. Failure must not strand navigation or falsely imply audible playback.
11. **Background and exit.** Minimizing or switching to another application pauses the opening timeline and audio together. Return resumes their remaining time without restoring automatic scene advancement after manual selection. Skip, Start setup, or leaving the opening stops the cue immediately and releases its timers/listeners/media lifecycle. A pending playback result after departure must not restart sound.
12. **Language policy.** Reuse the saved-language preference, then the existing ordered system-language matching policy, then English fallback. Match supported English/Chinese base tags; all Chinese variants map to Simplified Chinese. Do not change matching order or add a new locale, language-selection step, or opening language switcher.
13. **Existing navigation and recovery.** Skip bypasses only the opening and reaches the same Agent setup step as Start setup. Preserve the existing settings-to-opening replay, setup-phase recovery, completed-onboarding launch policy, and completion persistence semantics. Reentering the opening is a new visit starting at scene 1; no welcome-page index or separate “opening seen” flag is persisted.
14. **Setup isolation.** The existing setup shell shares opening artwork presentation and defaults to the previous second illustration. Make the dependency explicit enough to preserve the existing setup background while changing opening scenes. Do not delete assets still used by setup or change setup as a side effect of replacing a scene array.
15. **Boundaries.** Media remains bundled and local. No hosted requests, telemetry additions, live Agent execution, or changes to BentoDoc, artwork persistence, Agent configuration, or design-session contracts are required.
16. **Documentation.** During implementation, update the onboarding-owned four-scene guidance and artistic direction to the new three-scene behavior, plus affected behavior documentation. Keep historical decisions identifiable as history; publishing this spec does not assert that runtime changes or final media are complete.

## Testing Decisions

- **Primary seam:** prefer the existing mounted onboarding-flow/ceremony boundary, using the real opening controls and scene/audio composition. Exercise it through visible text, accessible controls, navigation destinations, and observable playback state. Reuse the existing React DOM/JSDOM and Vitest setup; no new test framework or duplicate playback test architecture.
- **Minimal supporting seams:** retain focused regression coverage at the existing language-detection and native launch/completion boundaries because they own behavior outside the renderer. Reuse current audio lifecycle coverage for media outcomes that cannot be observed reliably through DOM alone.
- **Prior art:** the repository already has mounted onboarding-flow tests, an intro-sequence test driven by fake timers, an audio lifecycle test with a controllable media fake, language preference detection tests, onboarding-theme tests, and native launch/completion policy tests. Adapt these to the new contract; do not preserve old four-scene or arbitrary-gesture recovery expectations.
- **Good tests assert behavior:** page/copy/selected-state changes, whether the user reaches setup, current playback position and paused/muted/ended outcomes, resumable state, and inability of late playback completion to restart audio. Do not assert private state layout, implementation-specific call counts, or snapshots that merely duplicate the component tree.
- **Deterministic timing:** use fake timers or an injected clock, explicit visibility/focus/media signals, and controlled playback promises. Do not use real sleeps, network audio, machine-speed assumptions, or scheduler races.
- **Timing cases:** scene 1 before 3 seconds; scene 2 at 3 seconds; scene 3 at 6 seconds and after 9 seconds; setup immediately available on scene 3; no fourth scene or automatic setup navigation.
- **Manual and reduced-motion cases:** mouse and keyboard progress selection, active-state announcements, no automatic advancement after manual selection, no resumed automation after backgrounding, and manual-only reduced-motion presentation.
- **Audio cases:** initial success; initial blocked playback; unrelated input does not recover it; explicit enable at an intermediate time seeks to the remaining cue; enable at/after 9 seconds is silent; mute/unmute does not restart; manual scene changes do not seek; natural end does not loop or navigate; media failure leaves setup usable.
- **Lifecycle cases:** partially elapsed scene paused in the background and resumed with its remaining interval; repeated focus/visibility signals do not advance time twice; mute/blocked/manual states survive foreground return; leaving during pending playback remains silent after that promise settles.
- **Flow regression:** Skip and Start setup reach the same existing Agent setup; settings Back starts a new opening visit; closing during the opening restarts at scene 1; closing during setup restores its phase; completed users do not see the opening after upgrade. Confirm setup retains its existing artwork and theme behavior.
- **Real-surface acceptance:** inspect Chinese and English at default/minimum desktop sizes, supported zoom, and high-density display; check typography, image sharpness, focus visibility, control reachability, and real packaged-media loading. Listen to the complete cue, early exits, mute, foreground return, and blocked recovery. Component tests cannot establish visual fidelity or hearing quality.
- **Completion evidence:** run relevant tests and required repository checks during implementation. Record human visual/hearing acceptance separately from automated passes. This spec-authoring task does not claim those tests or final-media acceptance have occurred.

## Out of Scope

- A fourth page, separate welcome/brand ending, or six-screen product flow.
- New setup steps, language switchers, additional locales, or changes to Agent/model/image-service configuration.
- Redesigning the setup background or later onboarding screens.
- A persistent opening-seen flag, persisted page index, new replay settings, or forcing completed users through onboarding on upgrade.
- New dark artwork variants, a new animation engine, rich interactive editing in the opening, or a live demonstration Agent run.
- Cloud collaboration, video, multiple canvases per artwork, asset libraries, template marketplaces, or website-publishing promises.
- Reworking unrelated interaction sounds, product theme policy, renderer architecture, or completion durability.
- Runtime implementation, music generation, paid media calls, release, or deployment as part of publishing this spec.

## Further Notes

- The owner approved the Chinese/English visual preview and all nine design decisions, with automatic dwell explicitly changed from five to three seconds. This is design-intent approval; it does not certify final assets, music, or runtime behavior.
- The comparison preview has six panels in two columns and three rows: Chinese left, English right. Its full dimensions are only 1201 × 1309; it is a visual reference, not six production-resolution assets. The approved preview and original concepts are retained in the design workspace; they are not currently attached to this issue. Obtain those references before producing faithful final artwork rather than substituting a newly invented visual direction.
- Formal production assets and the nine-second cue remain deliverables of the eventual implementation. Their visual/hearing review is a completion criterion, not a reason to invent more product decisions.
- Prior media-generation authorization is exhausted. This issue does not grant additional image or paid music calls; future production must use available approved material or obtain the required narrowly scoped authorization.
- Status: draft. Translation: pending. The issue is ready for implementation planning under the agreed scope; the written revision and final delivery are not automatically marked approved by the triage label.
