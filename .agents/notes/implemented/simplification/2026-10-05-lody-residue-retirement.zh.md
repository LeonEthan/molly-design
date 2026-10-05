# 清理桌面设计定位以外的 Lody 残留

Status: implemented
Translation: pending

## 摘要

Molly 的桌面设计主流程已退出开发者工具，但移动端死分支、回合 diff 生产和自动 Git 收尾仍留在代码中。此次沿既有消费者清理，复用桌面交互、Files 扫描、会话生命周期和设计保存，不增加协议或储存。既有 diff 快照、历史 worktree 恢复、原始工具历史与文件冲突保护仍保留。独立代码评审包、无消费者入口和未初始化的遥测包装层同时退出；云形协议和测试适配器按现有合同保留。

## 决策与边界

本记录补充 [开发者工作流退役](2026-09-11-developer-workflow-retirement.md) 和 [代码评审 viewer 退役](2026-09-21-code-review-viewer-retirement.md)，当前产品意图归 [设计 Spec](../../../../specs/graphic-design-platform.zh.md) 所有。过去已完成的代码与概念图不构成保留理由；此次没有新增产品能力。

复用阶梯先检查现有桌面组件、Files 完整扫描、共享 ACP history 和设计 Git 历史：它们已满足当前需要，直接使用并删除额外机制。没有必要改造移动 Sheet、Inbox 或滑动组件，也无需借用新的 diff 协议、自建快照储存或以 feature flag 维持死分支。

- 移动端检测本已恒为 false。移除它的消费者分支、移动 Sheet/Inbox、滑动动作、长按、下拉刷新、键盘 viewport 与 Drawer 适配。保留真实窄桌面响应式布局、弹出层 safe-area 和桌面选择/快捷键。
- 新回合停止 ACP/Git diff 采集、SQLite 快照写入、完整文本累积和自动 All Changes 派生。收尾复用 Files 刷新；工具 locations、状态与原始内容仍经过原 history pipeline。设计回执和最终画稿收集不改变。
- 前端历史 diff 摘要只读取既有会话事实，不再请求 provider 的 All Changes 或安排重试；设计会话不启动这项历史派生。历史快照仍可显式读取，保留当前文件预览、文本编辑、保存和冲突保护。
- 自动 PR 查询、分支名生成/重命名、Git baseline 和额外 commit/push Agent 提示退出。历史 GitHub/worktree 会话仍可恢复与清理；设计 Git 仓库继续隔离于用户仓库。
- 删除独立 code-review-helper 包、Storybook 脚本和 CI 专属规则，保留真正的产品文件图标。无消费者的 gh shim/token 注入、join 页面和错误适配器退出；旧 URL 本地重定向保持。
- PostHog 没有初始化或 Provider，包装层却仍可能安排 timer。同步移除埋点消费者、专属 helper/tests、SDK 依赖及无消费者的 shared analytics 导出。CLI 纯上报 ping timer 和埋点状态也退出；真实 presence 心跳、错误日志与进程清理接口保留。

删除整个 Code Collab 或云协议包会越过当前边界：Code Collab 仍负责文本保存、冲突校验和历史读取，云形 ports/DTO 及测试 Provider 仍是共享合同。对这些模块采用消费者级裁剪，而非整包删除。历史 worktree 设置也有明确恢复消费者。

## 证据与验证

- 移动端定向回归：17 个文件、118 个测试通过；CLI Files/历史 diff/ACP history 定向回归通过。
- 新回合回归检查实际提示序列、Git 命令记录和已处理历史；晚到 ACP 工具更新仍归属 enqueue 时的回合，且不新增 diff 快照。
- CI 范围选择器回归 38 个测试通过，退役包没有活跃引用。
- `pnpm check` 通过：类型、lint、全仓测试、i18n 与边界检查均通过；其中 CLI 261 个测试文件、3012 项通过（3 项跳过），components 421 个文件、3262 项通过。
- `pnpm build` 通过。首次打包自检仍发出已退役的 `turn-evidence` 任务；改为保留的 worker 的真实 `line-count` 输入与结果后，自检和桌面生产构建通过。
- `pnpm format`、`pnpm run docs check` 与 `git diff --check` 已完成，文档无错误。
- Chromium Storybook 输入焦点 E2E 8/8 通过，包含 620px 窄桌面；这不建立真实 Electron 交互验收。
- Codex CLI（gpt-6-astra、high、read-only）独立复核完成，未发现可报告的 P0/P1 回归。该意见是 advisory，不构成人类批准；复核自身的文件系统测试受只读沙箱限制，完整测试由本轮实际执行的 `pnpm check` 提供。

本记录不建立真实模型、Windows 或 Intel macOS 交互验收，也不授予 Spec approval。
