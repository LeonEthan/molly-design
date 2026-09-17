# Preserve the runtime model for automatic titles

Status: implemented
Translation: pending
Date: 2026-09-12

## Abstract

An isolated Grok title session started with the configured local model, then Folio
changed it to a listed built-in model and sent the title to another endpoint. The
shared title default previously selected the last model in a catalog, and settings
persisted that inference as an override. Defaults now omit model selection so the
actual new ACP session keeps its current model; explicit saved overrides still
apply. Existing records are not migrated because their provenance is unknown.

## Evidence and boundary

The retained installed Grok continuation log under
`folio-t28-grok-continue-KdI2bZ/evidence/cli-logs/2026-09-12.log` records the helper's
initial `probe` model at lines 473/512, Folio's `grok-4.5` override at 523–524 and
its remote 401 at 712/717/728. This establishes an explicit model override after
correct startup, not lost environment inheritance or evidence of real credentials
or payment. The [installed matrix](../../implemented/testing/2026-09-11-installed-five-agent-matrix.md)
owns broader native acceptance evidence.

The existing shared default function serves both settings initialization and title
startup. Removing its inferred model key fixes both paths without a new protocol,
provider-specific model list or runtime adapter change. Least-permission and low
reasoning defaults remain. A model's catalog position establishes neither cost nor
endpoint continuity.

Existing stored values remain overrides, even if they match a displayed default.
Do not guess which older values were automatically filled or erase them. The
existing title select allows an explicit model choice but has no automatic/reset
entry; this change adds no control. New configurations without an explicit choice
retain the actual runtime model. Existing configurations can still select the
intended model explicitly.

## Verification

Shared regression expectations first failed on the original last-model behavior.
Runtime tests observe the model at prompt time with differing current/last models
and an explicit override. Existing dialog tests verify actual new-provider submit
contains no inferred model and edit-save preserves an explicit current model.
No native run, package build or upstream change is part of this source fix.

Subsequent installed verification used normal source `5b21c6a`: actual isolated
helper requests retained `probe` and reached the configured local provider; a
separate UI-only SQLite readback verified that newly saved provider title options
omit the model key. The first two combined scripts failed on fixture/catalog
inspection issues and remain failed records; the independent storage case passed
without an Agent turn. The [installed matrix](../../implemented/testing/2026-09-11-installed-five-agent-matrix.md#normal-title-model-default-regression)
records the exact package, request identities, cleanup and verification limits.
