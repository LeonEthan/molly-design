# Molly embedded runtime

This private package powers Agent execution and local design storage inside the
Molly desktop app. It is not a separately installed CLI product. Start desktop
development with `corepack pnpm start:local` from the repository root. Internal
process arguments and the workspace package name remain implementation interfaces.
The embedded service uses only the local installation identity. An explicit cloud
platform launch is refused; no product-cloud login or remote host is started.

## Host port upgrades

The local host lease now uses loopback port `17792`. Explicit internal commands
`daemon stop` and `daemon restart` can also stop a detached Molly daemon from an
older build on `17790`, including while a new Electron host waits on `17792`.
The legacy lookup applies only to the default local TCP endpoint, outside E2E.
The live daemon's mode, PID and instance must match the active installation's
complete PID record before the existing token-authenticated shutdown is sent;
the request revalidates that identity and waits on the selected endpoint.
Foreign hosts never receive the token. No PID signals, data migration, legacy
lease acquisition or automatic desktop shutdown are added. Windows pipes,
cloud endpoints and isolated E2E endpoints retain their own scope.

## Design turn collection

`src/design/turn-outcome.ts` compares the collected PPTD project with the content
frozen at dispatch. A matching digest records `no_artifact` before import, even
when the current canvas differs. Identical rewrites do not prove a new attempt.
Existing files, candidates, history outcomes and commit receipts stay intact;
recorded outcomes and matching receipts still take precedence over collection.

Legacy manifests without dispatch content evidence retain the existing validated
import and atomic version check; missing evidence is not proof of unchanged
content. Changed projects retain structure, asset and version validation. Explicit
resubmission attempts and broader candidate retirement are separate work.

## Design image connection

Design sessions with an enabled URL/key/model connection expose
`molly_generate_image` (JSON `/images/generations`) and `molly_edit_image`
(multipart `/images/edits`, ordered workspace files and an optional PNG mask).
The user must provide a model; existing explicit values are preserved. Each call
returns a content-addressed workspace asset without changing or committing PPTD.
The connection probe checks `/models` only, not image endpoint support; provider
rejections remain visible without automatic paid retries or model fallback.
Attachments, image reading, preview rendering and existing artwork editing/export
remain independent.
