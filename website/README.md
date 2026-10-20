# Molly Design website

Source for the official website, <https://molly-design.pages.dev>: a static, bilingual (English/中文) single page hosted on Cloudflare Pages.

This folder is not part of the pnpm workspace. It has its own `package.json` and lockfile for the local QA tools, and nothing in the desktop app or CI builds or deploys it.

## Layout

| Path | Contents |
|---|---|
| `build.py` | Build script (Python 3 standard library). `GH`, `SITE`, `DOWNLOAD`, and the offline `DMG_FALLBACK` sit at the top. The live DMG URL comes from the GitHub Releases API. |
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

The build writes `website/dist/` and prints the sha256 of `dist/index.html`. It needs network access: it reads GitHub Releases to fill the FAQ DMG link. The sha can differ between builds when that response changes. If the API is unavailable, the build uses `DMG_FALLBACK` in `build.py`. The build fails on placeholder markup or a missing asset.

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

Compare it to the sha of the build you deployed. A later build can print a different sha, because release data is fetched live. Cloudflare serves `/index.html` and `/404.html` as 308 redirects to `/` and `/404`.

## Release

Publishing a GitHub Release is enough. The site does not keep a hand-edited DMG URL.

- Nav and footer "Releases" link to `https://github.com/LeonEthan/molly-design/releases`. Closing and the 404 page link to `https://github.com/LeonEthan/molly-design/releases/latest`.
- FAQ install and update answers link to a `.dmg` chosen at build time. `fetch_github()` reads up to 100 releases, skips drafts and prereleases, and uses the first `.dmg` it finds, so a newer non-app release does not leave the FAQ on an older installer. `DMG_FALLBACK` is only the offline fallback. Do not edit it for a normal release.
- Version numbers stay out of visible text.

1. Publish the app release with the arm64 DMG attached, and do not mark it a draft or a prerelease if it should appear on the site.
2. Rebuild with network access and run QA. Confirm the FAQ href.
3. Deploy that build. The sha you confirm is the sha of this build, not a permanent fingerprint of the source.

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

- Site source and assets: Apache-2.0, the repository licence.
- Inter, Instrument Serif, Geist, and JetBrains Mono: SIL Open Font License 1.1. Full licence texts sit next to the fonts in `assets/fonts/` and are listed in the repository `THIRD_PARTY_NOTICES.md`. Subsetting is allowed because none of these files declares a Reserved Font Name.
