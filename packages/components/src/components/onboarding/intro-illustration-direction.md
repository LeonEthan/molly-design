# Molly opening direction

The opening follows the approved three-scene bilingual direction in the
[welcome specification](../../../../../specs/welcome-onboarding.md) and its
[design record](../../../../../.agents/notes/proposed/feature/2026-09-24-welcome-graphic-design-directions.zh.md).
The handwritten Molly M remains separate from the artwork. A warm off-white shell,
restrained controls and generous space connect three distinct graphic compositions:

1. Inspiration: `../../assets/molly-intro-inspiration.png`, a water/type/architecture collage with a yellow accent. Chinese pairs the small English art phrase with the Chinese heading; English uses the phrase once as its heading.
2. Creation: `../../assets/molly-intro-creation.png`, a monochrome dancer, oversized FORM lettering and a slate-blue field. The localized callout and example label are real interface text. No invented date or venue appears. A thin UI connector joins the FORM selection’s lower-left corner to the localized callout, with a small dot at the callout end. It follows the contained image bounds when the window or zoom changes.
3. Expression: `../../assets/molly-intro-expression.png`, expressive brushwork around Make your mark. The localized supporting line sits below the artwork; Start setup replaces Skip.

Both languages share these three image assets. Headings, supporting text and controls
are localized DOM text, except Make your mark. which is part of the third artwork
and has an accessible text heading. Adjacent `.prompt.md` files record each authorized
image edit and actual delivered resolution. The six-panel concept preview is a review
reference, never a production screenshot crop. The final three assets require human
visual judgment; automated generation and checks do not establish legal clearance.

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

Step 01 retains the existing `../../assets/molly-opening-v1.mp3` and playback policy:
the opening twenty seconds of the previously authorized MiniMax Music-3.0 source,
normalized to -20 LUFS with a 0.4-second fade-in and four-second fade-out. It attempts
autoplay, supports mute and existing gesture recovery, never loops, and stops when
leaving the opening. This is deliberately an intermediate implementation: step 03
owns the new complete nine-second cue and explicit sound-button recovery; step 04
owns foreground/background pause and resume. No new music has been generated.

The earlier four-category artwork and audio production history remains in the
[independent-release record](../../../../../.agents/notes/proposed/feature/2026-09-13-geon-independent-brand-release.zh.md).
