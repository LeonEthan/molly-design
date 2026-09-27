# 去掉现行 PPTD/Kimi 指纹

Status: implemented
Translation: current
[English](2026-09-14-drop-live-pptd-kimi-fingerprints.md)

## 摘要

运行时与包来源不再把 PPTD 或 Kimi 当作现行创作格式。技能辅助包是 `geon-authoring.mjs`，面向 Geon 的诊断码是 `GEON-E*`，被排除的远程渲染探测名为 remote renderer，冻结矩阵行仍是 `common.kimiRuntime`。已重写技能和 PPTD 目录/示例不再作为 live ALD 校验；`source-manifest.json` 去掉 Folio 文案。本记录描述此前的现行表面边界，回合、预览和技能原文仍分别维护。

## 决定

关联[YAML 快照合同](2026-09-14-yaml-authoring-snapshot.zh.md)。

未改 vendored Bento。冻结的 `PPTD-E*` 表和 `common.kimiRuntime` 留在 `packages/design-bento/vendor`。创作包在 `src/live-diagnostics.ts` 映射现行诊断，并把被排除的渲染器呈现为 `common.remoteRenderer` / payload `remote`。辅助脚本导入 `scripts/lib/geon-authoring.mjs`；构建会删除遗留的 `geon-pptd.mjs`。

已重写的 `SKILL.md`、辅助脚本、`pptd-authoring.md` 以及捆绑的 `poster.pptd` / `poster.page` 不再是 live ALD verbatim/adapted pin。其余 `src/` intake 文件仍记录为 pinned ALD authoring 包的 adapted；imagegen LICENSE、sample prompts 和 `swatch.png` 仍为 verbatim。一次性迁移事实留在本记录，不进技能或运行时合同。

未采用 YAML 文件仍自称 PPTD/Kimi 的双面呈现。未分叉 vendor 诊断，以免破坏 `FROZEN_MATRIX_SHA256`。未改写 Git 历史。

## 验证与限制

`packages/design-authoring` 测试覆盖辅助路径、发出的 `GEON-E*` 码、远程渲染呈现和已 unpin 的清单行。包构建会再检查这些现行表面规则。CLI 回合/预览路径和技能教学继续明确拒收遗留 PPTD。
