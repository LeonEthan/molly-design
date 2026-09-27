# Turns and current projection use the YAML artwork entry

Status: implemented
Translation: current

[中文](2026-09-14-yaml-turn-projection.zh.md)

## Abstract

Design turns now collect Agent drafts from `design.yaml` only. A leftover `.pptd`, even an unchanged one, is not this turn’s artifact: collection records `no_artifact` and does not replace the current canvas. Human save publishes the same YAML layout (`design.yaml` / `pages/canvas.yaml` / `media/`) next to canonical storage without overwriting an unfinished draft. Version conflicts still leave that draft in place for explicit continuation; only the entry filename changed. Preview subscriptions, explicit import, skill guides, and PPTD fingerprint cleanup remain later tickets.

## Decision

Linked to the approved [graphic design platform](../../../../specs/graphic-design-platform.md) 2026-09-14 revision and the [YAML snapshot contract](2026-09-14-yaml-authoring-snapshot.md).

`DESIGN_ARTIFACT_ENTRY` reuses `ARTWORK_ENTRY` (`design.yaml`). Turn freeze, no-artifact detection, intake, and conflict diagnostics observe that file. Human create/save already exported through `exportAuthoring`; publication now names that seam rather than the deprecated PPTD alias. Workspace copy instructions point Agents at `design.yaml` and `pages/canvas.yaml`. A workspace with only leftover `.pptd` is `absent`. A workspace that also has `design.yaml` still fails closed on leftover PPTD.

A dual-entry collector (admit `.pptd` when YAML is missing) was rejected: that would keep PPTD as this turn’s artifact. Automatic conversion of leftover `.pptd` was also rejected. Conflict and explicit-resubmission behavior is unchanged except for the entry name.

## Verification and limits

CLI tests cover YAML turn collection, leftover `.pptd` as `no_artifact`, human-save projection without overwriting drafts, conflict draft preservation, and exact explicit resubmission. Desktop source-path watchers, idle explicit import, skill guides/examples, PPTD-E\* rename, and live ALD pins remain [#39](https://github.com/LeonEthan/Geon/issues/39)–[#41](https://github.com/LeonEthan/Geon/issues/41). Blind eval is [#42](https://github.com/LeonEthan/Geon/issues/42).
