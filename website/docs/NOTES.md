# NOTES — Molly Design website decisions

Trimmed from the v7 working notes (rounds v7 → v7i, 2026-10-17). This file keeps the decisions and constraints future edits must respect. Per-round chatter, session logs and local paths are not kept.

## Status

- Live at `https://molly-design.pages.dev` (Cloudflare Pages project `molly-design`), deployed manually.
- #175 changed the page; #250 pins every download link to `releases/latest/download/MollyDesign-arm64.dmg`. The build no longer calls the GitHub Releases API for the DMG URL, so `dist/index.html` is stable offline.
- Bringing the source into the repository was a migration only: no design, copy or animation change. The redesign after that migration is #175.

## Build pipeline

- `build.py` (Python 3 standard library) reads `src/slots.json` (bilingual copy as `[[zh||en]]` pairs), `src/style.css` and `src/site.js`, inlines CSS and JS, and writes `dist/index.html`.
- `@@A:key@@` placeholders resolve to content-hashed files copied into `dist/assets/`; only assets the page uses are copied. Root files (`og.png`, icons, `_headers`, `404.html`, `robots.txt`, `sitemap.xml`) keep fixed names.
- WebP derivatives carry `srcset`/`sizes` and explicit width/height. AVIF was not added: every browser that can run the macOS download (Safari 14+) supports WebP, and Lighthouse reports no image-format opportunity.
- Video: H.264 MP4, faststart, no audio, poster frame, `preload="none"`.
- Fonts on the page are self-hosted Inter (variable, latin), Instrument Serif (regular and italic, latin), and JetBrains Mono. Chinese text uses system fonts. Geist remains in `assets/fonts/` but the page does not request it.
- Build guards (`sys.exit`): placeholder markup (`ph-tag`, `ph-block`, `placeholder`, `占位`), a missing asset, or 404 referencing an unshipped asset. Nav and footer "Releases" go to the GitHub releases index.

## Claims and honesty rules

