# Preparing editable fonts

Keep the selected face's complete glyph set, character mapping and metrics.
Compressing a complete face to WOFF can meet the 16 MiB asset limit without
restricting later text edits. Do not subset to the current copy to make an asset
fit. If a complete compatible font still exceeds the limit, choose an appropriate
complete alternative within the user's direction or resolve the limitation with
them. Do not silently substitute a prescribed font.

The optional `scripts/font-prepare.mjs` helper needs Python 3 with `venv`.
It explicitly installs pinned FontTools 4.60.2 in a separate environment. It does
not require a global install or Brotli, and ordinary authoring does not require
running it. If Python or network access is unavailable, use another available
compatible font or report the preparation limit.

From the Skill directory, read `node scripts/font-prepare.mjs --help`. Choose a
new environment directory in the session workspace outside the collected artwork,
or under the shell's supplied `$TMPDIR`. Replace the placeholders below with
actual paths; keep the selected environment's Python path for all later commands:

```sh
node scripts/font-prepare.mjs setup <environment-directory>
node scripts/font-prepare.mjs faces <source-font> --python <environment-directory>/bin/python
node scripts/font-prepare.mjs woff <source-font> <artwork>/media/heading.woff --face <index> --python <environment-directory>/bin/python
```

On Windows use the returned `Scripts/python.exe` path. The face listing reports
family, style, weight and coverage; explicitly select the correct index from a
TTC collection. The helper preserves the source, refuses to overwrite output,
checks the 16 MiB limit, and verifies tables (except the computed checksum), glyph
mapping, glyph order and horizontal metrics before writing. Its report concerns
conversion, not rendering or font licensing; use fonts permitted for the task.

Register the new file with its matching weight/style in `customFonts`. Render
and read a native preview early. In a separate temporary draft, check plausible
future copy containing characters absent from today's design, without changing
the deliverable's wording. Glyph preservation does not promise characters absent
from the original font, and neither conversion nor validation proves native
rendering. Preserve the original artwork and normal save history when repairing
an existing document; this helper never commits an artwork.
