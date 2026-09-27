# First design onboarding and image settings

Status: implemented
Translation: pending

## Abstract

The reused onboarding still offered coding examples and created a generic Session,
while image settings could enable Save for an endpoint the stored schema rejected.
Folio now offers design examples, initializes the existing canvas before accepting
the first design Session, and uses the shared connection validator in the form.
Product entry remains independent of background creation; the existing landing
draft holds recovery input and its reserved identity across the route transition.
This changes no image service, configuration storage or mandatory setup steps.

## Decision and responsibilities

The [Spec](../../../../specs/graphic-design-platform.zh.md) remains draft; the
[scope review](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md)
sets reuse boundaries. Agent/Role/MCP settings and the image connection continue
using their existing catalogs. Image generation and editing share the user-entered
connection and required model introduced by the
[image tools work](2026-09-11-image-generation-editing.zh.md).
A successful models-list probe does not establish generation/edit/mask support.

First Task keeps the chosen published Agent and explicitly saved session model/options.
It never chooses Pi or supplies an image model. Its existing navigation-first behavior
is retained: making Session persistence a completion prerequisite would strand users
behind optional execution setup. The ordinary landing draft carries the prompt and
canvas association; submitting is moved from component state to an in-memory atom
scoped by that same draft key to prevent competing Send actions across route unmount.
The existing design create, save, association, side-panel and acknowledgement path is
reused. Failed save/acceptance keeps the draft, reports an error and releases submitting;
accepted history is authoritative and acknowledgement failure cannot resend it.

The intro retains approved illustrations and production tour composition. Its local
copy no longer promises cross-device continuation; real Agent setup status and the
optional exploration exit remain intact. Language, appearance and image setup are
not added to the local step list. Developer-only tour surfaces remain owned by the
separate product-entry convergence, not a new tour implementation.

## Verification

The full `corepack pnpm check` passed twice (typechecking, lint, package tests,
i18n, import/platform/public boundaries). Focused onboarding and image-form tests
passed 37 cases, including design save/acceptance failures after unmount, explicit
Agent/model retention, changed-draft preservation and storage rehydration. Root
formatting, scoped formatting, docs check and diff whitespace checks passed.

The built macOS desktop was exercised with separate Electron user data and CLI
data directories. Its real settings path rejected an empty model and credential-
bearing URL, saved a synthetic explicit model/key, reopened that model unchanged
without prefilling the key, displayed the real local closed-endpoint test error,
and disabled testing after key removal. No image endpoint or paid model was called.
The first exploratory launch lacked the CLI data override and is excluded from
fresh-profile evidence; ordinary startup may write caches/metadata even without
an explicit settings action.

The existing desktop smoke suite initially passed onboarding but failed its two
Session scenarios: launching the built main JavaScript file made `app.getAppPath()`
point at `out/main`, so the design worker resource path did not exist. Launching the
Electron package directory uses the same `package.json` main entry and fixes resource
resolution. The harness retains its two isolated data directories, unique CLI host
endpoint and environment allowlist. After this one-argument correction, `e2e:check`
and `e2e:smoke` passed: 3 scenarios / 18 steps, including cold onboarding, actual
custom Agent settings and Session lifecycle. The external ACP provider is the existing
synthetic fixture; these results do not establish commercial Agent/model quality.

The existing P1 desktop probe also passed on this build with no image connection:
manual canvas edits, save, hide/reopen, undo/redo, invalid-write refusal, conflict
preservation, and 913×617 PNG/JPEG export. Its exported bytes matched the established
P1 fixture. This is development-build macOS evidence, not a new packaged release
or cross-platform certification. Full first-task creation after onboarding unmount
is covered by deterministic component tests; the native smoke creates its Session
from the ordinary landing composer. The later combined Agent/hook matrix remains
outside this ticket. No PR, Issue, package or release was published.
