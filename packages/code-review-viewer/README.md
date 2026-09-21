# @molly/code-review-viewer

Private workspace build package that produces the prebuilt single-file
code-review viewer (`standalone.html`, all JS/CSS inlined) from
`@molly/code-review-helper`, so consumers embed one self-contained file instead
of bundling ~8 MB of viewer source.

Current status in Molly: retained build machinery. The OSS CLI has no `review`
command and this package is `private: true`, so nothing downloads it from npm or
a CDN; the `./manifest` export (version + sha256 of `standalone.html`) exists for
consumers that pin and verify the asset. Do not publish this package without a
reviewed packaging decision — see [AGENTS.md](AGENTS.md).

## Build

```sh
corepack pnpm --filter @molly/code-review-viewer build
```

`scripts/build-viewer.mjs` copies the helper's `standalone.html` here, computes
its sha256, and writes `dist/manifest.generated.ts`. The viewer source lives in
[`@molly/code-review-helper`](../code-review-helper); never hand-edit
`standalone.html`.
