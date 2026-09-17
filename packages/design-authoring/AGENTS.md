# Package rules

- The root `AGENTS.md` "Design platform: agent-naive environment" section binds
  this package: intake performs structural validation only; nothing here may
  repair, re-run, or gate agent behavior.
- `src/contracts.ts` is the only import path into `packages/design-bento/vendor`.
  Vendored code is never edited here; adaptations belong in this package.
- The frozen capability matrix reaches runtime only through
  `src/generated/capability-matrix-bytes.ts` (built by `scripts/build.mjs`) plus
  the `FROZEN_MATRIX_SHA256` re-check in `src/capability-matrix.ts`. Never read
  the vendored `v1.json` via filesystem paths at runtime — that breaks under
  bundling.
- Upstream-adapted files (`.prettierignore` lists them) stay close to the pinned
  upstream for reviewable diffs; `source-manifest.json` records every migration
  and is enforced by the build.
- Agent materials describe real format/capabilities and optional methods, never
  fixed creative sequences, analysis methods, review counts or finalize gates.
  Missing tools do not imply the absence of other Agent visual capabilities.
- Skill directories must be self-contained after materialization: scripts may
  import only `node:*` builtins or the bundled `scripts/lib/molly-authoring.mjs`.
- `src/generated/` and `skills/graphic-design/scripts/lib/` are build outputs;
  never edit them by hand.

- The snapshot contract admits only the YAML artwork projection (`design.yaml` with `format: molly-canvas/1`, `media/`). Read legacy `geon-canvas/1` with identical
  validation; writes use the new format and reads never rewrite source bytes. Leftover `.pptd` and PPTD v2 syntax fail
  closed. Projection reuses the existing Bento v4 editable fields (`id` /
  `kind`) and kernel replay through `contracts.ts`; replay validates but never
  repairs output. Keep exact run boundaries, optional values, IDs, array/z
  order, flat groups and asset bytes. Only schema asset locations may be
  rewritten. Omitted `fontFamily` does not become MiSans; Inter is the bundled
  licensed default family name. Update `projection-capabilities.ts` and
  roundtrip fixtures with any supported field change; never add a second
  canonical blob to the format.

- Read-only previews collect the entry and semantic assets only.
  Bound reads and compare exact document/asset bytes across observations; stability
  is not author completion. Conversion consumes only those frozen bytes.

- Digest-only authoring reads reuse the collector's path and file-identity checks,
  stream fixed-size buffers in sorted path/length/byte order, and preserve the
  existing full-snapshot digest. Do not add a smaller total-size admission limit.

- Former two-file YAML is accepted only by the explicit migration helper, with
  guarded collection and a fresh output directory. Preserve source bytes, current
  artwork, history and turn receipts. Digest-only reads retain the former page path
  to fingerprint inherited drafts; they never confer format admission or submission.
