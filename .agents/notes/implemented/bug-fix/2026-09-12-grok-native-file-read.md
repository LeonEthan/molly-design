# Preserve Grok native image file reads

Status: implemented
Date: 2026-09-12
Translation: pending

## Abstract

Builtin Grok delegated image file reads to Folio's advertised standard text RPC,
which decoded PNG bytes as UTF-8 before Grok could attach them to model input.
Folio now declines host text-read capability for builtin Grok so its existing
native reader handles images and text. Host writes, permissions, other providers,
and the standard text handler remain unchanged. A paired installed diagnostic
establishes the routing cause. The repaired normal package passes independent image,
native text, and permission/write acceptance with complete owned cleanup.

## Evidence and decision

Paired independent-file probes used normal source
`5b21c6aacbab1de4798ccecab087d04b69e8e482`, Grok Build 1.0.13 / ACP 0.1.0,
and a synthetic 256×256 PNG (1330 bytes, SHA-256
`8bcb47e5864ff6103692b8c791304aa6a050943ac149d82d07afd5480ed30555`).
They sent no attachment and established zero initial image blocks across all
roles. The fixture placed a separate PNG in the actual owned authoring directory;
it was not Agent-generated.

With normal `fs.readTextFile: true`, native `read_file` issued
`fs/read_text_file`, received 2168 UTF-8 bytes, and failed. Independent decoding
of the original PNG reproduced the response SHA-256
`70eb8ca7365fdf28998835094e40cc1b90e5951aba3b9d2bad68ece3a82764da`.
The main model received a binary error and no image. With only the initialize
read capability changed to false, the correlated native read completed without
that RPC; subsequent main `probe` requests contained the exact PNG in a tool-role
`image_url`. Native SKILL text reading also succeeded. The first round exited 1
at its original image assertion deadline; the contrast exited 0. Both completed
owned process/endpoint/directory cleanup. Synthetic evidence remains outside Git
in the host temporary directories `folio-t28-grok-input-lPtZB6` and
`folio-t28-grok-input-FFuLi0`.

The change uses AgentClient's existing builtin-provider capability negotiation,
alongside its Grok terminal compatibility. It does not reinterpret standard text
responses as binary, invent an extension, alter the public adapter submodule, or
modify the managed runtime. Custom agents named Grok retain host reads; host
writes remain advertised.

## Verification and limits

The focused authentication/initialization suite passes all 12 tests, including
builtin Grok, other builtin providers, custom Grok isolation, and standard UTF-8
write/read with line slicing. CLI typechecking and the full repository check pass. The first full check
failed two Claude authentication tests with inherited provider environment; the
child-only environment-filtered check passed without product/test changes.
Formatting and documentation checks pass. Normal source `81d54b6194017ba91aaec78509f9364ef743aa5f` was built, packaged,
privately installed and verified through its actual ASAR manifest. DMG SHA-256:
`aac7aa4c81056acae144b8e0521535dca1d031c86b484ea7074b4362afbe50d2`;
installed ASAR SHA-256:
`93609f470b607c88e41452dfdd80bf1a28e34dbffc957c9832ba0d91ef503aef`.
No diagnostic wrapper or capability injection was used in either normal round.

The independent image round (`folio-t28-grok-input-tvSRo6`, process handle 47383)
exited 0. Main request 5 had no images; after the correlated native reference read,
main requests 6/7/8 contained the exact 1330-byte PNG in tool-role image blocks.
Native SKILL reading passed. Owned cleanup finished at 2026-09-11T18:22:54.579Z.

The text/permission/write round (`folio-t28-grok-ordinary-94z2bY`, handle 56905)
also exited 0. Native text reading returned the original disposable marker. The
actual rejection returned a correlated native refusal for the `write` tool and
preserved that marker. Single approval returned the correlated native write
success and the file contained exactly 23 bytes,`APPROVED SYNTHETIC ONLY`.
Owned cleanup finished at 2026-09-11T18:23:42.336Z. An unclassified no-tool
provider request was retained without counting it as primary execution evidence.
These synthetic provider rounds establish native plumbing, not paid service
quality or user account authentication.

This does not resolve Grok's known HTTP cancellation behavior or missing design
generation boundary. Direct attachment input already worked with normal
negotiation; this repair concerns reading a separate PNG through a native tool.
See the [installed matrix](../../implemented/testing/2026-09-11-installed-five-agent-matrix.md)
and [hook boundary](../../rejected/architecture/2026-09-11-grok-design-hook-runtime-gap.md).
