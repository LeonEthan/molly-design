# Font fixture

`MollyTestSerif-Regular.ttf` is an ASCII (U+0020–U+007E) subset of the
repository's `website/assets/fonts/instrument-serif.woff2`, renamed to
Molly Test Serif. It retains Instrument Serif's outlines and the accompanying
SIL Open Font License in `OFL.txt`. Tests copy this committed font into their
Session workdir; no installed font is used for sample rendering.

Generated with FontTools `subset.Subsetter`, `populate(unicodes=range(32, 127))`,
with timestamp recalculation disabled, then cleared the WOFF2 flavor and renamed
name IDs 1/2/3/4/6/16/17 to the fixture family, Regular style and corresponding
full/PostScript names. FontTools is only needed to regenerate the fixture.
