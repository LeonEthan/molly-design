# Unchanged PPTD does not become a new turn artifact

Status: implemented
Translation: pending

## Abstract

A successful turn that left an old PPTD unchanged could create a candidate solely
because the canvas differed. T01 removes that passive promotion: a matching
frozen dispatch digest now records `no_artifact` before conversion or canvas
comparison. Files, existing candidates, historical outcomes and receipts remain
readable. Missing dispatch evidence retains legacy validation and atomic save
behavior; explicit resubmission evidence is separate work.

## Decision and scope

Implements [Issue #3](https://github.com/LeonEthan/Folio/issues/3) and the confirmed
[scope decision](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md#旧文件自动候选删除裁定与实施拆分).
This supersedes only the old passive offer rationale described there. It does not
retire version-conflict candidates, change dispatch manifests, add an attempt
ledger, or depend on preview/import UI delivery.

The collector still reads the bounded artifact snapshot first. A refused snapshot
remains invalid; only a present digest equal to the dispatch digest proves no
change. Missing legacy content evidence cannot establish that fact and continues
through the existing intake, asset assembly, store schema and atomic baseline
check. A same-byte rewrite is not an explicit resubmission fact. A later attempt
mechanism must establish its own content and version evidence.

The alternative was retaining a passive candidate for visibility. The confirmed
scope rejects that attribution: ordinary conversation must not claim an old
workspace project. The trade-off is that old work is no longer surfaced by a new
candidate before explicit file access/import is available. No data cleanup is
necessary. Existing stamps and matching receipts still recover the old verdict
before applying the new classification.

## Verification

Deterministic synthetic-project tests cover equal and different canvases,
unchanged invalid projects, same-byte rewrites, historical candidate/content/
receipt preservation, changed valid and invalid projects, missing legacy dispatch
evidence, baseline conflicts, receipt recovery, cancellation and failure. The
collector integration tests exercise the real intake and design store using
isolated temporary directories; no Agent or paid tool is invoked.

Targeted validation: 41 tests passed (34 collector tests and 7 dispatch-input
tests). `corepack pnpm format` completed; its unrelated pre-existing Electron
test formatting change was reverted. `corepack pnpm run docs check` passed with
21 existing size warnings and no SHA-protected topics; `git diff --check` passed.
The required full `corepack pnpm check` passed, including typecheck, lint, the
CI test suite, i18n and both platform/public boundary guards.

Dependencies were installed independently with Node 22.22.0 and pnpm 10.20.0.
The initial Electron postinstall failed downloading Sparkle from GitHub (connection
timeout); installation then completed using the existing
`LODY_SKIP_ELECTRON_POSTINSTALL=1` switch. No Electron packaging success is claimed.
Kimi was only checked out for an existing documentation link, not installed into
the root workspace. Claude authentication environment variables were filtered
only in the check subprocess, preserving the user's environment.
Desktop UI and live Agent/daemon execution are not exercised for this collector
change. Translation remains pending; this implementation does not approve the
[design Spec](../../../../specs/graphic-design-platform.zh.md).
