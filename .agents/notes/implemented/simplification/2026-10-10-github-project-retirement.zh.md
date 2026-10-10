# GitHub 项目入口退役，保留本地 worktree

Status: implemented
Translation: pending
PR: [#114](https://github.com/LeonEthan/molly-design/pull/114)

## 摘要

Molly 的 GitHub 项目选择与 PR 展示仍暴露已退出设计主流程的能力，底层历史恢复又依赖同一套 worktree 管理器。本次移除新建独立 GitHub 项目、远程仓库准备和 PR 交互，保留本地 worktree 与子代理会话工具。旧会话从已有本地仓库恢复，保留已接受任务和共享父工作区的子会话；所需本地状态缺失时明确失败并保留幸存文件，不迁移或清理历史数据。组件回归与真实本地 Git fixture 验证了保留路径；桌面实机验收仍是单独边界。

## 决策与责任

本记录续接 [Lody 残留清理](2026-10-05-lody-residue-retirement.zh.md) 与 PR #113；当前产品意图归 [设计 Spec](../../../../specs/graphic-design-platform.zh.md)。用户确认第二批清理并明确保留 worktree。`molly_session_*` 与 `molly_operation_*` 是子代理编排能力，不随开发者界面退役。

复用阶梯先检查 `UnifiedProjectSelectorView`、本地 Files/skills 索引和 `WorktreeManager`：选择器与索引可直接裁剪远程分支；管理器需要适配为历史本地恢复，因为原样保留仍会 clone/fetch。无需借用新模式、自建 worktree 管理器、引入协议或增加存储。

- MCP 显式创建输入仅接受 chat/local，本地 `worktree: true` 保留；GitHub 查询参数和仓库候选退役。历史 GitHub 父会话的子会话仍共享父工作区。已接受 Operation 的查询和固定目标恢复保持原合同。
- 桌面移除 GitHub 项目、仓库分支选择、Issue/PR 联想、PR 页签与徽章/菜单。旧默认项目退回 chat；持久 PR 页签读取为 Files，已存草稿引用和历史消息 span 保留。现有文件 provider、本地技能、旧回合 diff 和浏览器预览继续复用。
- GitHub 的 `ProjectRef` 历史解码保留。`WorktreeManager` 仅校验已有 bare 仓库；缺失目录通过同一会话的记录分支恢复，不能回退到 main 或初始化空仓库。已有目录也必须校验仓库，仓库丢失时强制清理不能进入手动目录删除兜底。
- 本地 shared worktree 的新分支分配、冲突后缀、捕获提交、setup、归档备份与脏目录保护保持。旧 GitHub 的 setup/cleanup 配置继续从历史记录读取。
- 删除无消费者的 GitHub token port、Git 凭证 helper 和 clone/fetch 鉴权参数；用户凭证与已生成文件保留。

## 权衡与独立意见

另一条可行路线是拒绝所有旧 GitHub 会话执行，实现更简单，但会破坏已承诺的历史恢复。按仓库工作流运行的 Codex CLI 第二意见（`gpt-6-astra`，high，read-only）建议复用管理器，只移除自动获取/刷新并拒绝新建；本次采纳这一边界。该意见没有修改文件。最终只读审阅另发现旧 speculative marker 的 `repoUrl` 会因目标不再携带 URL 而误判不匹配，触发旧目录清理。主 Agent 用真实本地 Git fixture 复现后，调整 GitHub marker 比较仅使用仍有意义的仓库 id、来源类型与 base branch；本地来源仍逐字段比较。新增测试确认未提交文件和原分支在认领、完成 setup 后均保留。

“本地恢复”描述 Molly 的仓库准备行为，不表示 Agent、Git hooks 或用户 setup 脚本被网络隔离。没有自动付费重试，也没有执行历史目录清扫。

## PR 审阅修正

PR #114 的审阅发现退役检查误伤三个保留合同：旧版已接受创建 Operation 的物化、已持久化子会话的首次启动，以及历史父会话创建新子会话。原记录中“继承 GitHub 项目的新会话入口退役”是范围描述错误，现更正为保留共享父工作区的子会话。

继续复用 Operation 的固定目标、`createSessionResult` 和 `SessionManager`；原样复用会在命令和启动检查处拒绝恢复，因此只增加内部恢复上下文及本地工作区校验，不引入协议或持久化字段。命令校验已接受 Operation 的工作区、机器、请求者和固定 Session/Turn，拒绝覆写冲突元数据。首次创建只在已有待处理回合且无已建立工作区/运行时证据时，使用已接受基准的本地缓存；省略基准保留旧命令的 main 语义，不能回退到其他分支。已记录分支丢失仍失败。子会话校验同机器根父会话的仓库与 worktree 后共享目录；历史 marker 真正不匹配时保留文件并报错。

Codex CLI 第二意见（`gpt-6-astra`、high、只读）建议保持 worktree 责任归属并采用上述窄兼容路径；反对意见是“没有分支记录”本身不足以证明从未运行，因此增加待处理回合、既有 worktree、ACP 会话和已处理回合检查。意见为只读建议，具体实现由主 Agent 校验后完成。回归使用合成 Operation 和临时本地 Git 仓库，不记录真实用户对话。

最终针对修复的同模型只读复核报告无剩余 P0/P1。父子会话回归在修复前明确失败；修复后的 276 项定向测试、补充旧版省略基准与 chat 恢复的 60 项检查通过。`pnpm check`、`pnpm format`、`pnpm run docs check` 通过；未运行打包桌面或真实 Agent 验收。

## 证据与限制

- worktree fixture 使用临时本地 Git 仓库，覆盖新本地 worktree、碰撞分支、捕获提交、旧记录分支恢复、脏目录与归档；没有网络依赖。
- 新增仓库丢失时的恢复/强制删除拒绝测试，读取幸存文件确认内容保留；缺失记录分支与缓存 main 也不会形成替代新会话。
- 组件回归验证本地选择/排序、提及范围、历史 PR 数据不再产生徽章和持久页签降级。旧 GitHub 创建测试改为拒绝合同，保留本地分支选择和历史执行回归。
- marker 修复的 64 个定向测试通过；同模型、high、只读的针对性复核确认该修复没有剩余 P0/P1，仓库/分支/工作区/机器校验与本地来源精确比较仍保留。`pnpm check` 全量通过，涵盖工作区类型、lint、CI 测试、i18n 与公共边界检查；`pnpm format` 和文档检查通过。本次未进行打包桌面或真实 Agent 运行验收。
