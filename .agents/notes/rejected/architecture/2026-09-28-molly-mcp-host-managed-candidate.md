# Superseded host-managed MCP candidate

Status: rejected
Translation: pending

## Abstract

The isolated issue #41 candidate preserved Molly-specific MCP contracts through a local adapter patch and depended on upstream adoption. The user rejected that direction in favor of the ordinary, unmodified Pi adapter chain. Its experiments remain historical evidence in an exact-content archive, while the current implementation has a separate record. The candidate's review document is not an active implementation plan or a production acceptance claim.

## Decision and retained evidence

The [triage decision](../../proposed/architecture/2026-09-28-pi-mcp-adapter-triage.md#current-decision-ordinary-integration-no-customization)
supersedes this candidate; [standard integration](../../implemented/simplification/2026-09-28-standard-pi-mcp-integration.md)
records the selected implementation. This rejected proposal does not belong under
`archived/`, which is reserved for previously implemented decisions.

The [original review bundle](2026-09-28-molly-mcp-host-managed-candidate.tar.gz)
contains all 15 original files under `molly-mcp-integration-review/`, including
`REVIEW.md`, both manifests, evidence, patches, licenses and reproduction scripts.
Its SHA-256 is `242771c364da6c429b15fed23a779836875130b1b45e7be4a87da8a340b444c7`.
The archive preserves file contents and modes; archive timestamps and ownership
are normalized. Extract it into a separate directory to read or reproduce the
historical candidate according to its bundled README.

`REVIEW.md` previously sat inside the active notes tree without note metadata or
the required dated path. Editing that artifact would break its recorded hash.
Instead, the duplicate unpacked bundle was replaced by this dated rejection note
and archive. Before removal, every archived file was compared byte-for-byte with
its original, and all 14 root-manifest and seven upstream-manifest artifact hashes
passed unchanged. The original `REVIEW.md` SHA-256 remains
`6b99c2fc084402ae23d54698eb8e6a963855d15b669fc5a4dd978a3def977b8e`.

The documentation checker and recorded test results are unchanged. No reproduction
script, dependency install, runtime change or paid request was performed for this
organization-only correction. No registered SHA topic required confirmation.
`pnpm run docs check` now passes with zero errors; existing instruction-size
warnings and pending translations remain visible.
