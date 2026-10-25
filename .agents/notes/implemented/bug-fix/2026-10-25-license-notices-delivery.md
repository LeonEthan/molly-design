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

## PR #242 review correction and notice sweep

The independent review of [PR #242](https://github.com/LeonEthan/molly-design/pull/242)
found that the newly packaged theme notice still called the first-party Molly
themes MIT. Its Molly section now states that Molly's modifications use
FSL-1.1-ALv2 under the root LICENSE, while the Vitesse Light Soft and Vesper
portions remain MIT with their existing copyright/license notices and paths.
Every subsequent third-party section is byte-identical to the pre-fix notice.
The existing staging map copies the corrected source; no packaging mechanism
changed.

The follow-up scanned 123 tracked notice, README, skill, license, font/asset,
manifest and generator candidates, then checked the delivered resource notices.
It also corrected the design-authoring README: its imagegen license copy is
verbatim upstream Apache-2.0, not MIT, while Molly-authored skill text and helpers
follow the package's FSL license. The upstream license bytes remain unchanged.
Root/product, website, adapter, generator and bundled design-resource declarations
already distinguish FSL from upstream terms and historical/future Apache grants.
Lody, Bento, upstream themes/fonts/icons, native reader licenses and pi-acp
attributions retain their existing licenses. Historical notes, old changelogs
and optional vendor submodules were excluded from current-license rewriting.

The initial sweep recorded two ambiguous scopes without changing them; the owner
decisions below now resolve both:

- Both design packages' `source-manifest.json` files then used
  `adapterLicense.spdx: Apache-2.0` beside the 2026-09-20 authorization, while
  the package license and README already said FSL. The field's historical-grant
  versus current-distribution meaning was unspecified; neither manifest
  is an input to the legal-resource staging map.
- `apps/electron/native/agent-browser/NOTICE.txt` calls the downstream build
  Apache-2.0 without separately scoping Molly's Rust patch. Its existing native
  resource notices were preserved rather than assigning the patch a new scope.

## Owner decisions on adapter metadata and agent-browser

The owner confirmed that `adapterLicense.spdx` denotes current distribution.
Both design manifests now use `FSL-1.1-ALv2`; `authorization` retains the
2026-09-20 Apache-2.0 grant and explicitly distinguishes the current FSL
distribution under the root LICENSE. `scope`, `notice`, source pins and file
hashes remain unchanged. Both package READMEs explain the two fields. Repository
search found no validator or test reading `adapterLicense`, so no executable
consumer needed adaptation or a new validation mechanism.

The owner also confirmed that the whole agent-browser binary is distributed as
a modified Apache-2.0 work. Its NOTICE and native-resource licenses remain
unchanged; the earlier question about separately scoping the Rust patch is
resolved without a notice edit.

The build flow reads the design manifests for pins, copies selected sources,
and emits selected build metadata; it does not stage either manifest. Inspection
of the existing review-corrected app's ASAR and unpacked resources found no
`source-manifest.json`. This metadata/documentation follow-up therefore does not
rebuild the package. The artifact evidence below records the review-fix source
at `f5acb394`; subsequent attribution regeneration changes only timestamps.

The owner-decision follow-up passed `pnpm check`, `pnpm format`, and
`pnpm run docs check` (zero errors, 18 size warnings, no registered SHA topics).
Two attribution regenerations differ only in timestamp from each other and
the pre-change source. A manifest audit verified that only `spdx` and
`authorization` changed in each JSON file, and that agent-browser's NOTICE
remains byte-identical. The full check retains the existing six skipped tests.

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
| `Lody-theme-NOTICE.md` | 4,786 |

`hdiutil verify` accepted the DMG checksum. Artifacts are
`apps/electron/dist/issue-241-review/MollyDesign-0.1.3-arm64.{dmg,zip}`. These
review-corrected artifacts supersede the initial `issue-241` package evidence.
The theme notice is SHA-256
`8c344fa43d4d744b98d3bd03ce1d9023cc2a5aa5344c4239e5f670aa01a529c1`
in source and all three inspected containers. SHA-256 for the archives:

- DMG: `870f7c1ff0c1d9ffe3341085e16a425a778211dcdb57ea89a8673ae7cde71423`
- ZIP: `d7f2e95e03936cbef5190f36ff22f88cd7c27b35606e30e850462eb080ee13bd`

After the review correction, legal-resource tests passed 16/16 again, issue-form
tests passed 15/15, attribution regeneration remained timestamp-only, and the
full `pnpm check`, formatting, docs check, build and macOS packaging passed.

The PR records exact inspection paths and output.
Developer ID signing, notarization, Windows/Intel execution,
old tags, Flock AGPL analysis, and #233 review threads remain outside this task.
