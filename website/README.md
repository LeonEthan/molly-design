# Molly Design website

Source for the official website, <https://molly-design.pages.dev>: a static, bilingual (English/中文) single page hosted on Cloudflare Pages.

This folder is not part of the pnpm workspace. It has its own `package.json` and lockfile for the local QA tools, and nothing in the desktop app or CI builds or deploys it.

## Layout

| Path | Contents |
|---|---|
| `build.py` | Build script (Python 3 standard library). Release constants `DMG`, `GH`, `SITE` sit at the top. |
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

The build writes `website/dist/` and prints the sha256 of `dist/index.html`. For the current source (release v0.1.1) it is `375b6db08a08f9a5ece4be0cca4d0cf4384f65e7e6ad36aaeb97404c2fb05b38`. The build fails on placeholder markup, release-page download links or missing assets.

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

It must match the sha printed by the build. Cloudflare serves `/index.html` and `/404.html` as 308 redirects to `/` and `/404`.

## Release: bump the DMG URL

Every download link on the site points straight at the release DMG, so each app release needs a site update:

1. Edit `DMG` at the top of `build.py` to the new release asset URL (`https://github.com/LeonEthan/molly-design/releases/download/vX.Y.Z/MollyDesign-X.Y.Z-arm64.dmg`).
2. Rebuild and run QA. The build refuses `releases/latest` or release-page URLs.
3. Deploy as above, then confirm a download link returns the new DMG.

Visible text never shows the version, so the copy and `docs/COPY.md` do not change.

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
- Geist and JetBrains Mono: SIL Open Font License 1.1; licence texts in `assets/fonts/` and listed in the repository `THIRD_PARTY_NOTICES.md`. The fonts are subset, which the licence permits because neither declares a Reserved Font Name.
