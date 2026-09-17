# Lody 上游更新采纳调研：可靠性优先，按能力移植

Status: proposed
Date: 2026-09-17
Translation: pending

## 摘要

Molly 与 Lody 自 2026-09-08 的共同基线后已经明显分叉：本次抓取的上游有 167 个独有提交，Molly 有 173 个独有提交。建议优先移植 Agent 取消与恢复、本地同步、输入保护及桌面交互修复，再独立迁移长对话历史和性能改造。上游的云端分享、账户、多机协作、开发工作流及清缓存能力不符合 Molly 当前本机设计产品范围，不能通过整分支合并重新引入。初轮完成源码调研，随后确认选择性采纳并开始实现；文末记录当前代码、验证证据与尚未完成的真实接入及平台验收。

## 比较范围与证据方法

| 项目         | 固定基线                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 上游         | `LodyAI/Lody`，`main`：`6f3a8855e94737ae65e2e57c625d74573adddc01`，提交时间 2026-09-17 16:55:34 +08:00                  |
| 本项目       | `LeonEthan/molly-design`，`HEAD`：`75fe35085e3e0c512ef28cec3016b6c07c0866f7`                                            |
| 最近共同祖先 | `8ea564daa36d9399bb0a768490f3bdb3b6a1656c`，2026-09-08，Windows/Linux Daily bootstrap 修复                              |
| 分叉量       | `git rev-list --left-right --count HEAD...refs/remotes/lody-research/main`：Molly 173 / Lody 167；上游非 merge 提交 166 |
| 上游净差量   | 1,508 个文件，113,346 行新增、22,016 行删除；包含文档、测试和生成物，不能视为待移植代码量                               |

使用 GitHub 仓库元数据确认 fork 来源，并获取上游 main 到本地调研 ref；没有切分支、合并、cherry-pick 或更新子模块工作树。读取完整提交清单，再对候选的补丁、当前消费者、相关决策和本项目源码进行重点核对。`git cherry` 未发现完全相同的 patch-id，但 Molly 的重命名及独立修复会改变补丁身份，因此这不代表 167 项都尚未解决。未审阅未合并 PR，也不覆盖本次固定 SHA 之后的更新。

本次开始时已有 design-authoring、格式查询笔记、`.claude/` 和 UI 验证脚本的未提交工作；这些不属于本次调研。候选的“尚缺”以已提交基线为主，并读取当前工作树核对相关消费者，不把其他任务的修改记入本次成果。

约束来源：[产品 Spec](../../../../specs/graphic-design-platform.zh.md)、[范围审查](../simplification/2026-09-11-design-result-feedback.zh.md)、[本机产品收敛](../simplification/2026-09-15-local-only-product-scope.zh.md)、[命名兼容](../../implemented/feature/2026-09-17-molly-namespace-convergence.zh.md)、[平台合同](../../../../packages/platform/AGENTS.md)、[共享协议合同](../../../../packages/shared/AGENTS.md)。本文不修订这些意图和边界。

## 第一批：建议优先移植的可靠性与输入修复

这里的先后是采纳顺序，不是 P0/P1 缺陷定级。源码仍存在相同机制是适用性证据，不等于已经在 Molly 安装包复现用户故障。

