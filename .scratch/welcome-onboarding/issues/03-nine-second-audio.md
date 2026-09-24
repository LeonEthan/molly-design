# 03: Deliver the nine-second score with explicit sound recovery

**What to build:** The three-scene opening plays a newly produced, restrained nine-second instrumental cue with immediate mute control, natural ending, and deliberate recovery if autoplay is blocked. Users never wait for music to enter setup and never hear the cue restart because they unmute or click an unrelated control.

Produce and bundle the final cue together with its real playback behavior and listening acceptance. Do not split this into an audio-file-only task and a separate player task. Additional paid production calls require their own authorization; approval of this local plan does not grant that budget.

**Blocked by:** Ticket 01 — Deliver the approved three-scene bilingual opening and setup handoff.

**Status:** ready-for-agent

- [ ] Deliver a complete original nine-second instrumental: warm electric piano, sparse muted plucks, restrained light rhythm, and a connected motif across three three-second phrases; cadence and tail finish within the cue.
- [ ] The new cue is packaged locally, requires no cloud request, and is audibly reviewed in the actual opening. Do not abruptly truncate the old cue or reuse the superseded fifteen-/twenty-second brief.
- [ ] Initial playback attempts sound on at a restrained level. The sound control's visible/accessibility state matches actual muted, enabled, or blocked playback state.
- [ ] Muting silences immediately while opening time continues. Unmuting plays only the remaining cue at current elapsed opening time; after nine seconds it does not restart.
- [ ] If autoplay is blocked, scenes and setup navigation remain usable and the localized control offers Enable sound. Only activating this control attempts recovery; unrelated pointer/keyboard input cannot start the cue.
- [ ] Explicit recovery within nine seconds starts at the current opening position, not at zero. Recovery at or after nine seconds remains silent. Failures remain truthful and do not block setup.
- [ ] Audio position is independent of selected scene; scene changes do not cause seeking/restarts. This must remain true when ticket 02 is integrated, but the audio work can start without its new navigation UI.
- [ ] The cue never loops or navigates on completion. Skip, Start setup, and leaving the opening stop it immediately. A late playback promise after departure cannot restart sound.
- [ ] Extend existing mounted ceremony/audio lifecycle coverage using a controllable media fake, fake time, and explicit promise settlement. Verify playback position, paused/muted/ended outcomes, blocked recovery, and teardown; avoid real sleeps or call-count assertions.
- [ ] Record human listening acceptance for the full cue, early exit, mute/unmute, and blocked recovery; source/provenance and final cue metadata are retained with the asset.
- [ ] Update audio guidance to distinguish this behavior from the old global-gesture recovery. Foreground/background synchronization is completed in ticket 04.
