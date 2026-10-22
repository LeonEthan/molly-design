# Composer picker is Provider, then Model, then Reasoning

Status: implemented
Translation: current
Issue: [#192](https://github.com/LeonEthan/molly-design/issues/192)

[中文](2026-10-20-composer-provider-hierarchy.zh.md)

## Abstract

The composer model picker led with an Agent row that always named Molly, and
the home composer repeated that as an Agent chip. Both composers now open
Provider, Model, and Reasoning, in that order, as one submenu each. Model
lists only the selected provider's models, and Reasoning lists only that
model's levels. Changing a provider or model keeps a child that is still
valid and otherwise selects the first model and reasoning `high`, or the
first non-off level when `high` is missing. With no connection, Reasoning is
`off` and that Provider row opens Settings. A configured
model that publishes only `off` shows Reasoning Off and sends `off`. A model
with no connection id and no group is a provider of its own, after the
connection providers. `session.cycleProvider` cycles those providers. The Agent
chip is removed and is not replaced; the image-model chip stays. The
selection is stored in the existing agent-defaults cache and a session-scoped
record so it survives restart. On a canvas, that record includes a model
chosen through the model config selector, and a record for the current turn
outranks the runtime baseline until the turn revision changes.

## Decision

Providers are read from the model catalog already shown in the picker
(`molly-model:<connection>/<model>`, or an ACP group). The connection-list
API and connection types stay untouched so this can rebase onto #181/#190.

There is no "All providers" scope and no nested popover. A provider pick
that leaves the current model behind selects that provider's first model,
then re-validates reasoning. A flat catalog with no connection id stays one
unlabeled list. Sends keep using the resolved model id, which already names
the connection.

## Verification

Component tests cover provider filtering, row order, a provider whose models
lack `high`, the empty Settings row, the removed Agent chip, and the absence
of an Agent row. Unit tests cover the default, child re-validation,
revision-scoped persistence, a stored model and reasoning beating the runtime
baseline, a model-selector edit producing a cache patch, and a model that
publishes only `off` showing Reasoning Off, an ungrouped row staying out of
the first provider, and the provider cycle command. Desktop
acceptance on Linux is recorded in the pull request.

## 2026-10-21 follow-up: shared reasoning on provider change

PR: [#227](https://github.com/LeonEthan/molly-design/pull/227)

[#212](https://github.com/LeonEthan/molly-design/issues/212) fixes a gap in child
re-validation: a grouped registry/custom catalog lost its shared reasoning ladder
when a provider change selected a different model without a per-model mapping.
The hierarchy now uses the supplied fallback whenever the target mapping is absent.
Explicit target mappings still take priority, including an empty mapping that means
display and dispatch `off`. The obsolete original-model parameter is removed.

The menu and provider-cycle command already share this resolver, and selector
normalization already retains shared options for an unmapped model. Reusing these
paths avoids caller-specific fixes or new state. This restores the existing valid-child
guarantee; it does not change model-pick behavior or the catalog-default scope of #213.
Regression tests first failed for missing mappings, then passed after the fix;
they cover absent tables, missing/partial mappings, explicit empty and nonempty
target mappings, cycle selection, and effective submit values. The related
hierarchy, config-selection and picker component suites pass (44 tests).
Before PR publication, full `pnpm check`, `pnpm format`, and `pnpm run docs check` passed.
No native desktop or real-model acceptance was run for this follow-up.

## 2026-10-21 follow-up: flat catalog default model submission

[#213](https://github.com/LeonEthan/molly-design/issues/213) exposed a mismatch
for an ungrouped registry/custom model config selector: the picker displayed the
first usable model, while submission omitted an empty/invalid value or retained
the unselected sentinel. Default-model backfill was nested inside the connections
branch even though the hierarchy resolver also derives defaults for flat catalogs.

The existing backfill now runs after the connections branch, reusing its guards
and the hierarchy-derived model. Connections-mode model and reasoning normalization
remain in their original branch. Valid model choices remain unchanged; a complete
runtime snapshot that omits the model key still owns that omission unless the user
edits it. The hierarchy resolver already supplies the display default, while the
submission filter only validates offered values, so adapting backfill avoids new
state, caller-specific defaults, or changing filter responsibilities.

Eight deterministic submission cases cover absent/empty/sentinel/invalid preferences,
an invalid runtime value, a valid second model, runtime omission, and a user edit
over that omission. Five cases failed before the fix. After the fix, the related
config-selection, hierarchy, and picker suites pass (52 tests). Full `pnpm check`
passed outside the sandbox after local socket tests hit `listen EPERM` and stalled
in the restricted run. Changed-file formatting and `pnpm run docs check` passed;
existing docs size warnings remain. No native desktop or real-model acceptance
was run for this follow-up.

## Related

- Supersedes the Agent row in [three-level picker](2026-10-19-model-picker-three-levels.md).
