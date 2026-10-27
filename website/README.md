# Molly Design website

Source for the official website, <https://molly-design.pages.dev>: a static, bilingual (English/中文) single page hosted on Cloudflare Pages.

This folder is not part of the pnpm workspace. It has its own `package.json` and lockfile for the local QA tools, and nothing in the desktop app or CI builds or deploys it.

## Layout

| Path | Contents |
|---|---|
| `build.py` | Build script (Python 3 standard library). `GH`, `SITE`, and `DOWNLOAD` (stable arm64 DMG on the latest release) sit at the top. |
| `src/` | `slots.json` (bilingual copy), `style.css`, `site.js`, `404.html`, `_headers` (security headers, CSP, caching) |
| `assets/` | Web-ready assets only: WebP images, the demo MP4, subset fonts with their OFL licences, wordmark, icons, `og.png`, and `manifest.json` (sizes and provenance) |
| `docs/COPY.md` | Final EN + 中文 copy, generated from the rendered page |
| `docs/NOTES.md` | Decisions, claims rules, asset provenance and QA baseline |
| `scripts/copy.cjs` | Regenerates `docs/COPY.md` |
| `scripts/qa/` | QA suite, see below |
| `dist/` | Build output and deploy folder (git-ignored) |

## Build

```sh
python3 website/build.py
```

The build writes `website/dist/`, prints the DMG URL every download link uses, and prints the sha256 of `dist/index.html`. Download links use the pinned `DOWNLOAD` URL and do not call the GitHub API. The build fails on placeholder markup or a missing asset.

## QA

Needs Node and pnpm versions from `package.json`, Python 3, and Google Chrome installed (Playwright and Lighthouse drive the system Chrome; no browser download).

```sh
cd website
pnpm install
bash scripts/qa/run-all.sh
```

`run-all.sh` builds `dist/`, serves it on `127.0.0.1:8790`, and runs:

- `scan`: committed files for absolute local paths, token patterns, email-like strings, and size limits (1 MB per file, 6.5 MB total).
- `qa-no-preference`, `qa-reduce`: layout in EN/中文 × 360/390/640/768/1024/1440, 12 cases per run and 24 across both (overflow, image dimensions, broken images, console errors, HTTP errors).
- `nav`: header and footer GitHub links, language toggle and focus ring at 1440/768/390/360, with zero external requests.
- `a11y-*`, `csp-*`, `pause-*`: alt text, local links, reduced motion, production CSP from `_headers`, and video pause/resume, per language and width.
- `copy-generate`, `copy-current`: regenerated copy must match `docs/COPY.md`.
- `lighthouse`: mobile then desktop; Performance ≥ 95 and Accessibility, Best Practices, SEO = 100.

Results go to `website/qa-output/` (git-ignored): `summary.txt`, `logs/<check>.log`, `shots/`, `nav-checks.json`, `lh-mobile.json`, `lh-desktop.json`. Each run overwrites its own files and never deletes the folder. The script exits non-zero if any check fails.

Options: `QA_PORT` (default 8790), `QA_OUT` (artifact folder), `QA_CHROME_CHANNEL` (default `chrome`), `QA_EXTERNAL_LINKS=1` (also fetch external links in `a11y`; off by default).

## Copy

`docs/COPY.md` is generated from the built page. After a copy change, rebuild, serve `dist/` on the QA port, then:

```sh
node website/scripts/copy.cjs
```

## Deploy (manual)

Deploys are manual; no CI job deploys the site. Run the build and QA first, then from the repository root:

```sh
npx wrangler pages deploy website/dist --project-name molly-design --branch main
```

`wrangler` asks for Cloudflare login on first use. For a preview deployment, use `--branch website-preview` and check the preview URL it prints. After deploy, confirm the live page:

```sh
curl -fsSL https://molly-design.pages.dev/ | shasum -a 256
```

Compare it to the sha of the build you deployed. Cloudflare serves `/index.html` and `/404.html` as 308 redirects to `/` and `/404`.

## Release

Publishing a GitHub Release is enough when release CI uploads `MollyDesign-arm64.dmg` on each release (#250).

- Nav and footer "Releases" link to `https://github.com/LeonEthan/molly-design/releases`.
- The nav download button, closing, FAQ install and update answers, and the 404 page link to `DOWNLOAD` in `build.py` (`releases/latest/download/MollyDesign-arm64.dmg`), so a click starts the download without a GitHub HTML page.
- Version numbers stay out of visible text.

1. Publish the app release with the arm64 DMG attached (release CI also uploads the stable `MollyDesign-arm64.dmg` name).
2. Redeploy the site only when page content changes; the DMG URL does not change between releases.

## Assets

- Commit web-ready derivatives only. Raw captures and crafting masters stay outside git; `assets/manifest.json` records each derivative's source and crop.
- Use WebP for images. PNG is allowed only for `og.png` and icons.
- Every committed file stays under 1 MB.

### Excluded from the repository

These stay outside git and are never imported into `assets/`:

- Raw captures and crafting masters, including `assets/capture-raw/`, `assets/crafted-v7f/` and `assets/crafted-v7g/`. `assets/manifest.json` cites their file names as provenance only.
- Unused derivatives. `build.py` copies only the assets the page references into `dist/`, so a derivative no slot uses is deleted rather than committed.
- Scratch frames, screenshots, archives, logs, caches, and deploy folders (`dist/`, `qa-output/`, `node_modules/`).

Imported assets are only those the exact current deploy needs. Every file in `assets/` except the licence texts and `manifest.json` is byte-identical to a file in `dist/` for the current build, and the folder totals about 3 MB (2.9 MiB).

## Licences

- Site source and Molly-owned assets: FSL-1.1-ALv2, the repository licence. Each version converts to Apache-2.0 two years after its release. Versions released up to and including v0.1.2 remain available under Apache-2.0.
- Inter, Instrument Serif, Geist, and JetBrains Mono: SIL Open Font License 1.1. Full licence texts sit next to the fonts in `assets/fonts/` and are listed in the repository `THIRD_PARTY_NOTICES.md`. Subsetting is allowed because none of these files declares a Reserved Font Name.
