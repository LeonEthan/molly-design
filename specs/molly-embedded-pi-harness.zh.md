# Molly 内置 Pi Harness

Status: approved
Approval: [2026-09-21 owner approval at a7a297ae](https://github.com/LeonEthan/molly-design/pull/52#issuecomment-5755930477)
Translation: current

[English](molly-embedded-pi-harness.md)

## Problem Statement

用户需要可安装、可配置、可持续创作的 Molly，而不是不断增长的验证矩阵。内置引擎、连接、图片和设计事务已有大量实现及验证，但尚未形成完成关键旅程的安装包。重复全量检查、性能诊断和多厂商排列验收延迟了实际交付。

## Solution

用户安装 Molly 后，只需配置模型连接、API Key 和明确的模型，即可开始设计，无需另装 Agent CLI 或全局 Node/npm。图片生成与编辑继续使用用户配置的图片 MCP/BYOK；没有图片连接时，文字、形状、手工编辑和渲染仍可使用。不同会话可以选择不同模型连接，但所有新执行使用同一版本的内置 Pi harness。

本草案承接《Molly 内置 Pi Harness 改造任务方案书》v1.0（2026-09-19），并按 2026-09-20 的收敛要求重新定义本次剩余交付范围：完成安装包、一个完整设计旅程、关键交互、旧数据继续和交付说明。下文明确延期的项目不再是本次完成条件；原方案历史目标与已执行证据保留，不将延期记为实现完成。[实施计划](../.agents/notes/proposed/architecture/2026-09-19-embedded-pi-harness-implementation.zh.md)保存实现与检查证据。本修订仍为 draft，不以任务状态或自动检查替代该修订的人类审批。

这是对[设计工作台 Spec](graphic-design-platform.zh.md)中多 Agent 选择和 CLI 引导目标的后续修订提案，不是对现有实现的描述。待实施时同步调整该 Spec、[上游采用范围](lody-upstream-adoption.zh.md)、相关作用域规则及黄金用例：保留已有验收历史，新内置 Pi 结果独立记录，不能把 Kimi CLI 的通过结果转记为 Pi 通过。本草案不改变 Bento 编辑范围、设计格式、历史后端或自主创作原则。

## User Stories

1. As a desktop user, I want to install Molly without installing Pi or global Node/npm, so that I can start designing without managing an agent runtime.
2. As a returning user, I want the installed application to contain the current engine and resources, so that development success also applies to the application I run.
3. As a designer, I want to configure my model connection and explicitly select a model and thinking level, so that I control the service used for my work.
4. As a user with multiple connections, I want each design session to retain its selected connection, so that accounts and endpoints are not mixed.
5. As a user, I want credentials protected locally and absent from prompts and exports, so that configuring a service does not disclose my secrets.
6. As a user, I want unavailable or unverified model capabilities stated clearly, so that I do not mistake a listed model for a tested service.
7. As a designer, I want to create an editable artwork with Kimi, so that I can continue editing the result rather than receive only a flattened image.
8. As a designer, I want to configure my own image service and image model, so that image generation is independent of my language-model connection.
9. As a designer, I want to generate an image and use it in my artwork, so that image results participate in the existing design workflow.
10. As a designer, I want to edit an existing image and apply the result to the intended element, so that I can revise visual content without rebuilding the artwork.
11. As a designer, I want to edit text and shapes without an image-service key, so that optional image generation does not block ordinary editing.
12. As a designer, I want to preview creation progress without committing every preview, so that I can inspect work while preserving the current artwork.
13. As a designer, I want my manual changes saved before the Agent continues, so that it works from the current artwork.
14. As a designer, I want the artwork protected from concurrent edits during Agent execution, so that two writers do not overwrite each other.
15. As a designer, I want to save, export, reopen and continue the same artwork, so that the design remains usable beyond one session.
16. As a user, I want to cancel execution and see an accurate result, so that a stopped or failed run is not presented as completed work.
17. As a user, I want to answer the preinstalled community extension's questions in Molly, so that I do not need a terminal interface.
18. As a user, I want unknown paid-operation results to remain identifiable without automatic resubmission, so that reconnection does not silently charge me again.
19. As a returning user, I want old artworks, assets and conversation history preserved, so that migration does not discard my work.
20. As a returning user, I want an explicit action to continue an old design with the built-in engine, so that historical runtime identities are not silently reused.
21. As a user of an old Role, I want migration to preserve its origin and usable preferences, so that it cannot secretly restart a retired CLI.
22. As a local Pi user, I want Molly to leave my separate configuration and installation untouched, so that adopting Molly does not disrupt other tools.
23. As a user receiving this delivery, I want a runnable package and concise supported-capability notes, so that I know what I can use and what remains deferred.

## Implementation Decisions

### 剩余工作与完成条件

已有内置 worker、ACP、连接与凭据、MCP、图片导入与恢复、设计事务、迁移门禁及社区问答实现继续复用，不为本次收尾重写。只修复阻断下列完成条件的实际缺陷。

| 顺序 | 剩余工作           | 完成条件                                                                                                                                                                    |
| ---- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1   | 安装包启动与交付   | 解决打包后 Helper 启动超时，生成 macOS arm64 本地安装包；从包安装的应用能启动内置引擎，不依赖全局 Pi/Node，不首启下载 harness；资源与版本身份一致。                         |
| R2   | 一个完整设计旅程   | 使用明确配置的 Kimi k3-256k/high 和图片服务，在同一个作品上完成创作、生成图片、基本图片编辑与应用、人工修改后继续、保存、导出、重开及继续；不另建海报/信息图/长图排列矩阵。 |
| R3   | 设置与关键交互收尾 | 在上述旅程检查连接/模型选择、必要错误提示、取消与预装问答；用户能配置和操作，未验证能力没有完整支持承诺。优先复用现有界面和权限流程。                                       |
| R4   | 旧数据继续         | 实际走一次旧设计会话继续和一次旧 Role 迁移；来源及旧数据保留，继续进入内置 Pi。备份、重入和全部旧执行入口门禁复用已有回归覆盖，不再次排列所有故障。                         |
| R5   | 交付说明与最终检查 | 提供安装包、简洁配置说明、支持状态和已知限制；完成与最终变更相关的检查及仓库规定的交付/提交检查。既有无关失败独立列明，不通过删除断言掩盖。                                 |

R1 → R2 是关键路径；R3 嵌入 R2，随后完成 R4 和 R5。新增真实缺陷先最小复现再修复，不因顺手发现可优化项扩大范围。R1–R5 全部有对应证据且没有未解决的核心功能、安全或数据损坏问题，才可将本次收敛交付记为完成；不声称原方案延期部分已完成。

### 职责与状态权威

| 责任方             | 权威状态与职责                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Molly Session 服务 | 用户任务、队列、权限、运行配置快照、执行结果和恢复策略；唯一派发者。                        |
| 内置 Pi worker     | 模型循环、工具调度、压缩和原生模型上下文；使用 Molly 私有 SessionManager 存储。             |
| Molly ACP adapter  | 沿用现有 ACP 消费边界，将原生结果、事件和取消映射到宿主；只补必要的共享扩展。               |
| 设计服务与 Bento   | BentoDoc 为唯一可编辑真相；设计服务拥有投影、草稿采集、素材校验、CAS、回执及既有 Git 历史。 |
| Electron main      | 保护凭据、验证调用者与秘密接收目标；向受管 worker/MCP 提供必要的短期取用能力。              |
| 独立 MCP host      | 工具连接、发现、授权执行、取消与结果导入；不在 daemon 主线程执行工具。                      |

产品 Session、一次用户任务、Pi 内部 turn、原生 session、worker 实例分别标识。运行快照冻结连接 ID/revision、模型与思考配置、harness 构建、插件和工具集合、权限配置及相关设计基线，不包含秘密。UI 消息是产品读模型，不用于复制并重建另一份完整原生模型历史。

### 内置交付与隔离

引擎基线为 Pi v0.85.1，使用公开 coding-agent SDK、固定绝对路径和独立进程。引擎、精选插件及实际需要的资源在构建时锁定并随包交付；发布产物带版本、依赖/资源摘要、协议版本和平台清单。开发与安装包均需验证实际 Node 版本满足引擎要求，不以宿主开发 Node 代替包内探针。

Molly 不定位、启动或修改本地 Pi，不自动读取用户级或项目级 Pi 配置、上级上下文或全局 skills，不继承其认证。资源加载仅来自已批准清单及宿主明确准备的本轮输入；不能先运行默认发现再过滤。settings、模型目录、缓存、会话、插件状态和临时文件均在 Molly 自有位置。worker 环境采用白名单，保留包内 Node 启动所需变量，移除外部认证和代码注入变量。退出只清理自己拥有的进程。

社区原生插件必须审核、锁版、选择性加载和验证；本次使用已预装的社区问答插件，复用现有隔离/恢复证据，并完成一次原生交互检查。简单确认、选择、输入和通知复用现有 GUI；不支持的 TUI 能力明确不可用。必要命令体系延期，不增加斜杠命令发现、配置命令或手动压缩命令；未映射命令保持不可执行。超时、关闭窗口和取消不得默认同意。插件不获任意安装、自更新或另一套付费服务配置入口。

这些保证针对产品路径与经审核扩展，不承诺同一 OS 用户下任意原生代码、shell 或第三方 stdio MCP 的强沙箱。

### 模型、凭据与权限

Provider preset、用户连接和模型选择分别建模。同厂商多个连接独立拥有 endpoint、凭据引用和 revision；按会话/连接隔离 ModelRuntime。未显式选择模型、凭据缺失或能力不兼容时明确失败，不选择首个模型或另一个账号作为 fallback。配置变更在下一安全边界生效；撤销可以终止当前工作，但不能换用别的凭据。

保留已有原生 presets、高级 OpenAI-compatible 和多连接架构；本次真实服务交付以已配置的 Kimi k3-256k/high 为准，不再扩展逐厂商、地域和模型验收。Google 接入修复与 Pi SDK 升级延期，固定引擎基线不变。支持矩阵区分真实验证、模拟验证、阻塞和未执行；只有真实通过的范围可称为正式支持。目录存在不代表服务可用，无视觉能力的模型不得显示为完成了原生看图评审。

凭据由 SecretStore 保护，普通配置仅保存引用；保存后无通用明文读取 API。秘密不进入工作区/Loro 配置、Role、原生会话、模型上下文、工具参数、命令行、诊断或 Git；模型 Key 不传给 shell，不同 MCP 不共享秘密。旧图片 Key 的迁移必须考虑 CRDT 历史和备份，不能将删除当前字段宣称为彻底清除历史明文。无法可靠持久化时明确失败或使用可见的内存模式。

授权关联实际 run、worker epoch、请求和连接 revision。工作区外读写、任意 shell、stdio 命令变更和秘密接收域变更有明确授权边界；付费工具默认逐次授权，可使用用户明确授予的有限次数。授权检查落实到执行路径；公开先读提醒不构成读证明或写授权。

模型请求、压缩及插件子请求都归属明确连接和使用量记录；首版标题由用户首句本地生成。有限传输重试不得变成整个任务或工具副作用的重放。费用无可靠依据时显示未知或估算。

### MCP 与付费图片

复用 workspace MCP catalog 和每轮选择，保留显式空选择的语义。支持经验证的 stdio/Streamable HTTP 子集；工具有稳定命名空间、来源和 schema 版本。接受任务时冻结工具集合，撤销立即阻止执行，执行中 schema 变更明确失败，新工具在安全边界生效。未实现的 sampling、elicitation、OAuth 等能力不宣称支持。

保留 `molly_generate_image`、`molly_edit_image` 和 `molly_render_preview` 的会话/宿主能力门控。外部图片能力通过预置适配或声明式字段映射绑定；无法绑定时仍可作为普通工具，如实显示图片能力未就绪。图片模型必须由用户明确配置，不使用 LLM 模型名或产品默认值。

URL、base64、MCP image/resource 经来源、路径、MIME、大小、尺寸和下载边界检查后进入既有素材存储。远程 file URI 不授权读取本机；重定向重新校验目标，不将秘密转发到新域。素材结果本身不提交或替换画布。

每次受管付费操作在发送前持久化身份与授权事实，状态区分 prepared、dispatched、succeeded、failed、outcome_unknown。协议重放和重连只恢复同一操作；未知结果不自动重新提交。用户明确再次生成时才创建新的操作。取消信号不证明远端停止或免计费；迟到结果只登记可恢复素材，不重启已结束的任务。

### 执行、设计提交与恢复

派发前先阻止新的人工修改并完成所有关联编辑器 flush，核对当前投影后冻结输入；所属作品在执行和产物处理结束前保持只读。预览只读、按消费者存在订阅，不决定成功或触发提交。

adapter 综合原生错误、取消、未完成工具和原生运行边界判定结果。Promise resolve、进程正常退出或单次 agent_end 均不独立证明成功。普通工具错误被模型处理后可以继续；错误、截断、断线及缺失结算不得误报完整成功。执行结果与 committed/no_artifact/conflict/validation_failed 等设计结果分别呈现。

恢复只重建已持久化的事实。能证明尚未派发的任务可继续；派发未知或模型流中断时保留 interrupted，不因没有可见 ACP 输出就重发。已完成执行但提交回执未确认时，仅恢复既有确定性收集/CAS/回执，不重新调用模型或工具。退役 worker 的迟到事件和授权不得结算新任务。原生历史损坏时保留原文件并明确诊断。

设计提交继续独立验证 schema、kernel replay、素材、可信来源和当前版本；失败保留 canonical、草稿及诊断。无新产物可以是合法问答。不增加候选审批、读取证明、必调 finalize、自动修复或新历史存储。

### 迁移与支持边界

画布、素材、草稿、聊天和历史原地保留。旧 AgentConfig/Role 保留来源且不可执行；用户显式“用 Molly 继续此设计”时创建新的 Pi 上下文，带入明确的历史上下文和可信素材。旧工具记录仅作为历史数据，不执行，不伪造跨 harness 原生身份。

迁移有版本、备份、重入标记和失败恢复，敏感备份仍受凭据保护。正式构建中聊天、继续、任务、Role、程序化创建、恢复、能力探测和辅助执行入口均不能启动外部 harness；读取旧历史不得偷偷启动旧 runtime。旧缓存仅保留或按另行显式动作清理。

首发原生验收为 macOS arm64；Windows/Linux 完成构建和资源探针不等于原生支持。真实 Provider/MCP 验收需明确账号、外发范围和预算。人工判断视觉质量；模拟测试、安装成功及结构正确不能替代。公开发布、签名、公证与更新渠道按各自交付条件处理。

## Testing Decisions

主测试入口只有一个：从 macOS arm64 实际安装包出发，执行 R2 的完整设计旅程，嵌入 R3 的设置、问答、取消及重开检查。R4 使用既有迁移入口做最小必要补充，不建设新测试框架。

- 好的测试观察用户可见结果、实际运行身份、保存/提交回执和旧数据保留，不断言私有实现细节或 mock 调用次数。Agent 自评不是人工视觉批准。
- 复用已有安装包资源与启动探针、真实 Kimi/图片记录、画布保存/冲突/导出验证、迁移重入以及权限/账本回归；既有证据只用于它实际覆盖的范围。
- 新缺陷只在能触达真实问题的最高现有入口补最小回归。只有变更、失败或新的明确风险才扩大检查；没有相关变化的模块不反复全量运行。
- 密钥不泄露、未知结果不自动重复付费、取消不伪造成功、不覆盖已保存画稿、旧入口不可执行仍是底线。优先复用现有测试，发现这些底线失效必须修复，不能以“减少测试”为由跳过。
- 基本图片生成与编辑使用用户已配置服务及显式模型。连接测试成功不替代图像生成/编辑成功；复杂 mask、多图及格式组合不在本次验收范围。
- 最后一轮检查集中执行受影响范围的类型/测试/构建和仓库要求的检查。提交前仍执行仓库要求的完整检查与格式命令；文档变更仍执行 docs status/check。既有无关失败如实归属，不删除检查、改写历史或无限追查。
- 停止追加性能分布、长期压力、GC/对象数量诊断、全厂商异常组合、重复截图与为填满矩阵而进行的真实调用。没有实际阻断性性能问题，不建设新性能门槛。
- 保留有价值的既有测试代码；本次删减的是额外实施和重复验证要求，不是为通过检查批量删除回归保护。

测试入口与五张收尾任务的拆分已经确认；任务确认不替代本 Spec 修订的正式审批，当前状态仍为 draft。

## Out of Scope

以下项目从本次剩余交付门槛移出，既有实现不因此删除：Google 修复与 SDK 升级；逐厂商/地域/模型真实验收；插件命令体系；复杂 mask、多图和全部图片格式组合专项验收；海报/信息图/长图各自完整排列矩阵；对用户本地 Pi 的实际升级/卸载演练；Windows/Linux 新增构建及原生专项验收；长期性能/压力/GC 诊断。已有自动检查仍保留，延期不等于宣称支持。

仍不做插件市场、任意原生插件安装、全部 TUI 兼容、外部 harness 选择、本地订阅认证导入、云端代理计费、新多 Agent 编排、Bento/YAML/历史重写或操作系统级强沙箱。公开发布、Developer ID 签名、公证和自动更新发布不属于本地可用版本收尾。

本地安装产物的真实启动问题不能归入“发布签名延期”而跳过；不绕过操作系统安全提示或降低现有安全策略。核心修复未完成时保持明确未完成状态。

## Further Notes

本次不是增加一套实施阶段或再建设验证平台，而是收敛剩余交付。用户故事描述完整用户价值，不代表为每条故事新增独立测试。原方案 A01–A20 不再要求全部逐项补跑，按 R1–R5 和保留底线判断本次交付；未覆盖范围明确列出。

### 依据与验证状态

剩余工作已发布为 [安装与 Kimi 接入 #46](https://github.com/LeonEthan/molly-design/issues/46)、[创作续改与保存 #47](https://github.com/LeonEthan/molly-design/issues/47)、[图片生成编辑与替换 #48](https://github.com/LeonEthan/molly-design/issues/48)、[旧数据继续 #49](https://github.com/LeonEthan/molly-design/issues/49) 和 [最终交付 #50](https://github.com/LeonEthan/molly-design/issues/50)。任务使用原生阻塞关系；Issue 创建和 ready-for-agent 标签不是实现完成证据。

仓库核查基线为 `7c85b3b06cc227a4e9e0c0e61d769352754aaa00`。实现证据、合成测试、资源探针及部分 Kimi/图片真实调用见实施计划的进度记录。最近桌面重建和 worker 同步已完成；图片解码探针的路径别名误报已修复并回归通过，但完整打包仍有 Helper 启动超时，原因尚未闭合。因此 R1 尚未完成。部分服务通过不等于所有服务、安装包、社区 GUI 或人工视觉均已验收；剩余工作以本修订 R1–R5 为准，历史矩阵不再额外扩大本次门槛。

- [现有 Agent 责任](../apps/cli/src/agent/README.md)、[设计链路](../apps/cli/src/design/README.md)、[共享合同](../packages/shared/AGENTS.md)。
- [Pi v0.85.1 包清单](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/package.json)：公开包和 Node `>=22.19.0` 要求。
- [Pi v0.85.1 SDK 文档](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)：原生会话、ModelRuntime、资源发现及默认认证/模型选择行为；封闭加载和权限适配仍需工程验证。
