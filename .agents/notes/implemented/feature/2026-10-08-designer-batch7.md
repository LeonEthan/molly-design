# Designer batch 7: a selection chip row, and sleep blocked only while Molly works

Status: implemented
Translation: pending

PR: pending

## Abstract

The two items left from the 2026-10-07 audit, both confirmed by the owner on 2026-10-08 ("agree": a separate selection chip row, and keeping the computer awake only while a run is active), plus a second pass on reply length once paid runs were authorised.

## Decisions and reuse

- **Selection chip row (#17).** A canvas selection now shows as a removable chip above the input, in the composer's existing reference-chip row (beside comment and annotation chips), instead of as `@Selected elements (1)` inside the draft. The composer holds the selection as state keyed by session; the canvas still drives it through the same sync call, renamed `syncDesignSelection` and `referenceDesignSelection`. At send, the chip is appended after the typed text as a design-element mention and expanded by the existing rewrite, so the agent-side marker and the transcript chip are unchanged. A chip alone does not make a message sendable, it travels only with text or attachments, it clears after an accepted send, and it does not follow the user into another conversation. Adding an action prompt still refuses while an IME composition is active (the textarea reports it through `isComposing`), as the old inline insertion did. The inline-token bridge in the textarea was removed as dead code; old drafts that already contain a design-element mention still expand.
- **Sleep (#29).** `WindowBadge` gains a `working` count (sessions the user owns with a fresh running, initialising or permission-waiting presence). The main process sums it over windows, which already drop their share when a window closes, and tells the CLI service whether any run is active. The power-save blocker is held only while the setting is on and a run is active. The setting stays on by default (it protects a long run without costing battery while idle), which reverses the batch 6 default, because with run-only blocking the earlier battery concern no longer applies. Its label now says "while Molly works".
- **Reply length (#15), second pass.** Batch 6's wording still produced "I previewed … and confirmed it renders cleanly" and unprompted tweak offers in a real run. The skill now names what to leave out (success checks, what stayed unchanged, offers of more tweaks) and gives a one-sentence example of a good bounded-edit reply.

## Not done

- Reporting only runs on this machine's sessions is by presence freshness (90 s TTL), so a run whose heartbeat stops is no longer counted.

## Verification

- Unit tests: input area (chip shown, removed, sent with the message, kept when the send is rejected, not sendable alone, session-scoped, prompt appended), the append helper, badge aggregation and parsing, the renderer's working count, and the sleep default plus run-only blocking.
- Live, on a clone of the owner's data with kimi-k3 at max reasoning: a canvas click produced the chip with an empty draft; sending an edit with the chip made the agent change exactly the selected headline and the transcript showed the selection chip; the Electron process held a macOS no-idle-sleep assertion for the whole run (about four minutes) and released it when the run ended, with none while idle; after the skill change the same one-line edit got the reply "Done: the headline now reads “JAZZ EVENING”, set slightly smaller so the longer word fits comfortably inside the frame."
- Not exercised live: the chip's remove button, and a multi-window case.
