# YAML authoring preview and explicit import

Status: implemented
Translation: current

[中文](2026-09-14-yaml-authoring-preview.zh.md)

## Abstract

创作预览 now watches the YAML artwork projection of the open 设计会话 (`design.yaml`, `pages/canvas.yaml`, needed `media/`) and shows a read-only uncommitted view. Idle 显式导入 saves the already-previewed YAML snapshot as 当前画稿 after validation. Leftover legacy `.pptd` is not a watch or import source. Invalid or unstable files keep the last valid preview and never clear the current artwork. Preview is one independently scoped slice; turn collection and skill behavior remain separately maintained.

## Decision

Linked to the approved [graphic design platform](../../../../specs/graphic-design-platform.md) live-preview clauses, the [YAML snapshot contract](../architecture/2026-09-14-yaml-authoring-snapshot.md) ([#37](https://github.com/LeonEthan/Geon/issues/37)), and the PPTD-era [live preview](../architecture/2026-09-11-pptd-live-preview.md) decision. The snapshot seam already admits only YAML; this slice makes desktop preview subscriptions and idle import follow that entry.

`design/source-path` resolves `ARTWORK_ENTRY` (`design.yaml`) from `@geon/design-authoring`. Observation starts on that file, then expands to `pages/canvas.yaml` and referenced `media/` reported by `collectAuthoring`. `buildPreviewPayload` intakes YAML through the same collector; leftover `.pptd` is refused and never becomes a source identity. Explicit import still binds the displayed BentoDoc/assets snapshot, flushes under the artwork gate, and uses canonical CAS. Failures keep the artwork, unsaved edits, and workspace files.

A dual watch of YAML plus leftover `.pptd` was rejected: the leftover file is not an entry. Preview still does not commit, rebase Agent drafts, or subscribe to application-produced projection files.

## Verification and limits

Deterministic tests cover YAML observation dependencies, leftover PPTD refusal without an importable identity, source-path resolution of `design.yaml` while a leftover `.pptd` is present, observation fallback watches, retained invalid/unstable previews, and explicit import of the displayed snapshot. Native verification fixtures now write YAML. Turn collection, human-save publish, no-artifact detection, skill rewrite, PPTD-E\* rename, and source-manifest unpin remain separately covered.