- Facts: Apple Silicon (arm64) only, macOS 13 Ventura or later. The app is Developer ID signed and notarized; the DMG itself is never called signed.
- No version numbers in visible text (#175, #184). No plugins, roadmap, stats, testimonials or customer logos.
- "Real capture" wording is scoped to sections that show real app captures (the recorded edit, the export menu, workflow and explores screenshots, the sample wall of real exports).
- The hero is a crafted animation and has no visible illustration label. Its bilingual aria-label says the regenerated sage stoneware kettle is image-generated, and that the cutouts and the repaired background are crafted for this illustration.
- Sample-wall brands are made up and the captions say so: Stillwater Clay, Ember Current, Tideform, Juniper Wharf, Moss & Ember.
- The research capture shows a 1936 WPA public-domain poster as a reference inside the built-in browser, not as Molly output. It is the only third-party artwork.
- "Connect a model" was removed from the demo: the only Settings capture shows provider and model names. "Your key stays on this computer" remains in the hero bullets and FAQ.

## Downloads

- The nav download button, closing, `404.html` (`@@DMG@@`), FAQ install and update answers (`@@DMG@@` in `slots.json`) and JSON-LD `downloadUrl` all use `DOWNLOAD` in `build.py`: `https://github.com/LeonEthan/molly-design/releases/latest/download/MollyDesign-arm64.dmg`. Release CI uploads that stable filename alongside the versioned arm64 DMG (#250). Nav and footer Releases link to the GitHub releases index. The hero has no download button.
- GitHub serves a release asset with `Content-Disposition: attachment` after a redirect to its CDN, so these links start a download without a GitHub HTML page (#245). Use `releases/latest/download/<name>`, not the `releases/latest` HTML page.
- A normal app release needs no website rebuild for the DMG URL. See README, "Release".

## Asset provenance

Every shipped image and video was checked by eye. Raw masters (app captures and crafting sources, about 127 MB) stay outside git; `assets/manifest.json` records each derivative's source name and crop for reference. Regenerating derivatives from raw masters is out of scope here.

| Slot | Asset key(s) | Source |
|---|---|---|
| Pillar 1 (layers) | `p1-v7b` | Layers-panel capture |
| Workflow 01 brief, 06 export | — | Text and illustration only |
| Workflow 02 research | `wf-research-v7c` | Research capture (Wikimedia Commons references) |
| Workflow 03 options | `wf-options-v7c` | Directions board A/B/C capture |
| Workflow 04 layers | `wf-kv` | Tideform KV sample in the app window |
| Workflow 05 edit | `wf-edit-v7c` | "honey oat" still after a client revision |
| Demo A "Change a word" | video `edit-v7c`, poster `edit-v7c-poster` | Real screen recording, 9 s, muted |
| Demo B "Export" | `export-v7c` | Export menu over the Stillwater Clay page |
| Explores trio | `p-research-v7c`, `p-options-v7c`, `p-decide-v7c` | Crops of the research and options captures; "You decide" shows the agent waiting for the pick |
| Sample wall | `s-detail`, `s-longform`, `s-kv`, `s-social`, `s-packaging` | Real Molly exports (made-up brands) |
| Hero tiles | `hx-kettle`, `hx-latte`, `hx-forest`, `hx-ribbon` | Crops of the sample exports |
| Hero plate | `hero-plate` | Generated landscape photograph, 1536×864 |
| Hero kettle | `hero-kettle` | Generated speckled stoneware cutout, 1014×782 |
| Hero kettle, regenerated | `hero-kettle-next` | Glaze edit of `hero-kettle` (sage stoneware, gpt-image-2), fitted to the same 1014×782 frame |
| `og.png` | — | Real wordmark plus the Tideform KV export, 1200×630 |
| Wordmark, icons | `brand/`, `icons/` | Real Molly wordmark and icon |

## Hero animation

- The hero demo rest frame is a 1536×864 landscape. A warm stone photograph fills the stage edge to edge, with the counter across the bottom. The left column is vertically centered: a header rule, the two-line poster headline, the spec rows, and the tagline. The speckled kettle is a separate transparent layer, large on the right, and “Object study · 2026” sits beside it (#184).
- The loop selects that kettle layer, drags it, and scales it from the kettle’s bottom center so the base stays on the counter. The size readout counts from 100% to the final scale while that handle is dragged. Regenerate then crossfades it to a second sage stoneware kettle in the same frame. The return eases back to the original cream kettle and the rest frame. The second image loads after the plate has painted, including when reduced motion is turned off after load. `prefers-reduced-motion` keeps the rest frame and does not run the loop.
- Desktop placement stays `left: 44%`, `top: 29.3%`, `width: 40%`. At 700px and below, the left column uses 28px of padding and the plate extends 1px under the stage clip so the rounded edge does not reveal the stage background. The size readout is kept inside the stage.
- The hero headline is one sentence per line in both languages. The second sentence keeps the highlight. The subheadline under it is gone (#184).
- The plate photograph is the LCP element. The labelled image role describes the still; it does not change which element Lighthouse paints first.

## Videos

- Videos autoplay muted only while in view, play once, then show native controls for replay; they do not autoplay again after finishing.
- With `prefers-reduced-motion`, nothing autoplays and controls show from the start.

## Secret safety

- Shipped images, video frames and `og.png` were checked by eye for keys, tokens, emails, account names, owner project names, logged-in third-party accounts, model or provider names, and the macOS recording indicator.
- `scripts/qa/scan.cjs` checks the committed folder for absolute local paths, token patterns, email-like strings and file sizes.

## QA baseline

`scripts/qa/run-all.sh` covers: layout in EN/ZH × 360/390/640/768/1024/1440 with and without reduced motion (24 cases in total), navigation and GitHub link checks at 1440/768/390/360, accessibility, production CSP and video pause/resume at EN/ZH × 1440/768/390, COPY drift, the repository scan and Lighthouse. Baseline at migration:

| Run | Perf | A11y | BP | SEO | LCP | TBT | CLS | LCP element |
|---|---:|---:|---:|---:|---|---|---|---|
| Mobile | 99 | 100 | 100 | 100 | 1.9 s | 0 ms | 0 | `div.hero > div.wrap > div.hero-copy > h1` |
| Desktop | 100 | 100 | 100 | 100 | 0.4 s | 0 ms | 0 | `div.hero > div.wrap > div.hero-copy > h1` |

Mobile performance has varied from 95 to 99 between runs; the gate is ≥95.

## Known limits

- The regenerated hero kettle is a glaze edit of the original cutout in the same frame. The plate photograph supplies the counter and the shadow.
- The cursor press is subtle and best judged in motion.
- Native video-control focus is drawn inside the browser's shadow DOM, so the a11y checker logs those stops without a CSS ring.
- Three existing GitHub Issues links remain in the page alongside the repository and DMG links.
- No finished "You decide" poster or "Connect a model" capture exists; a future capture round could add them.
