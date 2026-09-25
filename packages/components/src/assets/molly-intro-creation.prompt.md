# Molly intro creation artwork

- Method: built-in ImageGen edit; one authorized call, no retry.
- Source reference: `Codex generated-image artifact: 01a0d26f-8ae8-7320-8952-973e3bf368d7/exec-3de8477b-7bcf-4539-ae96-8eb2e47ff6e6.png`
- Native generated output: `Codex generated-image artifact: 01a0d2ec-f33e-78c0-a5cc-fbdf010e6e89/exec-c5a7859e-7291-460f-b81e-af27456da0cd.png`
- Actual dimensions: 1851 × 849 pixels; ratio 2.1802:1. Requested 2560 × 1174; no artificial upscaling.
- Inspection: standalone edge-to-edge poster; no app chrome, dates, venue, or external pointer line. Dancer pose, slate-blue block, title selection frame, and art typography retained. Generated interpretation is not pixel-identical to source.

The external pointer is restored separately by `CreationConnector` in the UI. Its start uses the selection’s lower-left corner at source pixel (75, 417), scaled against the displayed 1851 × 849 artwork; the endpoint follows the localized callout. The raster and original edit prompt below remain unchanged.

## Exact prompt

Use case: precise-object-edit.
Asset type: standalone high-resolution wide dance poster artwork for a desktop onboarding page.
Input image 1 is the EDIT TARGET. Extract and faithfully reconstruct ONLY its rectangular dance poster. Remove ALL surrounding application interface, filling the entire output with the flat poster composition.
Target output: 2560 x 1174 pixels, landscape aspect ratio approximately 2.18:1; highest available resolution. No outer padding, frame, drop shadow, app mockup or desktop UI.
Preserve the reference poster's exact layout and proportions: warm pale paper #F4F3EF; black-and-white dancer wearing the same flowing black dress, identical arched pose, head position, raised arm, lowered arm, body scale and bottom crop; slate-blue vertical rectangle behind the dancer on the right; huge bold black FORM at left and fine-line IN MOTION immediately below. Preserve the thin blue title selection rectangle around FORM and its four small square corner handles as artwork details.
Preserve small art typography: CONTEMPORARY DANCE PERFORMANCE at top-left; MOVEMENT CONNECTS US at top-right; BODIES / IDEAS / A BRIGHTER / TOMORROW at bottom-left with the short slash above; A MORE / HUMAN / TOMORROW at bottom-right with short rule above.
Remove the invented event date MAY 17–19 and venue RIVERDALE ARTS CENTER SHANGHAI completely; leave their area clean paper. Remove the long black pointer/callout line extending downward from the title selection box, the Chinese instruction bubble, and any remnants of them. Preserve only the short decorative slash above BODIES.
Remove Molly logo, sound control, Chinese app title and supporting sentence, Chinese Design example caption, all page indicators/progress lines, navigation buttons, and every other element outside the original rectangular poster. Do not introduce new text, dates, venues, shapes or different art direction. Faithfully keep the existing dancer pose, composition, crop, typography treatment and photographic texture. The rectangular poster itself should occupy the entire landscape image edge-to-edge.

