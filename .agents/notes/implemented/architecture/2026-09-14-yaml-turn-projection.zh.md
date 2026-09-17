# 回合与当前投影改用 YAML 画稿入口

Status: implemented
Translation: current

[English](2026-09-14-yaml-turn-projection.md)

## 摘要

设计回合现在只从 `design.yaml` 采集 Agent 创作草稿。遗留 `.pptd`（即使未改）不是本回合产物：采集记 `no_artifact`，不替换当前画稿。人工保存把同一套 YAML 布局（`design.yaml` / `pages/canvas.yaml` / `media/`）发到权威存储旁，不覆盖未完成草稿。版本冲突仍把该草稿留在原地供显式继续；只改了入口文件名。预览订阅、显式导入、技能指南和 PPTD 指纹清扫仍属后续工单。

## 决定

关联已批准 [平面设计工作台](../../../../specs/graphic-design-platform.zh.md) 2026-09-14 修订与 [YAML 快照合同](2026-09-14-yaml-authoring-snapshot.zh.md)。

`DESIGN_ARTIFACT_ENTRY` 复用 `ARTWORK_ENTRY`（`design.yaml`）。回合冻结、无产物判定、intake 与冲突诊断都观察该文件。人工创建/保存本来就走 `exportAuthoring`；发布现在点名这条缝，不再用已弃用的 PPTD 别名。工作区拷贝说明把 Agent 指向 `design.yaml` 与 `pages/canvas.yaml`。只有遗留 `.pptd` 的工作区是 `absent`。同时存在 `design.yaml` 时，遗留 PPTD 仍闭门拒绝。

未采用双入口采集（YAML 缺失时收 `.pptd`）：那会把 PPTD 当成本回合产物。也未自动转换遗留 `.pptd`。冲突与显式重提交行为不变，只改入口文件名。

## 验证与限制

CLI 测试覆盖 YAML 回合采集、遗留 `.pptd` 记 `no_artifact`、人工保存投影且不覆盖草稿、冲突草稿保留、以及精确显式重提交。桌面源路径监听、空闲显式导入、技能指南/示例、PPTD-E\* 改名与 live ALD pin 仍留给 [#39](https://github.com/LeonEthan/Geon/issues/39)–[#41](https://github.com/LeonEthan/Geon/issues/41)。盲测见 [#42](https://github.com/LeonEthan/Geon/issues/42)。
