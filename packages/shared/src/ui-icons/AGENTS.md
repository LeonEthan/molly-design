# UI icon geometry

`CLAUDE.md` is a symlink to this file; edit `AGENTS.md` only.

- Edit the canonical `svg/*.svg` files, then run `pnpm --filter @molly/shared
  icons:generate`. `icons:check` verifies the derived TypeScript; generated geometry
  is consumed by the React facade and native Bento chrome.
- Keep a 24×24 viewBox, 1.5 currentColor outline and round caps/joins. Judge optical
  weight at 16, 20 and 24px in both themes. Selection changes the surrounding control,
  not the glyph's stroke. Use only the generator's static shape/attribute grammar.
- This module owns operation/status glyphs. Provider brands, file-type logos, user
  emoji, charts and artwork retain their own geometry. Keep runtime exports free of
  React, DOM access, filesystem access and icon-library dependencies.
