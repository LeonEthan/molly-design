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
first non-off level when `high` is missing. Reasoning is `off` only when no
connection is configured, and that Provider row opens Settings. The Agent
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
baseline, and a model-selector edit producing a cache patch. Desktop
acceptance on Linux is recorded in the pull request.

## Related

- Supersedes the Agent row in [three-level picker](2026-10-19-model-picker-three-levels.md).
