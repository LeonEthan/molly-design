# 04: Pause and resume the complete opening across desktop interruptions

**What to build:** When a user minimizes Molly or switches to another application, the complete opening pauses silently without consuming scene or cue time. Returning resumes from the same position, preserves manual-reading and sound choices, and still allows immediate setup entry.

Deliver the real desktop lifecycle integration and its composition with manual navigation and the final cue. Verify the completed experience on the installed desktop surface while preserving the existing setup/restart/completion contracts.

**Blocked by:** Ticket 02 — Let users revisit scenes and read with reduced motion.
Ticket 03 — Deliver the nine-second score with explicit sound recovery.

**Status:** ready-for-agent

- [ ] Minimizing or switching to another application pauses scene timing and audio together. Background time never counts toward the three-second intervals or nine-second cue window.
- [ ] Returning resumes the remaining scene interval and cue position rather than resetting either or catching up through unseen pages. Repeated/overlapping focus and visibility signals do not double-count pause time or trigger duplicate playback.
- [ ] Manual selection remains manual after foreground return; reduced-motion presentation does not acquire automatic advancement.
- [ ] Muted audio remains muted, blocked playback does not recover on focus alone, and an ended cue stays ended. The explicit Enable sound rule remains in force.
- [ ] Manual scene selection never derives a new audio position. Delayed enabling/unmuting uses foreground elapsed opening time even after one or more background pauses.
- [ ] Skip or Start setup during any reachable state stops audio and navigates to the existing Agent setup; timers/listeners/media are released, including pending-playback completion after departure.
- [ ] A settings Back visit starts a new opening at scene 1; closing during the opening restarts there, closing during setup restores its phase, and completed users continue to bypass onboarding after upgrade. No new durable welcome state.
- [ ] Deterministic mounted-flow tests cover partially elapsed scenes, repeated pause/resume, manual and reduced-motion states, muted/blocked/ended sound, late enable, and leaving during pending playback. Reuse existing native launch/completion tests for their ownership boundaries.
- [ ] On the real desktop surface, verify both locales, default/minimum sizes, supported zoom/high-density display, focus visibility, bundled assets, background silence, resume, and setup handoff using an isolated onboarding profile.
- [ ] Confirm the setup background and theme lifecycle remain unchanged. Record composed visual/hearing acceptance and the relevant repository-check results; earlier concept approval alone is not final acceptance.
- [ ] Update affected behavior documentation and retain evidence without committing captured user/Agent transcripts. No cloud requests, telemetry additions, new renderer, or setup redesign.
