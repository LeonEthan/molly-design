# Skills teach the YAML canvas

Status: implemented
Translation: current

[中文](2026-09-14-yaml-canvas-skill.zh.md)

## Abstract

The graphic-design skill, composition/replication/format guides, bundled example, and optional helpers now describe only the YAML artwork projection: `design.yaml`, `pages/canvas.yaml`, `media/`, and Bento `id` / `kind`. The materials are original Geon text; they do not adapt an external poster relationship table, few-shot families, or PPT five-step workflow. Finalize remains optional and is not a commit gate. This note covers the skill slice only. Turns, preview/import, helper rename, PPTD-E\* codes, and live ALD unpin are not claimed done.

## Decision

Linked to the approved [graphic design platform](../../../../specs/graphic-design-platform.md) 2026-09-14 revision and the [YAML snapshot contract](../architecture/2026-09-14-yaml-authoring-snapshot.md).

An Agent following the skill writes a tree that `collectAuthoring` / `intakeAuthoring('design.yaml', …)` accepts. `pptd-authoring.md`, `poster.pptd`, and `pages/poster.page` are deleted. Rewritten skill files are marked `original` in `source-manifest.json` so the build no longer claims they are ALD adaptations. Helper scripts already targeted `design.yaml`; missing `geon_render_preview` is described as that tool only.

Rejected: adapting an external 8-row relationship table into a shorter Geon table; keeping `pptd-authoring.md` as a filename while changing its body; treating finalize as a commit gate.

## Verification and limits

Staging tests in `apps/cli/src/design/skills.test.ts` read delivered graphic-design bytes and require the YAML layout, `id` / `kind`, and the absence of the retired relationship table and PPTD v2/v3 authoring fields. `packages/design-authoring/tests/intake.test.ts` collects the bundled example and runs `intakeAuthoring('design.yaml', …)`. Skill-script tests continue to operate on `design.yaml`; the packaged-skill test also forbids the retired legacy phrases. Helper rename, `GEON-E*` codes, and live ALD unpin are covered by their respective checks. Turns and preview/import are covered by their own deterministic tests.
