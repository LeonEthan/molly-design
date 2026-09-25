# Molly opening direction

The opening follows the approved three-scene bilingual direction in the
[welcome specification](../../../../../specs/welcome-onboarding.md) and its
[design record](../../../../../.agents/notes/implemented/feature/2026-09-24-welcome-graphic-design-directions.zh.md).
The handwritten Molly M remains separate from the artwork. A warm off-white shell,
restrained controls and generous space connect three distinct graphic compositions:

1. Inspiration: `../../assets/molly-intro-inspiration.png`, a water/type/architecture collage with a yellow accent. Chinese pairs the small English art phrase with the Chinese heading; English uses the phrase once as its heading.
2. Creation: `../../assets/molly-intro-creation.png`, a monochrome dancer, oversized FORM lettering and a slate-blue field. The localized callout and example label are real interface text. No invented date or venue appears. A thin UI connector joins the FORM selection’s lower-left corner to the localized callout, with a small dot at the callout end. It follows the contained image bounds when the window or zoom changes.
3. Expression: `../../assets/molly-intro-expression.png`, expressive brushwork around Make your mark. The localized supporting line sits below the artwork; Start setup replaces Skip.

Both languages share these three image assets. Headings, supporting text and controls
are localized DOM text, except Make your mark. which is part of the third artwork
and has an accessible text heading. Adjacent `.prompt.md` files record each authorized
image edit and actual delivered resolution. The six-panel concept preview is a review
reference, never a production screenshot crop. The owner accepted the final three
assets visually in the task conversation on 2026-09-24. Automated generation and
checks do not establish legal clearance.

`ceremony/intro-sequence.tsx` advances at 0, 3 and 6 seconds, then holds the third
scene indefinitely. Skip and Start setup immediately enter the existing setup path.
The artwork uses contain sizing; narrow layouts preserve readable copy and controls.
At enlarged zoom, the frame scrolls from its top and the footer can wrap, keeping
the sound and setup controls reachable when the CSS viewport is smaller than the frame.
The three progress segments are native buttons with localized names and current-page
state. Tab moves between sound, scene selectors and the setup action; Enter and Space
activate the focused selector. Selecting any segment, including the current one,
stops automatic advancement for that opening visit. Focus remains on the selector
while the scene changes. The full-screen opening opts into Electron Tab traversal
with `data-native-tab-surface`; other app chrome retains its existing policy.

Reduced-motion preferences disable automatic advancement and the fade. All scenes
remain available manually, and audio is not implicitly muted. Live preference changes
are observed; once a user has selected a segment, changing preferences or resuming
`playing` cannot restart automatic advancement. Returning from setup mounts a fresh
opening at scene 1 using the current motion preference. No selection/manual flag is
persisted, and selecting a scene does not operate on the audio player.

Local setup independently uses `MollySetupArtwork` with the existing
`../../assets/molly-editorial-v3.png`. Replacing opening artwork must not alter that
setup backdrop, its phases, completion persistence or theme ownership.

The opening now bundles `../../assets/molly-opening-v2.mp3`, a nine-second passage
from the user-supplied MiniMax track. Its extraction, processing, measured levels,
hashes and audible-watermark review boundary are recorded in the adjacent
`../../assets/molly-opening-v2.source.md`. The cue starts enabled at a restrained
level, never loops, and stops immediately on entry to setup. Muting does not stop
the opening clock; unmuting or explicitly enabling sound after blocked autoplay
seeks to the current elapsed opening time and cannot restart the cue after nine
seconds. Unrelated pointer and keyboard input may unlock interaction sounds but
cannot recover the opening cue.

`use-onboarding-audio.ts` owns one foreground elapsed clock. `IntroSequence` reads
that clock through `getElapsedMs` when preserving the remainder of a three-second
scene interval; selecting a scene never seeks the audio. In Electron, the main
window pushes its native foreground state through preload, which retains the
latest value for a newly mounted opening. This covers macOS minimize events that
do not change Chromium's document focus or visibility. The web fallback combines
window focus and document visibility. Repeated or overlapping signals have no
additional effect, and returning resumes the remaining scene interval and cue
position when the active foreground source permits it. Manual reading and reduced-motion mode stay manual; mute, blocked
autoplay and an ended cue retain their state. A new opening visit starts at scene
one, without persisting scene, elapsed-time or sound state.

The earlier four-category artwork and audio production history remains in the
[independent-release record](../../../../../.agents/notes/proposed/feature/2026-09-13-geon-independent-brand-release.zh.md).
