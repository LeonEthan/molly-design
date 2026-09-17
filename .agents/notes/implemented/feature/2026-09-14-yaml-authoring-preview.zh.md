# YAML 创作预览与显式导入

Status: implemented
Translation: current

[English](2026-09-14-yaml-authoring-preview.md)

## 摘要

创作预览现在监听打开设计会话的 YAML 画稿投影（`design.yaml`、`pages/canvas.yaml`、必要 `media/`），并显示只读、未提交视图。空闲时的显式导入把用户已预览的 YAML 快照经校验后保存为当前画稿。遗留 legacy `.pptd` 不是监听或导入源。无效或不稳定文件保留上一份有效预览，且从不清空当前画稿。本记录只覆盖预览切片；回合采集、技能与指纹规则分别维护。

## 决定

关联已批准 [平面设计工作台](../../../../specs/graphic-design-platform.zh.md) 实时预览条款、[YAML 快照合同](../architecture/2026-09-14-yaml-authoring-snapshot.zh.md)（[#37](https://github.com/LeonEthan/Geon/issues/37)），以及 PPTD 时期的 [实时预览](../architecture/2026-09-11-pptd-live-preview.zh.md) 决策。快照缝已只承认 YAML；本切片让桌面预览订阅和空闲导入跟随该入口。

`design/source-path` 解析 `@geon/design-authoring` 的 `ARTWORK_ENTRY`（`design.yaml`）。观察从该文件开始，再按 `collectAuthoring` 报告扩展到 `pages/canvas.yaml` 和被引用的 `media/`。`buildPreviewPayload` 走同一采集器导入 YAML；遗留 `.pptd` 被拒绝，不会成为可导入的源身份。显式导入仍绑定已显示的 BentoDoc/素材快照，在画稿变更闸门下 flush，并使用 canonical CAS。失败保留画稿、未保存修改和工作区文件。

未采用 YAML 与遗留 `.pptd` 双监听：遗留文件不是入口。预览仍不提交、不改写 Agent 草稿基线、不订阅应用产生的投影文件。

## 验证与限制

确定性测试覆盖 YAML 观察依赖、遗留 PPTD 拒绝且无可导入身份、存在遗留 `.pptd` 时 source-path 仍解析 `design.yaml`、观察回退监听、无效/不稳定预览保留，以及导入已显示快照。原生核验夹具改为写入 YAML。回合采集、人工保存发布、无产物判定、技能重写、PPTD-E\* 改名与 source-manifest 解钉分别由各自测试覆盖。
