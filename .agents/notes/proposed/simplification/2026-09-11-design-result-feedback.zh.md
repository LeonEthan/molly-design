# 设计迁移范围复核与结果卡退役

Status: proposed
Translation: current

[English](2026-09-11-design-result-feedback.md)

## 摘要

本次按相邻项目已有设计经验及 Lody 复用边界审查 P0–P6，确认退役结果卡、专用缩略图、旧文件自动提升和强制创作步骤。后续整体讨论进一步删除候选创建/采用/拒绝工作流：冲突由 Agent 处理文件，外部文件预览后直接导入；渲染、图片读取、原子保存、旧内容与回执保留。Bento 语义往返需最小格式适配，图像 MCP 需补 edit 并取消默认模型，不能将它们误写为已完全复用。具体决定和实施代价见[工作流收敛记录](2026-09-11-design-workflow-convergence.zh.md)，本记录保留来源核查与结论更正。仅修改文档，退役和新适配仍未实现。

## 历史与当前事实

- 首版方案提交 `b660bb34f3bf3d0cd28d7a86dddbc1c7c271ee46` 的功能表已提出“作品卡”，P2.5 明确要求“真实结果卡和画布定位”；原 Spec 要求候选采用/拒绝与失败状态可见，未指定卡片形态。可用 `git show b660bb3:.agents/notes/proposed/architecture/2026-09-09-graphic-design-platform.zh.md` 核对；当前入口为[阶段计划](../../implemented/architecture/2026-09-09-graphic-design-platform.zh.md)。这证明它来自方案，不证明形态本身必要，也不能把方向性认可等同于每个控件得到单独认可。
- `a09858632afaf2a9d1929af95f593308951d8ae9` 实现 P2.5 卡片和候选动作，`baed947b6f16263cb6a2f8f37e10f1695d146fe0` 增加 P2.6 缩略图引用。它不是 P2 开发时无计划增加的功能。
- [消息渲染入口](../../../../packages/components/src/components/ai-gui/view.tsx)在设计会话的用户回合下挂载卡片；[状态解析](https://github.com/LeonEthan/molly-design/blob/a09858632afaf2a9d1929af95f593308951d8ae9/packages/components/src/lib/design-turn-result.ts)读取持久 `designOutcome`，另提供 live 显示，状态包括 committed、candidate、invalid、no_artifact、failed、cancelled。
- [卡片组件](https://github.com/LeonEthan/molly-design/blob/a09858632afaf2a9d1929af95f593308951d8ae9/packages/components/src/components/sessions/design-turn-result-card.tsx)读取候选状态和缩略图，提供定位、采用、丢弃和用户触发修复。修复经 [session-chat-interface](../../../../packages/components/src/components/sessions/session-chat-interface.tsx) 的普通 `dispatchPrompt`，不是自动修复或私有 Agent 通道；卡片不执行语义质量评审。
- [缩略图生成](https://github.com/LeonEthan/molly-design/blob/baed947b6f16263cb6a2f8f37e10f1695d146fe0/apps/cli/src/design/thumbnail.ts)、[读取](https://github.com/LeonEthan/molly-design/blob/baed947b6f16263cb6a2f8f37e10f1695d146fe0/apps/cli/src/design/thumbnail-read.ts)以及共享 outcome 的可选引用，是展示以外的额外维护面。它们复用现有渲染桥，并非第二套渲染器；没有实测数据证明其成本不可接受，也不能因为复用就认定这项需求不可删除。

## 必要信息和展示形式

| 现有内容 | 实际用途 | 当前方案处置 |
| --- | --- | --- |
| 提交结果 | Agent 说完成不等于存储已提交 | 保留可信反馈，采用会话中的简短记录/画布状态；不要求独立卡片 |
| 生成中、失败、取消 | 反映执行状态 | 优先复用 Lody 既有状态，避免同一回合重复展示 |
| 无设计产物 | 描述未改变画稿这一事实 | 普通咨询也可能没有产物，不默认把它变为异常或每轮必显提示 |
| 候选采用/丢弃 | 历史实现保留重新生成/冲突结果 | 最新裁定删除新候选工作流；旧内容仍可读，冲突由 Agent 处理，外部文件直接导入 |
| 结构校验诊断与修复 | 用户知道为何未提交，并能继续对话处理 | 异常时显示，沿用普通输入/发送链路，无需专用修复工作流 |
| 打开当前画稿 | 对话与产物之间导航 | 复用现有侧栏定位或轻量产物链接 |
| 每回合缩略图 | 快速回看历史视觉结果 | 退出迁移范围；移除专用生成和读回链，保留 Agent 渲染与读图 |

派生状态原则需按事实类型使用：某回合当时提交/失败是历史事件，不能从当前稿可靠重建。旧缩略图同样不能从最新稿还原；它们已退出产品范围，新版本只需容忍旧字段，不继续生产历史视觉回执。

“删除卡片”不等于删除 `designOutcome`、提交回执或已有内容。回合事实还用于幂等和恢复，移除 UI 须核对消费者；已有候选内容/素材应通过受控文件入口可达，不再为兼容旧数据建设新候选面板或继续创建候选。

## Agent-naive 与删减原则

按仓库的 agent-naive 定义，应用如实展示文件、存储状态和用户动作是允许的。当前卡片没有要求 Agent 调用特定工具、接受卡片的语义评价或按固定步骤生成，不能仅凭存在专用 UI 就认定它违反该边界。值得质疑的是每轮都以“设计产出”组织显示这一产品假设；它可能对讨论型回合增加无用反馈，属于待验证的设计取舍，不是已证明的运行时缺陷。

用户随后明确指向相邻 agentic-listing-design 的仓库规则。本地当前 `AGENTS.md` 未直接出现 Raptor3 名称，但开头明确要求“Prefer the smallest end-to-end implementation that meets the current requirements.”和“Before handoff, remove mechanisms without a current purpose.”；它指向的架构文档 §3 还要求可重算派生状态默认不持久化、只为未来可能需求而存在的字段/状态/协议默认删除、阶段内只建设当前最小形态，以及 Agent 自主完成后再检查产物。本次按这些项目内原文判断，而不依赖发动机外观类比；这些是来源项目的设计依据，不将其完整架构或 export 治理合同自动移植到 Molly Design。公开方法背景见 [Everyday Astronaut 一手访谈整理](https://everydayastronaut.com/starbase-tour-and-interview-with-elon-musk/)。

应用这一思路的关键问题是：删除专用结果卡后，用户是否仍能找到当前稿、确认提交结果、发现错误并读取遗留产物？现有会话与画布具备承接入口的基础，P3.0/P3.4 先保证当前稿、错误及旧内容文件入口可达再退役卡片；最新目标不要求人工处理新候选。代码复用和已完成状态都不能替代必要性论证；把卡片原封不动挪到侧栏，也不算真正减少责任与维护面。

## 对当前计划的建议及验证限制

用户已确认退役方向并要求落入文档。P3.0 拆分通用入口、专用链路删除和保留能力验收；最初的 P3.3 最小候选入口目标已被整体收敛取代，现改为 Agent 处理冲突，P3.4 保证旧内容可达。P4 取消作品缩略图，P6 验证无卡片仍能渲染和读图。P2.5/P2.6 历史实施记录保留，增加已被新范围取代的标记；正式计划与 Spec 已更新，运行时代码尚未改变。

本轮仅查阅 Git 历史、源码及公开访谈，未运行产品测试、构建或 UI 体验验证。没有声称重复提示已经造成用户失败，也没有以代码行数作为删除依据。实时预览尚处于方案阶段，不能据此直接删除当前唯一可用的候选/产物入口。

## 来源项目功能对照与结论修正

迁移范围进一步明确为：搬运相邻项目已验证的设计能力，只做删减，不自行增加产品功能。此前仅从“有用且兼容 agent-naive”论证是否保留，遗漏了来源范围这一更严格的判据；后续应先证明对应能力已有来源，再讨论必要性。Lody 的宿主适配与数据完整性实现不意味着可以额外添加产品工作流。

核对相邻项目当前 UI 入口 `app.js` 与编排模块的具体行为：

- `showCandidate`（308 行）确实创建候选审阅卡，包含候选预览、差异、接受/拒绝、重新比较和画稿对比。`followJob`（495–507 行）只在完成事件携带 `candidateRevisionId` 时展示它；无候选时更新当前修订并调用 `revealCurrent` 打开/刷新画稿。因此不能笼统说来源项目没有卡片或候选操作。
- 失败/取消走现有消息与状态提示（510–518 行），不是覆盖所有回合状态的通用设计结果卡。重开时恢复 `pendingCandidate` 的入口（685 行），也服务待处理候选。
- 候选图片来自按修订请求的预览接口；相邻 `packages/orchestration/src/revisions.ts` 的 `previewRevision`（196 行）读取修订并调用已有 renderer 返回 PNG。它不能证明 Molly Design 的逐轮缩略图捕获、存储与 outcome 引用链有来源；在核对的应用与公共包源码中未发现这一对应功能。Bento 自己的页面缩略图也不是会话历史结果缩略图。

据此修正判断：候选审阅是已有能力，可以删减后迁移；把它推广为每轮的通用结果卡，以及增加逐轮历史视觉回执，是 Molly Design 迁移方案自身的扩展。即使它们最初已写入本项目计划，也不符合此次明确的迁移范围，应从后续目标中移除，而不是继续以“可能有用”为由保留或换位置。此处是来源事实更正，不构成必须迁入候选的要求；后续用户已确认删除候选工作流。当前稿、旧内容可达与提交正确性仍保留，不迁回修订历史和对比系统。

## P0–P6 复核与处置

2026-09-12 修订：原读取同步 hook 改为[人工保存自动回写](../../implemented/simplification/2026-09-12-editor-owned-pptd-save.zh.md)，同时保留[先读文件提醒 hook](2026-09-12-noninvasive-design-hooks.zh.md)；不建立逐次模型生成证明或修改 runtime。下表旧名称依此理解，历史实现不改写。

来源项目本次核对版本为 `7fd3c06`。以下区分已决定删减、建议待裁定和保留理由；这是产品范围审查，不把冗余称为 P0/P1 运行时缺陷，也不以“已完成”豁免范围审查。

| 范围/状态 | 证据与判断 | 处置 |
| --- | --- | --- |
| P2.5/P2.6 已实现：通用结果卡、专用修复按钮、逐轮图片 | 来源只对待处理候选显示审阅卡；Molly Design 扩展到全部状态，并新增缩略图落盘/读回链 | P3.0 退役；修复继续用普通输入/文件诊断，旧内容可达，不建设候选入口 |
| P4.2 未实现：侧栏作品缩略图 | 来源 `navigation.js` 使用会话导航；未发现对应作品缩略图链。当前稿定位不需要新的图片生成/缓存 | 从功能表、P4 和概念图约束中删除，不把退役的图片链换到侧栏 |
| P2.1 已迁入 skill，P3.6 待改：固定创作流程 | 当前 [SKILL.md](../../../../packages/design-authoring/skills/graphic-design/SKILL.md) 的 Produce 段要求固定顺序、只检查一次参考图、禁止自行像素分析、经 finalize 发布；有来源也不等于符合目标范式 | 保留格式合同和可选辅助脚本；取消方法约束与必经 finalize，不再按单个工具缺席判定全部 review 未完成 |
| P2.7 #2b 已实现：旧文件自动候选 | [turn-outcome.ts](../../../../apps/cli/src/design/turn-outcome.ts) 在 `unchangedSinceSend` 且不同于当前稿时仍 `keepCandidate`，以可见性为由增加回合后处理。来源编排的候选对应重新生成或修改协调冲突，不能证明有同样的旧文件提升需求 | P3.0d 已确认删除自动提升，保留文件及已有候选/回执；可独立交付，不等待 P3.7 显式预览/导入上线 |
| P0/P1 已完成：桥接、保存、导出、冲突另存 | Bento 不能直接当普通 React 组件；存储、资源和版本保护具有当前消费者。尺寸交互已有明确决定；串行编辑取代正常人机并发 | 保留必要适配；冲突另存暂留异常保稿，不继续扩成日常流程 |
| P2.2/P2.3/P2.7 已完成：输入快照、原子提交、回执恢复 | 这些保护当前稿并记录不可由当前稿重建的历史提交事实；P2-A2 当前画布更新还消费 committed revision | 保留；移除卡片时沿消费者核对，不能把整个 `designOutcome`、输入快照或渲染桥一并删除 |
| P3.1/P3.7 待实施：读取 hook、只读实时预览 | 是明确确认的 Molly Design 适配，不能冒称来源项目已有；共享正向转换、workspace、实际 hooks 和 Lody watcher | 保留已确认范围；不扩成通用 hook 平台、新 runtime、持久预览库或自动提交系统 |
| P3 图片/选区、P4 上下文动作 | 来源已有图片编辑与稳定选区；Molly Design MCP 当前仅生图，需补 edit | 复用输入/派发与已有图像连接，model 必填无默认；重新生成统一提交，候选流程删除 |
| P3–P5 素材库、品牌资源、作品目录、模板市场 | 已明确移出迁移范围；部分旧图仍画出这些能力 | 保持删除；2026-09-12 用户另行确认 Git 设计历史，不由此恢复这些能力或来源项目完整修订库 |
| P5/P6 清理、打包与验证 | 复用 Lody 基础设施和既有测试；平台/Agent 支持必须有实证 | 保留必要交付工作，不新建发布系统、验证引擎或 Agent 调度 |

参考图附件 P2-A3 是既有 Lody 附件链路在 Molly Design 本地组合中的适配缺口；reference-pack 非 PNG 是可选辅助脚本的栅格分析限制，不能扩大为 Agent 不支持非 PNG 图片。两项继续单列，具体复用证据见下文。手写 PNG 移植具有来源及裸 Node 环境理由，本次不据行数要求换架构，也不新增编解码器。

## 退役边界及设计原则来源

2026-09-12 范围更新：用户已确认[Git 设计版本](../../implemented/feature/2026-09-12-design-version-history.zh.md)，取代本记录此前排除所有历史版本的范围。只增加人工存版本、历史查看和从旧版编辑；Git 是唯一历史后端，自建文件快照库不实施。结果卡、历史缩略图、候选审批和跨作品素材库仍保持退役，原 P0–P2 历史判断不改写。

Agent 看图与结果卡分属不同消费者：[skill 的 Review 用法](../../../../packages/design-authoring/skills/graphic-design/SKILL.md)调用 `molly_render_preview` 后用可用图片工具打开 PNG；[thumbnail.ts](https://github.com/LeonEthan/molly-design/blob/baed947b6f16263cb6a2f8f37e10f1695d146fe0/apps/cli/src/design/thumbnail.ts)则在产物已分类后生成给 UI 的小图。删除后仍需保留工具注册、预览队列/宿主和读图用法；渲染成功、模型说看过和成功读取图片是不同事实。旧内容预览按需复用渲染，不建立候选面板或持久缩略图服务。

P3.0 删除范围必须贯穿卡片挂载、专用修复动作、采集缩略图、字段生产、读回接口和孤立测试/文案。共享 `maxEdge` 与缩放分支当前用于卡片，实施时核对是否有新消费者再删除；旧 outcome 容忍遗留字段，无需批量重写会话或启动后台文件清理。采集与回执不能因预览曾成功而省略；P6 验证旧内容重开可读、保存保护、旧记录可读、Agent 真实读图和无专用缩略图生成。

根 AGENTS.md 复用来源项目开头的最小端到端及删除无用途机制原则，并结合架构 §3 的单一视觉真相、可重算派生状态、当前阶段最小形态、场景知识属于 skill、证据驱动约束和自主完成原则，写成本项目的约束。质疑需求、先删除再简化优化是本次明确采用的方法。没有照搬来源的不可变修订库、仅导出治理、封闭工具白名单或完整运行时；这些与 Molly Design 的已确认范围及 Lody 工作范式不一致。

文档更新覆盖根规则、Spec、阶段计划、相关同步/预览决策与概念图说明。产品代码及 runtime skill 本次不改；后续实施仍需按 P3.0/P3.6 验证，不能将本文档检查当成产品验收。

2026-09-11 后续决定：[串行编辑](../../implemented/architecture/2026-09-11-design-serial-editing.zh.md)已确认 Agent 执行及结果处理期间所属 Bento 画布禁止人工修改，取代人机并行编辑目标。读取同步、最终版本校验与草稿保留；后续收敛删除候选工作流，手工冲突另存暂作异常保稿，不因只读而假定所有外部竞争消失。运行时尚未修改。

## Lody 常规能力复核（2026-09-11）

本次对照 Molly Design `HEAD=101425f` 的源码与迁移前 Lody 基线 `8ea564d`，区分原有通用能力、P0–P2 已迁入能力和 P3 新的连接工作。安装版 Lody 的附件菜单已观察到，但没有上传/发送验证，也没有证明其二进制与本地源码版本一致。不能把一次 Molly Design OSS 验收失败推广为 Lody 没有附件功能；同样，存在入口和代码不能当成免云认证端到端已通过。

### 附件结论更正

此前 P2-A3 所称“没有对等的本地身份和存储”，遗漏了以下已有链路：

- [AttachmentAddMenu](../../../../packages/components/src/components/chat/attachment-add-menu.tsx) 统一附件入口；[首页](../../../../packages/components/src/components/chat/chat-landing.tsx)和[会话输入](../../../../packages/components/src/components/sessions/session-chat-input-area.tsx)已有按类型分流、粘贴、拖放、进度、重试和草稿处理。
- [sendSessionFileToLocalRuntime](../../../../packages/components/src/lib/electron-session-file-sender.ts) → Electron `localProjects.sendSessionFileLocal` → CLI `session/file-send-local` 已把用户选择的文件交给本机。已有 [session-file-blob-store](../../../../apps/cli/src/lib/session-file-blob-store.ts) 保存字节，返回 `fileId`、摘要、`transport: local` 和机器身份；不是必须从零建设本地图片库。
- [message-handler](../../../../apps/cli/src/lib/message-handler.ts) 的 `materializeSessionFileAttachments` 能从本机存储读取并校验字节，落在会话 `.lody/attachments`，向 Agent 提供 `resource_link` 和文件描述。云端回填已有独立开关，不能为复用本地通道打开认证产品云。
- `session-chat-input-area.tsx` 的图片上传异常分支已能改用本地文件附件；但首页图片 hook 无该分支，且首页/会话上传逻辑都在本地路径之前检查 `authToken`。因此它不是目前 OSS 构建可直接使用的完整解法。

实际适配范围：复用上述入口、传输和存储；处理本地能力与云认证的分离；核对首条消息之前的附件归属（已有处理器要求会话存在）；使本地图片接入 P2.2 的参考快照及 Agent 实际可用的图片输入。现有文件附件的 `resource_link` 不自动等于 ACP `image` 块，`prepareDesignTurn` 目前只冻结图片附件分支，不能用“文件已传过去”冒充设计参考图已接通。

还须适配已发送本地附件的读回：[session-file-presentation](../../../../packages/components/src/lib/session-file-presentation.ts) 将所有 `transport: local` 视为 pending，[session-file-download](../../../../packages/components/src/lib/session-file-download.ts) 仍是认证下载。优先复用现有受控本地文件读取与图片呈现；具体身份/路径映射仍需实现验证，不能直接暴露任意 blob 路径。保留不同的附件/画布素材生命周期，不等于建设两个上传控件、存储服务或素材库。原“必须另建本地存储、体量中大”的估算缺乏依据，撤回；本次不作新的成本承诺。

### 对原 29 项清单的逐组核对

编号对应上一轮整体清单；合并相同复用来源，未合并产品职责。

| 原编号 / 内容 | 已有依据 | 清单应只保留的差量 |
| --- | --- | --- |
| 2、4：外壳、会话导航与查找 | [侧栏](../../../../packages/components/src/components/loro-sidebar.tsx)、[行操作](../../../../packages/components/src/components/sidebar-updated-session-list.tsx)、[命令面板](../../../../packages/components/src/components/commands/command-palette.tsx)已有名称、搜索、置顶、归档与导航 | 设计身份/当前稿定位及开发字段删减；不是建设作品管理或新搜索系统 |
| 3：执行状态、继续与恢复 | [会话服务](../../../../apps/cli/src/session/README.md)、[会话输入/派发](../../../../packages/components/src/components/sessions/session-chat-interface.tsx)已有队列、权限、取消、继续、恢复与 provider 会话处理 | P3.5 验证设计上下文衔接；发现具体缺口再修，不能按完整会话系统重做 |
| 1、13、14：串行编辑与异常保稿 | Lody 提供执行事实；P1 已有画稿保存、离开保护和冲突另存 | 连接执行/结果处理状态与 Bento 人工变更入口；正常人机并发工作流删除，异常另存暂保留；没有现成的跨作品只读合同可直接宣称已完成 |
| 5、6：创建、尺寸、编辑、保存、重开、导出 | P1 已接现有 Session 创建/自动命名及 [design-service](../../../../apps/electron/src/main/services/design-service.ts)；Bento 有编辑命令与撤销/重做 | 后续只是新串行边界及 UI 适配；Lody 的普通文件保存/图片另存不是可编辑设计持久化的替代品 |
| 7、8、9：转换、反向投影、草稿 | P2 已有 [intakeAuthoring](../../../../packages/design-authoring/src/intake.ts)；Lody 有 workspace 和派发 | 正向转换继续复用；反向可编辑语义和投影/草稿隔离是明确的新适配；现有分组/多阴影等还需最小 PPTD 扩展 |
| 10、11、12：hook、五种 Agent、版本/回执 | 既有 Agent 接入，P2 的 [turn-input](../../../../apps/cli/src/design/turn-input.ts)、[turn-outcome](../../../../apps/cli/src/design/turn-outcome.ts) 与 store 已保护提交 | 不重做接入和回执；新增读写 hook 薄适配，验证实际工具覆盖；Lody 支持该 Agent 不等于已支持设计 hook |
| 15、16：候选与旧文件提升 | P2 已有候选持久化和动作；#2b 属于 Molly Design 增加的归属策略 | P3.0/P3.3 退役新候选生产与 UI，P3.4 保护旧内容；P3.0d 删除旧文件被动提升，Agent 明确重提交另有基线合同 |
| 17、18：实时预览与当前稿 | [文件预览](../../../../apps/cli/src/lib/file-preview/README.md)、[watch coordinator](../../../../apps/cli/src/lib/code-collab/workspace-watch-coordinator.ts)、Bento 和正向转换均已有 | 连接 PPTD 多文件快照、受限订阅及独立预览；普通文件预览不转换 PPTD，现有 watcher 订阅 workspace root，尚非精确依赖 API |
| 19：渲染及看图 | P2.4b 已有 `molly_render_preview`；Lody 有文件/图片显示，Agent 另有实际读图能力 | 保留能力；退役结果卡不删除通用附件气泡、图片预览、复制/另存或 Agent 图像内容块 |
| 20：skill | Lody 已有技能发现/物化与输入引用，P2 已迁入设计 skill | 收敛强制步骤；不新建技能管理器或固定创作流程 |
| 21：图像生成和当前画布图片操作 | P2.4 已有 [图像连接设置](../../../../packages/components/src/components/settings/image-connection-setting.tsx)、[生成工具](../../../../apps/cli/src/mcp/image-generation.ts)；Bento 的 [image 命令](../../../../packages/design-bento/vendor/packages/editor-bento/src/ui/image.ts)已有替换/裁切等能力 | P3.2a 复用连接并补 generate/edit 请求，删除产品默认模型；P3.2b 连接当前选区，不重建图片编辑器或图像作业服务 |
| 22：参考图附件 | 见上文完整输入/本地文件链路 | Molly Design 本地组合适配与验收；不能再写为“新增附件功能”或“新建本地图片存储” |
| 23：非 PNG 参考分析 | [image-preview-export](../../../../packages/components/src/lib/image-preview-export.ts) 的 `encodePngBytes` 已通过浏览器解码/Canvas 转 PNG；该文件在迁移前基线已存在 | 可选脚本能力适配；若采用规范化，优先在持有图片的现有渲染端入口复用并传递分析副本，不让 CLI/skill import Electron，也不新建解码通道 |
| 24：元素引用 | 已有 [mentions](../../../../packages/components/src/components/mentions/README.md)、[视觉批注输入](../../../../packages/components/src/components/preview/visual-annotation-draft-composer.tsx)和 [anchor 合同](../../../../packages/shared/src/visual-annotation-types.ts) | 复用输入/引用呈现与派发；网页 selector/矩形不是 Bento 稳定 ID，仍需作品/基线/元素绑定，不迁入另一套批注系统 |
| 25：快捷操作 | [命令与快捷键](../../../../packages/components/src/lib/commands/shortcuts.ts)、普通 prompt 派发均已有 | 可选目标动作复用现有入口；不用新命令系统，也不以便利按钮阻塞基本创作 |
| 26：布局、设置、引导 | [布局状态](../../../../packages/components/src/atoms/layout-state.ts)、现有侧面板、P1 的 [Focus canvas](../../../../packages/components/src/components/sessions/design-canvas.tsx)、[设置目录](../../../../packages/components/src/components/settings/settings-tabs.tsx)、[引导步骤](../../../../packages/components/src/components/onboarding/onboarding-steps.ts) | 配置/文案/布局适配。P1 已有专注画布，只核对新预览/只读衔接，不重新开发，也不用隐藏右侧面板的 Zen 替代；本地引导已有能力裁剪，不新增必经语言/外观/图像配置页面；没有具体需求就不新增“保存设置” |
| 27、28：开发功能退出与通用能力 | [终端](../../../../packages/components/src/components/terminal/terminal-dock.tsx)、[浏览器](../../../../packages/components/src/components/sessions/session-browser-panel.tsx)、[fork](../../../../apps/cli/src/session/session-fork-service.ts)、文件读取均已有 | 仍有消费者则复用；退出开发 UI 不等于删除 Agent 读图/文件/工具或设计预览依赖 |
| 29：打包和发布验收 | 既有 Electron 构建、managed-runtime 与 [更新服务](../../../../apps/electron/src/main/services/app-updater-service.ts)，P0 已接设计资源 | 补设计资源和真实平台/Agent/hook 验收；不建设第二套安装、更新或测试系统 |

`encodePngBytes` 是现有图片复制路径里的私有辅助函数，不是已接入参考附件的公共接口；提取复用仍需验证尺寸、透明度和支持格式，且原 PNG 跳过转换不能证明 reference-pack 支持任意 PNG 编码。外部路径引用也不会自动经过附件入口。可以先声明可选脚本限制，不能要求所有 Agent 读图先经该脚本。

### 本轮处理与证据限制

已更正阶段计划和 Spec 的附件描述、非 PNG 限制及 P4 复用边界；保留历史失败观察并收回对整体能力和开发体量的推断。P3.5/P4/P6 的通用能力列为复用/适配/验证，P2 已完成能力不重复开发。上述 sender、blob store、PNG helper、layout、command palette、watch coordinator、onboarding 和快捷键模块在 `8ea564d..101425f` 无差异，是 Lody 已有实现，不是本轮新发现的 Molly Design 扩展。

本轮为源码与计划审查，仅修改文档；没有运行产品测试、启动真实 Agent、上传附件、执行监听或验证安装版完整行为。实际附件接入、五种 Agent 图片输入与 hook、Bento 串行编辑和持续预览仍待相应实施验收。本节是产品范围/复用审查，不把文档误判自动标为已证实的 P0/P1 运行时缺陷。

文档验证：`corepack pnpm run docs check`、`corepack pnpm check:public-boundary` 与 `git diff --check` 通过；21 条既有规则文件大小警告，无注册 SHA topic。Spec 保持 draft，计划与本记录保持 proposed，翻译 pending；没有提交或更改运行时代码。

## 旧文件自动候选删除裁定与实施拆分

2026-09-11 用户明确确认删除 P2.7 #2b：成功回合中可证明与派发时工程相同的 PPTD，不因当前画布已不同而自动形成本轮新候选。该决定取代 P2.7 当时为了可见性而保留候选的选择，不删除磁盘文件、已有候选或历史回执。结构校验和原子提交继续保留；后续整体收敛将异常版本候选改为保留草稿/诊断交给 Agent，P3.7 承接直接显式导入。此范围决定已经确认，实际退役仍未实现，因此文档保持 proposed，Spec 保持 draft。

源码上的删减边界是 [turn-outcome](../../../../apps/cli/src/design/turn-outcome.ts) 的 `unchangedSinceSend` 分支；保留既有 `artifactAtSend` 内容证据，无主动重提交事实的未变旧文件按 no_artifact 结束，去掉被动提升的导入/比较。P3.3 对有效新读取基线下的明确重提交另行定义，不以摘要未变要求 Agent 修改无意义字节。清理局部辅助函数前核对 store 等其他消费者。已记录 outcome 和匹配的回执仍优先恢复历史事实，不用新规则重写旧回合或抹掉已有候选。缺少派发快照不能反推“未修改”；本切片不顺带修改旧清单兼容合同或增建提交台账。

删除可独立于实时预览交付：代价是 P3.7 上线前不再由普通回合自动提示磁盘旧工程，文件仍保留。验收区分当前画布与旧工程相同/不同、旧工程原已无效、新产物变更、异常版本冲突、已有回执恢复；取消/失败仍按真实执行结果处理，不一律改成 no_artifact。本轮未运行这些测试。

[下一步实施切片](../../implemented/architecture/2026-09-09-graphic-design-platform.zh.md#下一步实施切片2026-09-11)沿用 Pn.x 编号，先安排旧文件删减、串行编辑、格式往返和强制流程收敛，并可推进图像 MCP 补齐及独立附件适配；不再把候选面板作为卡片退役前置。hook 先完成一个可验证的实际接入，再扩到其余接入；文件预览只依赖共享来源边界，不等待五种 hook。P4 复用 UI，P5 按消费者清理，P6 汇总实际交付证据；没有创建执行任务或修改运行时代码。

## 整体审查后的当前边界

[收敛记录](2026-09-11-design-workflow-convergence.zh.md)记录用户已确认的后续决定与源码差异，取代本记录初轮讨论中的最小候选方向。当前需要纠正的既有实现包括：候选生产/审批、产品默认模型、仅文本生成的图像接口、Bento/PPTD 表达差异，以及结束后诊断不能直接反馈给已结束 Agent 的时序边界。P3 交付文件工具可见冲突、普通继续、旧内容可达和直接导入；P4 不为这些机制新增管理页。

本轮文档已同步，不表示运行时完成。原附件复用、非 PNG 脚本限制、渲染读图、回执与手工异常保稿结论继续适用；正常人机并发、临时预览元素指令和固定创作流程不再进入首期。

后续 T07 已实现[普通文件读回与卡片退役](../../implemented/simplification/2026-09-11-design-files-without-result-cards.zh.md)：旧候选原 JSON 与内嵌素材、旧/新草稿通过既有文件入口可达，卡片和专用采用/丢弃/修复动作退出。上文保留原审查时点；新候选生产和缩略图生产仍由独立任务退役。
