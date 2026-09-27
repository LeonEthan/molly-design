# 内置 Molly 始终使用自动审批

Status: implemented
Date: 2026-09-27
Translation: current

[English](2026-09-27-molly-auto-review-only.md)

## 摘要

设计师使用内置 Molly 进行图片检索、生成、分层和画布微调时需要反复点击 Allow
（[#10](https://github.com/LeonEthan/molly-design/issues/10)）。自动审批早已自动批准这些步骤并继续拦截高风险效果，
但它只是可选模式，默认仍为逐次询问。所有者决定每次 Molly 运行都使用自动审批，退役询问模式，输入框不再显示 Molly
权限选择。已保存的 `ask` 选择仍被接受但不生效，使现有会话、Role 与缓存默认值继续可用；没有操作系统沙箱的主机仍逐条提示
shell 命令。目前只运行了类型检查和确定性测试，尚无新的桌面验收运行确认改动后的提示次数。

## 问题

[生成式分层设计记录](2026-09-24-generative-layered-design-workflow.zh.md)将自动审批作为可选模式引入，并保留询问为默认。
从未切换模式的设计师在使用 Molly 自有设计工具和编辑文件时会逐次看到提示。已验收的自动审批运行在完成调研、分层、预览和保存时
没有人工提示，因此提示来自默认值，而非能力缺失。

## 决定（所有者，2026-09-27）

记录于 [#10 分诊评论](https://github.com/LeonEthan/molly-design/issues/10#issuecomment-5855952365)：

- 每次新的内置 Molly 运行都把 `auto-review` 冻结进运行快照。
- Molly 目录不再发布 `mode` 选项或模式列表，现有权限按钮因此自行隐藏；其他 Agent 保留各自的权限控件。
- 早期会话、Agent Role、工作区目录及 `molly:agentSessionDefaults` 中保存在 `modeId` 或
  `configOptionValues.mode` 的 `ask`/`auto-review` 值被接受并忽略；未知值仍作为不支持的控制项失败。记录 `ask` 的早期快照仍可读取。
- worker 不变：仍读取冻结在快照中的模式，因此越界审查、分类器回退和无沙箱时的 shell 提示行为与之前一致。

## 考虑过的方案

- **只改默认值并保留选择器。** 所有者否决：设计师不应需要理解或选择权限模式。
- **从 worker 和快照 schema 中移除模式。** 暂缓：冻结字段属于持久运行日志，保留它可在不改 worker 的情况下维持早期 `ask` 运行的恢复。
- **拒绝已保存的 `ask` 值。** 否决：已保存的 Role 和缓存的输入框默认值会开始以 `harness_legacy_config_unsupported` 失败。

## 风险与限制

- 所有内置 Molly 用户现在都依赖 beta 版 `@anthropic-ai/sandbox-runtime` 以及改编自 `pi-auto-approval` 0.1.1 的锁定分类器。
  Agent 读取的不可信内容可能影响分类器；其批准仍仅限越界请求并记入日志。Molly 付费图像工具不再逐次提示。
- 在 Windows 或沙箱无法启动的环境中，shell 命令保留逐条提示；该 issue 在这些环境中只得到部分解决。
- 验证覆盖目录投影、快照冻结和旧配置接受的单元测试。改动后尚无打包桌面运行重新统计提示次数。