| 候选                                                                                                                                                                                                                                                                                                                                                                                                                                               | 对 Molly 的价值和当前证据                                                                                                                                                                                                                                                                                                      | 建议边界                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 取消、压缩、中途追加指令的归属链：[23c64a6c / #571](https://github.com/LodyAI/Lody/commit/23c64a6c)、[235329a2 / #573](https://github.com/LodyAI/Lody/commit/235329a2)、[f5aa23f7 / #275](https://github.com/LodyAI/Lody/commit/f5aa23f7)、[c0bd68f0 / #618](https://github.com/LodyAI/Lody/commit/c0bd68f0)、[73af3a34 / #693](https://github.com/LodyAI/Lody/commit/73af3a34)、[436a6a87 / #740](https://github.com/LodyAI/Lody/commit/436a6a87) | 上游区分 cancel 回执、底层 prompt 真正结束、compaction 结束及 steer 投递结果。Molly 的 `apps/cli/src/agent/agent-client.ts` 尚无 `pendingPromptCompletion` / `drainCancelledPrompt` 这套等待；steer 也没有上游的 `delivery_unknown` 恢复语义。对画布只读锁尤其相关：过早结束执行归属可能让下一轮或人工编辑越过尚未结束的工作。 | 按前置顺序组成一次生命周期适配，不孤立挑最后一个补丁。保留 Molly 的 Grok 显式停止关闭语义、设计 flush、结果处理期间只读、回执、草稿及“不自动重启已结束回合”。不能用上游普通会话结束点直接替换设计回合结束点。 |
| 凭据失效保留会话上下文与失败实例清理：[a6e8a530 / #559](https://github.com/LodyAI/Lody/commit/a6e8a530)、[32cf7456 / #595](https://github.com/LodyAI/Lody/commit/32cf7456)                                                                                                                                                                                                                                                                         | 上游避免把认证失效当成可新建会话的普通恢复失败，并在清理失败 Session 前解除其事件归属。Molly 已过滤部分旧实例事件，但失败启动分支仍先 `terminate`，没有对应的先 detach 处理。                                                                                                                                                  | 保留现有 `acpSessionAgentConfigId` / `agentConfigId` 归属和跨 provider 继续保护；不能为了“恢复成功”悄悄丢失原会话或换 provider。认证到期不自动重发付费请求。                                                  |
| 停止后关闭旧提问、原生任务控制：[2acd5117 / #605](https://github.com/LodyAI/Lody/commit/2acd5117)                                                                                                                                                                                                                                                                                                                                                  | 上游补齐原生任务控制和取消后待答问题的关闭，适用于复用的 Agent 交互链路。                                                                                                                                                                                                                                                      | 与上一组取消链配套核对；底层任务仍活动时不能提前解除画布只读。Molly 的 Grok stop 已独立加强，不以通用补丁覆盖它。                                                                                             |
| 本地 Loro join 恢复：[2c714ea0 / #774](https://github.com/LodyAI/Lody/commit/2c714ea0)                                                                                                                                                                                                                                                                                                                                                             | `packages/shared/src/local-loro-transport.ts` 仍缺少上游的 join deadline / generation 恢复防护，并在 Flock reconcile 失败后经 `finally` 完成首次同步信号。上游增加超时恢复、代际隔离和真实同步成功的边界。它直接适用于本机 renderer ↔ CLI 数据通道，无须云产品。                                                               | 优先独立移植。按[本地数据平面](../../../docs/cli-lib-local-loro-data-plane.md)保持 push-only、本地健康状态和旧 join 不污染新 join；不能恢复已经删除的云重连。                                                 |
| 首页草稿与 workspace 隔离：[06df9285 / #735](https://github.com/LodyAI/Lody/commit/06df9285)、[eade9041 / #619](https://github.com/LodyAI/Lody/commit/eade9041)                                                                                                                                                                                                                                                                                    | Molly 首页仍有 `resetDraftKey` 驱动重置，prompt 草稿未采用上游 workspace 分域；本机附件已有独立作用域，不能再次当作缺失能力重建。用户点 New Chat 或切换上下文时，输入保护有直接价值。                                                                                                                                          | 适配 prompt 草稿即可；保留设计参考图、元素引用和发送失败恢复的现有语义。workspace 分域只服务已有身份，不恢复 workspace 管理产品入口。                                                                         |
| Office 文字/图片混合粘贴、超大粘贴保护：[37fe8693 / #772](https://github.com/LodyAI/Lody/commit/37fe8693)、[6fde8b07 / #702](https://github.com/LodyAI/Lody/commit/6fde8b07)                                                                                                                                                                                                                                                                       | 上游修复 Office 同时提供文本和图片时文本丢失，并对超过 500 KiB 的粘贴明确拒绝。Molly 尚无这组保护；长设计 brief 和参考图输入是现有使用场景。                                                                                                                                                                                   | 只移植剪贴板类型判定、上限和反馈；真实用户图片继续走 Molly 本地附件，拒绝时保留原草稿，不重新接云上传。                                                                                                       |

## 第二批：桌面交互与小范围性能修复

这些更新通常比历史存储改造更容易独立落地，但“较小”不表示可以免适配直接 cherry-pick；Molly 已更改命名、主题、菜单和画布宿主。

| 候选                                                                                        | 建议                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [bbeef72e / #722](https://github.com/LodyAI/Lody/commit/bbeef72e)：ScrollArea 卸载取消轮询  | 上游对 `@radix-ui/react-scroll-area@1.2.10` 的 ESM/CJS 清理补上 RAF 取消。Molly 没有该补丁，适合优先减少切换会话后残留工作；核对当前锁文件版本后带入 patch 与锁文件。                                                                                         |
| [7249efeb / #726](https://github.com/LodyAI/Lody/commit/7249efeb)：子菜单视口边距           | Molly `DropdownMenuSubContent` 仍为 `sideOffset = 6`，未合并 `collisionPadding`。可以采纳安全边距和间距修复，但保留本项目已经完成的 pointer-grace 修复与新主题；两者解决的是不同问题。                                                                        |
| [696e68fd / #733](https://github.com/LodyAI/Lody/commit/696e68fd)：Electron 原生右键菜单    | 当前主窗口未安装上游的 `installContextMenu`。可补齐输入框撤销、剪切、复制、粘贴及普通选中文本的 Copy；图片保留已有菜单。不要覆盖 Bento 自有上下文操作，也不能假定主窗口监听自动覆盖画布的独立 WebContents。                                                   |
| [409651c9 / #555](https://github.com/LodyAI/Lody/commit/409651c9)：本地文件链接与系统动作   | 当前本地路径解析仍拒绝绝对路径和 `..`；上游改善本机文件定位与系统调用错误反馈。适合设计文件、图片和导出路径；采用时保留可信 Session、受控文件读取和 opaque resource 权限边界，不把 Markdown 链接变成任意文件读取授权。                                        |
| [39639984 / #745](https://github.com/LodyAI/Lody/commit/39639984)：设置弹窗能力刷新         | 可在 Agent 设置弹窗打开期间跟随真实 ACP capability 变化，减少配置已更新而 UI 仍陈旧。只更新现有本机 capability 来源。                                                                                                                                         |
| [f4ffc09c / #513](https://github.com/LodyAI/Lody/commit/f4ffc09c)：能力缓存兼容读取         | 建议采纳“仍理解的字段可读、同时保留刷新需求”，避免缓存版本升级使模型/命令选择暂时消失。当前 `packages/shared/src/ai.ts` 仅有 exact-version gate；仍须以配置身份及 override fingerprint 限制复用，不盲信未来版本字段。                                         |
| [7f7dcc6c / #607](https://github.com/LodyAI/Lody/commit/7f7dcc6c)：Grok 默认模式            | 建议核对隐式默认模式与实际能力，再移植 `agent` → `default` 和启动校验；保留用户显式选择、Role 固定权限及警告显示。                                                                                                                                            |
| [6f3a8855 / #781](https://github.com/LodyAI/Lody/commit/6f3a8855)：折叠工作过程不跳会话底部 | Molly 仍有 `pendingExpandedGroupRowKeyRef` 和相应滚动校正。建议采纳用户滚动意图的修复；它落在上游窗口化历史之后，应在现有 sticky-scroll 上重做同一语义，或随第三批一起迁移，不直接覆盖整个 `view.tsx`。                                                       |
| [7f58dec3 / #545](https://github.com/LodyAI/Lody/commit/7f58dec3)：Mermaid 不吞普通滚轮     | 属于现有聊天阅读体验，按需跟进；保留原有安全 Markdown 渲染和全屏退出路径。其补丁含独立手势实现，优先级低于输入丢失与执行恢复。                                                                                                                                |
| [0e93b3ca / #742](https://github.com/LodyAI/Lody/commit/0e93b3ca)：保留崩溃诊断直到用户恢复 | **部分已有。** Molly 原生 `render-process-gone` 已展示恢复页并忽略 clean-exit；React `ErrorBoundary` 仍保留自动 reset 计数逻辑。只评估后者的手动恢复与必要调用方调整，不重复搬原生恢复页，不引入该提交里的 PostHog 上报、账户 onboarding 或已删除的清空入口。 |

## 第三批：值得做，但必须作为完整迁移的长对话改造

核心链为 [416da4e2 / #460](https://github.com/LodyAI/Lody/commit/416da4e2)（统一历史写入和流式更新）→ [020c6647 / #376](https://github.com/LodyAI/Lody/commit/020c6647)（窗口读取历史）→ [c0eb3350 / #694](https://github.com/LodyAI/Lody/commit/c0eb3350)（primitive metadata 与版本化导入摘要），再结合 [4de83a57 / #751](https://github.com/LodyAI/Lody/commit/4de83a57)（单 token 不使整个会话失效）。这是依赖阅读顺序，不意味着四个提交已经构成经过验证的最小闭包。

Molly 当前没有上游 `packages/shared/src/session-data/` 的窗口读取和统一 writer；现有会话数据仍走旧历史路径。已有 `validateUpdates: false` 临时补丁不等于已拥有 #460 的正式写入校验。因此只搬 #751 的 React memo 或依赖优化不足以获得整条链的效果。收益是长设计会话反复生成、工具输出和读图时减少全量历史物化及更新传播，但本次没有测出 Molly 的加速比例。

两处依赖不能遗漏：#740 已调用 `sessionData.history.readTurn` / `commands.applyHistoryAction`，生命周期专项必须先移植对应写入接口，或将同样的行为适配到 Molly 现有接口，不能复制调用而缺少实现。#751 是窗口化 reader 上线后的重要修补，应与 #376 同批接受，避免引入已知的中间态性能回退；它的 Markdown 快路径又以前面的 #739 删除 inline math 为背景，Molly 若仍保留 inline math，不能照搬只检查块级分隔符的 guard。

配套候选：

- [16015623 / #638](https://github.com/LodyAI/Lody/commit/16015623)、[89650462 / #753](https://github.com/LodyAI/Lody/commit/89650462)：将预取移入串行 worker 并限制后台预取。Molly 仍有旧主线程 acquire/mirror 路径，桌面 candidateWindow 为 Infinity、concurrency 为 3。可以先在现有 coordinator 上移植有限预取策略；worker 带有可丢弃快照缓存和通信机制，需用具体慢例证明必要性后再做，不移植上游云认证/云 resolver。
- [fb8286a1 / #674](https://github.com/LodyAI/Lody/commit/fb8286a1)：历史 hydration 后首条用户消息保护；[b73c365a / #695](https://github.com/LodyAI/Lody/commit/b73c365a)：重开会话恢复 Virtua 测量；以及 #781 滚动意图修复，应与窗口化读回一起验收。
- [e7e4a5dd / #676](https://github.com/LodyAI/Lody/commit/e7e4a5dd)：积压派发检查合并并让出事件循环。适合作为 CLI 侧独立优化候选；必须保留 Molly 设计派发前准备和一次有效驱动 turn 的归属。

迁移要求：旧会话、工具记录、附件、元素引用、设计 outcome/commit receipt 可读；历史导入幂等；输入与执行状态一致；本地离线重开不依赖云补回。先以合成的短/长历史和确定性事件验证行为及工作量，再测真实 UI；不能把上游测试通过当作 Molly 验收。不得增加第二套设计快照存储。

## 运行环境和工程维护

| 候选                                                                                                                                                                                                                    | 结论                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------ |
| [05c13ce2 / #72](https://github.com/LodyAI/Lody/commit/05c13ce2)：Node/SQLite 运行时下限                                                                                                                                | 建议采纳。Molly 已有 SQLite 的 Node-API 10 启动检查，但根 manifest 仍宣称 `>=22.0.0`，安装前没有统一检查。按补丁统一为 `>=22.14.0 <23                                                                                                                                                         |     | >=23.6.0`，适配 Molly 的提示、相关清单和开发指引。这个建议源于当前源码的声明不一致，不是本次观察到已安装 Electron 崩溃。 |
| [555e0a7c / #717](https://github.com/LodyAI/Lody/commit/555e0a7c)：安装数据目录和 Windows 路径                                                                                                                          | **仅补差量。** Molly 的 diff store、fork-operation store、speculative worktree 等已改用 `getMollyDataDir('local')`，不能重复声称这些仍写错目录。浏览器安全路径函数仍统一 `/`，且没有 `ensureMollyDataDir` 对应的创建失败诊断；采纳这两部分，保护 `.molly`、现有旧别名优先级和 Lody 数据隔离。 |
| [51fee74c / #629](https://github.com/LodyAI/Lody/commit/51fee74c)：依赖发布等待期                                                                                                                                       | 建议作为独立维护小改动评估：`minimumReleaseAge: 10080`，即 7 天；当前 workspace 未配置。例外应按 Molly 已锁定依赖逐项说明，不照搬上游 Devframe 等后来加入的豁免。不能将等待期描述成消除供应链风险。                                                                                           |
| [d53c10e6 / #698](https://github.com/LodyAI/Lody/commit/d53c10e6)：Daily 证据留在 artifacts                                                                                                                             | 可采纳。当前 workflow 仍有 `contents: write` 和视频附件发布路径；上游删除该流程，Issue 只链接 run/artifact，降低权限和维护复杂度。实施时遵守 `.github/workflow-security.md`，本次不触发工作流、不发布评论。                                                                                   |
| [3adeb941 / #659](https://github.com/LodyAI/Lody/commit/3adeb941)：原生 API 兼容准备                                                                                                                                    | 低优先级按需要采用 await clipboard、真实 notification 成败和目录选择默认路径。该提交**不是升级 Electron 44**；Molly 当前仍为 Electron 39.5.1，不应根据标题误判为必须升级。                                                                                                                    |
| [bc91ca78 / #630](https://github.com/LodyAI/Lody/commit/bc91ca78)、[fe83849b / #631](https://github.com/LodyAI/Lody/commit/fe83849b)、[ff8f680d / #633](https://github.com/LodyAI/Lody/commit/ff8f680d)：Vite/Storybook | 暂缓，另做工具链任务。上游只让前端目标进入 Vite 8，CLI 和 Electron 仍留在 Vite 7，原因包括 electron-vite peer 合同与 CLI logger 的 CommonJS interop。Molly 另有 Bento、技能脚本和导出资源构建，应独立验证这些额外消费者。                                                                     |
| [8653fed7 / #737](https://github.com/LodyAI/Lody/commit/8653fed7)：oxfmt                                                                                                                                                | 暂缓，收益属于维护流程，不阻塞可靠性修复。整包格式变化会增加后续移植冲突，也不能覆盖当前工作树的修改。                                                                                                                                                                                        |

## 有价值但需要独立范围决定的能力

**内置 Pi ACP：** [02ba149e / #766](https://github.com/LodyAI/Lody/commit/02ba149e) 与 [5459eb0d / #778](https://github.com/LodyAI/Lody/commit/5459eb0d) 将旧 registry `pi-acp` 迁移为 builtin `pi`，包含明确确认及支持机器判断。Molly 已支持 Pi，不是等待新增第六种 Agent；但 `apps/cli/src/design/turn-outcome.ts` 仍识别 `pi-acp`，`pi-launch.ts` 通过 `PI_ACP_PI_COMMAND` 包装旧接入。升级会影响 reminder/native settlement、MCP 注入、历史会话继续和配置身份，必须先适配这些合同，再按 Molly 公共 runtime channel 打包和校验。不能只更新 registry 或子模块指针。

**其他 provider 与 macOS 原生库：** Bub、Devin、DeepSeek Harness 的设置/安装/升级不是当前五种设计 Agent 的修复，应另行确认产品范围。上游 [2ff57279 / #747](https://github.com/LodyAI/Lody/commit/2ff57279) 与 [49dcdd13 / #776](https://github.com/LodyAI/Lody/commit/49dcdd13) 针对 bundled Node 与运行时安装 native addon 的签名限制有可借鉴价值；后者仅给 helper 关闭 library validation，主应用仍保留。Molly 目前继承同一 plist，但本次没有在已支持 Agent 的签名包中复现此问题；不因 DSH 的新需求就主动扩大 Molly entitlement。

**多窗口：** [179c63da / #562](https://github.com/LodyAI/Lody/commit/179c63da) 与 [e42f786a / #641](https://github.com/LodyAI/Lody/commit/e42f786a) 是完整功能加缓存隔离的组合。虽然能改善并排工作，但它要求逐窗口核对 Bento 宿主、同一作品全部实例只读、flush、导出及保存归属，不能当作免费 UI 修复随包进入。

**Devframe Hub 与 devbar：** [ebca249d / #525](https://github.com/LodyAI/Lody/commit/ebca249d)、[1b926b42 / #754](https://github.com/LodyAI/Lody/commit/1b926b42) 可帮助未来性能定位，但新增依赖、诊断路由和桌面 surface；当前没有用它替代已有测试/诊断的必要性证据，先保留调研，不引入运行时。

**用量、标题和模式：** [8fb002bf / #662](https://github.com/LodyAI/Lody/commit/8fb002bf)、[b1638083 / #736](https://github.com/LodyAI/Lody/commit/b1638083) 的累计用量和来源语义有价值，但 Molly 已删除 usage tracking service，local platform `usage` 为 null，不能整体恢复计费产品。若处理 ACP 原始 usage，只修真实 provider 归属，避免用当前选中模型猜测。原生标题 [63ae7ad5 / #522](https://github.com/LodyAI/Lody/commit/63ae7ad5)、Codex goal / Plan mode 和 Grok 默认 mode 更新须和 ACP core/adapter pin 配套；保留 Molly 既有标题默认模型和 isolated title drain 修复，不列为第一批必迁。

**ACP terminal：** [2055c001 / #645](https://github.com/LodyAI/Lody/commit/2055c001) 中 spawn 错误收敛、ENOENT/EACCES 反馈和等待方结束值得提取；但其“含空格 command + 空 argv 自动改走 shell”改变了本项目 `apps/cli/src/session/AGENTS.md` 的直接 executable/argv 合同，应单独裁定，不和错误处理一起默默进入。

子模块 pin 本身也是待适配接口，不能视作普通依赖全量刷新：本次 root tree 中 core 为 `7bc6332d` → `80205d81`，Codex 为 `9b4c9614` → `08b11547`，Claude 为 `d395b3dc` → `6e279715`，Grok 为 `77a994f4` → `47bcb4a9`，Kimi 为 `aab809cc` → `9191807f`。本轮未逐一全面审计各 adapter 内部提交；例如 #544 在主仓主要是 gitlink 变化，不能只看标题就断言 Molly 是否已覆盖。Kimi 继续保持独立构建、校验和及隔离子模块边界。

## 明确不随本次更新采纳的内容

- 云端公开/实时/静态会话分享及 MCP 分享批准链接（#539、#646、#681、#762 等）、分享设置、账号登录、团队身份、远程机器、跨机器 mention、移动和网站更新：不属于当前单人本机设计产品。纯 UI 小修可从混合提交提取，不能为复用它们恢复云认证和网络链路。
- [99e63b06 / #704](https://github.com/LodyAI/Lody/commit/99e63b06) 的 `app reset-cache`：Molly 已明确删除清空存储流程，`clear-local-cache.ts` 只提供无数据删除的 `reloadApp`。本地数据不具有云端可重建保证；上游 hard reset 和原有缓存扫描不能照搬。将来若需要修复工具，必须另行定义 Molly 数据所有权及保稿语义。
- [9fb2a68a / #609](https://github.com/LodyAI/Lody/commit/9fb2a68a) 将桌面发布改成 changelog-only：与 Molly 独立安装包和应用更新方向不同，不能替换本项目发布链。
- 工作树/PR/Commit & Push、会话 fork 新入口、Prompt Shortcuts、usage share report 等扩展：开发产品或新增能力，当前未建立设计用户需求，不跟随上游默认加入。后台共享实现若仍有消费者，按具体缺陷再取所需部分。
- [4400744a / #538](https://github.com/LodyAI/Lody/commit/4400744a) 身份切换导致 ACP 重启的修复：Molly 的 local-only 收敛已移除相应 `agentGitIdentitySnapshot` / `terminateForRestart` 机制，不能据上游标题重新引回整条身份逻辑。
- [d796e623 / #741](https://github.com/LodyAI/Lody/commit/d796e623) 默认归档 All Tasks：Molly 已删团队范围控件和旧作者过滤，不再搬上游偏好默认值。
- 上游文档、PR 模板、贡献规则、版本号和双语政策是其仓库治理决定，不自动覆盖 Molly 的现行规则。E2E 场景可参考，不能整体导入依赖远程机器、分享、fork 或移动端的产品路径。

## 建议执行顺序、取舍与验收

1. **小步可靠性修复：** 本地 join、凭据恢复/失败实例、草稿与粘贴；可并列成互不依赖的小切片。Node 下限、ScrollArea、菜单边距可单独交付。
2. **生命周期专项：** 先确定 #740 使用的历史写入接口如何适配，再按取消 → 压缩 → steer → 原生任务控制推进，连同设计只读和结果处理统一验证。若选择原样复用新历史接口，需提前第三批的相应基础部分；不要求先完成窗口化 UI。代码范围较大，但比先追新 provider 更直接保护现有创作。
3. **长对话专项：** 统一 writer/metadata → 兼容旧历史 → window reader → 订阅/预取 → 虚拟列表/滚动。不要与 UI 换肤、formatter 或 provider 大升级混合。
4. **条件性升级：** Pi 接入和工具链各自决策、分别验收；新增 provider、多窗口及诊断产品仍保持待确认。

整分支 merge 会恢复已退役产品和旧命名；整文件复制会覆盖设计派发、附件、结果回执及原生画布适配。建议按上述能力抽取补丁并保留原上游 commit/PR 来源；能小范围移植的修复保留对应测试，大链条补足 Molly 独有合同的确定性验收。不要全局替换 `lody` 字符串：有些历史字段和 ACP 外部 wire 名仍是兼容合同。

实施验收至少覆盖：取消回执早于实际结束、取消失败、compaction 中断、steer 结果未知、旧实例迟到事件；画布始终只读到产物处理结束且下一轮不被旧事件解锁；断线重连后旧 join 不污染新数据；输入/附件不丢；旧长会话读回及本地离线重开；绝对路径动作受控；Windows 路径、Node 安装守卫和真实打包资源边界。测试使用注入事件、时钟及合成数据，不进行自动付费模型重试。

## 本轮产物与验证限度

本轮仅新增本 proposed 调研笔记，没有代码实现、Spec 意图变更、提交、PR 或对外消息。`pnpm run docs status`、`pnpm run docs check` 和 `git diff --check` 通过；文档检查有 18 项既有规则文件大小警告，无注册 SHA topic，翻译 pending。没有安装依赖、执行全仓测试、构建或启动真实 Agent，也未做补丁 apply-check；这些不能由 Git 补丁阅读替代。采纳顺序和投入判断为工程分析，不是已测性能或已批准实施计划。

## 方向确认与 Spec 草稿（2026-09-17）

后续已确认选择性采纳建议，并要求先记录目标、范围、方案和测试方法，形成[上游更新采纳 Spec](../../../../specs/lody-upstream-adoption.zh.md)。它以 U1–U9 固定本次范围，以 T1–T12 定义可观察的验收，保留 Pi、工具链、新 provider、多窗口、诊断产品及预取 worker 的暂缓决定；小修复可以先行，#740 需要的统一历史写入接口必须先准备，再衔接生命周期和窗口化读取。本文的源码观察仍对应初轮基线，不因方向确认而升级为运行时完成证据。

本次文档阶段不实施代码、不调用模型、不提交或发布。Spec 为 draft、本文为 proposed，方向确认不冒充对新修订的逐项批准；后续实施需复核已前进到 `c1dc2aab` 的工作树及真实消费者。新增 Spec 将历史校验绕过的后续替换纳入目标，但不提前修改现有临时 Spec 的实施状态，也不把待评估机制加入产品范围。

文档阶段验证：`pnpm run docs status`、`pnpm run docs check`、两份文档的局部 Prettier 检查和 `git diff --check` 通过；18 项既有规则大小警告，无注册 SHA topic。未运行实现测试或构建，U1–U9 和 T1–T12 均未据文档检查标记完成。

### 四项边界确认（2026-09-17）

后续复核确认了四项补充决定，已纳入 Spec 的 U6/U7、验收矩阵和完成条件：正常完成沿用队列，主动 Stop 保留输入并暂停后续派发，未知 steer 不自动重发或改记未投递；停止失败须经可达的既有恢复入口核验实际结束，不能靠超时或重开界面解锁；新版保证读取旧历史，不保证旧版读取新写入，也不自动降级，交付前验证写入中断及重启恢复；公共生命周期变化须验收 Claude、Codex、Grok、Kimi、Pi，macOS 完整集成，Windows/Linux 验证路径、原生菜单、启动及重开等平台行为。缺少必需运行证据时不宣称整体完成。

超时参数、窗口大小、adapter 精确版本及迁移切片留给实施时依据合同和测试确定，不另增产品范围。此次仍只更新文档，Spec 保持 draft、本文保持 proposed；已确认的行为决定不等于运行时已经实现或验收通过。

## 实施进度（2026-09-17，进行中）

用户已明确要求完整实施。以 `c1dc2aab` 复核并开始选择性迁入；不提交、发布或替换用户安装。已执行根目录依赖安装，保留无关 UI 调试脚本。

- U1：迁入 `2c714ea0` 的有界 join、代际隔离及首同步失败恢复。新增假时钟/显式 promise 屏障测试；原实现健康检查重置 join 的回归先失败，修改后连同既有测试 37 项通过。
- U2：迁入 `a6e8a530` 认证分类和保留上下文恢复、`32cf7456` 失败 Session 实例监听撤销，保留 Molly 替代设计运行时身份检查。认证、SessionManager、执行服务及 Grok CLI 默认模式合计 212 项通过。
- U3：迁入 `06df9285`、`eade9041`、`6fde8b07`、`37fe8693` 的草稿作用域、New Chat 保留、500 KiB 与富文本图片优先级；onboarding 使用同一草稿键，保留画布准备关联。粘贴 60 项测试通过，草稿独立验证继续进行。
- U4/U5：ScrollArea 双入口补丁已证明旧实现卸载后继续轮询；已接入补丁、菜单边距与原生文本菜单。文件动作仅延伸本机系统打开/显示及错误反馈，不恢复 IDE launcher。兼容 capability 读取、打开对话框实时刷新、Grok 隐式默认与手动 ErrorBoundary 恢复正在验证。
- U8/U9：Node/NAPI 守卫与平台路径差量正在实现。依赖最小发布时间设为 10080 分钟；Daily 原有 artifact-only 分场景报告已满足内容边界，仅收窄遗留 contents 写权限，保留该报告结构。
- U6/U7 尚未完成。实现映射确认 writer 必须显式支持 `designOutcome`、目录保留 `agentConfigId`；上游取消会推进队列、停止失败不可重试和未知 steer 重发入口不能原样迁入。

上述为切片进展，尚未执行最终全仓检查、构建、五 Agent 和三平台验收，不代表 U1–U9 全部完成。本文仍为 proposed，Spec 仍为 draft；后续在此追加最终证据与未执行单元。

## Implementation record (2026-09-17)

This section supersedes the earlier in-progress implementation status, not the research
history. U1-U9 source changes are recorded in commit `619f2174` on
`codex/independent-release`. Unrelated
`.claude/` and UI inspection scripts remain outside this task. Overall acceptance remains
incomplete until the real-provider/platform cells below have evidence.

| Slice | Implemented behavior and source                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1    | `2c714ea0`: bounded join (120 seconds), generation isolation, reconciliation before first-sync success. Fake clocks and deferred replies cover failure/recovery.                                                                                                                                                                                                                                                                                                           |
| U2    | `a6e8a530`, `32cf7456`: authentication failures preserve identity/history; failed instances detach listeners. Molly design ownership checks remain.                                                                                                                                                                                                                                                                                                                        |
| U3    | `06df9285`, `eade9041`, `6fde8b07`, `37fe8693`: user/workspace draft identity across onboarding/chat, New Chat preservation, Office text priority and 500 x 1024 normalized UTF-8 byte limit.                                                                                                                                                                                                                                                                              |
| U4    | `bbeef72e`, `7249efeb`, `696e68fd`, `409651c9`: both Radix entry points stop polling; submenu geometry retains pointer grace; native text menu; trusted-local OS open/reveal with explicit errors. No IDE launcher restored.                                                                                                                                                                                                                                               |
| U5    | Compatible capability cache reads, live dialog refresh, capability-checked implicit Grok mode and manual-only error recovery. Static `agent` interaction mode remains.                                                                                                                                                                                                                                                                                                     |
| U6    | Relevant chain: `23c64a6c`, `235329a2`, `f5aa23f7`, `c0bd68f0`, `2acd5117`, `73af3a34`, `436a6a87`. Molly persists/flushed exact-turn Stop pause; Continue alone resumes. Unknown steer never replays; exact late native application evidence may settle it. Five-second escalation waits for actual termination and retains reachable retry after failure. Original provider/artifact completion gates canvas release. Native task Stop never pauses/releases its parent. |
| U7    | Shared validated writer, control-only Mirror, window reader, versioned import hashes/cursor and conditional rollback. Molly first design receipt wins; shallow directory keeps receipt and agentConfigId outside the body window. Default tail20/cache200; initial directory remains O(n). Existing prefetch coordinator is bounded at candidates20/concurrency1/batch1. Hydration, scroll restoration, markdown caching and math/Mermaid fast paths retain Molly syntax.  |
| U8    | Node range >=22.14.0 <23 or >=23.6.0 and NAPI10 aligned across manifests, install guard, SQLite diagnostics and README. Windows source-path handling and data-directory errors preserve Molly path/override priorities.                                                                                                                                                                                                                                                    |
| U9    | Release age10080 minutes. Exact exceptions only for the three loro-mirror2.3.2 packages. Daily already retained artifact-only evidence; remove obsolete contents-write permission.                                                                                                                                                                                                                                                                                         |

### Integration decisions

- Codex submodule: `38f29ed0016a3ab9dfd1189a6b9e65559b2a1433` (adapter1.10.1).
  Required Core: `80205d81b9de02f4171564a7c3aaaebfd9d91ddd` (0.1.5). Both remain
  clean checkouts. Kimi remains isolated; no usage product feature/new provider adopted.
  Core is excluded from root lint like the other external adapters; its own tests still run.
- Existing `session/cancel` carries optional resume/interrupt; `sessionStopControl:1`
  negotiates schema, RPC, CLI, facade and UI together. Interrupt-and-send is explicit;
  internal Edit & Resend cancellation retains its rewrite barrier without a user pause.
- Queue promotion persists history and activation before removing the source. Interrupted
  activation repairs the original pending id without duplicate history or newer-pointer rewind.
  A real isolated SQLite test injects metadata failure, flushes, closes and reopens twice:
  acknowledged history survives, failed work is not reported successful, recovery is idempotent.
- History writes now validate changed/new fields and preserve opaque old data. Control-plane
  validation remains independent; the temporary validation Spec is marked as historical context.
  Compatibility is new-reads-old; no old-reads-new or automatic downgrade guarantee.
- Math early-exit checks preserve Molly's TeX parenthesis/bracket delimiters. No prefetch
  worker, parallel snapshot store, telemetry or authenticated product cloud path was added.

### Evidence and remaining acceptance

- Built Electron smoke: 3 scenarios/18 steps passed; full existing deterministic desktop
  suite: 4 scenarios/25 steps passed. Isolated profile/data/endpoints and real main, preload,
  renderer and CLI; these runs do not prove real-provider behavior.
- Codex adapter: steer/steer-events21 and CodexAcpClient/load-session117 tests passed with
  retry=0 and no paid invocation. Client late-steer tests56 passed.
- Native/artifact ownership plus actual SQLite recovery targeted run:134 passed.
  Windowed-reader tests35 passed, including 100/1000-entry change-ID probes and off-window receipt/provider updates without
  body hydration. Math/file actions17 passed.
- Build, e2e:check, frozen-lockfile install and pnpm format passed. Final aggregate checks
  and documentation gates are recorded below when complete.
- Real integration: Claude, Codex, Grok, Kimi and Pi have NOT completed this task's full
  startup/permission/Stop/Continue/image/MCP/artifact matrix. Adapter/synthetic tests are
  not substitutes. The available host is macOS; Windows/Linux actual startup/menu/reopen
  runs are NOT executed. Unit path/guard tests and cross-compilation do not replace them.
  Human visual acceptance is also pending.

The code and deterministic evidence do not establish overall acceptance. These required
cells remain open under the original Spec; the note stays proposed and Spec stays draft.
The implementation is committed and pushed; no installation replacement or user-data
migration was performed.

Library diagnostic (one local Node/tsx sample, 3000 rounds/6000 entries): snapshot
5,682,782 bytes; import4.18ms; composition156.03ms; asynchronous directory/tail21.98ms;
visible range2.04ms; targeted field update mean0.068ms; full business-fact derivation
1120.55ms; retained hydrated bodies200. These numbers are not comparative speedups,
renderer frame measurements, or device acceptance. Electron before/after operation,
main-thread and memory measurements remain an unexecuted diagnostic cell.

Final local gates: `pnpm check` exited0 (typechecks, lint, test:ci, translations,
Code Collab imports, platform and public boundaries). CLI2738, components3057 and
Electron145 tests passed; explicit real-provider tests remain skipped. Codex-specific
138 adapter tests were run separately without retries. Lint reports10763 warnings and
0 errors; these warnings are not a claim of warning-free code.

Final `pnpm build` passed; the rebuilt desktop's `pnpm e2e:full` passed all4 scenarios/
25 steps with verified teardown. `pnpm e2e:check`, frozen-lockfile install, `pnpm format`,
changed-file formatting and `git diff --check` passed. Lockfile was normalized with pnpm
(106 added/53 removed lines), avoiding a whole-file formatter rewrite. `pnpm run docs check`
reports0 errors,18 size warnings and no SHA topics. No gate result upgrades Spec approval
or supplies the unexecuted real-provider/platform/visual/performance evidence above.

## U6 review follow-up: preserve Grok native close recovery (2026-09-17)

The two-axis review found a P1: the newly adopted generic five-second prompt drain
could kill Grok's ACP transport before its ten-second native close completed. Recovery
then retained a callback to that dead client. The legacy cancellation path also killed
the process before retrying native close. This violated the existing full-close and
reachable-recovery contract, rather than establishing a need to change product intent.
The user accepted the repair; this section owns its implementation and verification.

Grok now keeps its original connection and raw close completion separate from the
bounded diagnostic waiter. Explicit retries share an outstanding close, start another
only after actual failure, and accept late native confirmation for the same identity.
Generic process escalation remains for other agents. Both execution paths wait for
native closure, captured pending requests and artifact processing before release;
Retry Stop retains dispatch pause, while Continue explicitly resumes it. Cancellation
during resident-session restoration also preserves the transport and waits for load
settlement before close. No new protocol, persistence store or provider replay is added.
Increasing the kill delay was rejected because it would retain the same failure at a
later deadline; declaring process exit to be native closure would weaken the contract.

Regression tests use real AgentClient lifecycle methods with synthetic ACP transport,
fake timers and explicit prompt/close/artifact gates. They cover close at seven seconds,
late confirmation after timeout with coalesced retries, explicit retry after native failure,
the legacy path, and Stop during restoration. Separate client tests cover late `closed`
and `notResident` outcomes. Real Grok/provider and platform acceptance remains unexecuted;
these synthetic tests do not replace the pending acceptance matrix above.

Verification: all nine new regressions passed (seven execution-path cases and two late
native-outcome cases). Restoring the generic kill branch temporarily makes the seven-second
closure case fail exactly at five seconds; restoring the fix passes. The temporary mutation
was removed before final checks. `pnpm check` passed, including CLI 2747 passed/4 skipped,
components 3057 passed, shared 1208 passed, typechecks, translations and platform/public
boundaries. Lint reported 10769 warnings and zero errors. Changed-file formatting,
`git diff --check` and `pnpm run docs check` passed. Existing document size warnings remain.
No new desktop build or real-provider run was performed for this follow-up; no commit or
publication is part of the fix.

## Fresh golden acceptance after U1–U9 and Grok fix (2026-09-17)

The user requested the golden case against the current working tree. `pnpm e2e:build`
passed, then the real Kimi runner executed one fresh isolated round,
`upstream-adoption-20260917-01`, with the frozen MagSafe reference and exact prompt,
K3 / Thinking High. The build used source commit `c1dc2aab`, with the implementation
still uncommitted at the time of that run;
the ignored report records hashes of the actual built main, renderer, CLI and Bento.
No deterministic provider, repair prompt or additional paid-model round was substituted.

The Agent completed naturally and produced a committed 570×4000 document containing
12 images, 15 text elements and 4 shapes. The runner's technical checks passed: canonical
readback and PNG/JPEG dimensions and hashes were unchanged after full application restart.
The unedited PNG SHA-256 is
`0ca2f905ccac99e4eafdbcc3c068b2d86301ee0f332d8ffb915a7c25d00e69c8`;
JPEG SHA-256 is
`e8e99a4df1ac236ac732c727ae0c168930a490ebf15a20faa5e06f5935e7cee2`.
Visible heading editing, autosave, reopen/YAML readback and changed export reached their
checks. The subsequent move step failed: the main-page accessible `Position Y` spinbutton
was not visible within 30 seconds. Crop validation was therefore not reached. The failure
alone does not establish whether product selection propagation or the test locator caused it.

Overall status is **failed**, editing is **failed**, and human visual judgment remains
**pending**. The original golden was restored by the runner's finalizer, owned processes
and endpoint were torn down, and the isolated review profile was exported without a
teardown error. Evidence lives under the ignored
`e2e/artifacts/acceptance/molly-kimi-magsafe-replication/upstream-adoption-20260917-01/`:
report, original/reopened exports, edited heading export, comparison, screenshot and review
profile. Captured conversations and images remain outside tracked files. This round must
remain failed; a future editing-only continuation may reuse a clone of its review profile
without another model invocation. No such continuation or automatic paid rerun was started.

### Golden move failure diagnosis (2026-09-17)

Follow-up diagnosis confirms the move failure is a stale test locator scope. The
selection toolbar is owned by the isolated Bento WebContents
(`packages/design-bento/src/selection-toolbar.ts`), while
`e2e/scripts/kimi-replication-evidence.mjs` queries `ui.page`, the React shell.
A fresh isolated clone of the retained review profile selected the same heading:
the shell had zero `Position Y` spinbuttons; the canvas had one visible spinbutton
with the expected current Y value. No model turn was dispatched. Owned processes
and endpoint were closed successfully. Ignored diagnostic evidence is retained in
`e2e/artifacts/diagnostics/position-y-20260917/` (`result.json`, selected canvas image
and probe script).

The proposed correction is to locate position and crop controls through the current
canvas Page, including `Crop`, `Left` and `Apply`, which have the same stale shell
scope. Increasing the timeout cannot repair a WebContents mismatch. This diagnostic
changed no runtime or acceptance runner code and did not exercise move persistence
or crop; the original failed round and pending visual verdict remain unchanged.

### Golden locator correction and editing continuation (2026-09-17)

The user authorized the correction. The acceptance driver now locates `Position Y`,
`Crop`, `Left` and `Apply` in the current native canvas Page. The existing `saved`
helper reacquires that Page after each full restart. Product code, timeout policy
and assertions are unchanged.

A new immutable continuation, `upstream-adoption-20260917-01-editing-resume-01`,
cloned the retained review profile and passed inline text editing, position movement,
image cropping, autosave, full application restart, canonical/YAML readback, edited
exports and restoration of the original golden. It made no model call and completed
owned-process/endpoint teardown without an error. Its report inherits the parent's
technical pass; the overall result is `editing-passed-visual-pending`. The original
round remains failed and human visual acceptance is still pending.

The continuation used the already fresh product build from the parent run; only the
Node acceptance driver changed, so rebuilding the application was unnecessary.
Node syntax, changed-file Prettier, `git diff --check` and documentation checks passed.
The correction changed no product runtime; it is included in commit `619f2174`, with
no separate publication or installation replacement.
