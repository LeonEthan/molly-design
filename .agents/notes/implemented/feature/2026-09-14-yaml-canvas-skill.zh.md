# 技能只教 YAML 画布

Status: implemented
Translation: current

[English](2026-09-14-yaml-canvas-skill.md)

## 摘要

graphic-design 技能、构图/复刻/格式指南、捆绑示例和可选助手现在只描述 YAML 画稿投影：`design.yaml`、`pages/canvas.yaml`、`media/`，以及 Bento 的 `id` / `kind`。材料是 Geon 原文，不改编外部海报关系表、few-shot 家族或 PPT 五步流程。finalize 仍可选，不是提交门槛。本记录只覆盖技能切片。不宣称回合、预览/导入、助手改名、PPTD-E\* 码名或 live ALD unpin 已落地。

## 决定

关联已批准 [平面设计工作台](../../../../specs/graphic-design-platform.zh.md) 2026-09-14 修订与 [YAML 快照合同](../architecture/2026-09-14-yaml-authoring-snapshot.zh.md)。

按技能写出来的目录可被 `collectAuthoring` / `intakeAuthoring('design.yaml', …)` 接受。已删除 `pptd-authoring.md`、`poster.pptd` 和 `pages/poster.page`。重写后的技能文件在 `source-manifest.json` 标为 `original`，构建不再声称它们是 ALD 改编。助手脚本本已指向 `design.yaml`；缺少 `geon_render_preview` 只说明该工具不可用。

未采用：把外部八行关系表压成更短的 Geon 表；文件名仍叫 `pptd-authoring.md` 只改正文；把 finalize 当提交门槛。

## 验证与限制

`apps/cli/src/design/skills.test.ts` 的物化测试读取 graphic-design 交付字节，要求 YAML 布局、`id` / `kind`，并排除已退役关系表和 PPTD v2/v3 创作字段。`packages/design-authoring/tests/intake.test.ts` 采集捆绑示例并运行 `intakeAuthoring('design.yaml', …)`。skill-script 测试继续操作 `design.yaml`；同一物化测试现在禁止遗留短语。助手改名、`GEON-E*` 码名与 live ALD unpin 由各自检查覆盖。回合与预览/导入由确定性测试覆盖。
