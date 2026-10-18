# Website guidelines

`CLAUDE.md` symlinks here; edit `AGENTS.md` only. Read [README](README.md) and
[NOTES](docs/NOTES.md) before changing the site.

- Owner-approved exception (#161) to the root public-source boundary: this
  static site's source is public. It holds no hosted backend, Web or mobile app
  code, operator config or credentials; keep it that way.
- `website/` is a standalone static site, outside the root pnpm workspace and
  lockfile. Keep its QA tools in `website/package.json`; never add it to the root
  workspace, the desktop build or CI deploy.
- Deploys are manual (`wrangler pages deploy`); agents never deploy, log in to
  Cloudflare or change Pages settings without explicit owner approval.
- Pure migrations and refactors keep `dist/` byte-identical; compare the sha
  printed by `build.py`. Design, copy or animation changes need owner approval
  and a regenerated `docs/COPY.md`.
- Follow the claims rules in NOTES: no version numbers in visible text; never
  call the DMG signed; keep the hero `Illustration` label; scope "real capture"
  wording to real captures.
- Downloads use the `DMG` constant only; never link `releases/latest` or the
  release page.
- Commit web-ready derivatives only: WebP images (PNG only for `og.png` and
  icons), no raw captures or masters, each file under 1 MB. Record provenance in
  `assets/manifest.json`.
- No absolute local paths, secrets, emails, or captured user data in committed
  files; `scripts/qa/scan.cjs` enforces this. Upstream licence texts stay
  verbatim; if one ever contains a public legal contact, add a narrow scan
  allowlist entry for that address rather than editing the licence.
- `src/` ships verbatim as deployed, so root oxlint ignores `website/src/**/*`
  (#161); `build.py` and `scripts/` stay lint-clean.
- Scripts stay portable: resolve paths from the script location, bind servers to
  127.0.0.1, and exit non-zero on failure.
- Run `bash scripts/qa/run-all.sh` after any change and report its summary and
  `qa-output/` artifacts.
- Fonts are OFL-1.1; keep the licence texts in `assets/fonts/` and the
  `THIRD_PARTY_NOTICES.md` entry when fonts change.
