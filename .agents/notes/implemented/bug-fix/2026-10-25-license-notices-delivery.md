# License notices and packaged delivery after the FSL migration

Status: implemented
Translation: pending

## Abstract

[Issue #241](https://github.com/LeonEthan/molly-design/issues/241) closes three
declaration and distribution gaps after the FSL migration. Molly-owned adapter
and website declarations now use FSL-1.1-ALv2 while retaining the adapters'
historical Apache authorization and third-party exceptions. Issue forms use
neutral component wording, and validation accepts both generations of the form.
Packaging stages and verifies readable legal files through the existing Builder
hooks; this fix ships in the v0.1.3 release artifacts. This work does not establish
overall license compatibility or approve publication.

## Decisions and provenance

- Reuse the attribution generator and existing locale key; keep internal type and
  file names. The visible title is “Licenses & Notices” / “许可与声明”.
- Regeneration previously removed the Inter and Instrument Serif website font
  notices added to the generated Markdown. Their existing OFL exceptions now
  live in the generator alongside Geist and JetBrains Mono.
- Keep exact checked-confirmation matching and add alternatives for only the
  changed component confirmation. Old and new wording both require a checked box.
- Reuse `beforePack` resource staging, `files` includes after Markdown exclusions
  (the browser-cookie-reader license pattern), `asarUnpack: resources/**`, and
  `afterPack` validation. A small shared legal-file map supplies staging and
  verification; no separate packaging or legal manifest mechanism is needed.

Upstream was checked at Lody commit
[`7c13287b6d6b607dcf1f91fd76d2b2469bddd21c`](https://github.com/LodyAI/Lody/tree/7c13287b6d6b607dcf1f91fd76d2b2469bddd21c).
Its [LICENSE](https://github.com/LodyAI/Lody/blob/7c13287b6d6b607dcf1f91fd76d2b2469bddd21c/LICENSE)
is the standard Apache 2.0 text, with the literal appendix placeholder
`Copyright [yyyy] [name of copyright owner]` and no project-specific copyright
line. The local [copy](../../../../LICENSES/Lody-Apache-2.0.txt) preserves those
bytes verbatim. The recursive upstream tree has no root NOTICE; its only NOTICE
is the [bundled theme notice](https://github.com/LodyAI/Lody/blob/7c13287b6d6b607dcf1f91fd76d2b2469bddd21c/packages/components/src/lib/vscode-theme/bundled/NOTICE.md).
All its sections remain in the local theme notice. Packaging also copies that
retained notice as `Lody-theme-NOTICE.md`, alongside the four files required by
the issue. [Root NOTICE](../../../../NOTICE) scopes Apache to retained Lody-derived
material and identifies the separate FSL product license.

## Verification and limits

The focused issue-form suite passes all 15 cases, including both wordings for
both forms and missing/unchecked confirmations. The legal resource suite passes
all 16 cases, including exact source-byte copies and each file missing, empty or
whitespace-only. Two generator runs differ only by timestamp; all 1,201 entry
licenses match main except the explicitly changed Molly adapters. All four
website fonts retain OFL-1.1. The generator also refreshes the installed
`@google/genai` version from 2.21.0 to the lockfile's 2.23.0.

`pnpm check`, `pnpm format`, and `pnpm run docs check` passed. The first sandboxed
check failed on denied local sockets; the full rerun with local socket access
passed. Documentation has only existing size warnings and no registered SHA
topics. The focused issue-form suite was also run explicitly after formatting.

The local macOS arm64 build and package passed the existing native probes and the
new legal-file gate. The `.app`, ZIP entries, and read-only mounted DMG each
contain byte-identical, nonempty UTF-8 copies under
`Molly.app/Contents/Resources/app.asar.unpacked/resources/licenses/`:

| File | Bytes in each artifact |
| --- | ---: |
| `LICENSE` | 3,765 |
| `NOTICE` | 2,680 |
| `LICENSES/Lody-Apache-2.0.txt` | 11,358 |
| `THIRD_PARTY_NOTICES.md` | 205,088 |
| `Lody-theme-NOTICE.md` | 4,651 |

`hdiutil verify` accepted the DMG checksum. Artifacts are
`apps/electron/dist/issue-241/MollyDesign-0.1.3-arm64.{dmg,zip}`. SHA-256:

- DMG: `7cf9a40a5bec1e476772d02878afaecdd46a4f88c7ab2c8b434e7a008fcc4046`
- ZIP: `7c807eecfe791e90c356faf5cf9ea96151a742bec3a470a7ed11b02b905979ba`

The PR records exact inspection paths and output.
Developer ID signing, notarization, Windows/Intel execution,
old tags, Flock AGPL analysis, and #233 review threads remain outside this task.
