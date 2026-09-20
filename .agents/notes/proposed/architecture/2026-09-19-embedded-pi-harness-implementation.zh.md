# Molly 内置 Pi Harness 实施计划

Status: proposed
Translation: pending

## 摘要

本计划将《Molly 内置 Pi Harness 改造任务方案书》v1.0 的 T00–T16 转成可独立审阅的实施批次，目标是在复用会话、ACP、设计事务和 MCP host 的前提下替换外部 CLI 执行。先完成契约、隔离、凭据和可靠终态，再交付一个无生图的最小设计闭环，随后扩展 Provider、图片 MCP 与社区插件，最后迁移并关闭旧入口。源码核查发现旧图片凭据存储和“无 ACP 输出可重试”规则需要提前处理，不能留到最终迁移或总验收。规划交付后用户明确要求“开始完整实现”，当前正在实施；真实服务、完整安装包和人工视觉结果仍待验证。

## 1. 计划基线与交付边界

- 方案来源：《Molly 内置 Pi Harness 改造任务方案书》v1.0，2026-09-19；保留原 T00–T16、A01–A20 编号，便于与附件核对。
- 代码基线：`7c85b3b06cc227a4e9e0c0e61d769352754aaa00`，与方案一致。工作区已有其他未跟踪笔记及 E2E 脚本，不纳入本计划的实现证据。
- 意图所有者：[内置 Pi Spec 草案](../../../../specs/molly-embedded-pi-harness.zh.md)。本文拥有实施顺序与验收决策，不复制第二份产品 schema。
- 初始授权包括运行时代码、依赖安装和离线/模拟验证；后续真实调用授权范围见下文。Git 提交、PR 或发布未获授权。没有创建会触发执行的 Lody Task/Session。
- 实现已覆盖 worker、连接、MCP、图片、社区问答、迁移及旧入口门禁；当前剩余交付以 Spec 的 R1–R5 收敛范围为准。下方 T16 全范围核对及后续记录保留为历史证据，不再要求据旧矩阵追加全部验收，也不能视为当前安装包的验收结果。

### 实施进度记录（2026-09-19）

#### 收敛剩余交付范围（2026-09-20）

此前逐步扩展协议矩阵、性能与 GC 诊断，产生的局部证据没有足够快地转化为可用安装包。依据新的收敛要求，修订现有内置 Pi Spec，而非另建平行规格：保留固定引擎、连接选择、基本图片生成/编辑、社区问答、本地隔离和设计数据正确性；剩余工作限于 R1 安装包、R2 一个完整设计旅程、R3 关键交互、R4 旧数据继续、R5 交付说明与必要检查。

替代方案是继续补齐原方案全部 A01–A20；本次不再采用该交付门槛。代价是 Google/SDK 升级、全部服务真实验证、命令体系、复杂图片组合、跨平台新增专项验收和本地 Pi 升级/卸载演练明确延期，不能宣传成已支持。测试围绕实际安装包的一个高层设计旅程，复用已有回归，仅对新缺陷补最小复现；停止无变化模块的重复全量运行及性能/GC 扩展。不删除有价值的既有测试，不削弱密钥、付费未知状态、取消、画稿保存和旧入口门禁底线。

最新实现状态补记：正常退出已空闲且自动保存的桌面后，已同步最新 worker 并完成桌面构建与类型检查。包内图片解码探针把路径别名误当依赖越界的问题，已用真实目录比较修复；先失败后通过的回归同时证明包外依赖仍被拒绝，定向四项及 Electron 173 项通过。完整打包两次仍在 Helper 启动超时，采样停于 dyld 启动阶段，不能把路径修复视为解决该超时；本次不继续诊断或追加运行。公开边界检查通过，真实模型零新增调用。

本次仅固化规格与范围，Spec 仍为 draft，笔记仍为 proposed。随后五张纵向收尾任务及其依赖获得确认，已发布为 GitHub #46–#50 并核对 ready-for-agent 标签和原生阻塞关系；入口确认不等于 Spec 正式审批或重新开始实现。无需为本次文档变更重复运行时测试。历史段落保留其当时结论；后续执行不得再以其中的旧全范围 open 清单覆盖新 Spec。

#### T16：全范围交付核对与构建证据分离（2026-09-20）

本次核对保留原 G01–G08、T00–T16、A01–A20 和 DoD 12 项，不把一系列合成探针通过换算为整体验收。下表链接是实现与既有验证的追溯入口；测试文件存在本身不是本轮执行通过的证据。各次实际执行结果、失败和限制仍以本记录对应进度段落为准。本轮只做只读产物检查与文档整理，没有新增生产逻辑或真实模型请求。

直接读取当前三个构建层级得到以下差异：

| 产物                                                      | 当前观察                                                                                                                                                                                | 可支持的结论                                                                   |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| apps/cli/dist/harness/runtime-manifest.json               | Pi 0.85.1，darwin/arm64，build 0d65026cb464429a6cd3f99dc1eab4f71039047e18afb147815b3e751fdddfa0                                                                                         | 最新 CLI 探针的构建身份；不是安装包身份                                        |
| apps/electron/resources/cli/harness/runtime-manifest.json | Pi 0.85.1，darwin/arm64，build 678b7f4705af4b99935d09bca339cd9941886dd4f13331cf8ec29c3de8a78b56                                                                                         | 桌面暂存资源尚未同步最新 CLI，不能套用最新探针结论                             |
| apps/electron/dist/mac-arm64/Molly.app                    | Info.plist 与 app.asar/package.json 均为 0.1.0；只读列举 app.asar 的 8263 项未发现 harness 目录、harness-worker 或 runtime-manifest.json；外置 Resources 文件清单亦无该 manifest/worker | 有 Molly.app，但没有本次固定 worker 的产物身份证据；不是当前迁移的可验收安装包 |

产物检查未启动旧包、覆盖运行资源、删除既有归档或采集凭据。包名/版本相同不能代替 harnessBuildId。原生应用复查仍报告 Mac 锁屏、自动解锁失败，需人工解锁；不绕过系统锁屏。后续应先退出本任务应用并确认相关进程结束，再同步资源和生成有一致身份的本地候选包，最后在同一包上开展原生验收；签名、公开发布仍是独立授权事项。

| 任务         | 已有实现/证据入口                                                                                                                                                                      | 当前未关闭部分；关联验收                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| T00 基线     | 本记录基线与性能段落、[CLI README](../../../../apps/cli/src/agent/README.md)                                                                                                           | 根检查 Git 谱系失败独立保留；完整应用基线尚缺；A20                                                          |
| T01 契约     | [共享契约](../../../../packages/shared/AGENTS.md)、当前 runtime manifests                                                                                                              | 消费者/安装包必须对齐同一构建，不能仅凭 schema 通过关闭交付                                                 |
| T02 打包     | [Harness README](../../../../packages/harness-pi/README.md)、实际 Electron 子进程离线 smoke                                                                                            | 最新原生安装包、无全局 Node/npm/Pi 和无首启下载验收未完成；A01                                              |
| T03 ACP      | [ACP 测试](../../../../packages/harness-pi/tests/acp.test.ts)及既有 CLI 验证                                                                                                           | 原生界面的文本/工具/确认/取消显示和异常闭环；A05/A12/A19                                                    |
| T04 隔离     | [Session 测试](../../../../packages/harness-pi/tests/session.test.ts)、封闭资源加载                                                                                                    | 同时运行真实本地 Pi、独立升级/卸载及配置前后对照未完成；A02/A03                                             |
| T05 凭据     | [加密存储测试](../../../../apps/electron/src/main/services/model-connection-store.test.mjs)、受保护传输/轮换测试                                                                       | 最新包真实执行后的参数/日志/历史/导出泄露扫描与系统存储失败体验；A04/A15                                    |
| T06 Provider | [协议矩阵](../../../../packages/harness-pi/tests/provider-contract-matrix.test.ts)、Kimi 既有真实记录、显式兼容模型                                                                    | Google 固定 SDK 不支持受保护 fetch，属于真实实现缺口；其他预设的合成契约不等于真实账号支持；A04/A05/A06/A11 |
| T07 恢复     | ACP、Session、[派发与账本测试](../../../../packages/harness-pi/tests/control-and-dispatch.test.ts)                                                                                     | 最新桌面崩溃/恢复、队列/steer/压缩和用户状态旅程仍需原生证据；A09/A12/A13/A19                               |
| T08 MCP      | [桥接测试](../../../../packages/harness-pi/tests/mcp-bridge.test.ts)、保护通道离线 probe                                                                                               | 仅声明已验收 stdio/HTTP 子集；原生撤销、断开与并发体验仍待核对；A07/A10/A11/A19                             |
| T09 图片     | 本记录 B08 导入、账本、恢复与既有真实调用段落                                                                                                                                          | 真实编辑/mask、多图输入、完整结果格式与失败旅程不能由生成成功代替；A08/A09/A10                              |
| T10 扩展     | 精确锁版 pi-ask-question、[资源加载测试](../../../../packages/harness-pi/tests/resource-loader.test.ts)、[GUI bridge 测试](../../../../packages/harness-pi/tests/extension-ui.test.ts) | 必要命令选择与宿主映射尚未实现；问答插件原生交互/恢复验收未完成；A14                                        |
| T11 设置     | 连接/显式模型、预装能力界面及旧 CLI 界面门禁                                                                                                                                           | 最新包空配置接入、表单、能力/收费提示与扩展交互尚待原生验收；A11/A14                                        |
| T12 设计     | 本记录真实海报/续改/PNG 段落，既有 flush/CAS/素材事务                                                                                                                                  | 信息图、长图、人工编辑后继续、图片替换、冲突、历史/导出/重开及人工视觉验收全矩阵未闭合；A06/A08/A16         |
| T13 迁移     | [继续服务测试](../../../../apps/cli/src/session/design-continuation-service.test.ts)、Role 备份/发布与重入测试                                                                         | 最新包实际旧 Session/Role 迁移、中断/重启、备份恢复和来源保留旅程未完成；A17                                |
| T14 旧入口   | CLI legacy 运行/安装拒绝、目录与 Role 门禁测试                                                                                                                                         | 必须在最新正式构建逐入口验证后端/任务/Role/深链/恢复均拒绝旧执行；A18                                       |
| T15 验收     | 本记录分层检查、真实请求与合成性能/对象保留诊断                                                                                                                                        | A01–A20 尚不能整组 pass；尤其原生安装、并行 Pi、自然长时稳定性和视觉验收；A03/A19/A20                       |
| T16 文档     | [用户帮助](../../../../README.zh-CN.md)、模块 README、Spec 草案与本核对                                                                                                                | 构建不一致、未闭合验收和下列 DoD 仍开放；不标记 approved/完整交付                                           |

最终 DoD 当前均保持 open，区别是缺口类型而非一概“代码未实现”：1 依赖 T02/T14 的当前安装包；2 依赖 T06 的 Google 实现决策和逐支持项真实证据；3 依赖 T09 的完整编辑与异常旅程；4 依赖 T10 命令与原生插件验收；5 依赖 T04/T15 的本地 Pi 独立生命周期；6 依赖 T03/T07 原生故障状态；7 依赖 T12 完整设计与人工检查；8 依赖 T13 原生迁移/恢复；9 依赖 T05 最新包执行扫描；10 依赖 T14 当前正式构建的全入口验证；11 保留根检查既有失败及 T15 未验收项；12 需要以上产物/支持矩阵/文档一致。对应目标：G01→1，G02→1/10，G03→2，G04→3，G05→4，G06→5/9，G07→7/8，G08→6；DoD 11/12 是跨目标交付门槛。

当前需要人类输入的事项保持明确：手动解锁 Mac；选择是否允许评估改变固定 Pi SDK（Google 路径），或保持版本实施最小原生适配；确定必要命令集合。未回复的选项不是授权。模型调用次数授权不等于其他厂商账号授权、SDK 范围变更或视觉质量批准。其余验收只使用已配置服务和任务内数据，不为填满矩阵创建额外付费重试。

#### T15/A20：GC 与原生对象保留诊断，未添加生产“修复”（2026-09-20）

上一轮看到受保护 MCP 的 52 轮 RSS 增长，尚不能把它等同于对象泄漏。本轮按 diagnosing-bugs 的性能分支保留原自然运行基线，分别检验延迟回收、历史增长和旧上下文保留；没有先设 RSS 阈值或调整生产逻辑。给合成探针增加显式 --diagnose-gc，仅在有界本地运行中通过 Node --require 加载 diagnostics/gc-observer.cjs、--expose-gc 和独立 IPC；不改 sealed worker、模型协议或权限通道。观察器在正常隔离/初始化以后才解析已加载 SDK 的公开入口，仅报告数字桶和构造器计数，不采集堆快照、对象摘要、用户历史或秘密。

同机同 build 的两组完整 GC 对照各 52 轮：受保护 MCP 组结束时 heapUsed 60059908 B、RSS 235552768 B；无 MCP 组分别为 57524720 B、234340352 B，后者原生历史从 1207 B 增至 37103 B。强制 GC 会改变性能和分配行为，这些数值不是优化后的生产成绩，也不能与自然运行组混成同一分布。

进一步按 [Node v22 的 queryObjects 文档](https://nodejs.org/docs/latest-v22.x/api/v8.html#v8queryobjectsctor-options)使用 count 模式，在首轮、第 10/20/30/40/50 轮、取消及显式续跑后计数。该 API 会进行完整 GC，且只覆盖当前执行上下文；固定 SDK 的两个公开构造器无本探针创建的子类。八个检查点 AgentSession 和 ModelRuntime 均各为 1，新增生命周期断言直接拒绝多实例残留，而不以任意内存大小当作泄漏判据。该组最后 heapUsed 57869180 B、RSS 230195200 B，历史 37396 B；取消、续跑与正常退出均通过。此结果反对“旧 Session/ModelRuntime 实例线性堆积”的假设，支持自然组的一部分增长来自可回收分配，但不排除其他对象、缓存或更长期的增长。

首次逐轮执行两类对象计数的试跑未在探针期限内完成，子进程退出导致观察失败；保留失败，不将它记为产品取消失败或完整样本。改为上述固定检查点后完成 52 轮，保留原 30 秒保护期限；探针增加独立 deadline 错误分类。诊断通道只在显式选项下存在，GC 观察代码留在清楚标记的 diagnostics 目录，未加入生产定时 GC、重启策略或 SDK patch。A20 的自然长时运行、完整应用冷启动与原生界面验收仍开放。

有效 GC 对照与检查点运行共 156 个本地合成请求，新增严格计数断言后另做 12 轮通过，四个检查点均各 1 个实例；失败试跑的完整次数未保留，不伪造计数。普通非诊断受保护 MCP/问答协商/显式兼容模型 smoke 仍通过，未调用真实 Provider。脚本语法、格式和 diff 检查通过，公开边界通过（4548 文件、25 manifests），docs check 零错误、17 条既有体积警告，无 SHA 待审。脚本继续属于根 lint 排除范围；没有以此声称 lint 或全仓既有 Git 谱系检查通过。

#### T15/A19/A20：同 worker 合成连续运行、取消与资源观察（2026-09-20）

在既有性能探针增加可选 --exercise-turns=N（1–50），仅与测量和显式合成兼容模型组合；默认离线探针行为保留。独立 helper 创建临时 loopback Chat Completions 服务，以固定合成密钥验证接收者和模型；先完成 N 轮，再在 ACP 实际收到非终结文本后发送取消，最后显式发起新 run。每轮通过真实 fd 3 授予凭据、冻结 snapshot、读取原生结果及请求账本；正常请求 succeeded，取消请求 outcome_unknown 且原生 cancelled，新 run 正常完成。观察到的 HTTP 与 run 一一对应，无自动重试或 fallback；本机服务关闭事件给出独立连接释放时间，不用 cancel 响应代替远端停止证据。

启用受保护 MCP 时每轮都重新准备短期授权和原生工具上下文，保持同一 nativeSessionFile；问答扩展只协商、不触发交互。记录 first/warm/cancelled/after-cancel 分布和逐轮 RSS。macOS 使用 lsof 的数字 FD 字段统计打开描述符，不记录文件名、目的地址或内容；其他平台不伪造该指标。计时是基线观察，未进入确定性单元测试或事后阈值判断，也未添加生产 RPC、SDK patch 或付费服务依赖。

同上一节 Apple M4 / Darwin 25.6.0 / Electron 39.5.1 / Node 22.22.0、build 0d65026cb464429a6cd3f99dc1eab4f71039047e18afb147815b3e751fdddfa0。5 个独立 worker 各运行 20 个完成轮次、一次取消和一次显式续跑，共 110 个本地合成请求；所有 worker 正常退出。first prompt 5 样本、warm 95 样本、取消/续跑各 5 样本的 p50/p95 如下（ms）：

| 观察                     |    p50 |    p95 |
| ------------------------ | -----: | -----: |
| 首轮 prompt 至结算       | 61.473 | 67.422 |
| 后续 prompt 至结算       | 35.978 | 40.203 |
| 后续受保护 MCP 准备      | 54.813 | 56.966 |
| cancel 通知至原生结算    | 24.102 | 28.163 |
| cancel 通知至 HTTP close |  0.877 |  1.100 |
| 显式取消后新轮次         | 37.561 | 38.554 |

另做两个 52 轮资源观察（各 50 次完成、取消、续跑）。启用受保护 MCP 时，首轮 RSS 221488 KiB，第 10/20/30/40/50 轮为 239184/243856/248560/254064/259456 KiB，最后 261456 KiB；FD 完成轮均为 19，取消后 18，新轮恢复 19。关闭 MCP 的对照首轮 221344 KiB，最后 237504 KiB，FD 同样 19/18/19。两者均能取消、续跑、正常退出，但启用 MCP 的增长更明显；尚未区分原生历史、上下文重建、V8 分配/回收或引用保留，不据 RSS 单项断定泄漏，也不能通过“不持续增长”验收。两组为单样本，不能把差额当优化收益；需要后续受控内存排查和更长运行证据。

首次 5 轮功能试跑、110 轮分布及两个 52 轮观察合计 219 个本地合成请求，零真实供应商调用。新增 helper 与主探针语法检查、普通非测量受保护 MCP/问答/兼容模型启动均通过；脚本继续在根 lint 排除范围内。未重建未变化的生产 worker，未声称消除既有根检查 Git 谱系失败。原生 UI、Google SDK 决策、完整安装/视觉验收仍开放，A19/A20 尚未整体完成。

#### T00/T15：打包 worker 启动性能基线探针（2026-09-20）

原方案 A20 要求可复现的性能记录，已有离线 smoke 仅返回通过与否。本轮复用该探针，抽出可调用函数并增加可选 --measure=N（1–100），保持原无参测量模式的离线契约与成功输出。每样本独立进程/私有目录，记录启动、ACP initialize、新建会话、受保护 MCP 准备、空闲退出和两处 worker RSS；输出全部样本及 nearest-rank p50/p95，并核对同一 build。资源核验与夹具准备不计入启动，ps 仅观察本次创建的 worker；没有另建产品度量协议或安装性能阈值。清理只等待尚未发生 exit 的子进程，避免已被信号终止的进程再次等待 exit。

基线环境：Apple M4、10 核、Darwin 25.6.0 arm64，驱动 Node 22.22.0；实际子运行时独立探针为 Electron 39.5.1 / Node 22.22.0。生产 CLI build 0d65026cb464429a6cd3f99dc1eab4f71039047e18afb147815b3e751fdddfa0，Pi 0.85.1，启用合成显式兼容模型、受保护本地 stdio MCP 和问答协商；无模型推理或真实密钥。10 个样本全部正常退出。

| 指标                        |     p50 |     p95 |
| --------------------------- | ------: | ------: |
| 启动至 ACP initialize（ms） | 386.447 | 419.059 |
| 启动至会话就绪（ms）        | 408.127 | 441.155 |
| newSession 自身（ms）       |  21.616 |  23.169 |
| 受保护 MCP 准备（ms）       |  60.033 |  72.396 |
| 空闲退出（ms）              |  11.080 |  12.892 |
| 会话就绪 RSS（KiB）         |  219696 |  220416 |
| MCP 准备后 RSS（KiB）       |  220416 |  221088 |

首个样本就绪 441.155 ms，后续九个为 404.800–420.522 ms；没有清除 OS cache，因此不能称为操作系统冷启动/热启动对照。RSS 为瞬时常驻内存，不是峰值或同 worker 多轮增长曲线。A20 的完整应用/安装包冷启动、推理首轮体验、活跃取消与长期资源稳定性仍未完成；不事后设阈值宣称性能通过。

验证：脚本语法检查、10 样本实际 Electron Node 启动、附加单样本版本报告探针及普通非测量启动路径均通过；附加样本就绪 476.128 ms、MCP 82.481 ms，没有并入上述固定 10 样本分布。根 lint 配置排除 apps/\*/scripts，本脚本未被 oxlint 执行，不将其“无文件”退出视为 lint 通过。无生产依赖/执行代码变化，未重复全仓测试或构建；既有根检查 Git 谱系失败保持开放。未替换运行中的桌面资源，未触发付费调用，未关闭其他原生验收或 Google SDK 决策缺口。

#### T06/T15：逐预设协议矩阵与 Google 原生接入阻塞（2026-09-20）

新增真实固定 SDK、注入合成 HTTP 的预设矩阵，覆盖 OpenAI、Anthropic、xAI、DeepSeek、Moonshot、Kimi Code、Z.AI、MiniMax、OpenRouter。每项验证文本、原生 read 工具循环、401、429、断网、截断和错误模型；观察实际请求、派发先于 HTTP、工具结算先于下一次模型请求、原生终态及诊断脱敏。测试固定显式模型仅作夹具，Kimi Code 使用 k3-256k/high；首次夹具误用 off 被运行时正确拒绝，改为已支持 high，未放宽实现。未知模型在传输前失败，异常不自动重试或换模型。九个预设共 63 项通过，不等于全部模型、地域或真实账号验收。

另一个确定性用例复现 Google Gemini 原生失败：Pi 0.85.1 的 google-generative-ai 适配器在收到不同于 globalThis.fetch 的 fetch 时直接抛错；Molly 的每请求受保护 fetch 正是目标地址绑定、发送前记账和诊断隔离的边界。会话能构建但 prompt 失败，HTTP 和派发记账均未发生，宿主记录 harness_provider_failed。目录存在不是接入完成；该项断言已知失败而通过，不能计为 Google 支持。

可行方向是评估保持 SDK 基线的最小原生协议适配，或获得明确授权后评估变更固定 SDK；尚未实现任何方向。全局 fetch 替换、绕过账本、静默转 OpenAI-compatible 均不采用。原方案明确引擎升级属于范围变更，已请求用户选择；未改 Spec、依赖、生产运行时或服务支持承诺。writing-for-agents 将矩阵与边界放到模块 README，测试详情留在本实施记录。

验证：定向 64 项、Harness 全量 242 项（12 文件）通过，其中 Google 为失败特征测试；Harness 类型检查及新增测试 type-aware lint 通过，lint 零错误零警告。格式、diff 和 docs check 通过；文档零错误、17 条既有体积警告，无 SHA 待审主题。仅测试与说明变化，未重复构建未变化的生产运行时；根 pnpm check 既有 Git 谱系基线失败仍开放。

本轮未读取真实密钥、未调用收费服务；此前 Kimi/图像真实证据不被扩大。桌面复查仍返回 Mac 锁屏，自动解锁失败，未覆盖运行资源或绕过锁屏。T06/A05 仍未完整验收，原生界面、安装、命令映射及迁移等剩余项不因本次合成矩阵关闭。

#### T06/T11：高级 OpenAI-compatible 显式模型路径（2026-09-20）

原来该 preset 仅在 schema 中存在，表单过滤该项、固定目录无模型，worker 也没有注册定义。本轮将每连接最多 32 个有界 customModels 加到已有加密连接行和 revision，不另设全局模型文件或目录存储。定义含 ID/名称、输入类型、上下文/输出上限、工具调用、流式用量、输出 token 字段和思考等级；重复 ID、未知字段、非正/越界限制以及原生 preset 携带自定义定义均被拒绝。旧无定义记录可读，但不猜测模型。

保护目录 publisher 按连接投影定义，worker 使用固定 SDK 公开 provider composition 注册标准 Chat Completions SSE。采用明确 reasoning_effort 映射（off → none），拒绝不支持的思考/工具；不接受自定义请求头、脚本、模型端点或默认发现，也不推断厂商专有方言。相比允许任意 SDK 配置，这一适配覆盖当前高级协议入口且不扩大凭据接收目标；Responses 和专属方言不因此被宣称兼容。既有完整连接快照/revision 继续负责撤销和 worker 退役。SDK 必需的内部零价格仅为算术占位，不通过宿主报告为免费账单；未声明流式用量时不写测量用量。

设置复用连接表单增加可编辑模型卡片，保留空字段、增删、重复 ID/限制校验、能力提示、密钥省略保留及提交清空逻辑。Native presets 不接受这些定义；配置仍不发请求、不自动选择模型。新增三个 Storybook 状态和中英文说明。writing-for-agents 将边界写入最近规则与模块 README，公开帮助的“尚无入口”同步改为“合成验证、真实待验收”，未改 Spec 意图或历史结论。

真实 SDK 配合注入 HTTP 覆盖 SSE 成功、图片编码、两个输出字段、工具循环、思考限制、同模型跨连接隔离、原生历史恢复无请求和 ACP 用量记录；未连接真实兼容服务。首次 UI 测试误定位连接名称并使用错误语言代码，修正夹具后通过；首次用量测试在 undefined 上调用属性断言，修正断言后通过，运行时未为通过测试放宽。完整方案及原生界面、服务兼容和安装验收仍开放。

验证：CLI 全量 3,061 项通过、3 项跳过，Harness 全量 178 项通过，Electron 全量 173 项通过，组件定向 11 项与 Shared 定向 8 项通过；CLI/Shared/Harness/组件和 Electron node/web 类型检查通过。13 文件 type-aware lint 零错误、55 条警告，i18n/公开边界（4545 文件、25 manifests）/格式/diff 通过；docs check 零错误、17 条既有体积警告，无 SHA 待审。生产及 dev CLI 构建通过；实际 Electron arm64 子进程以显式合成兼容模型完成离线启动、受保护 MCP 准备与问答协商，最新生产 build `0d65026cb464429a6cd3f99dc1eab4f71039047e18afb147815b3e751fdddfa0`。新增用量缺失用例保证能力声明不替代测量；其成本断言的类型错误已修正并重新通过类型与定向测试。

桌面复查仍锁屏，未覆盖正在运行的 resources/cli 或 out，未执行真实收费请求。根 pnpm check 的既有 Git 谱系基线失败仍未解决，不以本次局部全绿宣称全仓检查通过。下一验收仍包括新表单原生交互、真实兼容服务、必要命令映射、迁移和完整安装/设计矩阵。

#### T16：公开配置、恢复与数据保留帮助（2026-09-20）

两份根 README 原将迁移前 Claude/五 Agent 安装验收作为当前完成结论，并指导安装外部运行时；这与新内置执行路径不符。本次将历史证据保留为明确的迁移前链接，当前支持范围改为局部 Kimi/图像真实证据、SDK 目录及离线证据、尚未完成的原生安装/插件/迁移/视觉验收。没有修改历史笔记或降低原方案验收要求。

按现有设置和存储实现补齐本地加密模型连接、独立图像连接、MCP 选择、取消后的未知远端结果、显式旧会话续作及完整备份/卸载/降级限制。macOS Electron 默认目录按实际 storage identity 写为 Molly Design，区别于界面名称 Molly；路径覆盖与跨机器凭据解密限制并列说明。没有读取用户凭据或历史，未执行清理、数据迁移或运行时修改。writing-for-agents 用于将操作步骤与恢复参考分开，并将历史证据与当前能力共处标注，避免重复维护另一份公开帮助。

核对目录还发现：高级 OpenAI-compatible 语言模型仅有共享 preset/schema，设置过滤掉该项，当前打包目录没有对应模型；这是原方案尚未实现的能力，不应写成可用。T10 必要命令选择仍待明确；精选问答扩展本身无命令，不能为了清单引入未批准的 grill-me 模式。T16 本切片仅修正文档，安装/配置/恢复的原生验收未因此完成。

验证：两份 README 与本笔记格式化、git diff 检查通过；docs check 零错误、17 条既有体积警告、无 SHA 待审主题。仅文档变更，未重复运行无变化的运行时测试，根 pnpm check 的既有 Git 谱系基线失败仍开放。桌面复查返回 Mac 锁屏且自动解锁失败，未覆盖运行中资源或调用付费模型；原生验收需手动解锁。

#### T11：设置页展示随包内置能力与兼容限制（2026-09-20）

按原方案 §7.1/§11.1 补上此前缺少的预装能力清单。复用执行入口的 bundled CLI 解析器和现有 renderer IPC 服务，主进程只读取固定位置的 runtime manifest、精选扩展 manifest 和许可证，核对当前平台、协议、资源摘要及已适配工具形状后返回有限公开字段。没有扫描用户插件、导入 SDK、调用模型、读取凭据、安装或添加启用开关。

界面区分读取中、未知与已预装，展示 Pi/build、扩展版本/许可证、问答接口协商条件及兼容限制。相比静态硬编码一份“已启用”目录，随包清单能反映实际安装资源，同时明确不代表会话实时启用或原生验收。固定读取仅覆盖当前审核的 pi-ask-question 子集；未知命令/资源不能成为可用能力声明。T10 的必要命令分类与映射仍未实现，不能用本展示页关闭该要求。

验证：Electron 全量 172 项测试通过，组件定向 16 项通过；Electron node/web 与组件类型检查、i18n 和公开边界（4543 文件、25 manifests）通过。资源夹具覆盖缺失、篡改、重复身份、平台不匹配、未映射命令及许可证不一致；真实 CLI dist 清单也由新读取器成功验证，build `131704264468ae3b559e37d45f7a85bb9018757e8e738a42d95e9b3ccfb86f67`。提供加载/未知/预装三种 Storybook 状态。Mac 复查仍锁屏，未替换运行中的桌面资源、未重建整套桌面或执行真实模型调用；原生视觉、插件交互和安装包验收仍开放。

#### B08/B12：结构化模型选择贯穿命令接受与 Operation 恢复（2026-09-20）

命令层的历史读取、配置合并和历史写入原来只保留 ACP `modelId/configOptionValues`，合法的仅 `modelSelection` 输入因此在辅助创建/续聊时丢失。现保留结构化选择；合并前先核对其自身 ACP 别名，再投影到既有字段参与显式覆盖与继承。接受时重新验证当前目录，将最终连接、模型和思考等级冻结到既有 Operation 目标配置和用户历史，不另建模型存储或选择默认连接。

SQLite 的严格目标配置 schema 复用共享 `ModelSelectionSchema` 接受该可选字段，关闭重开保持原值；不迁移或回填旧行。相较仅补 ACP 字段，保留结构化事实可避免辅助路径依赖界面投影是否同时存在；代价是旧版严格 reader 的降级兼容仍需实机验证。新增用例覆盖结构化创建、历史转换、仅结构化历史继承、显式换连接、思考等级覆盖、冻结后不读变动历史及冲突拒绝。首次检查暴露测试 helper 和 schema 的导入路径错误，修正后 291 项定向测试及 CLI/Shared 类型检查通过。原生桌面、真实调用和安装包验收不由这些结果替代。

最终验证：CLI 全量 3,060 项通过、3 项跳过（265 文件），Shared 定向 36 项通过；5 文件 type-aware lint 零错误、158 条警告。生产/dev 构建与实际 Electron arm64 离线问答协商、受保护 MCP 准备通过，构建 ID `131704264468ae3b559e37d45f7a85bb9018757e8e738a42d95e9b3ccfb86f67`（212 个锁定包、13751 个资源）。公开边界通过，桌面复查仍锁屏；未覆盖运行中的桌面资源，未新增付费调用。根检查既有 Git 谱系基线失败不因这次 CLI 回归通过而关闭。

#### T13：迁移发布等待本地持久化确认（2026-09-20）

CLI 的准备收据已有持久化屏障，但 renderer 发布目标元数据原来只等待 `upsertDocMeta` 的内存确认；重试遇到已有元数据也会直接返回。现统一等待本地 Repo `flush()`，之后复核收据与目标删除状态，才向对话框确认成功。失败或取消不删除已经接受的目标元数据；显式重试复用同一目标并再次等待 flush，不重建会话、不执行模型、不回滚后来的人为修改。

新增确定性屏障测试覆盖成功等待、存储失败后重试、等待期间取消及目标删除；连同迁移对话框、RPC facade、Role 写入和编辑回归共 65 项通过，组件类型检查通过。夹具使用真实 LoroRepo/Mirror 的内存仓库和受控 flush 故障，证明调用顺序与失败语义，不证明 OPFS 实际断电、跨进程复制或原生桌面重启。T13 的实机迁移、备份/回滚验收仍开放。

#### T10：关闭未映射 Slash command 的隐式分发（2026-09-20）

固定 SDK 的 `prompt()` 默认先执行扩展命令，再检查流式运行状态，并允许命令自行通过扩展 API 触发模型或更改会话。因此仅接入 hook 错误不能证明命令符合 Molly 状态机。当前实际精选扩展没有 commands，产品也没有批准的命令映射；不能把原生默认调用路径误当作已经完成映射。

本轮在资源加载时明确拒绝未映射命令注册；ACP 在持久派发记录和凭据请求之前再次检查已注册命令。普通模型 prompt 关闭 SDK 的隐式命令/模板扩展，已批准 skills 继续作为系统资源提供，普通斜杠开头文本不被误判成命令。没有伪造命令完成对应的模型成功回执，也没有为验收而添加无需求的新命令。

测试使用真实 SDK 命令注册形状，覆盖加载拒绝、绕过加载检查后的独立分发拒绝、无命令副作用/无模型请求/无运行派发记录，以及普通斜杠文本不丢失。初次类型检查指出合成注册缺少 SDK 必需的 sourceInfo，补齐后定向 59 项通过。具体只读、配置修改和触发执行命令的发现/宿主映射仍是未完成项；本修改仅封住未实现功能的隐式入口，不缩减原方案要求。

验证：Harness 全量 167 项通过；Harness/CLI 类型检查通过，定向静态检查 20 个警告、零错误。生产/开发打包及真实 Electron arm64 离线问答协商、受保护 MCP 准备通过，构建 ID `96aef0fdf95beee6ca35e18525445861c510e72b9dffee4954efb1c21a7e8f98`（212 个锁定包、13751 个资源）。文档检查零错误、17 个既有体积警告。桌面复查仍锁屏，未覆盖运行资源或触发付费调用；这些证据不替代命令功能、原生 UI、迁移、安装包或视觉验收。

#### T10：SDK hook 错误独立上报与失败上下文隔离（2026-09-20）

本轮核对固定版本 SDK 发现：问答工具错误事件并不覆盖扩展 hook；后者通过 `bindExtensions.onError` 单独上报，原生 runner 可捕获后继续。此前仅在提供 questionUI 时 bind，且没有错误监听，不能据原生模型结束认定插件成功。

现在所有受管会话都绑定该公开回调。启动 hook 失败拒绝会话构建；后续失败在当前原生上下文锁定失败状态、请求非阻塞取消，并在 provider stream/HTTP 边界拒绝后续请求。宿主使用静态 `extension_hook_failed` 结算，即使模型已有完成结果也不伪造成功；同一失败上下文拒绝下一次 prompt。错误携带仅在进程内使用的 context owner，防止被替换上下文的迟到通知终止新运行。没有修改 SDK、重放执行或另建扩展状态存储；原始 hook 诊断不进入宿主回执。

合成扩展通过受管 ResourceLoader 测试替身提供，仍由真实 SDK 执行：覆盖 session_start、before_agent_start、context 和 agent_end 异常，验证无后续 HTTP、无原始诊断泄漏、失败结算与禁止上下文复用。测试不是第三方插件全量 hook 兼容性证明。必要 Slash command 分类/映射、原生问答 UI 及整体迁移验收仍未完成；Mac 本轮复查仍锁屏，没有覆盖运行中的桌面资源。

验证结果：Harness 全量 164 项通过，补充迟到 context-owner 信号后 ACP 39 项通过；Harness/CLI 类型检查通过，定向静态检查 25 个警告、零错误。生产和开发 Harness 打包成功（Pi 0.85.1、212 个锁定包、13751 个资源），真实 Electron arm64 子进程的问答协商及受保护 MCP 离线检查通过，构建 ID `d9971a4f84415cd52e8aaab323562af84ba65b7c9023658f030556191fad7ca9`。公开边界通过（4539 文件、25 manifests）；文档检查零错误、17 个体积警告，无 SHA 待审项。未触发付费模型调用，未重复执行未变化的 CLI 全量回归；上一轮 CLI 3055 项通过、3 项跳过的范围不被扩大为本轮原生验收。

#### T10：生产问答通道、请求级关闭确认与迟到回答隔离（2026-09-20）

本轮将上一节的静态问答扩展接入生产 ACP，但只在宿主同时声明 form elicitation 与私有 `mollyQuestionUI` v1 时启用。继续复用 Core 问题形状和现有权限历史/UI；新增私有关闭握手，而非另一套问题存储或组件。每个问题绑定当前 pending 原生 prompt 的 run/epoch，重复、过期、跨运行请求拒绝；prompt 结束或连接关闭会撤销所属问题。

关闭握手等到宿主权限取消记录写入完成才确认，取消持久化失败明确拒绝；worker 有五秒关闭确认期限，失败不释放肯定回答。用户停止后的迟到回答被丢弃。原生问答工具失败结束当前推理并写入 `extension_question_failed`，不触发自动付费重试。最终冻结的工具/插件 hash 使用实际 SDK 注册和已审阅源身份。相比不等待关闭结果，这增加一次私有往返，但可验证 UI 所属请求已经撤销。

当前离线证据：Harness 全量 160 个测试通过；ACP 子集 38 个覆盖回答、关闭、宿主异常、关闭失败和停止后迟到回答，UI adapter 另验证异步关闭期间停止和拒绝。CLI 全量 3055 个通过、3 个跳过，其中 AgentClient 82 个及 MessageHandler 11 个覆盖请求身份、逐个取消、取消落盘失败和 prompt 结束。类型检查通过，定向静态检查零错误（仍有警告）。生产及开发 CLI 构建通过；真实 Electron arm64 子进程离线验证了问答能力协商、插件身份与受保护 MCP 准备后的身份保持，构建 ID 为 `6a0a29003f9a37ba7a6ed1ffce7f99e75099e0b076dde41a63e8503b8f032727`。公开边界检查通过，文档检查零错误、17 个既有体积警告，没有 SHA 待审项。

这些检查不是原生桌面验收：Mac 锁屏使 UI 验收仍待手动解锁。没有因此调用模型或覆盖运行中的桌面资源；T10/A14 及完整方案保持未完成。根检查已知的设计来源 Git subject 基线问题没有被改写或宣称通过。

#### B09 实际社区问答扩展的 SDK 适配（2026-09-20）

选择 [fitchmultz/pi-ask-question](https://github.com/fitchmultz/pi-ask-question/tree/c3caa7cb9ba17875c6a75c0a9cff84366b31cbb9) 0.4.0 的问答业务逻辑，commit 为 c3caa7cb9ba17875c6a75c0a9cff84366b31cbb9、MIT。已阅读全文及许可证：源文件没有 fs/network/spawn、凭据读取或全局 Pi 路径；工具的唯一计时器在 finally 清理。保留选择、多选、自定义输入和归一化答案；删除终端界面/渲染及额外 grill-me 模式，不为兼容证明引入新的产品模式。取消和五分钟超时不再提示模型替用户决定，UI 返回后再次检查取消，并给输入添加明确上界。来源、原始/适配源码摘要、许可证摘要、依赖及改动列入 vendor manifest；构建检查摘要并把许可证和清单纳入 sealed closure。

固定工厂用公开 Extension 类型、createExtensionRuntime/defineTool 注册批准工具，不使用 SDK 未导出的工厂加载器、不启动默认发现。SDK 会话仅在宿主明确提供 questionUI 时加载；普通生产 worker 仍无该工具。新增 UI adapter 复用 Core 问题形状，绑定 run、dialog、lifetime 取消和有限计时器，先撤销待回答请求再交付答案。通知/终端能力明确分开，不支持的主题操作及 TUI 调用抛错；首次 SDK 集成发现它会 shallow-copy UI，因而把不可用主题改成操作时拒绝的 opaque 对象，而非构造期间抛错，没有修改 SDK。

真实 SDK 配合合成模型流已执行社区工具，答案写入原生历史；重开同一历史恢复答案，另一个 Session 没有该状态，重开不改原文件、不调用网络、不重问。假时钟覆盖超时/取消/关闭/迟到回答，另测多选、自定义输入、未知选项、宿主异常及撤销失败不得交付肯定回答。生产 GUI 取消握手、能力声明、plugin/tool hash 纳入冻结快照、插件故障的 run 终态传播和 slash-command 分类仍待实现；这些测试不能替代 ACP worker/桌面或完整 T10/A14 验收。writing-for-agents 将激活条件和证据边界写回 Harness 规则及 README。

本轮新增 18 项回归，Harness 全量 152/152、类型检查及 3 项 dev/production 布局检查通过；6 文件 type-aware lint 零错误/18 条警告。初次 lint 的 finally 抛错和上游局部变量遮蔽已修正，后者同时更新审核摘要。pnpm install 同步 TypeBox 1.3.7 直接依赖和锁文件；公开边界通过（4,538 files/25 manifests）。生产/dev Harness 子构建各含 212 包/13,751 资源，实际 Electron Node darwin/arm64 protected-MCP 离线启动通过，buildId 为 92ae5be4b3aa83b8c13d059367c80c03bb2a4415921aaedf4e5ed9c4e801fb25。该探针没有启用问答 UI，不作为社区插件进程验收。未覆盖运行中桌面资源、读取密钥、进行付费调用或提交发布；未重跑全仓已知基线失败。Spec 仅删除已过期的单次执行额度描述、修正“真实调用尚未执行”的历史状态，不改变目标或将草案标为批准。

#### B09 扩展工具注册边界（2026-09-20）

封闭资源加载器现在在 SDK 构造前拒绝扩展与原生工具、宿主工具及其他扩展的同名注册，保留 MCP/Molly 命名空间，并核对注册键和实际工具名一致。即使本轮没有暴露某个原生工具，其名称仍保留；宿主自己的单个权限包装工具仍合法。重复宿主定义在创建私有目录和原生历史前失败。加载器复制批准列表以保留宿主顺序，公开先读提醒最后追加，不修改输入列表。这是受审核原生扩展的注册约束，不是任意代码沙箱，也不把钩子顺序当作权限边界。

新增 18 项确定性回归，Harness 全量 134/134、类型检查通过；第一次类型检查发现测试夹具的泛型工具需要 SDK 的公开 defineTool 适配，修正后通过。4 文件 type-aware lint 零错误/7 条既有警告，diff 检查通过。writing-for-agents 将约束写回最近 AGENTS，并在 README 区分注册校验与实际插件验收。本次尚未加载社区扩展、实现 GUI 问答/命令分发或证明插件原生状态恢复，T10/A14 继续开放；没有付费请求、桌面资源替换或用户历史修改。

生产/dev 的封闭 Harness 子构建均通过（Pi 0.85.1、212 个锁定包、13,749 个资源），实际 Electron Node darwin/arm64 protected-MCP 离线启动通过，buildId 为 c87a389881d594336e81416a3e8697a3cb08842edc1d1612e6090315d074c37a。不是整套 CLI 或安装包重建。格式及 docs check 通过，文档零错误/17 条大小警告、无 SHA 主题；未重跑已有独立基线失败的全仓 check。

#### B08/B12 MCP 选择在命令及恢复中的保留（2026-09-20）

核查发现 Commands 的 inherited/merged/effective config 和历史写入均遗漏 mcpServerIds，Operation 严格 JSON schema 也拒绝该字段；已有 Session/worker 选择逻辑本身不能弥补上游丢失。现复用 SessionTurnInputConfig 的既有 ids 和 targetDispatchConfigs，不新增 catalog、工具参数或默认选中项。普通及 Role MCP 创建从实际调用 Turn 冻结选择；Role 不存 MCP 设置。续聊沿用目标会话最近输入的选择并在接受时冻结，显式空数组保留，恢复不读取后来历史。命令转换、合并及历史写入复制数组，避免接受后引用被修改。

语义 runConfig 转换原来重建对象时同时丢掉 agentConfigId / inheritSessionDefaults；现在只替换模型相关值并保留其他冻结控制。旧 Operation 若没保存 MCP ids，仍按其已接受快照缺省值执行，不从新的目录或历史猜测补选。新增字段不会迁移既有 SQLite 行；旧版严格 reader 的降级读取仍未证明。真实凭据、工具 schema/revision 及禁用检查继续由当前 catalog/worker 边界负责，本改动不授权新增 server。

定向用例覆盖显式空选择、调用轮选择复制、目标历史冻结、语义转换后的控制保留、Role 选择、SQLite 关闭重开及单次/批量恢复转发；连同现有 catalog/启动验证共 241 项通过。首次新增语义转换夹具遗漏必需的模型目录，被真实校验拒绝；补齐合成目录后通过，没有放宽运行时验证。CLI 全量 3,046 通过/3 跳过，265 文件全部通过；CLI/Shared 类型、生产/dev bundle、9 文件 type-aware lint（零错误/333 条警告）、格式/diff 及公开边界（4,531 files/25 manifests）通过。docs check 零错误/17 条大小警告，无 SHA 主题；根检查的既有 Git 谱系基线失败未变。

维护规则按 writing-for-agents 同步。未调用付费模型、未读取凭据、未覆盖运行中桌面资源；这些测试没有向真实外部 MCP 派发工具，也不是原生安装验收。T08 原生外部 MCP、T10 社区扩展、T13 原生迁移及完整安装/设计验收仍开放。下一源码缺口仍是实际社区插件选择和兼容接入：当前 session-factory 的 SDK extensions 为空，仅资源加载器有自有设计 reminder，不能算作完成 T10。

#### B12 Task 状态修复的持久派发事实（2026-09-20）

原有 pendingSettlements 在进程退出后丢失；进一步核查发现 Task → Session link 位于派发之后且尽力写入，所以不能把链接存在、当前 backlog 状态或一个时间戳当作确定派发证明。复用 Session metadata，保存有版本的 taskAutomationStatusRepair（Task、精确 Agent、负责人、首 Turn 和 Task 状态摘要），不新建数据库、扫描聊天或补发请求。底层 loro-repo 0.20.0 的 upsertDocMeta 先发布内存事件，磁盘写入延后，并非事务提交：现先写 prepared 并显式 flush，才发布首 pointer 与 dispatched receipt，再 flush。发布前 flush 失败不派发；发布后 flush 失败保留原 Session 并警告，不能按未派发回滚。重启只看到 prepared 时保留 outcome unknown、暂缓自动派发，不猜测重试模型。普通 chat 不覆盖未结算标记；没有标记的旧派发不猜测恢复，保留原 boot baseline。

状态摘要规范化 Task meta/body/timeline，排除 updatedAt 和 session_linked bookkeeping；因此派发自己的链接不阻止修复，后续模型/委托、项目、状态、负责人、正文或活动变化会保留新的决定。摘要在同一个 Task Mirror mutation 内重新计算，仍只应用 backlog/todo → in_progress。Task 本体及索引均确认落盘后才清除并 flush 标记；清除落盘失败时即使内存已无标记，下一恢复仍先 flush，不能误报完成。缺失/删除 Task 不重建，异机/异用户在打开 Task 前排除，畸形标记明确拒绝。

工作区启动及既有 rate-limited meta catch-up 先过滤存在索引和 Session metadata，再串行打开有限并发（1）的匹配 Task；普通 Task 事件不扫描全工作区。恢复失败暂缓新自动派发并拥有 30 秒重试；dispose 取消计时器、请求取消并等待已拥有的恢复结束。已运行的单次派发仍复用此前的状态-only callback/5 秒重试；恢复没有 createSession 或模型入口。这里的摘要是本机写入保护，不声称跨进程/跨副本 CAS。

150 项定向回归通过：实际 Loro snapshot 导出/重新导入后的修复、不依赖原 callback、Task flush 失败后重试、链接 bookkeeping、后续委托/项目/状态保留、缺失 Task 不复活、异主体隔离、畸形 receipt、发布前后落盘失败、prepared-only 未知结果及清除落盘重试，以及假时钟验证恢复失败期间不派发/30 秒重试/停止取消。测试中的磁盘故障用显式合成存储注入，不是实际进程崩溃验收。新增 flush 后首次定向运行因工作区夹具缺少该接口失败，补齐后通过；CLI 全量 3,037 通过/3 跳过，265 个文件全部通过。CLI/Shared 类型、生产 bundle、dev build、公开边界（4,531 files/25 manifests）通过，8 个最新相关文件 type-aware lint 零错误/153 条警告。

Published bundle import 检查及实际 Electron Node 的 darwin/arm64 protected-MCP 离线启动通过，封闭 harness build 仍为 76eddae3749e253cce4998b2439be1d8de31af646cc7c166318044991a446ba7；格式/diff 通过，docs check 零错误/17 条大小警告，无 SHA 主题。writing-for-agents 将维护边界写回 commands/lib 规则与说明。引用的 context/message-flow.md 和 specs/tasks.md 在当前公开树未找到，未以缺失文档补造规则；本次依据现存命令派发、Task schema/Mirror、索引及恢复合同实现。桌面 2026-09-20 04:54 左右再次确认锁屏且自动解锁失败，原生重启仍待手动解锁；没有覆盖运行中 resources/cli。未调用付费服务、未 staging、未改用户历史，T10/T13/安装及完整设计验收仍开放。根 pnpm check 的既有 Git 谱系基线失败未改动，不能把本轮局部全绿描述为全仓检查通过。

#### B12 内置 runtime manager 与旧目录写入退役（2026-09-20）

进一步逐调用者核对纠正了前文“历史元数据仍需 manager”的暂定结论：getAcpCapabilitySourceVersion 的唯一生产消费者是新建非 Molly 会话后的目录写入，Molly 已直接跳过；它并不读取或恢复历史。删除该不可达写入及 SessionManager 旧下载进度/失败诊断后，setting 的旧 builtin/registry/custom 启动构造器和版本派生没有生产消费者。因此直接删除，不另设历史版本模块或复制 pins；存量 capability/cache/history schema、共享 Core 和受保护 Molly publisher 保留，实际历史记录未改写。

删除 managed-agent-runtime、其孤立测试、依赖退役外部 CLI 的 Kimi 子模块启动 smoke 和外部 artifact staging 脚本，共四个文件；三个历史 runtime manifest 暂保留为源码记录，不再构成可执行安装入口。移除所有 managed-runtime progress 参数，保留明确取消、目标/覆盖拒绝及 Session-owned 原生 worker 启动。CLI 删除 DSH profile、Claude SDK、tar、zstd-stream 的直接依赖，pnpm install 同步锁文件；prepare:acp-adapters 现只构建共享 Core，内置 Pi closure 构建保持独立。用户 runtime、配置、凭据、缓存和历史均未删除，源码文件可从 Git 基线恢复。

保留覆盖所有 builtin/registry/custom 退役目标的执行/认证/安装拒绝测试；agent-setting 测试只保留仍使用的环境合并，删除旧构造器的孤立用例。现有合成 Session 创建用例改为观察目录写入事件为空，不再期待旧引擎版本重建；Molly catalog refresh/publisher 仍由独立测试覆盖。334 项定向测试和 CLI 类型通过；全量 3,019 通过/3 跳过（265 个文件通过），比上一切片删除 40 项孤立用例及一项可选外部 CLI smoke。生产 CLI build、dev build、22 项 packaging 检查及 actual Electron Node darwin/arm64 protected-MCP 离线启动通过，封闭 harness build 仍为 76eddae3749e253cce4998b2439be1d8de31af646cc7c166318044991a446ba7。定向 lint 首次指出 SessionManager 遗留 captureCli 导入，移除后零错误/205 条既有警告；格式/diff 与公开边界（4,530 files/25 manifests）通过，docs check 零错误/17 条大小警告。

writing-for-agents 同步当前启动/目录所有权，删除已无实现的下载、DSH、旧认证说明，保留历史记录不变的边界。没有付费调用、桌面 staging 或原生安装证据；T10 插件、T13 迁移/恢复及完整设计/安装总验收仍开放。后续源代码工作转向已定位的 Task settlement 重启后恢复缺口：当前 pendingSettlements 仅在内存，boot baseline 只能阻止盲目重发，不能证明已派发 Task 的状态最终恢复。

#### B12 无消费者的安装、更新与 DeepSeek 启动服务退役（2026-09-20）

消费者核查确认 registry binary installer、后台 runtime update coordinator 与 DeepSeek host launcher 只剩孤立测试；DeepSeek 的唯一生产引用是 capability source version。setting 现直接读取原 acp-extension-dsh/profile 导出，保持同一版本权威与历史 cache identity，不构造替代标识。删除三项旧服务、仅供 registry installer 使用的 ZIP extractor 及四组孤立测试，共八个文件；删除 CLI 的 yauzl/@types/yauzl 直接依赖并运行 pnpm install 同步锁文件，其他包仍需的传递依赖保留。

历史 install/status 拒绝回归继续保留，仅移除已删除 registry installer 的 mock；仍有源码的 managed-runtime cache 访问陷阱不变。98 项定向测试和 CLI 类型通过；CLI 全量 3,059 通过/4 跳过（266 个文件通过/1 跳过），比上一切片少 30 项已删除服务的孤立测试。公开仓库边界通过（4,534 files/25 manifests），格式/diff 检查通过。此次未读取密钥、运行推理/图片、删除用户 DSH 配置/会话/缓存或覆盖桌面 resources。八个源码/测试文件可从 Git 基线恢复。

生产 CLI build、dev build 及 actual Electron Node darwin/arm64 protected-MCP 离线启动通过；封闭 harness build 仍为 76eddae3749e253cce4998b2439be1d8de31af646cc7c166318044991a446ba7。定向 type-aware lint 零错误/10 条既有警告，docs check 零错误/18 条大小警告。初次误用根目录未提供的 eslint 命令未运行检查，随后使用仓库 oxlint 完成验证。笔记格式检查发现排版差异，经 Prettier 修正。

writing-for-agents 将退役边界同步到 agent 规则、README 和 CLI 说明，移除已失效的 DSH 配置写入与 ZIP 提取维护规则，保留仍存 managed-runtime 的取消约束。内置 managed-agent-runtime 仍被历史元数据与 Session 诊断引用，其下载实现和剩余目录消费者尚未退役；不能据此次删除关闭整个 T14。原生界面仍报告 Mac 锁定，桌面部署、迁移、安装与完整设计验收继续开放；根 check 的既有 Git 谱系断言问题未改变。

#### B12 泛用启动器与 npx 恢复退役（2026-09-20）

泛用 startLocalAcpAgent 虽最终由 spawn 边界拒绝，仍在拒绝前为 Molly 做封闭资源解析和登录 shell 环境准备；源码还包含 Codex title/E2E 配置与认证文件复制、外部进程启动和 npx 缓存自愈。现将泛用启动器直接收敛为取消检查、目标检查和 Session-owned launch 拒绝，保留历史调用者所需结果类型及通用 shutdown，不再读取环境/配置或准备 Runtime。删除其 Codex 辅助函数及四项孤立测试，新增 Molly 拒绝发生在环境访问之前和显式取消的合成用例。

Session 直接通过原 start gate 单次创建内置 worker，保留失败进程清理、独立 stderr tail 和 startup monitor；移除不可用的 npx timeout/retry 包装与 npm-cache 环境注入。消费者核对后删除 acp-npx-startup-policy、npx-cache 及缓存测试，共三个文件，可从 Git 基线恢复；没有清空任何用户缓存/CLI/认证文件或运行中桌面资源。提醒、native settlement、图片调用和模型默认值未改动。

定向 86 项回归和 CLI 类型通过；CLI 全量 3,089 通过/4 跳过（270 个文件通过/1 跳过），较前一切片删除 53 项旧缓存用例及四项 Codex helper 用例、增加两项拒绝/取消用例。生产 CLI build、dev build 和 actual Electron Node darwin/arm64 protected-MCP 离线启动通过，封闭 harness build 未变，仍为 76eddae3749e253cce4998b2439be1d8de31af646cc7c166318044991a446ba7。定向 lint 零错误/37 条既有警告，格式/diff 检查通过。没有付费调用、staging 或原生界面操作。

writing-for-agents 同步单次启动和缓存保留边界；setting 中历史 npx 命令元数据仍保留，但不再描述为可执行/自愈能力。后续已定位 SessionManager 的旧下载进度/错误诊断、setting 的历史 capability 版本引用及无生产调用者的 update coordinator；移除 runtime manager 前需要保留确有历史消费者的元数据，不能复制版本权威或删用户安装缓存。根 check 的基线 Git 谱系断言、完整 runtime-manager/catalog 清理、安装和原生设计验收仍开放。

#### B12 其余外部设计 hook 退役（2026-09-20）

上一切片退役 Pi shim 后，源码仍保留 Claude 版本探测及 hook settings、Codex session config overlay、Grok 临时插件/reload 和 Kimi CLI TOML/全局 timeout 适配。虽然 Session 的入口已拒绝这些外部引擎，继续打包和保留专用启动参数不符合 T14。现删除这些模块、三个可执行提醒入口、四组孤立单测和两个已依赖退役 ACP entry 的手动探针；AgentClient 初建、恢复及替换均不再转发旧 hook settings/pluginDirs 或发起 native hook reload。保留共享 Core、通用 sessionConfig、设计 launch ID、原生 Molly 提醒/结算及精确 MCP 重提交。

新增启动/替换的合成协议用例，将旧 hook 参数作为结构化残余输入传入客户端，验证只发送明确 sessionConfig 且无 native 扩展调用；旧 Kimi 启动拒绝及 config.toml 原样检查继续保留。移除专用旧适配测试不替代内置能力验证。staging/afterPack 复用旧产物拒绝，将三种提醒 JS/sourcemap 加入检查；检查本身不删除输入。13 个源码/探针/测试文件可从 Git 基线恢复，没有删除用户 CLI、配置、已登记 hook、缓存或历史。没有读取密钥或触发付费调用。

定向 85 项测试、22 项 packaging 检查和 CLI 类型通过；CLI 全量 3,144 通过/4 跳过（271 个文件通过/1 跳过），相较上一切片少 21 项已删除适配的孤立用例。生产 CLI build、dev build、actual Electron Node darwin/arm64 protected-MCP 离线启动均通过，封闭 harness build 仍为 76eddae3749e253cce4998b2439be1d8de31af646cc7c166318044991a446ba7。定向 lint 零错误/96 条既有警告、格式和 diff 检查通过；公开仓库边界检查通过（4,545 files/25 manifests）。未覆盖正在运行的 resources/cli，也没有新的原生桌面或付费调用证据。

writing-for-agents 删除已失效的外部 hook 维护要求，将当前所有权写回 agent/design 规则及 README；旧 Grok 探针链接改为基线源码 URL，历史实施正文保留。后续 runtime-manager/catalog 清理仍开放，现已确认 npx startup recovery 及泛用 ACP runner 内还有旧初始化/缓存分支，需要沿实际消费者继续退役。根 check 的基线 Git 谱系断言、原生迁移/安装及完整设计验收没有因此关闭。

#### B12 外部 Pi shim 与独立扩展退役（2026-09-20）

源码追踪确认旧 `pi-design-launcher` 仍作为独立产物读取环境变量并启动本机 Pi；Session 虽已拒绝旧目标，产物仍存在。因此删除 launcher、临时 shim 适配、独立 design/MCP 扩展及其孤立测试，移除 Session 的不可达 Pi 启动分支和两种构建入口，并将三个产物及 sourcemap 纳入已有 staging/afterPack 拒绝检查。五个删除文件可从 Git 基线恢复；用户 CLI、配置、缓存、历史和正在运行的桌面资源没有删除或覆盖。

能力核对：内置 resource loader 通过公开 before_agent_start 送达相同提醒，adapter 使用原生事件及拥有者 run receipt 结算，精确重提交沿用 Molly MCP 和 launch/turn/canvas 校验。共享 cancellation transport 此前已迁入 harness，继续保留；将旧 SDK 内存传输取消送达用例转入该包，并扩展 reminder/native settlement 用例覆盖 aborted。不把提醒当读取证明，不把 MCP 成功当画稿提交，不恢复旧 hook 的终态授权。其他旧 Agent hook 与 runtime-manager 清理仍未完成。

116 项 harness 测试、81 项定向 CLI 回归和 16 项陈旧产物检查通过；CLI 全量命令最终为 3,165 通过/4 跳过（275 个文件通过/1 跳过），补足上一节夹具修正后的全量证据。移除旧扩展的 7 项孤立测试，保留共享取消测试并增加 aborted 结算覆盖。移入的 SDK handler 首次类型检查发现返回 Promise<void>，改为返回永不成功的等待 Promise 后 CLI/harness 类型均通过；未放宽运行时。定向 lint 零错误，保留既有警告。

生产 CLI build（含类型、bundle/import/worker/native smoke）、dev build 通过，均无旧 Pi 独立产物；actual Electron Node 的 darwin/arm64 protected-MCP 离线探针通过。封闭 harness 内容本轮未变，build 仍为 76eddae3749e253cce4998b2439be1d8de31af646cc7c166318044991a446ba7，212 个锁定依赖/13,749 个资源。再次检查原生界面仍报告 Mac 锁定；未 staging、重启、调用推理/图片或覆盖运行桌面资源。writing-for-agents 将当前所有权同步到设计规则/README，修正删除文件的基线链接，保留旧实现笔记作为历史。根 check 的基线 Git 谱系断言及其他安装/迁移/视觉验收仍开放，不据本轮通过关闭 T12/T14/T15 全批次。

#### B12 旧 ACP 可执行产物退役（2026-09-20）

移除 production/dev 的 Claude、Codex、Grok、DeepSeek 四个 ACP entry、对应无消费者入口源码及 DSH presets 复制脚本；移除 CLI 对前三者的直接 workspace 依赖，锁文件已同步。原 prepare 脚本保留名称，但只准备 Core 和仍被历史 capability 元数据引用的 DSH profile。Claude SDK 仍被 runtime-manager 的历史版本检查引用，未为清理构造替代元数据或删除共享 Core/子模块。旧 Pi/design hook 的等价性核对及完整 runtime-manager 下载代码退役仍开放。

复用已有 harness verifier 增加 retired-artifact 拒绝，覆盖生产检查、dev、两种桌面 staging 和 afterPack，连同旧 sourcemap/presets 一并检查。普通 dev 命令清理自己的生成目录；检查函数不擅自删除输入。用户全局 CLI、缓存、历史和当前运行桌面资源未改动。已确认运行中的进程入口来自 resources/cli，新的 dist/dist-dev 独立构建；macOS 原生桌面仍报告锁定，因此未 staging、重启或替换安装包。

生产 CLI build（含类型、bundle/import/worker/native smoke）、dev build、10 项陈旧产物用例和 79 项构建/目标拒绝测试通过。包内 Pi 使用实际 Electron Node 完成 darwin/arm64 protected-MCP 离线启动探针：build 76eddae3749e253cce4998b2439be1d8de31af646cc7c166318044991a446ba7，212 个锁定依赖/13,749 个资源。未调用推理或图片服务。打包脚本语法和 2 项跨平台 decoder 资源选择测试通过；没有实际执行多架构 afterPack/安装验收，不将单机 CLI 证据扩大为 Win/Linux 原生支持。

writing-for-agents 更新 CLI/Electron 维护规则与 provenance 说明。全仓类型检查通过；首次全仓 lint 找到此前凭据测试的局部变量重名，机械修正后零错误（11,345 条既有警告）。i18n、Code Collab/平台/公开边界检查通过。T14/T15 尚未关闭。

全仓检查同时暴露 embedded-harness 的无扩展名 re-export 无法被 Electron 的原生 Node 类型剥离测试解析。共享包使用两个内部 package imports 显式映射到原 TS 文件，未加公开 API、测试专用 loader 或运行时 fallback；生产/dev bundle 和 Electron 类型重新通过，165 项 Electron 测试通过。第一次扩展测试中 Components 3,172 项、Shared 1,313 项、Harness 114 项通过；CLI 的 38 项失败归于遗漏 SDK closed Promise 的两处夹具、未更新迁移能力断言和仍使用 custom Agent 的生命周期夹具。补齐真实 SDK 形状、能力版本以及合成 Molly 连接/启动解析后，相关 60 项通过；生命周期测试继续在 createAgent 失败及替代实例终止处断言事件，不放宽运行时拒绝。最后一次 CLI 全量在生命周期夹具修正前得到 3,171 通过/1 失败/4 跳过，该文件修正后单独 22/22 通过，不能描述为全量命令一次全绿。

根 pnpm check 仍未全绿：design-authoring 的 live-fingerprints Git 历史断言在该独立仓库基线就失败（要求最近 30 个提交标题包含 PPTD/Folio），本轮 137/138 通过；不篡改 Git 历史、不删除断言或把普通提交正文提及失败当作谱系保留证据。其余包采用 no-bail 独立继续验证，不隐藏这项失败。所有新产物仍未覆盖锁屏中运行的 resources/cli；原生安装、多架构 afterPack、真实模型和视觉总验收继续开放。

#### B12 续聊接受前的模型校验与恢复快照（2026-09-20）

Chat 之前仅检查 Session/目标资格，模型选项仍走旧 ACP 校验；Operation 接受后才可能发现模型不合法，恢复又重新使用可变历史。现在 create/chat 复用同一 Molly 模型投影及 runtime 目录校验。续聊先读取目标会话最后的明确设置，合并显式替换，检查模型专属思考梯度；单次与批量 MCP 在接受前冻结结果、精确配置 ID 和调用 Turn 的 Task 工具开关。CLI 写入新建/续聊历史时也携带精确 AgentConfig ID。没有另建持久化库或默认模型。

沿用 SQLite Operation 的 targetDispatchConfigs，增加可选 agentConfigId，恢复不重读后来历史、不从请求者另选模型；目标改绑会拒绝。旧 Operation 若没有冻结 chat 配置，不再猜测补齐，materialization 拒绝后由既有 deadline 产生最终超时，不自动调用模型；已持久化的目标仍由固定 Turn 的现有幂等证据识别。新增字段可被新版读取，但旧版严格 schema 的降级读取尚未验证，不将此算作迁移/回滚验收。当前检查也不证明 provider 凭据有效或原生恢复成功。

接受路径 36 项、命令 65 项、MCP 51 项、Operation SQLite 33 项和恢复派发 6 项共 191/191 通过；测试采用合成目录/历史和命令端口，恢复测试没有启动 Worker 或真实 daemon。CLI 类型检查通过。writing-for-agents 将快照责任写回 commands/orchestration 规则及 CLI 说明；未读取密钥、付费调用或修改运行中桌面资源。完整 Task 重启修复、MCP 选择的其他转发路径、旧依赖清理及原生总验收仍开放。

#### B12 Operation 完成回传的退役目标检查（2026-09-20）

Delivery 之前把“配置记录存在”直接判成可继续，甚至无 frozen config ID 时也可进入执行。现同时核对冻结引擎、原 Session 的引擎与精确配置 ID，以及点读所得的当前同机 Molly 配置；覆盖参数、旧引擎、改绑、缺失身份和不合法的 frozen 模型投影进入既有 CONFIGURATION_UNAVAILABLE / not_started 完成路径。结果仍写入历史，Delivery 在已有 claim/finalization 事务边界内消费，不花执行 attempt、不唤醒旧模型。目录暂时不可见仍等待同步确认，不把暂缺当永久删除；旧 repo-meta 存储中的合格 Molly 配置继续可读，不按存储年代判退役。

同时修正实际 continuation payload 丢失 frozen agentConfigId、mcpServerIds 和 taskToolsEnabled：恢复使用原明确目标与工具选择，保留显式空 MCP 列表和关闭 Task 工具，不从新历史或默认配置补齐。已拒绝的旧启动覆盖参数不再构造到 payload。模型目录/凭据当前可用性仍由执行服务及 protected host 独立核验，本地投影检查不是服务可用性证明。

Coordinator 88 项、可执行竞态模型 17 项、真实 Mirror 回馈回归 1 项共 106/106 通过；新增 11 类拒绝用例检查 SQLite 零 attempt、静态结果和 replacement coordinator 重启后不重复历史，模型加入 retirement action 的有界轨迹。旧 storage 测试更新为 Molly，另行验证旧引擎拒绝，而非移除旧格式覆盖。CLI 类型检查通过。writing-for-agents 将合同与职责写回 orchestration 规则和 README。没有付费调用、真实历史修改或原生部署；完整 Task 重启恢复、旧依赖清理与方案总验收仍开放。

#### B12 Task 派发后的状态更新隔离（2026-09-20）

核查确认此前 startDelegatedTask 在会话已持久派发后仍把 Task 状态写入异常抛给调度器，调度器会移除 started 标记，后续评估可能重新创建会话。现在成功派发返回独立、仅执行状态写入的 settlement；调度器保留 started 与 Agent 槽位，通过既有索引/重连评估及拥有的 5 秒计时器重试该写入，不重发模型或创建 Session，停止时取消计时器。尚未派发的接受失败保留原有可重试语义。

状态更新在同一次本机 Mirror mutation 中检查当前负责人、精确委托及 backlog/todo，后来完成、转入审核、改绑或负责人变化不会被旧 settlement 覆盖。重复写入不新增重复状态活动。修正 Task 索引的相等行早退：相等的内存行也可能来自上次失败的 flush，因而必须再次确认本地持久化，不能仅凭相等当作落盘成功。该修复沿用 Task 文档与索引，不新增持久化回执库，不宣称跨进程 CAS。

定向测试以真实 Loro/Flock 和显式失败注入覆盖状态 flush、索引 flush、较新决定保留，以假时钟验证无后续事件的重试、停止取消和 Agent 槽位；没有真实等待、网络或模型请求。当前覆盖运行中调度器的 settlement-only 修复；进程重启后的丢失状态修复仍需独立审计，既有 boot baseline 只证明不会无条件重放旧 backlog，不证明全部恢复已完成。原生重新检查仍报告 Mac 锁定，未替换桌面资源。writing-for-agents 将责任与验证边界更新到 lib 规则和说明。

9 文件 231/231 项通过；CLI 类型、公开边界（4,566 文件/25 manifests）、格式及 diff 检查通过。7 文件 type-aware lint 零错误/55 警告；docs check 零错误/18 条大小警告、无 SHA 主题。未重跑全仓检查，不将这些定向结果称为完整发布或恢复验收。

#### B12 后台 Task 目标退役与已选模型传递（2026-09-20）

Task automation 原来只根据机器所有权选择 Agent，而且 Fleet 创建 Session 时丢弃 Task 已保存的 model/thinking，传入空 dispatch config。现调度只允许同机、无启动覆盖参数的 Molly；旧委托记录仍保留，启动 baseline 继续包含它们，避免改引擎后重放启动时已存在的待办。Task 启动重新读取原精确委托、当前负责人和 backlog/todo 状态，拒绝撤销、改绑或已执行任务；沿用 TaskAgentRef 的既有字段传递模型/思考，不新增持久化协议或默认模型。任务工具显式启用，禁止继承进程/请求者默认值，最终目标和模型目录继续由 Session 创建的统一校验负责。

使用真实 Loro Task 文档及 Flock 索引验证派发值、先派发后推进状态、撤销/负责人/状态变化、缺失及旧模型参数拒绝，以及下游接受失败时保持任务不变；调度测试覆盖旧引擎/启动覆盖参数拒绝及引擎恢复不重放 baseline。8 文件 171/171 项通过，CLI 类型检查通过。初次新测试只有 fixture 手写索引 ID 错误，改用共享 getTaskIndexFlockDocId 后通过，产品逻辑未放宽。writing-for-agents 将维护合同补到 lib 规则及目录说明。没有真实 Task 修改、付费调用或原生部署。

本增量不关闭 T14：Operation continuation 的旧配置分类、Task 派发已持久化但后续状态写入失败时的重试边界、原生迁移和残余 adapter 打包清理仍开放。现有 Session 最终执行 guard 独立拒绝 legacy，但不能用该 guard 代替上述接受/恢复语义的完成证据。

#### B12 CLI/MCP 接受前的目标与模型校验（2026-09-20）

Session 创建的真实校验路径现只接受同机、无启动覆盖参数的 builtin Molly；Role 目标以精确 ID 匹配，不能把丢失 ID 当另一配置的名称。现有请求会话只默认到原精确配置，不再按相同 Agent 类型替换。MCP 创建选项发现也移除不可执行旧目标。历史目录和会话不删除，旧操作的已接受重试仍返回原固定身份；后续 materialization 重新经过同一执行准入，不恢复旧引擎。

创建在 Operation 接受及 Session 写入前读取当前版本 runtime Molly 模型目录，合并显式请求和已冻结/历史继承值后校验完整投影、连接/模型和该模型专属思考梯度。拒绝缺失目录、无模型选择、失效模型及不支持的旧权限/参数，不再先过滤继承字段再隐式改变执行设置。校验不使用其他模型的当前选项快照推断强度，也不证明凭据或上游服务可用。续聊在接受/写入前同时核对 Session 旧引擎身份和当前精确配置，拒绝配置丢失、退役或增加启动覆盖参数；续聊完整 run-config/daemon Task 接受和旧依赖清理仍需各自完成，未关闭 T14。

新增 23 项合成测试沿真实命令校验和真实 Flock 目录投影运行，存储写入和意外 Session materialization 会直接失败，不使用真实网络或按 mock 调用次数断言。与既有命令 65 项、MCP 51 项合计 139/139 通过；CLI 类型检查通过，4 文件 type-aware lint 零错误/306 条警告（含既有大文件及新测试类型夹具）。writing-for-agents 将合同写回 commands 规则，并把 cli-overview 中旧 adapter 的说明标为残余源码/构建定义，纠正其仍可启动和自动注册的过时描述。格式和 diff 检查通过；未进行付费调用、原生部署或完整安装验收，未读取用户密钥。

#### B12 Role 写入层防绕过（2026-09-20）

DirectWorkspaceWriter 对普通新建/编辑和显式迁移统一检查精确 Molly 目标，拒绝旧 builtin、registry/custom、启动覆盖参数及缺失目标，并检查既有 Molly model/run-config 投影；不再仅在 embeddedMigration 存在时校验。普通保存若来源绑定旧目标或已丢失，必须转到显式迁移，不能仅换 config ID 后覆盖原来源。源记录在目录异步读取前留比较值，全部读取后再核对，编辑/删除产生的较新事实保留；相同已写入结果仍可幂等返回。此为当前本机写入窗口检查，不宣称跨进程 CAS。Role 不使用通用 insert-if-absent 旁路，既有非 Role 插入行为不变。

真实 Flock 的 30/30 项定向测试通过（Role 写入 21、通用 writer 9），含新建与普通编辑成功、5 类不可用目标、隐式旧 Role 改绑、缺失/旧模型选项、通用插入绕过、目录读取中的并发编辑/删除，以及原有迁移备份/重入/重试验证。Components 类型检查通过；2 文件 type-aware lint 零错误/18 条既有警告；公开边界检查通过（4,564 文件/25 manifests）。writing-for-agents 将本机 Role 写入合同补入 providers 规则和模块说明。没有修改真实用户 Role、凭据或运行中的桌面资源，没有付费请求。本增量只覆盖 renderer catalog writer；后台 Operation/任务接受及残余执行路径仍待完成，不能据此关闭 T14。

#### B12 Role 可执行目录与新建入口退役（2026-09-20）

核查发现 Role discovery 原来只比较 config ID 与机器，仍将已退役 CLI 的 Role 报为可用；新建 Role 对 CLI 类型也未收敛。共享可用性判断现接收完整目标元数据与机器能力目录：旧 builtin、registry/custom、Molly 启动覆盖参数均显示引擎退役；未读目录保持 unknown，不误报删除。Molly 需要当前版本且 authoritative 的目录，明确模型/连接及模型专属思考梯度匹配，并通过既有 Molly run-config 投影校验。旧 permission、未知选项、已删除连接、失效模型均不可提及，不从其他模型或配置补齐。角色行保留历史值和明确原因，退役行使用查看动作与显式迁移入口。

新建和正常 Molly 编辑只提供无覆盖参数的 Molly。旧 Role 的普通编辑器只供查看、不能保存或偷偷换目标；显式迁移仍走既有备份流程。缺少模型、目录版本过旧、缺失思考梯度或强度不支持均禁用 Save 并说明原因。目录可用性不证明凭据有效、不调用模型、不改变真实用户 Role。使用共享纯函数描述目标资格，没有新增存储/协议；后端原有独立执行拒绝仍保留。本增量不代替后台 Operation 接受、直接 writer 防绕过及旧 setup/打包依赖的剩余收敛，也不关闭 T14。

13 文件合计 162/162 项通过：shared 44（含 37 项 Role 测试），Components 118（新增 9 项真实编辑器决策测试与退役行测试；表单叶子和持久化端口在编辑器测试中隔离）。首次回归发现通用能力读取器将 cache version 作为刷新提示而非准入门槛，因此只在 Role 执行可用性/新建准入增加 current-version 检查，未全局改变历史读取。Shared/Components 类型检查、i18n（914 文件/2,068 keys）、公开边界（4,564 文件/25 manifests）、格式和 diff 检查通过；10 文件 type-aware lint 零错误/18 条既有警告。新增退役、模型失效、目录不可用的 Role 行 stories，但本轮未重建 Storybook/原生应用或进行付费推理。writing-for-agents 将执行目录与只读迁移边界写入 shared/settings/hooks 规则；docs check 零错误/17 条既有大小警告、无 SHA 主题。Shared 规则为 8,147 字节，仍在 8 KiB 限制内。

补充只读表单边界：旧 Role 字段整体禁用，值变更与提交回调拒绝写入，关闭仍可用；不是仅把 Save 按钮置灰。编辑器/表单 33 项回归与 Components 类型再次通过，2 文件补充 lint 零错误/6 条既有警告；该增量仍未进行原生视觉验收。

#### B12 首次任务模型选择（2026-09-20）

FirstTask 复用既有机器能力目录、ACP selector 投影和 Select 控件，显示连接/模型与该模型支持的思考强度。保留用户此前保存的明确选择，但必须在当前 authoritative 目录中同时匹配模型与思考梯度；首次无选择、目录缺失、连接删除或不支持的强度均保留 Enter Molly，不接受任务，不从目录第一项或运行时默认值自动补齐。用户主动修改模型时保留原思考选择，若不兼容则明确要求重新选择，不静默降级。

点击运行时固定可见模型及经过现有 schema 过滤的 reasoning_effort，再保存到既有 defaults cache，供导航后的 landing 恢复；异步画布创建/保存/Session 接受不再读取可被其他页面修改的 cache。没有新建配置存储或协议。选择先导航后后台执行的既有边界不变，最终凭据/连接 revision 与运行时准入仍归后端独立校验，UI 目录不是凭据可用性证明。

首次任务 16/16 项测试通过，包括缺失/失效/不支持/目录缺失只进入应用、模型精确匹配与显式强度、保存/接受失败恢复草稿，以及导航卸载后 cache 被修改也保持提交时模型与 high 不变。初始 fixture 漏掉生产目录中的 model-category config option，补齐后既有生命周期用例通过，未放松生产可用性判断。更新 Storybook 为 Molly 与合成模型选择/目录缺失场景，旧 CLI 作为不可选择历史项；原生首次付费任务和完整迁移仍待验收。本增量未调用真实模型。

合并引导回归 7 文件 49/49 项通过；Components 类型、i18n（914 文件/2,067 keys）、公开边界（4,563 文件/25 manifests）、格式与 diff 检查通过。4 文件 type-aware lint 零错误/11 条既有警告；docs check 零错误/17 条既有大小警告、无 SHA 主题。误用不存在的 eslint 命令没有产生检查结果，随后按仓库 oxlint 脚本重新验证。Storybook 重建通过，浏览器点击实际确认：单个模型也可主动选择；选模型后按钮仍为 Enter Molly；选择 High 后变为 Start design session；Agent 列表只有 Molly；Skip 到达完成标记；目录缺失时模型/思考控件禁用而 Enter Molly 可用。截图确认当前桌面尺寸布局；整套 Playwright 未运行。writing-for-agents 将选择/冻结边界更新到引导规则。隔离预览服务已关闭，原生重新检查仍报告 Mac 锁定，未替换正在运行的桌面资源。

#### B12 首次引导旧引擎入口退役（2026-09-20）

引导的 ProvidersScreen 改为复用既有加密 ModelConnectionSetting，并显式选择本机已发布的 builtin Molly。删除该屏旧安装/登录/创建编辑/刷新/进度与 showcase 实现；不将旧 UI 原样藏在不可达分支。选择被删除后不自动替换为另一项，registry/custom、其他机器和启动覆盖参数不进入候选。FirstTask 的候选与异步导航后重新核对使用同一资格判断，旧 AgentConfig 不因名称或 ID 相同而变为可执行。

Overlay 不再预下载 Kimi/Codex/Claude，也不再订阅旧 setup 进度、发起重试或根据相同 ID 自动提升安装任务。已无生产调用者的预下载 hook、配套 readiness hook 和旧调度测试已删除；源码仍可由 Git 恢复，没有删除用户 runtime 缓存。持久旧安装选择显示 retired，旧 firstTask 目标不可用时回到模型配置页，保留草稿记录供用户明确操作。概述文案区分「可进入应用」与「推理已验证」。旧安装/登录 Storybook 替换为未配置、本机目录待就绪、显式选择与旧记录退役状态；相应 E2E 场景已更新但尚未运行。

本增量不等于完整首次设计或 T14：FirstTask 的模型/思考选择控件在后续同名进度节接入，其他 composer/Role 目录与后台 setup、探测和旧打包依赖仍待收敛。未替换原生桌面构建、未运行付费服务。writing-for-agents 更新引导与设置规则，将已删除预下载/进度语义从当前维护合同中移除；历史决策记录保持原样。

7 文件 43/43 项定向测试通过：真实 Overlay 恢复旧 firstTask 选择时挂载连接步骤、不发旧 status/install/refresh 请求并保留原选择；候选与概述涵盖旧 builtin、registry/custom、覆盖参数、其他机器及安装任务，显式选择绑定机器与 ID，删除/切机不自动转选。补充测试最初误用了 cloud 测试 provider 而挂载了带 Tooltip 的旧巡览，改为真实 local platform provider 后通过，没有更改生产平台逻辑。首次任务生命周期测试的合成引擎目标改为 Molly，不把这组 mock Session 接受测试当作真实模型验证。Components 类型、i18n、公开边界（4,563 文件/25 manifests）、格式和 diff 检查通过；13 文件 type-aware lint 零错误/14 条警告；docs check 零错误/17 条大小警告，无 SHA 主题，引导规则从 7,723 降到 4,930 字节。

Storybook 完整静态构建通过。前两次分别因缺少必要的预览域名变量与 Node 默认约 4 GiB 堆不足退出；使用合成 preview.example.invalid 域名和 8 GiB 构建堆后成功，未改产品配置。构建仍有现存 shared index 循环 re-export、浏览器外部化 Node 模块和大 chunk 警告。隔离的本机 4173 预览经浏览器实际点击确认：Molly 未选时 Next 禁用，点击后启用；旧安装概述显示只读退役且无 Retry；Skip for now → Explore Molly → Enter Molly 到达完成标记。检查了退役概述截图。这是组件集成预览，不是原生桌面或人工视觉验收；未运行整套 Playwright。预览服务已关闭。

#### B12 设置页旧 Provider 操作退役（2026-09-20）

Agents 设置入口在组件边界分离模型连接与设备管理，不再先挂载旧 Provider 的迁移、安装进度、能力刷新、登录或创建编辑逻辑再隐藏按钮。模型连接表单继续使用既有加密服务；只从当前本机目录读取旧配置/安装记录，以名称和退役状态显示，不渲染旧 env、prompt、命令或凭据。连接保存说明改为明确不测试推理、不修改旧会话，发送前显式选择连接与模型。

`MachineProvidersSection` 同样复用只读清单，删除旧操作 props；设备管理保留监控、会话打开与终止、设备操作和项目入口。旧配置、setup、用户 CLI 和缓存没有删除或自动迁移。选择只读清单而非保留失效按钮，是因为后端安装/登录/探测已经固定拒绝；也不以隐藏记录冒充完成迁移。原 onboarding provider dialog 仍存在，setup 后台队列、composer/Role 可执行目录与打包依赖需要各自退役，本增量不关闭完整 T14。

新增清单空状态、旧配置与未完成安装、长名称 Storybook。真实 React 测试验证本机范围、旧管理组件不挂载、无操作控件、名称保留、敏感字段不显示、无本机身份时连接表单仍可访问，以及中英文文案。writing-for-agents 将设置入口约束与剩余 legacy dialog 的区别写回附近规则和跨模块说明。删除已不可达的旧 Agents 机器选择分支，保留 Machines 分支原有选择规则。

5 文件 28/28 项通过（清单 8、入口 3、设备面板 3、模型连接 5、机器选择 9）；Components 类型检查通过。初检发现 Storybook 合成配置缺少 description，以及删除处理器后残留的 toast 导入，修正后定向 type-aware lint 零错误/16 条警告。i18n、公开边界（4,565 文件/25 manifests）、格式和 diff 检查通过；docs check 零错误/18 条既有大小警告，无 SHA 主题。原生桌面重新检查仍报告 Mac 锁定，尚未替换原生构建或作视觉验收；没有新增付费调用。

#### B12 能力刷新与登录后探测退役（2026-09-20）

`machine/acp-capabilities-refresh` 在请求合并/读取目录前拒绝旧 builtin、registry/custom 和 Molly 启动覆盖参数。删除旧 runtime 状态查询、进程探测、进度转发和探测结果写回；保留从 protected catalog publisher 已发布的 Molly 目录读取，并检查 builtin/Molly 身份、cache version 和内置来源。目录缺失或不匹配明确失败，不选择旧缓存、外部进程或默认模型。旧登录执行器已固定拒绝，其成功后的自动能力探测和计时器也已删除。

复用已有并发消费者取消机制，但请求合并仅以 configId 为键，不再序列化旧环境变量/潜在凭据。一个调用者取消不会结束其他读取；最后调用者取消后可发起独立新读取，迟到旧读取不发布结果或更新目录。原“启动外部 probe 并缓存”的八个测试替换为 59 项当前边界测试，涵盖所有 registry 目标、覆写、目录缺失/错身份/错版本、取消、并发及失败后显式重试。原登录超时测试先因删除旧分支失败，随后替换为真实固定拒绝/模型连接指引，不将被 mock 的成功登录当作产品能力。

5 文件 287/287 项通过（刷新 59、SessionExecutionService 130、安装拒绝 47、执行退役 48、内置目录 3）；CLI 类型检查通过，3 文件 type-aware lint 零错误/137 条警告。writing-for-agents 将刷新契约写回 Agent 规则和 README。此增量仍不是 T14 总验收：旧静态目录/UI、setup 队列、独立探测 helper/dependency 接线、已启动 Session 的旧能力更新路径及打包条目尚需继续清理；未部署桌面或新增真实模型调用。

补充验证：CLI 生产构建和实际 Electron Node 的包内受保护 MCP 离线启动通过，worker 摘要保持 `b230295a36f030a222a3507b6d120121f68b7545376ef2842ea3dae93dc295c6`。公开边界 4,561 文件/25 manifests、定向格式、diff 检查通过；docs check 零错误/18 条大小警告，无 SHA 主题。未将这些检查扩大表述为真实 UI、Provider 或安装包验收。

#### B12 启动发现、自动更新与安装 RPC 退役（2026-09-20）

移除 `start --cli-types` 和启动时对 Claude/Codex 认证状态的探测，不再把 Kimi/Grok 当作默认托管安装项；Commander 在执行服务启动前拒绝旧参数。启动 composition 不再创建 managed-runtime manager/update coordinator，不准备、预取、更新或裁剪旧缓存。移除 Fleet/Molly 的旧 builtin 自动注册参数、初次同步订阅和退避重试队列；已有 protected host 驱动的 embedded catalog publisher 继续负责校验包内资源、注册 Molly 和发布模型目录，未新增第二条注册途径。

旧 binary status/install RPC 保留可解码的固定拒绝响应，不解析 registry、不查缓存、不返回可执行路径、不下载或清理文件。Molly 本身也没有单独的 runtime 安装入口。不同机器的请求返回明确目标失配；旧 pending provider setup 遇到失败状态后不会继续安装。保留旧配置、Role、历史、opt-out 和 runtime 目录，旧安装模块的独立历史测试暂存，待消费者清理后再删除无用依赖。

writing-for-agents 将注册归属放回 CLI/lib/commands 规则，详细实现和限制留在 README/本记录。规则引用的 `context/local-agent-ownership.md` 在当前仓库不存在；本次仅移除旧 runtime 更新器的启动/关闭调用，原 host lease、监督协议、Fleet 生命周期和信号退出顺序保留。旧能力刷新消费者、provider setup UI/队列、registry 广告、打包依赖及更早派发提示仍待处理，不将此增量记为 T14 完成。

验证：8 文件 212/212 测试通过（安装 RPC 47、真实拒绝边界与旧队列回归 8、启动/工作区/零云/目录 19、SessionExecutionService 138）。新测试初次因未保留 mocked module 的常量导出而加载失败，修正为 partial mock；队列测试的错误字段名和 `undefined` 序列化预期也按实际持久化合同修正，没有修改产品校验。CLI 类型检查、生产构建、实际 Electron Node 的包内受保护 MCP 离线启动通过，worker 摘要仍为 `b230295a36f030a222a3507b6d120121f68b7545376ef2842ea3dae93dc295c6`。9 文件 type-aware lint 零错误/162 条警告，公开边界 4,560 文件/25 manifests 通过。重新读取原生桌面状态仍报告 Mac 锁定，未部署桌面资源、未新增真实模型调用。移除的 `start-options.ts` 是无运行时消费者的旧 CLI 选择器，Git 可恢复；没有删除用户文件或缓存。

#### B12 旧进程启动与登录执行器退役（2026-09-20）

迁移预览已接线后，启动入口审计确认旧 builtin、registry、custom 和显式 command/args 仍可发起外部引擎。因此先关闭实际执行边界，不增加灰度开关或自动转向 Molly 的 fallback：`resolveACPProcessLaunchAsync` 只接受无 override 的 builtin Molly，仍由固定包内路径 resolver 提供 worker；同步 resolver 对旧目标明确拒绝。`Session.createAgent` 在登录 shell/设计 hook 准备前独立校验目标，通用 `spawnAcpProcess` 即使收到明确 command/args 也拒绝，Molly 必须使用 Session 拥有的 fd-3 与运行租约。

删除原 builtin/registry 异步下载启动选择、原生 CLI 登录/status 执行器和交互进程管理。旧认证 RPC 返回固定错误，迟到 code/form 不接受，取消返回无正在运行；Molly 使用加密模型连接而非 CLI 登录。CLI 外部认证探针不再读取 shell 或用户凭据目录。保留旧 metadata/版本解析和历史 DTO，不删除历史、用户 CLI、全局认证、工作文件或 runtime 缓存。

原先断言“成功启动旧 CLI”的测试改为退役断言，而不是跳过或将旧引擎模拟为 Molly。旧认证测试曾等待已退役的进程回调而停滞，已终止该确切测试句柄并替换为固定拒绝/迟到输入及无进程写入测试；历史 catalog 的四个旧启动预期与 Session 环境的七个旧启动预期同样先失败，随后按新合同修正。历史输出解析、普通 shell 环境单元及 Session/AgentClient 协议读模型测试仍保留。

这是 B12 的执行边界增量，不代表 T14 完成。设置/UI 的旧创建入口、自动注册/预取、显式下载及 managed-runtime 更新、可用性缓存/Role 状态、无消费者 adapter 打包依赖仍需逐项退出；更早的任务接受/工作目录准备也应返回清晰迁移提示。尚未部署或验证真实桌面迁移/回滚，不能把源代码拒绝或合成测试冒称安装包全入口验收。writing-for-agents 将实际启动规则与旧登录退役写回 CLI/Agent 规则及 README，保留历史设计和验收上下文。

本轮验证：执行/认证/历史读取与既有能力、SessionExecutionService 共 258 项，AgentClient/迁移准备/启动绑定 125 项，Session 环境与旧 Kimi 配置保留 14 项，harness-pi 全套 114 项，合计 511/511 通过。CLI 类型检查及生产构建通过，实际 Electron Node 的包内受保护 MCP 离线启动通过，worker 摘要保持 `b230295a36f030a222a3507b6d120121f68b7545376ef2842ea3dae93dc295c6`。13 个相关文件的 type-aware lint 零错误/79 条警告；定向格式、diff、公开边界（4,560 文件/25 manifests）通过；docs check 零错误/18 条大小警告，无 SHA 主题。未新增真实付费调用，未替换桌面资源；构建仍包含旧 adapter 条目，不以构建成功代替打包退役或完整安装包验收。

#### B11 显式预览、确认与渲染端发布（2026-09-20）

旧设计会话菜单按本机 preparation capability 和当前归属显示“用 Molly 继续此设计”。用户明确选择同机内置 Molly 后，现有本机 RPC 准备收据，弹窗以纯文本展示历史摘录、截断/遗漏及附件状态，提示历史正文可能含用户以前输入的敏感内容。确认时重新准备，结果变化则刷新预览并要求再次确认；不重放旧工具、权限或配置，不发送模型请求。打开独立目标后，模型连接和下一条需求仍通过正常输入框选择/提交。

发布沿用双作者边界：daemon 只准备并持久化收据，渲染端 writer 等待目标文档同步、核对收据和 owner/source/catalog 后写 metadata，不新增通用 daemon 写入代理。发布补丁只含不可变身份及来源关系，省去 title/status/archive/lastMessage 等可变字段，以保留并发迟到确认前已经接受的新活动；现存绑定先验证，删除标记不复活。实际 LoroRepo 的逐字段 upsert 并非跨进程 CAS，不能据此承诺所有外部改写线性一致；启动阶段的绑定检查和普通派发保护继续生效。关闭/切换 workspace/卸载取消尚未接受的发布并阻止迟到导航，已接受写入可完成，重开按确定性目标重入。

新增 31 项测试和既有 writer/Role/RPC 24 项全部通过（55/55）：使用真实内存 LoroRepo/Flock 验证重复发布、保存活动、删除前后竞态、失配拒绝、同步到达/缺失/取消，以及真实 React 弹窗的显式选择、纯文本展示、更新预览再确认和取消/切换。测试夹具最初把 receipt 放进不持久化该根的 initialState，并尝试删除整个 Mirror 根，导致误测；改为显式写入与全新无收据文档后通过，未放宽产品校验。目录核对调整到异步 metadata 查询之后，防止等待期间移除的配置仍被发布。

本轮新增选择/不可用/预览/确认中 Storybook 状态和中英文文案。writing-for-agents 将发布约束放在 provider 规则、交互及限制放在 Session README。完整 T13/T14、原生桌面迁移/重启/回滚和旧入口退役仍未关闭；重新读取桌面状态仍报告 Mac 锁定，未替换运行中资源、未迁移真实用户会话、未新增模型或图片调用。下文历史“未接通 UI/发布”的描述保留为各次增量的时点，不代表当前源码。

补充验证：共享参考与 RPC 54 项通过，合计 109/109；Shared/Components 类型检查、i18n 全键、公开边界（4,559 文件/25 manifests）、定向格式和 diff 检查通过。12 个相关文件的 type-aware lint 零错误/202 条警告，docs check 零错误/18 条既有大小警告，无 SHA 主题。本轮未执行原生桌面构建替换或完整安装包验收，也未重复全仓已知失败项；Storybook 覆盖是源码状态，不冒称已做视觉验收。

#### B11 独立迁移工作目录与启动边界修正（2026-09-20）

修正先前“将目标挂成旧来源 child 以复用工作区”的选择。实际 child 启动会在父级工作树缺失时重建工作树并更新旧元数据，且 UI 将其放在父级生命周期下；这不能满足迁移保留旧来源、尤其已归档来源的边界。新目标改为独立 Session，保留同一 artworkId 和精确 openedBy 来源；旧 parent/project/repo/branch 只保留在不可变来源收据中，不作为新工作目录或生命周期的配置。不移动 canonical、素材、旧草稿或托管 Git，也不复制第二份作品。

共享 metadata 构造与 bootstrap 绑定检查一起修正，拒绝重新引入旧父级、项目/分支/worktree 或错误 opener。SessionManager 在准备资源认领、workspace 初始化和 Agent 启动之前核验迁移收据及本次 launch，拒绝外来工作目录、旧仓库参数、native fork 和身份/目标配置不匹配；bootstrap 继续复核当前绑定。普通会话不打开迁移历史。目标使用既有默认 chat workdir，设计 resolver 仍按 artworkId 读取原作品 projection，新草稿和 turn 输入落在新 Session 目录。

156/156 项定向测试通过：共享参考与 RPC 54；CLI 迁移准备/首次附件 53、启动与工作目录 21、既有 SessionManager 22、设计 workspace 6。新的正向测试经公开 createSession 入口和真实 workspace 构造、canonical 与 turn-input 落盘，只替换付费 Agent 启动阶段；拒绝任何旧来源/root 文档打开，验证原作品 revision、旧草稿字节不变以及没有创建旧来源目录或 repos。最初两项 fixture 因非 UUID 作品 ID 被真实 store 拒绝；修正为合法合成 UUID 后通过，没有放宽产品 schema。Shared/CLI 类型检查和 CLI 生产构建通过，定向 type-aware lint 零错误/59 条警告；格式、diff、docs check（零错误/18 条既有大小警告，无 SHA 主题）和实际 Electron Node 的包内受保护 MCP 离线启动通过，worker 摘要仍为 `b230295a36f030a222a3507b6d120121f68b7545376ef2842ea3dae93dc295c6`。

writing-for-agents 将工作目录归属约束放入 CLI 规则（6,999 字节），具体职责和限制更新到 Session README。已准备收据的 schema/版本不变；尚未发布的 metadata 派生方式修正，旧式已发布 child 绑定会明确拒绝，不自动改写。此增量没有接通 UI/发布操作，没有迁移真实用户会话或调用付费模型，也没有替换正在运行的桌面资源；重新检查原生桌面仍报告 Mac 锁定。完整迁移、旧入口退役和原生桌面验收仍开放。

#### B11 首次请求附件交接（2026-09-20）

准备入口之后补齐实际 prompt 消费者：仅带迁移标记的目标 Session、首条持久化新用户消息和匹配的当前 invocation 可以交接历史附件。来源 owner/作品/拓扑、目标配置/原生归属和不可变收据均重新绑定；读取来源目录及候选涉及的少量消息体，不在每次派发中展开旧历史。文件块仅带原存储命名空间和白名单元数据，排除旧 sourcePath。预检开始/结束各取一次候选快照，避免每个文件反复读取同一批历史。

prompt builder 复用现有附件 materializer；图片同一次交接产生 ACP image、resource_link，并把相同字节交给既有设计参考快照。当前输入优先，历史相同身份去重，合并仍受现有文件/图片数量限制；缺失、历史变更和超出本轮上限使用明确来源/文件 ID 说明，不冒充可用附件。后续新 turn 在目标目录判断后返回，不打开旧来源或重复注入。读取/物化前后核对当前 invocation，交接期间的身份变更停止当前 prompt，不改写源历史或在目标追加伪造旧用户消息。

本机复制器原先在预检后重新读取时没有大小上限，且直接跟随符号链接；接入该消费者时将现有复制路径改为 regular-file/命名空间校验、NOFOLLOW、64 KiB 分块有界读取、精确大小和 SHA-256 匹配后发布。临时副本失败即清理，原 blob 不动；迁移附件在二次复制失败时不走 relay fallback、不请求模型恢复或付费重试。

93/93 项定向测试通过：生产迁移/首次交接 25、服务 28、预检 22，以及既有文件 prompt/设计输入/skill prompt 18。使用真实临时文件与 Loro 存储验证普通文件、PNG 双路转交、源/目标历史不变、后续 turn 不读源、多块复制、预检后字节变化、身份变化、去重与数量限制。新测试在设计准备边界捕获实际转交的图像字节；原有设计输入测试独立覆盖落盘，不把这组组合测试说成完整真实 UI 或 Provider 验收。CLI 类型检查、生产构建、定向格式检查通过；五个文件的 type-aware lint 零错误、206 条警告。实际 Electron Node 的包内受保护 MCP 离线启动通过，Pi 0.85.1 worker 摘要仍为 `b230295a36f030a222a3507b6d120121f68b7545376ef2842ea3dae93dc295c6`。未调用付费模型、未替换桌面资源。

writing-for-agents 将跨 Session/prompt 的首次交接约束放入共同 CLI 规则（6,886 字节），实现职责和当前限制留在模块说明。UI、最终发布、归档来源/工作区布局验证和整段迁移旅程仍开放；本轮消费者接通不代表 T13/T14 完成。

发布前核查发现，先前 `buildDesignContinuationMeta` 采用 child Session 并非无副作用的工作区复用：[SessionManager.resolveSharedWorkdir](../../../../apps/cli/src/session/session-manager.ts) 在父级工作树缺失时可创建工作树并写回旧父级的 branch/base/isWorktree；[会话列表](../../../../packages/components/src/components/sessions/session-list-rows.ts)也将 child 作为根会话标签，而非独立可见行。当前准备 RPC 尚不发布该 metadata，因此这些副作用尚未由迁移入口触发。后续须在发布前修正并验证新执行上下文的工作区归属，覆盖已归档来源和已清理工作树；优先核查“独立新 Session + 同 artworkId + 精确 openedBy 来源”是否完整复用现有设计路径。该选择尚未实施，不以当前纯 metadata 测试代替生命周期验收，也不为迁移而恢复归档来源或重建其工作树。

#### B11 迁移准备生产 RPC（2026-09-20）

上一轮附件预检已有代码和测试，但没有生产调用者。本轮在既有 `MessageHandler`/本机 RPC 中接入 `session/design-continuation-prepare`，复用 `DesignContinuationService`，而不是另建迁移传输或借用 native fork。共享合同严格限定 v1 请求、不可变收据和每个候选一一对应的状态；拒绝额外执行字段、任意目标 ID、结果文件路径及不匹配/多余状态。新增 `designContinuationPreparation` v1 能力的发布与消费共用同一版本常量，只表示准备已实现，不声称 UI、最终发布或执行迁移已完成。

生产入口要求当前 daemon 本机所有者、确切 workspace/machine，并拒绝带 Agent ownerSessionId 的调用；服务再核对来源所有者/删除标记与当前 Molly catalog。忙碌判断复用现有 live presence、execution snapshot 和 pending dispatch，不能拿持久 status 当实时执行证据。读历史与附件前后的验证沿用已有服务。持久化失败和未知解析/磁盘异常只返回固定诊断，不把内部路径或错误 payload 带回 UI。该动作没有输入 prompt、模型选择或派发字段，成功不产生 runnable metadata，也不调用旧 runtime、模型或工具。

本轮 122/122 项测试通过：共享参考/RPC/能力协商 49 项，生产 MessageHandler 迁移 RPC、服务与附件 59 项，既有图片发现和设计恢复 RPC 14 项。生产入口测试使用实际 Loro 导出/重开和临时 blob，验证保留已归档源 Session、可用/缺失附件、外部身份/Agent 上下文拒绝、live busy、目标配置缺失，以及磁盘失败脱敏后的显式同收据重试。Shared、CLI、Components、Electron 标准类型检查和 CLI 生产构建通过；定向 type-aware lint 零错误（含旧 MessageHandler 在内共 204 条警告）。Electron 类型检查须使用仓库脚本的 `--composite false`；直接省略该参数的额外探针产生跨项目 TS6307，不作为本次功能失败或完整检查通过的依据。

公开边界 4,554 文件/25 manifests、格式/diff 和实际包内 Electron Node 的受保护 MCP 离线启动检查通过，Pi 0.85.1 worker 摘要仍为 `b230295a36f030a222a3507b6d120121f68b7545376ef2842ea3dae93dc295c6`。重新检查桌面确认 Mac 仍锁定，未替换运行中资源。未迁移真实用户会话、未调用付费服务；UI、附件首次请求交接、发布和真实迁移验收继续开放。

#### B11 旧设计附件本机预检（2026-09-20）

`DesignContinuationService.inspectAttachments` 复用已有准备收据，为后续显式迁移预览提供当前附件状态；不持久化第二份可用性记录。候选必须匹配来源中唯一且已处理的人类 turn，以及原 file ID、存储 Session、机器、名称、类型、大小和摘要。使用既有本机 blob 路径（保留 fork 原存储命名空间），不采用旧 sourcePath、文件名拼路径、外部 URL 或 cloud fallback。

预检通过普通文件检查、预先大小匹配、64 KiB 分块 SHA-256 和总读取上限判断字节；拒绝文件/父目录符号链接偏离与非普通文件。检查后再次读取历史，服务返回前再次核对来源 owner、作品/拓扑和空闲状态。缺失、历史变更、路径不安全、完整性失败及不可读分别返回状态，不复制、删除、补写或重新生成附件，不启动旧引擎。保留不可变候选而不按预检结果过滤收据，便于用户之后显式恢复或重选；状态不是永久文件访问能力，首次请求的字节/图片校验仍需接线。

这是迁移预检基础，不是已完成 UI 或首次请求带图。附件预检 21 项、迁移服务 28 项、启动绑定 6 项和既有附件/存储 33 项，共 88/88 测试通过；覆盖真实临时 blob、原 fork 命名空间、缺失/损坏、来源变更、符号链接、历史读取期间变更和收据不变。CLI 类型检查通过，四个相关源码/测试文件 type-aware lint 零错误（服务既有 5 条警告）；格式与 diff 检查通过。没有读取真实用户附件或调用模型，未替换桌面资源，也未重复执行全仓已知失败项。

#### B11 持久化准备与模型参考绑定（2026-09-20）

在上一轮纯投影上增加 daemon 侧 `DesignContinuationService.prepare`，复用既有 Session Doc 和 fork 的进程内目标锁。确定性的 workspace/source/version → UUID 让显式重复点击和重启后的重入找到同一个目标；在该目标的新增可选根字段中保存不可变 v1 收据、白名单来源拓扑和历史参考。原 Session、canonical、素材、草稿及托管 Git 保持原位，不复制画布、不调用旧 runtime，也没有新增机器级迁移索引或第二套历史目录。

这是派生迁移准备，不是 renderer 通用写入代理，也不改变普通输入的双作者边界。只打开指定来源与目标，检查本机所有者、目标 Molly 配置、单层父级、删除标记及来源在异步读取期间的变更。receipt 先通过实际 Loro 存储写入并等待落盘；失败向调用方报告，显式重试重新经过持久化屏障，不重写旧收据。已准备后改变作品/执行来源的重复请求拒绝；纯标题变更不会覆盖最初来源备份。未来版本、损坏收据和冲突目标原样保留。

目标 metadata 的白名单构造复用既有 child Session 共享工作区能力，保留确切来源和 artworkId，不继承原生 ID、执行指针、旧权限或运行配置。目前准备阶段不发布该 metadata，因此不会让尚未接通附件/发送流程的半成品 Session 进入正常执行。

Molly 的现有私有 bootstrap 已增加读取收据参考文本的回调，核对 workspace、目标 Session、作品、用户、机器、AgentConfig、父级和原生身份归属后，将有来源标记的 JSON 数据加入系统上下文。明确它不是指令或旧执行历史；当前画布和当前 turn 输入优先。同一 Pi 上下文恢复/切模型复用同一不可变参考，不重放工具或产品聊天；普通 Molly 会话不为此打开历史。附件候选仍无文件访问权限，尚待复用既有附件解析器完成授权、字节校验和首次请求带入。

当前 UI/RPC、目标最终发布、附件接线和整段桌面迁移验收仍未完成，不能据此关闭 T13/T14。原生桌面检查确认 Mac 仍锁屏；未替换运行中资源、未迁移真实用户会话、未调用付费服务。writing-for-agents 用于把不可变收据/未发布约束放在 Loro 存储规则，模块职责和未完成边界留在 README 与本记录。

验证：迁移服务 23 项（实际 Loro 导出/重开、并发重入、写盘失败、来源变更、删除标记、父级、不可变/未知版本）、宿主启动绑定 6 项、既有 SessionManager/fork/store 59 项，以及共享投影/绑定和文档向前兼容 40 项，共 128/128 通过。Shared、CLI、Components 类型检查通过；定向 type-aware lint 零错误（8 个主要源码/测试文件共 142 警告，新增宿主绑定测试零警告），格式、diff 与公开边界 4,550 文件/25 manifests 检查通过。CLI 生产构建和实际 Electron Node 的离线受保护 MCP 启动检查通过，worker 仍为 `b230295a36f030a222a3507b6d120121f68b7545376ef2842ea3dae93dc295c6`。这不验证 UI 迁移、真实 Provider 或完整安装包；未重跑全仓已知失败项。

#### B11 旧设计上下文投影基础（2026-09-19）

核对旧 Session fork 和恢复链路后，不能直接复用原生 fork 或普通 Agent 切换作为跨 harness 迁移：前者要求旧引擎参与，后者不保留明确迁移来源与重入边界。设计路径解析允许新 Session 保持原 artworkId，从而共享 canonical/current projection，同时使用独立草稿目录；原 Session、草稿和托管 Git 历史无需移动或复制。

新增共享纯投影 `buildDesignContinuationReference`，为后续显式迁移准备带源 Session/turn 身份的历史参考数据。只选择已处理的用户正文和已结束的助手正文，忽略工具、权限、思考、任务、执行配置、原生身份及 mention spans；不把尚未接受或失败的旧用户请求暗中变成新任务。最近 32 个合格 turn、正文合计 32 KiB UTF-8/单 turn 8 KiB、本机用户附件最多 8 个，超限或不支持的内容明确计数。它不是完整聊天备份，也不修改或删除原历史。

附件仅提取 fileId/hash/机器/原 storageSessionId 等候选身份，排除旧路径授权、云传输、跨机器、助手产物和缺少完整 hash 的旧图片；重复身份合并。候选不代表已验证，后续接线必须复用附件存储的来源授权和字节校验，不能直接以其字段读取文件。正文是用户已存对话的参考摘录，不宣称能自动识别其中手工粘贴的秘密；正式迁移入口仍需清楚展示带入内容和遗漏。

本增量仅完成基础投影和 19 项确定性合成测试，未接入 UI、迁移持久化、重复点击/重启恢复或首次 Pi prompt，不能宣称旧设计迁移完成。没有读取真实历史、复制文件、发起模型调用或替换桌面资源；源代码仍需后续完整迁移接线与桌面验收。选择先隔离参考数据而不是调用旧 replay builder，是为避免旧工具输出和运行配置意外进入新的执行上下文。

验证：投影、Session input 和嵌入模型合同合计 55/55；Shared 与 CLI 类型检查通过，两个新增文件的 type-aware lint 零警告/零错误，定向格式及差异检查通过；docs check 零错误/18 条既有大小警告，无受保护 SHA 主题。本增量未改变生产调用链，未重建/部署桌面，也未重复全仓已知失败检查。

#### B11 Role 显式迁移增量（2026-09-19）

旧 Role 编辑会直接替换 CLI 绑定，没有迁移来源或旧配置保留。此次复用同一 `agentRole` 行：显式“迁移到 Molly”保留 Role id、归属和命名，在提交新目标的同一次写入中保存版本化、只读的非秘密源快照。相较于新建 Role 加独立迁移日志，这避免重复名称、额外目录和跨行中断状态；代价是旧 Role id 的未来使用明确转向新引擎。已有 Session 和已接受 Operation 不重写、不重新派发，备份不参与执行。

迁移表单清空旧模型、思考和权限选项，仅提供同一机器的内置 Molly，并要求用户明确选择连接/模型；已有旧配置缺失时也可显式重配。写入边界重查目标引擎、源内容与 revision，拒绝已修改/删除来源、旧权限模式、隐式模型及备份改写/丢弃。重复相同提交不新增 Role；普通后续编辑保留初始备份。快照经过既有 Role 秘密字段过滤，不复制 AgentConfig/env/Key，也不宣称清除旧 CRDT 明文历史。旧二进制读取 v1 普通字段不等于支持编辑新增快照字段；自动降级和恢复旧 CLI 执行不在此增量中实现。

合成验证：共享 Role/Flock 合同 34 项通过；实际 Flock 写入、持久化导出/重开、并发重复、源变更/删除、目标缺失/跨机器/旧引擎、读取失败重试和设置/composer 回归 75 项通过。定向 type-aware lint 13 文件零错误/47 警告。Shared 类型检查通过；Components 类型检查仅剩会话界面 `session-chat-interface.tsx:1000` 的 `Element | null` 到 `HTMLElement | null` 不兼容，未改该无关预览菜单改动。新增 Role 迁移/备份 Storybook 状态；尚未做桌面或旧二进制回滚验收。

本增量没有迁移真实用户 Role、没有发起模型/图片调用。Mac 仍锁屏，未替换运行中桌面资源；此前 Stop 和外部图片资源链接增量也尚待解锁后的部署。完整 B11/T13 仍缺旧设计显式继续及回滚验收，B12/T14 旧执行入口退役保持开放，不将 Role 子项记成完整产品切换。

补充检查：Shared 加嵌入模型投影合同 41/41、Components 75/75、CLI MCP 51/51 通过；MCP 回归明确验证只冻结迁移后的配置，不将旧备份的 Prompt、模型或权限选项纳入派发。CLI 类型检查与生产构建通过，实际 Electron Node 的离线受保护 MCP 启动通过（worker `b230295a36f030a222a3507b6d120121f68b7545376ef2842ea3dae93dc295c6`）。i18n 全键、公开边界 4,545 文件/25 manifests、定向格式和差异检查通过；docs check 零错误/18 条既有大小警告、无 SHA 主题。文档按 writing-for-agents 将迁移不变量留在共享合同，决策和未验收范围留在本记录，不将当前代码冒充原生桌面/回滚验收。

- 基线：Node 22.22.0、pnpm 10.20.0、Electron 39.5.1。`pnpm install` 完成；design-authoring 全套 137 项中 136 通过，既有 `live-fingerprints.test.ts:121` 仍因当前 Git 历史缺少 PPTD/Folio lineage 失败，未修改该断言。
- B01：增加独立窄导出的版本化连接/选择、run 快照/终态和付费状态合同及测试；未宣称既有 Role/Session 消费者已经迁移。
- B02：`packages/harness-pi` 精确使用公开 SDK 0.85.1；私有资源加载、内存凭据、独立缓存/会话目录、环境白名单和 worker 额外管道 bootstrap 已实现。开发/生产构建供应独立闭包，manifest 记录版本、锁摘要和逐文件 SHA-256，Electron afterPack 验证资源并使用实际包内 Node 探针。
- 本机探针：构建产物包含 212 个依赖实例、13,746 个资源（数量随后续实现会变化）；macOS arm64 下 Electron 39.5.1 的 Node 22.22.0 成功加载 SDK、读取 1,354 个静态模型条目。探针没有调用推理服务；模型目录存在不证明厂商支持已真实验收，也不证明完整安装包已验收。
- B03：main-only 加密 ModelConnectionStore、save/delete/status IPC、revision CAS、不可用密钥链/Linux 明文后端拒绝、内部 run/epoch 凭据队列及 owner-only 既有 socket 交接已落地。Session 内置分支通过 fd 3 获取本轮凭据；主进程失联/连接停用使 lease 失效。7 项合成存储测试通过；实际 OS 密钥链和旧图片 Key 历史迁移仍未验收。
- B04：薄 ACP adapter、原生结算判断、工具逐次授权、派发前独占持久记录及精确 native restore 已接入宿主分支；该分支禁止旧 ACP 重发和历史重建，并校验 run/epoch/原生结果。35 项 SDK/ACP/MCP 合成测试通过，覆盖截断、错误脱敏、重复派发、旧 epoch、损坏历史原样保留、等待授权时取消及 schema 变更。图像输入和附件 URI 已有适配，但完整设计收集/重提交和 UI 消费未验收。
- B05/B10 部分：新增模型连接设置表单（中英文、Storybook 与 3 项组件用例），支持显式 preset/endpoint、新增/编辑/停用、替换密钥；变更接收域要求重新输入密钥。保存不触发推理，也不替用户切换 Agent。composer 的模型选择与安全切换尚未实现。
- B07/B08 部分：桥接冻结后的 ACP MCP 列表、分页与命名空间、授权后 schema 复核、取消送达和最小操作回执；生产 catalog 尚未供应连接 revision，故工具派发明确失败，不能称为 MCP 已接通。未知结果拒绝重放，素材恢复尚未接入。记录独立于已有子 Agent Operation，是因为任意 MCP 付费副作用不经过该 workflow；不复制聊天或设计历史。
- 离线打包 smoke：用 Electron 39.5.1 内的 Node 22.22.0 启动实际打包 worker，完成 ACP initialize/newSession，确认项目 `.pi` 污染不被加载且原文件不变；没有发送 prompt、API 请求或真实 MCP 调用。该结果不能代替完整安装包/无全局运行时验收。
- 新 runtime 尚未作为默认 Agent 对用户启用，旧入口暂保留，避免在 B05/B11 完成前破坏现有设计流程。真实调用仅限下文明确授权的连接、模型、外发范围与次数；其他 Provider/MCP 未获授权前不调用付费服务。

实施批次是逻辑边界，不要求一个批次塞进一个大 PR。每批可按生产者、消费者与验收进一步拆小，但同一合同的双方必须在启用前齐备；代码清理以消费者证据为准。

### Kimi Code 协议补齐（2026-09-19）

Kimi Code 会员 API 与 Moonshot 开放平台分别用 `kimi-coding` / `moonshot` 预设；复用已锁定 Pi SDK 的原生 `kimi-coding` provider，不将 Anthropic endpoint 塞进 Moonshot 的 OpenAI 协议。设置列表/表单使用独立中英文名称与提示。已保存的误配仍可读取和停用，新保存/派发拒绝已知不匹配的官方地址；不自动改写用户连接，改 provider 仍需用户在本机重新输入 Key。

模型仍须显式选择，不把 `kimi-for-coding` 暗设为默认值。官方第三方接入说明要求保留真实客户端身份，因此沿用 SDK 的 Pi 标识，不模拟 Kimi CLI 或 Claude Code（[官方说明](https://www.kimi.com/help/kimi-code/third-party-agents)）。合成测试用内存 fetch 接收 SDK 构造的实际 Anthropic 请求，检查 endpoint/model/认证归属和诊断脱敏，不产生网络流量。协议适配不等于账号权限已验证，也不代表 composer、唯一 Agent 入口或整批迁移完成。

本次增量验证：Harness 37 项、共享合同 5 项、连接表单 5 项、Electron 156 项通过；shared/harness/components/CLI/Electron 类型检查、i18n 检查通过，lint 零错误（既有 11,228 项警告）。独立 worker 资源闭包重新构建成功。没有读取用户保存的 Key、自动改写既有连接或发送真实推理请求；本次未重跑已有失败记录的全仓 `pnpm check`。

## 2. 已核对的现状与计划修正

### B03 图片凭据增量（2026-09-19）

图片设置改走 Electron main 已有 `model-connections.enc`，不另建 SecretStore；renderer 只获取非秘密元数据并提交写入，保留 Key 由 main 处理。端点变化必须显式重新输入或清除 Key，更新检查 revision。`/models` 设置探测由 main 发出，旧 daemon 明文配置探测明确拒绝。图片 MCP 启动仅发现能力，实际调用才向活动模型运行租约申请精确图片 revision 的凭据；撤销/主进程离线中止拥有该租约的 worker。

旧机器 Flock 配置通过私有 host 通道迁入同一加密文件，持久化成功才确认；daemon 仅在确认 ID 和当前完整旧值都匹配时移除当前行。重送、重启、并发修改与持久化失败不覆盖新的配置，也不丢弃唯一 Key。不完整旧配置先加密备份但不确认删除，需修正后完成迁移。CRDT 历史和旧备份可能仍含 Key，设置页明确提示轮换；没有破坏性清库，也不宣称已清除历史秘密。

此增量为源码实现和合成测试证据，尚未重启用户安装或迁移真实配置。Electron 160 项、图片设置 16 项、Broker/迁移与 daemon 相关测试通过；MCP 增加无 Key catalog 可发现但无活动授权不能执行的测试，CLI/shared/components/Electron 类型检查通过。真实请求仍为文本 0/10、图片 0/10，全部迁移/设计/安装验收仍开放。

### B04/B05/B07 接线增量（2026-09-19）

构建在同一受校验资源闭包中生成公开 SDK 模型目录；daemon 不导入 SDK、不读取用户模型缓存，也不网络探测。受保护 host 交换从本机权威 Flock 注册唯一可用 Molly Agent，并将启用连接与静态模型交叉投影到既有 ACP capability cache。原先等待云端同步确认的前置条件在真实本地版联调中证实不可满足，已移除；不改变旧云同步协调器语义。现有 composer 选择显式 connection/model/thinking；未选择占位符不能执行。注册不修改默认 Agent 或旧 Session/Role。

显式下轮改变模型、连接或连接版本时，现有 turn owner 等待旧 worker 退出，再创建新 epoch。Pi 原生历史仍归同一产品 Session，连接目录仅记录创建分区；精确唯一原生 ID、目录及树验证后沿用同一文件，不复制历史或重放产品聊天。跨 legacy ACP Agent 仍不能复用原生身份。预热资源兼容判断加入模型选择，程序化 catalog 选择与子任务完成回传保留同一选择，不引入独立配置源。

内置 MCP 生产者提供固定合同 revision；图片调用的持久操作回执绑定本轮冻结的实际图片连接 revision。运行后新增图片配置不会获得本轮授权，已冻结配置变更使原租约失效。Molly 草稿重提交复用既有 launch 所有权、精确摘要和 CAS，不允许旧 Pi hook 伪造 Molly 原生结算。外部 MCP 的真实 revision/撤销生产者、素材恢复和完整设计闭环仍开放。

合成验证：Harness 40 项；宿主 Agent/MCP 身份、图片租约及设计重提交 73 项；Session 执行 138 项；SessionManager/Operation continuation 98 项；共享选择/输入 35 项通过。新增准备兼容字段最初导致两项旧测试失败，已保留无模型选择时的旧语义并复验通过。仍未重启实际应用，未迁移真实秘密，真实请求仍为文本 0/10、图片 0/10。

### B07/B08 目录撤销与付费失败围栏增量（2026-09-19）

Workspace MCP 普通写入由存储分配本机单调 revision，不接受调用者伪造版本；历史行只有显式保存才建立版本。Molly 冻结选择并监听完整行变化，因此旧 writer 不加版本、删除后恢复同值、审批等待期间修改也会永久撤销该 worker。下轮改变 MCP 选择通过既有安全替换路径生效；迟到旧回调只终止其原 worker。无认证 stdio/HTTP 已接通版本绑定，带认证头/env、环境变量插值及 HTTP URL 凭据/query/fragment 仍拒绝进入 ACP；旧 catalog 明文和受保护外部 MCP 凭据通道未完成，不能称为完整外部 MCP 支持。

原先按 run + tool-call ID 围栏不足以阻止模型在结果未知后换 ID 再次付费。本次在同一最小操作回执中恢复并检查该轮未知结果，串行结算同轮 MCP 副作用；未知结果会结束原生推理，返回 interrupted。内置图片 MCP 增加私有回执，区分未派发、上游明确拒绝和派发后结果/导入未知，成功登记已有素材 SHA-256。已派发的图片失败同样要求显式用户新操作；不根据提示词 hash 判断重复，也不重建画布或将摘要当作已恢复素材。实际 stdio fixture 断开和返回拒绝均证明不会再请求下一次合成模型响应。

本轮桌面控制两次确认 native pipe 启动失败。用户已允许重启，但正常退出需要先经过应用现有画布 flush 屏障，未强杀 Electron 或绕过主进程提取 Key。已请求用户在目标 Molly 中正常退出；不是继续索取重启授权。Lody MCP 当前连接的另一工作区没有 Molly Agent，未将它冒充目标产品发起付费测试。真实请求仍为文本 0/10、图片 0/10。

设置页实际走 renderer 的通用 Flock writer，而非 CLI catalog helper，因而同时接通 renderer 的 MCP 写入分支到同一版本分配函数；真实 Flock fixture 验证历史保存、并发旧 editor revision 和 key/id 不匹配拒绝。此轮 Harness 47 项、CLI 目录/权限/控制/执行 227 项、共享合同 24 项、renderer 写入 12 项、图片传输 26 项与图片 MCP 20 项通过。图片 MCP 最初仅一项临时 Unix socket 被沙箱拒绝，获准独立重跑该文件后全绿；未使用真实 Provider。四个受影响包类型检查及 Electron node/web 类型检查通过；lint 零错误（11,287 警告）、公开边界通过，docs check 零错误/18 条大小警告。CLI 生产构建和实际 Electron Node 离线 ACP smoke 通过，build `baf12ae3edbe893b02c442ed910eaac35e0e2b0207b244f615ee9db9a94461a9`，212 依赖、13,749 资源，lock 摘要一致。此次构建不等于完整安装验收，也未重跑已记录的全仓基线失败。

本轮 Electron/Bento/main/preload/renderer 也已完成重建；Bento 临时 worktree 登记受沙箱限制后获准提升构建权限重跑通过。未启动或重启用户应用；CLI 新 bundle 仍需在正常退出后同步到桌面资源再启动，不能把已构建当作已启用。

### B04/B05 真实本地启动与计量补齐（2026-09-19）

用户正常退出后，新构建已通过实际 Electron 离线 ACP 探针并启动。桌面控制恢复，真实界面暴露两处接线遗漏：本地无云端 transport，注册却错误等待云同步确认；目录同时给出旧 `models` 和只有 thinking 的 `configOptions`，现有选择器优先后者，因此缺少模型菜单。新增确定性用例先复现失败，再分别改为本机 Flock 权威读取、完整 model config option 投影；未降低闭包校验、未扩展凭据读取。注册修复已在真实界面确认。

模型每次 HTTP 尝试（包括原生压缩）在既有 run journal 中先落盘请求 ID；请求失败/未结算保留未知，成功仅保存原生 token 桶，不保存消息、Key 或 SDK 价格估算。Core 累计使用量以 connection/model 为键，恢复原请求身份，不重放 delta。这里是计量而非通用次数配额实现。Molly 标题直接取脱敏后的用户首句，不启动第二个 Agent。Harness 49 项及类型检查通过；目录/标题回归 22 项通过（包含先红后绿），CLI 类型检查通过；完整方案和真实付费验收尚未完成。

首次真实提交在派发前发现增量 `build:bundle` 清理了设计技能资源；补跑既有资源复制和 published-import 检查后恢复，完整 `build` 原流程不缺此步骤。随后复现 SDK 延迟到首次 assistant 消息才创建原生文件，而 ACP 已返回 ID：执行前失败并重启就无法恢复。新增空会话恢复测试先红后绿；新建时独占持久化 SDK 自己的 header 并用公开 `SessionManager.open` 重开，不手工构造消息、不修复旧文件。Harness 50 项及类型检查通过，重建 worker 与实际 Electron 离线 smoke 通过（build `53f4d4a955db0bad3c41cc99451ea6c0a316902af3068d1fe502562dd1c6a46f`）。此前两个未派发失败记录保留。

首个真实 Kimi `k3-256k/high` 请求在新会话中成功，UI 与 run journal 均确认 completed；仅一次 HTTP 请求，原生报告 input 7,817、output 28、cache-read 512，费用未报告。没有工具调用，画布运行中只读、结束后恢复可编辑。此时文本累计 1/10、图片 0/10；后续图片联调单独计数。本记录只保留汇总证据，不提交实际会话 transcript。

已使用配置的 `gpt-image-2.5-sunburst` 完成一次合成蓝圆图生成和一次原图改橙色编辑；每次均经原生单次权限入口，结果都是 1024×1024 PNG，各有独立成功 receipt/素材摘要，原图保留、未修改画布。已查看两个输出核对颜色与尺寸；这是工具链路验证，不是设计质量人审或 mask 支持证明。两轮各消耗两次 Kimi HTTP（工具决策/结果总结），累计文本 5/10、图片 2/10，均成功，无自动重试。

随后正常退出并重启，沿用同一原生历史文件，通过单次读取权限取得该合成 PNG 的图像内容，Kimi 正确描述橙色圆形和白色背景，运行正常结算。此次新增两次 Kimi HTTP，累计文本 **7/10**、图片 **2/10**，均成功；重启没有自动推理。系统附件选择器的自动化交互未完成，因此工具看图证据不代替附件上传 UI 验收。最新 worker build 为 `53f4d4a955db0bad3c41cc99451ea6c0a316902af3068d1fe502562dd1c6a46f`，实际 Electron Node 离线启动通过；Harness 50/50、CLI 目录/标题 22/22 通过，受影响类型检查通过。lint 零错误/11,292 警告，docs check 零错误/18 条既有警告，公开边界通过；未将既有全仓测试失败宣称为已消除。

### B07 MCP 资源读取增量（2026-09-19）

原 bridge 对资源链接一律拒绝，现支持有界 text/image、内嵌 resource 和原连接 `resources/read`。链接读取单独走现有权限与操作日志，复查生产者工具 schema 和连接可用性；只接受精确 URI 对应的响应，同一结果内重复链接复用一次读取。缺少资源能力明确拒绝，file/data/带用户名密码 URI、不支持的二进制资源和嵌套链接不进入读取。没有新增直接 URL 下载或本机路径解释，也没有把链接转交其他 MCP。

输出检查整体 20 MiB、64 块、规范 base64；资源单次读取 30 秒，与原工具共享 210 秒执行期限，取消/撤销后的结果不能送入模型。内容转换仅服务模型上下文，尚不代表图片真实编码/尺寸完整验证、素材导入或迟到素材恢复；这些 B08 工作仍开放。选择复用原 MCP 连接而非直接下载，可保留连接鉴权和来源边界，代价是上游必须提供资源能力，任意 Web 链接不会隐式变成下载权限。

合成测试包括真实 stdio 子进程的图片资源读取与独立持久回执，以及授权拒绝、撤销、取消、schema 变化、URI 替换、畸形 base64、总大小和不支持内容。Harness 73/73 通过，类型检查通过；无真实 Provider 请求，累计文本 7/10、图片 2/10 不变。打包检查结果在完成后追加，不以源码测试替代安装验收。

最终定向 type-aware lint 零错误（9 条警告），文档检查零错误（18 条既有大小警告）。生产 worker 重建后，以实际 Electron Node 完成离线 ACP smoke，build `e3aec3449537a62b9e36275c740f6dd1a2cba1bbe7a1470f99cde04f89b29834`，212 个锁定依赖、13,749 资源。该 worker 目前仅更新 CLI dist，运行中的桌面仍使用上一构建；未将此结果宣称为桌面资源功能验收。

### B04/B10 原生工具权限显示修正（2026-09-19）

真实合成海报轮次发现 read/write/edit 的权限界面只显示工具名，未呈现目标文件；bash 的命令已有既有消费者。合成 SDK→ACP 回归先复现 `kind: other`、缺少 `locations` 和裸 `read` 标题。核对既有消费者后确认界面按 read/edit 类别和 locations 显示路径，宿主合并保留这些字段；问题位于 worker 的事件和权限生产者，而非新增 UI 的需要。

现由同一显示适配函数为工具更新与权限请求提供原生类别、目标标题和位置，read→read、write/edit→edit、bash→execute；相对路径按当前 cwd 展示，原参数和权限判断不变。`~` 保留原文避免猜测 SDK HOME，外部 MCP 的 path 参数不被当成本机路径。回归由红转绿，Harness 79/79、类型检查通过，定向 type-aware lint 零错误/19 警告。生产 worker build `d842dc26330df23542471be6c9369f080c41a3e9c2232ce1bd184ac9a682f247` 的实际 Electron Node 离线 smoke 通过。正常退出后已替换桌面资源，在真实续改中确认 read/edit 权限显示目标路径。

真实续改也纠正了前述命令显示判断：工具详情消费者与浮动权限卡片不是同一个入口；后者只接收标题，`rawInput.command` 不会显示。新增失败回归后，让 native bash 标题保留完整命令，仍不改变参数或执行语义；单测 6/6、SDK→ACP 用例 12/12 通过，worker build `865ac55c0812b4f4e59ca9b1577876f93ef0a02320d2315e25b3a4daf5684298` 离线打包启动通过。安全停止后已正常退出、同步并重启；新一轮真实权限弹窗确认完整显示 finalize 命令和路径。完整 Harness 81/81、Electron 类型检查和 CLI/Bento/main/preload/renderer 构建通过，定向 lint 零错误/8 警告。

### B05 合成设计失败与可定位诊断（2026-09-19）

首轮 600×800 合成海报创建了九个独立文字/图形元素，但内核拒绝无效嵌套字段，未提交当前稿；该轮消耗 15 次 Kimi HTTP，退出时仍等待工具权限，记录保持 dispatched/结果未确认。重启未新增模型请求，界面显示派发栅栏 EEXIST，未重放副作用。显式续改将标题加粗移到 run 层级后仍校验失败，另消耗 7 次 HTTP；通过正常 Stop 结束，账本 settled/cancelled、画布恢复可编辑，保留草稿和原稿。两轮均不算有效设计通过，未渲染或生成新图片。

随后只读采集草稿并在内存隔离各元素：三条线的 `viewBox` 为 SVG 四数串，而现行 Bento 合同为 `[width, height]` 正数对；其余六元素通过。仅在内存替换三处 viewBox 后整稿 intake 为 ok，没有替 Agent 修改真实草稿或提交。原有诊断丢失了内核返回的 targetId，导致不能确定错误元素；现只保留该 ID 到错误消息，未改 vendor、准入条件或做自动修复。最小合成回归由红转绿；格式参考在 line 分支明确该字段的实际值形状，不增加创作顺序。Authoring 137/138 通过，唯一失败仍为既有 Git lineage 环境断言；类型检查通过。此时累计文本 **29/60**、图片 **2/30**，分别剩余 31 和 28 次。

### B05/B13 修复续改、版本与 PNG 的真实证据（2026-09-19）

上述离线定位之后，经普通会话提交新的明确续改输入，停止状态下仍需点击 Continue 才派发排队输入；没有重放旧轮。新 worker 使用 `k3-256k/high`，仅由产品 Agent 修改三个 viewBox，九个文字/形状/线元素均保留；首次有效草稿在模型结束前出现在只读画布。finalize 成功，`molly_render_preview` 返回 600×800、47,016 字节 PNG，随后原生 read 工具向模型实际返回同字节数的 image/png 内容块；不是仅有路径或模型口头自报看图。最终 journal 为 completed 并带 nativeEndEntryId，UI 明确显示已保存当前稿。新增 6 次模型 HTTP，累计 **35/60**；图片 generate/edit 仍 **2/30**，剩余 25/28 次。

随后通过原生 UI 保存 V1；选中橙色圆点把 X 从 410 改为 430，自动保存后建立 V2。历史标明 V2 来源 V1。切回 V1 后，canonical 与当前 YAML 投影都恢复 X=410，九元素保留，创作草稿未被人工投影覆盖。原生 PNG 导出保存到被忽略的 `e2e/artifacts/embedded-pi-design-lz0LAN/orbit-v1.png`：600×800、47,012 字节，SHA-256 `fa9e81cac07cb9a5a288be07fe87f39d2d4eadb30c21426f8e5a5658e9d7beed`。已实际查看渲染/导出；解码逐通道比较只有 (270,356)、(270,357) 两处绿色通道各差 1，故不声称像素完全一致，严格像素一致性与人审仍未关闭。

正常退出并重启后仍显示 V1，V1/V2 历史及来源保留，累计请求仍为 35，未自动模型调用。此证据只覆盖合成、提示已明确纠错的基本可编辑海报旅程；首轮失败和首个续改取消不改写为成功。尚未覆盖两份有效实时构建、多图长图/信息图、选中图生成替换/mask、JPEG、附件提交 UI、完整原生安装包或人工视觉质量。代码检查：Harness 81/81；Authoring 137/138（既有 lineage 断言失败）；受影响类型检查、CLI 与 Electron/Bento 构建、实际 Electron Node 离线 ACP、定向格式/空白检查通过；docs check 零错误/18 既有大小警告。未重跑或声称修复此前全仓测试基线。

### B03/B07 外部 MCP 凭据保存边界（2026-09-19）

复用模型/图片的 main 加密库，为 MCP 增加 workspace/server/完整目标/版本绑定。HTTP header 和 stdio env 的值只在输入与 main 内部短暂出现，公开元数据只有引用、版本、目标和字段名；设置 IPC 自行解析当前本地工作区，没有通用明文读取方法。更换 URL 或命令/参数需要重新输入整组凭据，旧版本、跨 server、跨工作区和目标替换均拒绝读取。传输保留头、已知进程控制环境字段、重复大小写字段、非法字符、字段数/值/总字节超限会拒绝；加密失败保留原库，同时封住“写入超过自身读取上限导致整个库不可读”的路径。

设置沿用现有目录和表单，先完成加密保存，再把 `protectedCredentials` 引用写入 Flock，不增加第三份执行配置。目录落盘失败时保留已保存引用供用户显式重试，不把 vault 回滚到可能已过期的版本。另一方案是先写目录再写凭据，但这会先持久化无法解释的引用；本实现选择 fail-closed，代价是两次存储之间失败可能暂时不可执行，需要用户处理。界面遮蔽凭据输入，提交即清空；失败后必须重新输入，防止空白重试被误认为删除凭据。删除凭据有明确动作；目录移除后清理加密值失败会提示可能残留，不宣称删除完成。

旧字面量 header/env 仅在用户明确保存该条配置时进入加密库，再从当前行移除；未运行批量迁移，也未清除历史 CRDT/备份。旧环境插值/透传不会自动读取宿主变量，界面允许移除旧透传并明确要求直接输入。带保护引用的连接在 legacy/embedded resolver 均明确拒绝，不能当作无认证连接启动。目前尚未接通 main→broker→worker 的 MCP 运行授权：bridge 在 ACP newSession 阶段发现工具，而现有凭据租约从 prompt 才开始，必须先解决此生命周期衔接，不能把密钥塞回启动参数规避。UI 直说“认证执行尚未接通”，不把存储能力算作 B07 完成。

合成验证：加密库与 IPC 注册 18/18、共享契约/目录 16/16、设置表单和保存路径 9/9 通过；加密库新增用例先复现缺失方法，再通过。测试覆盖隔离、轮换/CAS、目标变化、保留引用重试、删除、旧值遮蔽与禁止无认证降级。此轮没有真实模型/图片请求，累计仍为 **35/60、2/30**。类型、格式、文档及集成回归结果在本节后补充；未将源码或合成测试作为运行中桌面/原生安装包验收。

追加检查：Harness 81/81、CLI MCP resolver 11/11、现有模型/图片设置与真实 Flock writer 30/30 通过；Flock 往返保留保护引用，混入明文值的保护配置被拒绝。Shared、Components、Electron node/web 类型检查通过，定向 type-aware lint 零错误（43 条警告），i18n 和公开边界检查通过；docs check 零错误/18 条既有大小警告。本轮未重建/重启桌面，运行中仍为此前验收构建；未读取、迁移或删除真实用户 MCP 凭据，未提交或发布。完整认证链路和原生设置验收仍开放。

### B03/B07 运行准备与受保护 MCP 交付（2026-09-19）

本节接续并更新上一节“认证链路未接通”的源码状态，不追认桌面真实验收。带保护引用的 MCP 在 ACP newSession 中只绑定公开目录，不进行认证连接；宿主在拥有当前 run/epoch 后，先经既有 main host/broker 获取精确 workspace/server/目标/revision 凭据，再通过 fd 3 交付。窄的 `_molly/prepare_mcp_run` 仅携带公开准备快照。worker 校验完整匹配后发现工具，通过 SDK 公共 API 在同一原生文件/ID 上重新构造工具集合并返回最终哈希；宿主核对身份后才获取模型凭据、派发推理。没有新增持久配置层或 renderer 明文读取入口。

这解决了工具发现早于模型租约的循环依赖。启动即注入凭据会扩大生命周期，或者把秘密放回 ACP；因此选择本轮准备租约，代价是每轮重新连接认证 MCP，并在原生结算后关闭带凭据的客户端、恢复基础工具集合。准备阶段有截止时间，取消、主进程失联、模型/MCP 撤销会退休所属 worker；已派发 run 的持久栅栏阻止重复准备。旧 Agent 仍明确拒绝保护引用，设置保存仍不等于认证/工具发现测试成功。现有原始 header/env 必须经设置显式保存迁移，不能通过启动数据旁路。

合成验证覆盖两个 stdio 服务的凭据隔离、HTTP 目标/认证头隔离（注入 fetch，无网络）、错误 server/字段/epoch/revision、取消、轮换、删除、主进程心跳过期、迟到回报，以及任务结算后重新授权/保留原生历史。公共快照、ACP 更新、模型上下文、原生历史及运行记录未出现合成 canary。Harness 86/86、broker/control/resolver 39/39、AgentClient 61/61、共享契约/目录 17/17 通过。此类定向扫描不等于真实用户历史秘密清除审计。

实际 Electron Node 的打包准备测试先失败：macOS `/var` 与 `/private/var` 别名使同一原生文件在重新打开后字符串不同。现统一报告 `realpath`，保留宿主精确身份校验；重建后的保护 MCP 准备 smoke 通过，build `132d531a950637fbd4c2dbd63cea7f073de3bcec2e658891288600413bed020c`，Pi 0.85.1、darwin/arm64、212 个锁定依赖、13,749 个资源。测试使用本地合成 stdio peer，未发送模型 prompt 或付费工具调用。真实 main vault→设置→任务的原生 UI 验收仍待进行；本轮没有替换运行中桌面资源或保存用户 MCP 凭据。

追加检查：普通打包启动 smoke 同样通过；设置保存/表单/Flock writer 18/18、加密库 16/16 通过，本节合计 237 项定向测试通过。Harness、CLI、Shared、Components 和 Electron node/web 类型检查通过；定向 type-aware lint 零错误/196 警告（包含现有大文件与 JS 合成 fixture），i18n、公开边界、格式和 diff 空白检查通过；docs check 零错误/18 条既有大小警告。未重跑全仓 `pnpm check`，不将定向结果称为全仓通过；未提交或发布。真实累计仍为文本 **35/60**、图片 **2/30**，剩余 25/28 次。

### B03/B07 原生设置与重启验收（2026-09-19）

完整 Electron 构建通过，包含 CLI、受管资源同步、Bento、main/preload/renderer 和 node/web 类型检查。当前桌面已启用 build `843798b7bcea79eafe43c0a6d7f0f16ac5d992978daad7d9d42ca30d3a2da22b`（Pi 0.85.1、darwin/arm64、212 个锁定依赖、13,749 个资源）；使用实际 Electron Node 对已同步的桌面资源执行 `--protected-mcp` smoke 通过。正常退出旧实例后才启动新实例，未替换正在运行的资源，也未改动系统安装的其他应用。

通过原生 MCP 设置创建本地合成 stdio 连接，再保存一个不授予真实访问权的测试变量；默认加载保持关闭。重新打开编辑器显示凭据已存储且输入为空，未回显值。最初自动化表单状态不明确，通过恢复窗口、重新读取列表和编辑器确认当时仅保存了无变量连接，再显式补存变量；没有使用后台写入绕过设置验收，也没有据此宣称存在已复现的产品表单缺陷。

新建 `k3-256k/high` 会话只选择该 MCP。模型请求工具后，原生界面逐次批准无副作用的 `inspect`，得到预期隔离检查结果，run journal 为 completed。正常退出并重新启动后，旧回复仍可读，账本请求总数保持不变；显式新一轮再次要求单次批准并正常完成。两个轮次属于同一个原生历史文件，使用不同 worker epoch，各有两次成功模型 HTTP 和一次成功合成工具结果。对本机 harness 原生历史、run/operation 记录的定向扫描未发现合成凭据 canary；没有读取或打印真实用户密钥，该检查也不构成旧秘密历史清除审计。

本阶段新增 Kimi 请求 **4 次**，没有图片请求；累计文本 **39/60**、图片 **2/30**，剩余 **21/28** 次。该证据覆盖 macOS 本机构建的受保护 stdio 设置、运行授权、结算和重启恢复，不替代真实外部 HTTP 服务、完整安装包、素材导入/恢复或所有平台验收。没有自动重放、付费重试、提交或发布。

### B08 素材发布边界加固（2026-09-19）

核对外部图片结果复用路径时发现现有 `writeGeneratedImageAsset` 只检查词法路径：预先存在的 `media/` 符号链接可使写入越出工作区；未知尺寸以 0 返回，直接调用写入器也绕过了传输层字节上限。合成回归先复现这些行为以及宽松 base64 接受。现在在任何文件创建前冻结有界字节，拒绝非规范 base64、无有效尺寸头、零尺寸、超过 16 MiB、单边 16,384 或总计 64,000,000 像素的结果。后两项是显式导入资源上限（RGBA 基础像素缓冲约 256 MB），不是画布限制、供应商默认尺寸或完整内存上限；不自动缩放或修复。MIME/尺寸头检查仍不是完整像素解码，不能将本增量宣称为全部图像编码验证。

保留已有内容寻址 `media/` 布局，不建立新素材库。工作区别名先规范化，media 必须是原地真实目录；发布前后核对目录身份。临时文件 fsync 后通过独占 hard link 发布，取代会覆盖并发目标的 rename；同摘要同字节复用，不同字节、符号链接或非普通文件拒绝。碰撞比较用 no-follow 文件句柄及有界读取。代价是不支持 hard link 的文件系统会明确失败，不以覆盖写回退；同一 OS 用户下的恶意并发目录替换仍不构成强沙箱承诺。取消后的清理由目录身份约束，不把取消当作删除已发布素材的授权。

确定性文件边界测试覆盖并发相同/不同内容、fsync 后取消与临时文件清理；MCP 集成测试确认上游成功但导入拒绝时仍返回 dispatched/outcome_unknown，不重复生成，目录外没有写入。此次只使用合成传输，没有消耗真实额度，仍为文本 **39/60**、图片 **2/30**。外部图片声明式绑定、完整编码解码验证、来源/操作素材恢复与迟到结果恢复仍待接通；当前运行的桌面尚未包含本节源码修改。

追加检查：图片传输/发布、MCP 集成和连接共 **75/75** 通过；CLI 类型检查与完整生产构建通过，实际 Electron Node 的打包保护 MCP smoke 通过。worker 源码未变，资源闭包摘要仍为 `843798b7bcea79eafe43c0a6d7f0f16ac5d992978daad7d9d42ca30d3a2da22b`；它不标识已更新的 host 图片代码，也不证明运行中桌面已替换。定向 type-aware lint 零错误/14 警告，格式、diff 空白及文档检查通过（18 条既有大小警告）。没有重跑全仓 `pnpm check` 或提交；按 writing-for-agents 将发布约束留在 MCP 作用域规则，具体限值、取舍和验收限制留在 README/本节。

### 追加真实调用额度（2026-09-19，历史授权记录）

后续用户明确取消 Kimi 与现有图片模型的调用次数限制，账户侧额度由用户自行控制。
当前继续使用 `k3-256k/high` 与已配置的图片连接，按需调用，不再按先前 60/30 次上限停止。
取消次数限制不授权自动重试结果未知的付费请求、切换其他账号/模型或披露凭据。
取消限制时只读账本为 9 次运行、39 次模型 HTTP，图片 generate/edit 累计 2 次；历史计数保留。

用户再次批准 **50 次 `k3-256k` 调用和 20 次图片模型调用**，按追加额度记录，沿用 `high` 和现有图片连接。累计上限为文本 **60 次**、图片 generate/edit 合计 **30 次**；此时只读核对私有操作账本，已派发文本 7 次、图片 2 次，剩余 53 次和 28 次。额度不重置，失败及结果未知的已派发请求仍计入，不授权自动付费重试、切换其他模型或披露密钥。

### B08 外部图片字段绑定首片（2026-09-19）

在原 workspace MCP 行增加可选 `imageBinding`，不建立另一份连接目录或持久 readiness。
设置页提供公开 JSON 编辑与本地校验，必填显式图片模型；generate/edit 分别绑定确切工具名，
仅允许顶层 prompt/model/size，以及 edit 的有序 images/可选 mask 字符串字段。
拒绝重复目标、原型字段、嵌套路径、未知配置字段和缺失模型；凭据仍走原 main vault。
取舍是首片不支持嵌套结构、脚本转换或任意常量，避免把配置扩成可执行适配器。

受保护与无认证连接均沿原目录 revision 和每轮选择进入嵌入式 ACP 元数据，旧 runtime 不接收此绑定。
worker 以原 schema 判断可绑定性，并冻结映射；实际调用先校验规范化与原生参数，拒绝静默类型转换，
再展示包含固定图片模型的原生参数取得授权。审批后的 schema/连接检查保持；同 revision 的映射变更也撤销旧 worker。
映射不可用时工具明确显示 ordinary/unavailable，不称为图片就绪；兼容映射不会把语言模型名当图片模型。

此片只返回 inline MCP 内容，不导入作品素材，不把字符串引用当作本机文件读取或上传。
声明为图片的工具收到失败会结束本轮并持久禁止自动付费重试；外部私有 image receipt 不能提供可信素材摘要。
不支持或损坏的结果（包括尚未接入导入的 resource_link）在派发围栏内变为 outcome_unknown，停止模型续调。
普通未声明图片工具的独立授权 resources/read 路径保持。工具描述与设置均说明尚未导入作品素材；
不能将这个配置/执行切片当成完整 B08 或真实外部图片供应商验收。

合成测试覆盖字段及模型校验、原图顺序/mask、真实审批参数、审批后的参数不可变性、目录变更撤销、
外部失败/损坏结果/资源链接导致原生推理中止、伪造私有回执及重启后的重试围栏。
首轮类型检查发现内容转换缺少必需资源读取参数，已补显式拒绝；lint 发现控制字符正则，已改为字符码校验。
Harness **97/97**、共享绑定/目录 **31/31**、设置 **10/10**、CLI resolver **13/13** 通过；
Harness/Shared/Components/CLI 类型检查、公开边界通过。此次没有真实模型或图片请求，累计仍为 39/2。
完整 CLI 构建通过；最终资源 smoke 与桌面部署状态另记，不以源码通过声称运行中桌面已更新。

最终源码重新构建通过，实际 Electron 39.5.1 Node 的打包保护 MCP preparation smoke 通过，
worker build 为 `d0ade5cf734ea62332ba09c9e8790f593544467d671cd9e8747fa15f70ec1d47`，
Pi 0.85.1、darwin/arm64、212 个锁定依赖、13,749 个资源。未替换运行中桌面资源或启动真实请求。
16 个定向文件 lint 零错误/49 警告，格式/diff 检查通过，文档零错误/18 条既有大小警告。
按 writing-for-agents 将执行约束放在 Harness 规则中，映射能力及未完成部分放在 README/本节。

### B08 外部内联图片导入（2026-09-19）

沿用已绑定的外部 MCP 工具，在同一付费派发围栏内通过私有 ACP 方法请求 owning host 导入。
AgentClient 核对原生会话、单次批准的原生工具标题/参数摘要及目录有效性，消费后不可重放；
EmbeddedHarnessControl 核对 active run/epoch/turn/product Session、所选连接 revision 与声明工具。
SessionManager 从活 Session 元数据及冻结 turn 输入解析已有设计草稿；worker 不能指定写入路径。
公开 renderer Machine RPC、内置图片连接凭据门禁及画布提交链均未扩张。

设计服务先验证全部图片的规范 base64、声明/实际 MIME、尺寸头与字节上限，按输入顺序复用已有
独占素材写入器。既有 operation 目录增加 `<operationId>.images.json` 不可覆盖导入意图，
只存身份和预期素材摘要/尺寸，不存图片字节、prompt、密钥或绝对目的路径。
原因是文件发布与 worker 操作结算不能原子完成；只等 worker 回执会丢失崩溃后的来源关联。
这不是平行素材库或成功证明，未来恢复必须复核实际文件；本增量未实现恢复消费/UI。

仅 host 返回的素材摘要进入成功操作回执；外部 `_meta` 不能伪造素材权威。
模型收到 host 素材路径后可经普通 native read 查看，服务原始内容不冒充导入回执。
拒绝、无内联图片、取消或导入失败均保留 unknown 并结束原生推理，不自动付费重试。
不兼容映射保持 ordinary/unavailable；普通会话不获得设计写入能力。
resource_link/URL 导入、完整像素解码、恢复、真实外部服务及安装验收仍开放，不能关闭完整 B08。

当前合成 Harness **100/100**、新增导入/宿主控制/AgentClient **95/95** 通过，CLI 类型检查通过。
第一轮素材测试的非 UUID 夹具已按既有设计身份规则修正；未放宽产品验证。
后续构建和完整定向检查另记。没有真实模型或图片请求，累计仍为 **39/2**，现在没有调用次数上限。
按 writing-for-agents 将授权/导入边界留在模块规则，原子性取舍和未实现部分留在本节与 README。

最终定向回归：Harness **100/100**、CLI 授权/导入/图片传输与 MCP **154/154**、共享合同 **28/28**；
CLI/Harness/Shared 类型检查、公开边界、i18n、格式和 diff 空白检查通过。
type-aware lint 17 文件零错误/194 警告；初次两项错误是导入意图冲突分支未保留本机 EEXIST cause，
补齐后通过，外层 ACP 仍只返回固定脱敏错误。完整 CLI 构建及最后源码重新打包通过；
实际 Electron 39.5.1 Node 的离线启动和受保护 MCP preparation smoke 通过，
worker build `aba040008334a340f627d55190cf676d06419acf95e1ecaf2e338bfda0f7a021`，
Pi 0.85.1、darwin/arm64、212 个锁定依赖、13,749 个资源。
文档检查零错误/18 条既有大小警告；未重跑全仓既有失败基线，未提交、发布或替换运行中桌面。
最后单独重打包会清空 dist 的复制资源；完整性检查因此先报告缺少 DeepSeek preset，
按既有 build 顺序重跑 presets/design-skills/WASM 复制后再次通过，未放宽检查。

### B08 本地素材恢复读回（2026-09-19）

导入意图现有消费者：设计专用 native `molly_recover_images` 通过 owning host 读取，
不新增素材数据库、不依赖旧 MCP 在线/凭据，不将远端查询、生成或画布提交塞进恢复。
原生审批绑定确切 query 摘要，消费一次；宿主核对当前 run/epoch/turn/Session，
再从意图核对源 Session/artwork 和 operationId 推导关系，解析原 turn 的冻结目录。
空参数分页列出意图（不是可用性）；每页最多读取 100 个有界回执、返回 20 个本会话项，
目录遍历仅保留 101 个排序名称，复用现有 journal 而非新增索引。显式 operationId 才核验素材。
保留畸形/不属于本会话的回执但不暴露其内容；读取不会创建缺失目录或修改付费状态。

文件核验使用 no-follow/nonblocking 句柄、普通文件/字节上限、完整字节摘要、MIME/尺寸头和
media 目录身份；返回已核验素材及 missing/changed/unsafe，不把头检查宣称为像素解码。
整批预期字节上限为 16 MiB，与内联导入的 20 MiB encoded 上限兼容。
导入意图改为共享严格结构；复用比较按规范化对象，避免仅 JSON 字段顺序造成虚假冲突。
恢复不结束任务、不重启旧 turn，不改 canonical。内置图片回执、远端/迟到结果取回、完整解码
和独立人工恢复 UI 仍开放，不把本片宣称为完整 T09/A09。

合成 Harness **103/103**、CLI 导入/恢复/授权 **117/117** 通过；
CLI/Harness/Shared 类型检查通过，16 文件 type-aware lint 零错误/185 警告。
首次恢复用例发现 macOS `/var` 的真实路径是 `/private/var`，断言改为核验实际解析路径，
产品未绕过 symlink 检查。正常退出 Molly 后正在完整构建与部署，真实联调另记。
按 writing-for-agents 将只读恢复约束放在模块规则，将来源、分页与未实现边界放在 README/本节。

最终源码回归：Harness **103/103**、CLI 六组 **176/176**、共享合同 **28/28**。
完整 CLI/Electron/Bento/main/preload/renderer 构建及 Electron node/web 类型检查通过；
复制后的实际 Electron 39.5.1 Node 受保护 MCP preparation smoke 通过，
Pi 0.85.1、darwin/arm64、worker build `b7f03bf1c4190ff1589847af9fc47ad459ca63af45696635d0029feb820df678`。
随后重新构建 app 以包含刚更新的恢复文案，并核对编译产物确实包含该文案。
public boundary/i18n/格式/diff 检查通过，文档零错误/18 条既有大小警告。

Molly 经原生菜单正常退出（确认进程已退），再以已验证的本地资源启动；未强杀或触碰其他应用。
已有合成设计会话继续选中 Molly、Kimi K3-256K、High，发送明确的新只读恢复请求。
原生 UI 显示 `molly_recover_images` 单次授权；批准后实际返回 `listed` 和空操作列表，
原生运行结算 completed，画布从 Processing/read-only 恢复到可保存/导出及已自动保存。
两次实际模型 HTTP 均 succeeded，没有图片请求，累计文本 **41**、图片 **2**；次数仍无上限。
该证据证明实际打包 worker、审批、宿主回调和空列表读回贯通，不冒充已有素材恢复、远端恢复、
完整安装包或完整 T09 验收。图片发布加固、外部字段绑定、内联导入和本地恢复源码现已部署到此次桌面。

### B08 有界像素解码与编辑输入验证（2026-09-19）

本增量补上此前明确保留的文件头校验缺口：生成/外部内联素材在发布前、编辑源图和 mask
在发送前、恢复素材在报告可用前，均使用锁定 Sharp 0.35.4 执行严格解码。只允许现有
PNG/JPEG/GIF 结果；编辑输入另保留 WebP。解码处理有 15 秒上限、每边 16,384 和跨帧
64,000,000 像素上限，GIF/WebP 解码所有帧；metadata 不算成功，必须完成 raw 像素输出。
输出仅用于验证即丢弃，保留原始编码、摘要和顺序，不自动修复、缩放或变更画布。
WebP 现在也参与首张源图/mask 尺寸比对，读取源文件增加 nonblocking 和读取前后 stat 核对。
取消后不发布；付费响应后解码失败仍是 dispatched/outcome_unknown，不得自动再次生成。

选择现成完整编解码器而非扩充手写 PNG/JPEG/GIF/WebP 解析器；代价是新增 native 依赖与
各平台资源验证。沿用已有 embedded CLI native staging：Sharp/依赖树和目标 addon/libvips
随包交付，beforePack 选目标，afterPack 核对实际复制结果；本机包还运行实际 Electron
解码探针。保留依赖 README/许可证/NOTICE，不在运行时下载。依据
[Sharp 输入校验](https://sharp.pixelplumbing.com/api-constructor/)的 `failOn: warning`、像素限制
和多帧设置；元数据和 native 解码都不构成视觉品质证明或恶意本机进程沙箱。

最初严格解码拒绝了旧测试里的 PNG 文件头片段，以及一份文件头正常但压缩数据损坏的
1×1 PNG；成功路径换成完整合成 PNG，原坏样本保留为拒绝用例，没有降低严格级别。
回归覆盖 PNG/JPEG/GIF 完整/截断数据、损坏像素、多帧预算、WebP/mask、整批导入拒绝、
文件碰撞与取消，以及原生 MCP 的已派发未知状态。CLI 构建/类型检查通过，相关最终结果见下。
macOS arm64 实际 Electron Node 探针完成四格式解码与坏图片拒绝；macOS x64、Linux x64/arm64、
Windows x64/arm64 的目标资源装配检查通过后恢复本机资源。跨平台资源检查不等于实机运行；
完整安装包、远端/迟到素材恢复和 T09 其余要求仍开放。本轮不新增模型或图片调用。
最终回归 CLI **85/85**、资源选择/缺失/错版测试 **2/2** 通过，CLI 类型检查和完整生产构建通过。
新增 GIF 用例发现解码器可能按帧矩形缩小逻辑画布，因此导入预算同时核算容器逻辑尺寸与
解码尺寸，并乘以帧数；修正后用例通过，没有移除该拒绝断言。最终源码已重新构建和同步。
实际 Electron 39.5.1 Node 的四格式解码探针通过；受保护 MCP 离线启动 smoke 通过，
worker 未改变，build 仍为 `b7f03bf1c4190ff1589847af9fc47ad459ca63af45696635d0029feb820df678`。
type-aware lint 七文件零错误/22 警告，公开边界通过；未重跑全仓既有失败基线、未提交或发布。
文档检查零错误/18 条既有大小警告，格式与 diff 检查通过。最终资源重开 Molly 后，旧合成
会话和三轮历史可读，画布显示已自动保存、保存版本/导出可用，没有自动启动新模型任务。
writing-for-agents 用于把运行约束放在最近规则文件，把选择代价和证据限制保留于本节。

### B08 内置图片统一导入与本地恢复（2026-09-19）

内置图片原先由 MCP 直接发布文件，而外部图片由 owning host 记录导入意图后发布，导致内置
成功素材无法使用同一恢复入口。本增量让受管内置调用通过私有 tools/call 元数据请求字节结果，
复用既有 ACP 导入回调和 `.images.json` 意图，不另建 RPC、素材库或来源数据库。宿主核对
单次原生批准、run/epoch/turn/session、内置 MCP 选择和冻结的实际图片 connection/revision；
私有元数据本身不提供权限或文件目标。原路径仅为尚未退役的 legacy 调用保留。

MCP 取得字节后不写入素材；宿主完整解码整批结果，再写恢复意图、独占发布文件、返回摘要。
worker 在同一付费派发围栏中等待导入，只使用宿主摘要，并将宿主路径而非原始图片放入模型
上下文。导入失败仍为 unknown，停止本轮并禁止自动重试；新内置素材可用只读恢复工具核验。
旧内置素材没有意图时不补造历史；宿主未收到的远端/迟到结果仍不可恢复，T09 尚未全部完成。
采用内联输送会短暂传递 base64；共享与 MCP 聚合边界容纳完整 16 MiB 原始图片及有限元数据，
最终解码/原始字节总上限保持，不扩大资源读取和路径权限。

合成验证：Harness **106/106**、CLI 导入/控制/传输/MCP **117/117** 与相关类型检查通过。
新增集成覆盖 generate/edit 在导入前目录为空、宿主发布后按操作恢复及真实字节/摘要一致；
ACP 覆盖正确私有元数据、只信宿主摘要、导入失败和无图片结果中止；控制层覆盖连接、版本、
工具、未选择与撤销。最初未选择用例在绑定后修改 fixture 配置被正确拒绝，现改为初始选择
另一服务器，未放松运行时绑定限制。补充完整 16 MiB 编码边界后 Harness **107/107**、
共享 **7/7** 通过；AgentClient/文件发布 **79/79** 通过。CLI/Shared/Harness 类型、生产
构建、格式、公开边界通过；定向 type-aware lint 零错误/230 警告，docs 零错误/18 既有大小警告。
没有重跑或宣称修复全仓已记录的基线失败，没有提交或发布。

正常退出后同步新 CLI，实际 Electron 39.5.1 Node 的保护 MCP 启动和四格式解码探针通过；
build `678b7f4705af4b99935d09bca339cd9941886dd4f13331cf8ec29c3de8a78b56` 已进入桌面。
原生 UI 核对 Kimi `k3-256k/high`，新建合成任务，逐次批准一次生成、恢复列举和按 operationId
核验。三步成功，native journal completed；PNG 为 1145×1374、794,502 字节，摘要
`5a6272fa5e961fee9b5b95f05aaaef7c8f021b0b28d76afefc54f83cb5e7f7e0` 与文件、宿主意图和
付费回执一致，恢复 unavailable 为空。canonical revision 与派发 baseline 相同，未应用画布。
新增 4 次成功 Kimi HTTP、1 次图片调用，累计 **45/3**。此证据不含像素美学验收、真实编辑
与崩溃恢复；尝试正常重启前 Mac 锁屏，已请求用户解锁，未绕过锁屏或终止其他应用。
writing-for-agents 将统一导入约束归到最近规则文件，并保持旧资产/远端结果的未完成说明。

### B10 等待授权时保留 Stop（2026-09-19）

原生验收发现权限卡片替代 composer 时连同原 Stop 一起隐藏，用户必须先拒绝工具才可停止。
现浮动权限/提问 surface 接收原会话的取消动作，复用原 active-turn/goal 与归档门禁；
不新增 RPC、取消状态机或权限结果。停止请求处理中禁用权限输入，完成/失败后仍以既有
dispatch/presence 判断界面，不伪造拒绝、任务结束或画布解锁；失败保留显式重试入口。
选择在替代 composer 的现有卡片组末尾放置一个 Stop，避免恢复完整 composer 造成授权与
发送同时可用。补充普通权限/提问 Storybook 与确定性交互测试。Mac 锁屏期间仅修改源码，
相关交互/披露/可取消状态测试 **16/16**、Components 与 Electron node/web 类型检查通过；
定向 lint 零错误/103 警告，i18n、格式与 diff 检查通过。停止不冒充 runtime 未就绪，
停止失败保留卡片与显式重试；提问分支同样通过合成交互验证。尚未部署或做原生 Stop
验收，不把已有图片验证归给这次 UI 修改。全仓既有失败基线未重跑，无提交或发布。

### B08 外部图片 MCP 资源链接导入（2026-09-19）

外部绑定图片工具的 `resource_link` 现通过原 MCP 客户端的 `resources/read` 解析，继续使用
既有 URI/MIME/base64/聚合大小限制及精确 URI 核对，再交 owning host 解码/导入；不把
URL 文本当下载指令，不通过宿主 fetch 或 filesystem 解析远端资源。单独批准和目录/schema
复核仍必需；读资源与原调用共享 210 秒上限，每次读取最多 30 秒。

直接在原付费调用内复用原串行 dispatch 会等待自身，或者必须过早结算父操作。本实现改为
仅在 live parent 内发放窄读取回调：固定 run/server/revision 和 resources/read，子记录带
parentOperationId；只跳过其尚未结算的同一父记录，不绕过任何其他 unknown/重试围栏。
父级等待子读取结算，回调随后失效；不新增公开 RPC、配置或存储目录。普通工具资源读取
保持原独立路径。拒绝、取消、身份不符、传输丢失或宿主导入失败均使父操作 unknown，
中止模型续调，不重复生成。子读取成功仅证明传输结果已取得，不是素材或画布批准。

新增合成用例覆盖实际 stdio 链接→单独授权→宿主导入、宿主拒绝、用户拒绝、错 URI、
响应丢失、父/子落盘顺序、同轮并发隔离、吞掉子异常仍不能伪造父成功、回调过期，以及
授权未回答时取消且迟到批准不读取。旧“所有 resource 均不支持”用例改为错误 URI/丢响应
负例，正例单独证明新增行为；没有删除失败保护。正在完成构建/静态检查，本轮没有真实
模型或图片调用。桌面仍是上一构建；锁屏不以源码或离线测试替代原生 UI 验收。

最终 Harness **114/114**、CLI 导入/控制 **48/48**、设置/Stop **10/10** 通过。测试里的
Promise.withResolvers 超出该包 lib 声明，替换为已有显式 resolver 写法后类型检查通过，
没有扩大编译目标；最终 ACP/派发用例 **52/52** 复验通过。CLI 类型及生产构建通过；实际
Electron 39.5.1 Node 的保护 MCP 离线 smoke 通过，Pi 0.85.1、darwin/arm64，build
`b230295a36f030a222a3507b6d120121f68b7545376ef2842ea3dae93dc295c6`，212 个锁定依赖、
13,749 个资源。没有同步到运行中的桌面。定向 lint 零错误/92 警告，i18n、公开边界、
格式/diff 检查通过，docs 零错误/18 既有大小警告。未重跑全仓已记录失败基线，无提交/发布。
writing-for-agents 用于将父/子派发约束与原资源读取规则合并，保留当前不支持远端查询的说明。

### 真实联调授权与预检（初始记录）

后续授权已覆盖 Kimi Code `k3-256k` / `high` 最多 10 次真实请求，以及本机已配置图片模型最多 10 次真实请求（生成与编辑合计）。这是上限而非必须耗尽的次数；失败和结果未知计数，不自动重试、不自动改模型；只使用合成测试内容。其他 Provider 和公开发布不在此授权内。

预检确认锁定 SDK 的 `k3-256k` 目录支持 `high`；新增合成请求断言验证真实 SDK 构造 `model: k3-256k`、`thinking.type: adaptive`、`output_config.effort: high`，Harness 38 项测试及类型检查通过。这不是服务端连通性证明。当前 Lody 创建选项未暴露 Molly 内置 Agent，产品安全入口与旧图片凭据迁移仍须完成；未绕过凭据边界建立临时明文调用路径。此时文本请求 0/10、图片请求 0/10；后续真实派发必须更新消耗和结果，不从头重置预算。

| 已核查事实                                                                                        | 证据                                                                                                                                                                                                                                    | 对实施顺序的影响                                                                       |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 基线 Pi 通过 registry `pi-acp@0.0.33`、PATH/`PI_ACP_PI_COMMAND` 和临时 shim 接入；现已退役。      | [设计 README](../../../../apps/cli/src/design/README.md)、[基线 pi-launch.ts](https://github.com/LeonEthan/molly-design/blob/7c85b3b06cc227a4e9e0c0e61d769352754aaa00/apps/cli/src/design/pi-launch.ts)                                 | 固定 worker 与封闭资源加载一起交付；不能把更换配置标签当作内置完成。                   |
| 启动入口不仅在设置页；会话创建/准备、恢复、能力探测、认证、标题和历史 catalog 都能到达 launcher。 | [setting.ts](../../../../apps/cli/src/agent/setting.ts)、[session-manager.ts](../../../../apps/cli/src/session/session-manager.ts)、[history-session-catalog-client.ts](../../../../apps/cli/src/lib/history-session-catalog-client.ts) | 最后切换必须覆盖后端及辅助路径，旧历史读取需要脱离旧进程。                             |
| 图片配置类型带 `apiKey`，现行约定存于机器 Flock；设置页消费该配置。                               | [image-connection.ts](../../../../packages/shared/src/image-connection.ts)、[设置页](../../../../packages/components/src/components/settings/image-connection-setting.tsx)                                                              | SecretStore 和旧 Key 迁移必须先于新真实调用；仅加新连接表不能满足不入 Loro 的目标。    |
| Session 规则允许在无 ACP 输出时恢复并重试同一 prompt 一次。                                       | [Session 规则](../../../../apps/cli/src/session/AGENTS.md)                                                                                                                                                                              | 新引擎按持久派发事实恢复，不能以“UI 没看到输出”证明没有请求/副作用。                   |
| Workspace MCP 已有 catalog 与每轮选择两层；Role 绑定 machine + AgentConfig 并冻结到 Operation。   | [共享规则](../../../../packages/shared/AGENTS.md)                                                                                                                                                                                       | 复用 catalog，不建立新机绑定层；Role 迁移和程序化创建共同修订。                        |
| 开发 Node 范围从 22.14 开始；Electron 固定 39.5.1，MCP SDK 固定 1.29.0。                          | [根清单](../../../../package.json)、[CLI 清单](../../../../apps/cli/package.json)、[Electron 清单](../../../../apps/electron/package.json)                                                                                              | 核对实际 Electron 子进程 Node，不仅修改 engines；MCP 能力以锁定 SDK 和 server 为准。   |
| dev/production 要求 flat sibling worker；Electron 子进程需要保留 `ELECTRON_RUN_AS_NODE`。         | [CLI 构建说明](../../../docs/cli-overview.md)、[Electron 规则](../../../../apps/electron/AGENTS.md)                                                                                                                                     | 采用 CLI sibling bootstrap，SDK/插件资源放受管资源子树；不能照抄概念目录破坏入口定位。 |
| 当前设计已具备独立当前投影、草稿、回执、CAS、实时画布和 Git 历史。                                | [设计 README](../../../../apps/cli/src/design/README.md)                                                                                                                                                                                | 只适配新执行身份/终态；不重建设计系统。                                                |

上游 [Pi 包清单](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/package.json)已核对公开包名与 Node `>=22.19.0`；[固定版 SDK 文档](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)确认可注入模型、凭据和资源加载，默认行为包含本地发现与认证/模型回退。这里只证明 API 方向可行，不证明目标包资源闭包、权限或安装包已通过。

### 2.1 B00/B01 必须收敛的合同差异

1. [现有设计 Spec](../../../../specs/graphic-design-platform.zh.md)保留多 Agent 选择；[上游采用草案](../../../../specs/lody-upstream-adoption.zh.md)要求五种接入验证。新方案是后续范围变更，实施时同步说明替代范围，保留旧证据，不将所有历史文字改成 Pi。
2. 根及 design 规则禁止 runtime 补丁和读取证明。新宿主权限检查通过公开 SDK 工具/扩展边界落实，只解决操作授权，不新增“先读才准写”证明；如需改变普通工具授权边界，在 B01 修订最近的规则并记录，不暗中 patch Pi。
3. Role 的新目标不再允许换 CLI。保留唯一 Role family 和来源信息，以显式新版本表达连接/模型偏好；旧 `machineId + agentConfigId` 仍是旧记录的真实身份，不能静默改义。
4. SecretStore 由 main 管理而 daemon/worker 在不同进程。B01 固定受限取用链、main 退出时的行为和能力协商；首版无 main 保护通道时拒绝新付费执行，已持久化设计仍可读，不增加第二个 headless 凭据后端。
5. 原方案 M1 需要设计闭环，但 T12 全量依赖 T09。拆为 T12a 基础无生图回归和 T12b 完整图片/视觉回归；T11 同理分最小连接表单和完整设置，不改变最终范围。

这些差异由 B00/B01 形成具体修订。当前新 Spec 为 draft，不据计划编写请求标记 approved；后续获授权实施时不重复询问已经明确的方向，仅处理实际未决的范围变化。

## 3. 代码归属与复用边界

| 所属模块                                               | 保留/调整                                                      | 有必要才新增                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/shared`、`packages/platform`                 | 共享 schema、capability、输入快照与平台 port；沿用 ACP core。  | 非秘密连接、内置引擎身份、原生结果和秘密取用 port；不重复定义旧事件体系。 |
| `apps/cli/src/agent`                                   | start gate、AgentClient、进程监督、错误与权限呈现。            | 固定 launcher、薄 ACP adapter；最终删除无消费者的外部启动代码。           |
| `apps/cli/src/session`、`src/lib`、`src/orchestration` | 当前队列、TurnRuntimeState、Operation、恢复和持久化屏障。      | 原生 session 映射、run/epoch/边界所缺字段；不新建调度器或聊天数据库。     |
| `apps/cli/src/mcp`、`src/design`                       | 独立 MCP host、图片传输、素材、render、flush、CAS/回执与 Git。 | 通用连接管理、声明式图片绑定、最小付费操作记录及结果规范化。              |
| `apps/electron/src/main`、preload                      | 现有受限 IPC、CLI 生命周期与桌面存储。                         | SecretStore 和作用域取用桥；renderer 仅有写入/删除/状态查询。             |
| `packages/components`                                  | settings、composer、权限/工具事件、Role 与旧会话界面。         | 连接管理、必要的扩展交互及显式迁移动作；不添加通用插件市场。              |
| CLI/Electron 构建脚本、`e2e`                           | 当前 bundle、资源同步、after-pack 探针与原生测试 harness。     | Pi entry/资源清单与对应探针；不另建打包/测试框架。                        |

最多新增一个 `packages/harness-pi`，只承担 SDK session factory、model runtime、ResourceLoader、事件/结果映射和受管扩展；只有 B00 确认独立依赖闭包与测试边界确有收益才分包，否则放在现有 agent 子模块。新增作用域需 README、短 AGENTS 与 CLAUDE symlink。以下新文件名都是拟定位置，不能当作已存在 API。

持久化复用优先：产品运行事实扩展现有 Session/Turn 存储，付费操作优先扩展既有子进程 Operation 存储。B01/B08 必须证明其权限、写入时机及生命周期适配；不满足时才在同一宿主存储增加最小记录类型，并说明必要性。Pi JSONL 只保存原生上下文；不把消息再双写成第二份恢复真相。

## 4. 里程碑与依赖

| 批次                  | 对应原任务        | 前置               | 交付边界                                             |
| --------------------- | ----------------- | ------------------ | ---------------------------------------------------- |
| B00 基线审计          | T00               | 无                 | 完整启动/敏感数据/资源/测试矩阵及未决点。            |
| B01 合同与版本        | T01，T16 文档起步 | B00                | schema、身份/状态、capability、manifest、规范差异。  |
| B02 worker 与隔离     | T02、T04          | B01                | 包内 SDK worker，封闭配置与资源加载，合成探针。      |
| B03 凭据与旧 Key 迁移 | T05，T13 凭据部分 | B01                | SecretStore、受限取用、旧图片秘密迁移。              |
| B04 ACP 与恢复核心    | T03、T07          | B02，B01           | 事件、终态、取消、队列、原生上下文和崩溃恢复。       |
| B05 最小设计闭环      | T06a、T11a、T12a  | B03、B04           | 一个显式连接完成无生图设计、手改续写、取消和重开。   |
| B06 Provider 完整目录 | T06b              | B05                | 目标 presets、多连接、能力、目录与请求审计。         |
| B07 通用 MCP          | T08               | B03、B04           | catalog 到工具的稳定路由、授权、变更、取消与关闭。   |
| B08 图片与付费恢复    | T09、T12b         | B05、B07           | generate/edit、素材入库、未知结果与完整设计回归。    |
| B09 受管社区扩展      | T10               | B03、B04           | 一个真实社区扩展、清单/审核、GUI bridge 和命令适配。 |
| B10 完整设置与交互    | T11b              | B06、B07、B08、B09 | 模型/图片/MCP/能力/权限完整 UI 与错误语义。          |
| B11 会话与 Role 迁移  | T13 剩余          | B08、B10           | 幂等迁移、旧记录可读、显式新 Pi 上下文及回滚。       |
| B12 关闭旧执行        | T14               | B11                | 全入口后端拒绝 legacy；移除无消费者的旧代码和依赖。  |
| B13 最终验收与文档    | T15、T16          | B02–B12 全部完成   | 冻结安装包、支持矩阵、视觉验收、恢复说明与 DoD。     |

里程碑 M0=B00–B01；M1=B02–B05；M2=B06–B10；M3=B11–B12；M4=B13。M1 的模拟链路可先完成，真实 BYOK 证据需批准的测试连接；未获真实调用条件时标记该项 blocked，继续独立的模拟实现，不将 M1 整体写为已验收。

共享合同稳定后，B02 与 B03 可独立实施；B06、B07、B09 可在各自前置通过后并行。B08 不等待完整 Provider 目录，但必须等待 MCP 与付费门禁。此处是工程依赖建议，不是本轮派发多 Agent 的指令。不预估缺乏测量依据的人天，B00 后按实际资源与风险排期。

## 5. 分批实施内容和退出条件

### B00：完成差量审计

**执行内容：** 读取各落点作用域规则、active notes、模块 README；记录实际 HEAD/dirty tree、pnpm/Node/Electron/ACP/MCP/Pi 锁版与运行时探针。逐一追踪普通聊天、首页创建、设计继续、queue/steer、Task、Role、MCP/API 创建、恢复、fork/edit-resend、标题/摘要、能力探测、认证、历史 catalog、预备会话及测试入口到最终 spawn。每项登记保留、替换、退役或待确认及其持久身份。

建立敏感数据流表：输入控件 → 存储 → RPC → worker/server → provider，含日志、旧 machine Flock、CRDT 历史、备份和诊断。核对本地路径、进程所有权、插件候选及许可证。复现方案所述 `packages/design-authoring/tests/live-fingerprints.test.ts` 失败；记录观察而非假定当前必失败。

**交付/验收：** 本笔记追加入口/数据/资源清单及基线测试结果；固定正常设计、取消、冲突、恢复的合成 fixture。性能用固定机器和合成 Provider 记录样本数、冷/热启动、首轮就绪、内存和取消分布，先定阈值再验收。真实账号、模型和预算未知不阻塞静态审计。

### B01：固定最小共享合同

**执行内容：** 在 shared 定义版本化的 HarnessIdentity、ProviderPreset、ModelConnection、ModelSelection、ImageConnection、MCP transport 判别联合、RunConfigSnapshot、RunOutcome 及旧记录解码边界。身份区分 provider/connection、product/native session、user/Pi turn、run/epoch；模型与 endpoint 变更使用 revision，秘密只保存引用。

优先映射现有 ACP/Core、TurnRuntimeState 与 Operation 字段；只扩展确实缺少的身份/结果。冻结 `completed/failed/cancelled/interrupted` 与设计提交结果的分工，以及已接受、未派发、已派发、结果未知的恢复规则。定义秘密取用的客户端身份、授权作用域、目标域、撤销和 main 生命周期，不能以传入任意 credentialRef 换取秘密。

**交付/验收：** schema/契约测试拒绝未知版本、混合 stdio/HTTP 字段、空模型、错误身份、无权限凭据取用和不兼容恢复。manifest 记录精确版本、锁摘要、资源/插件哈希、平台及协议；升级模型目录不改变可执行依赖。同步本计划 §2.1 的最近规则与 Spec，不建立平行协议库。

### B02：同时交付 worker、资源与隔离

**主要落点：** 拟 `molly-pi-agent-entry.ts`、`agent/embedded-runtime-launch.ts`、可选 `packages/harness-pi`；现有 `apps/cli/scripts/dev-build.mjs`、`vite.config.ts` 和 Electron `sync-cli-*.mjs`、`cli-native-deps.mjs`、`eb-after-pack.mjs`。

**执行内容：** 精确锁 Pi 0.85.1 及完整闭包，复用共享 start gate；入口按 sibling 约定解析绝对路径，包内资源另由 manifest 解析。保持 SDK 主入口，不调用外部 `pi-acp`、npx 或 source-only API。依赖变更更新 pnpm lock，开发 Node guard、CI、CLI guard 和包内 Node 实测共同对齐。

worker bootstrap 在加载 SDK 前设置私有目录；显式注入 settings、CredentialStore、ModelRuntime cache、SessionManager 与封闭 ResourceLoader。白名单保留包内 Node 和受控代理/证书/loopback 必需值；不继承模型 Key、Pi overrides、NODE_OPTIONS/NODE_PATH。声明必要 rg/fd、WASM、图片资源；禁用未使用的 CLI/TUI 初始化，实际使用的能力必须随包供应。

**退出条件：** 合成模型环境中 PATH 放假 `pi/node/npm`、预置污染 `.pi`/上级 AGENTS/全局 skills/假 Key，启动和一次工具执行不触发它们；污染配置哈希不变。安装包资源探针覆盖入口、依赖、原生绑定与 Node；本地初始化无隐式下载。关闭只回收本 worker 所有进程。真实本地 Pi 并存/升级验证留到 B13 的受控测试安装。

### B03：凭据能力及敏感数据迁移提前落地

**主要落点：** 拟 Electron `services/secret-store.ts`、既有 main/preload IPC、platform port、shared 图片配置、现有设置/daemon 图片读取路径。

**执行内容：** 按项目 Electron 39.5.1 的实际可用 API 实现安全持久化；renderer 仅 save/delete/status，后台按运行和 server 授权取用。Key 不进 argv 或通用继承环境；模型凭据经受限通道注入内存，第三方 stdio MCP 如需环境凭据，只向该 server 注入其已授权字段，不传给 Agent shell。运行快照锁定 secret revision；轮换下一边界生效，撤销有明确中止语义。系统保护不可用时按 Spec 明确失败或显示仅内存模式，绝不写明文 fallback。

旧图片凭据迁移采取“读取合法旧值 → 安全存储确认 → 发布非秘密引用 → 验证新读取 → 标记迁移完成”；中断可重入，不因失败丢失唯一 Key。普通备份不复制秘密；涉及秘密的恢复材料采用同等保护。B00 审计旧 CRDT 历史/备份能否彻底清除，不能仅删除当前 apiKey 字段就宣称完成；无法证明旧副本清除时给出明确残留范围与轮换/重新输入策略，不自动执行破坏性清库。

**退出条件：** 重启、锁定/不可用存储、撤销、轮换、中途崩溃均有确定结果；两个模型连接/两个 MCP 不互取凭据。合成 canary 扫描参数、日志、会话、工作区和导出无新秘密泄露；迁移前已有残留与新写入分开报告。持久 schema 与读取双方切换前，不启用真实 API。

### B04：ACP 适配和会话恢复合并验证

**主要落点：** 拟 `agent/molly-pi-acp-adapter.ts` 与事件/outcome 映射；保留 AgentClient、SessionManager、TurnRuntimeState、message-handler 与历史持久化屏障。

**执行内容：** 建立 init/new/load/prompt/config/permission/usage/cancel/shutdown 的最小能力表；图像输入保留实际 image 块。原生错误、截断、未完成工具、取消、正常完成分别映射，stdout 仅协议。产品任务只派发一次，不再向 Pi follow-up 队列重复入队；steer 按 applied/proven refusal/delivery_unknown 保留事实。

原生 session 文件位于私有路径，产品记录引用及确认 entry 边界。每个 worker 新 epoch；事件顺序单调、重复去重、退役事件拒收、终态只结算一次。取消保留拥有权直到原生结算/已验证退出且产物处理结束；窗口断开不释放画布。无可见输出不自动重试已派发或未知任务。

**退出条件：** 合成 ACP/native fixture 覆盖正常退出但原生失败、取消竞态、max-token 截断、普通可恢复工具错误、旧 epoch 迟到、重连、压缩中停止及历史损坏。分别在派发前、请求发出后、工具运行、native 完成、回执未确认处注入崩溃；观察模型/工具操作身份和持久结果，不以 mock 调用次数替代不重放证明。模型切换不能静默丢弃图像、工具或推理历史。

### B05：最小可用纵向闭环

**执行内容：** 先用合成 Provider、再用已授权的一个官方 API 连接；首个实现优先 OpenAI preset，但 UI 不自动选模型。复用 settings/composer 提供最小连接表单、模型/思考/权限选择和认证错误。标题本地截断；禁用旧自动辅助标题请求的新会话入口。

接通当前设计准备 → 阻止新编辑/flush → 投影核验 → 冻结快照 → Pi → 实时只读画布 → 原生结算 → 既有采集/CAS/回执 → 解锁。设计技能与公开读取提醒显式加载，保留原生文件工具行为和精确重提交能力；不依赖旧 shim 才能结算。

**退出条件：** 不装 CLI 的开发/打包环境中完成文字/形状海报、人工修改后继续、取消、无产物问答、冲突保稿、保存版本、重开和导出。执行成功与提交失败能分别显示；缺 Key 只阻止 Agent 发送，缺图片连接不阻止以上旅程。M1 通过后才扩展产品切换，不据此删除旧配置或启用所有用户迁移。

### B06：扩展 Provider 和多连接

**执行内容：** 完成 OpenAI/Anthropic/Google 端到端，再按相同契约增加 xAI、DeepSeek、Moonshot/Kimi API、智谱/Z.AI、MiniMax、OpenRouter、高级兼容入口。每项记录官方 endpoint/区域/认证产品、Pi provider 映射和能力来源；实施时查官方资料，不复制过期模型名。

隔离 runtime、目录与 endpoint；目录刷新有 deadline，仅访问批准来源；没有明确模型就拒绝。配置快照保护当前调用；压缩、摘要及插件受管请求使用同一连接审计，展示真实 usage 与未知费用。有限传输重试绑定同一请求语义，不自动 replay turn/tool。

**退出条件：** 同厂商双连接并发、Key/endpoint 变更、401/429/断流、图像模型/非视觉模型、未知费用均有契约证据。每个声称正式支持的 preset 至少一个明确模型有真实记录；无账号者列 blocked，不能把兼容协议测试转记成厂商真实验证。

### B07：通用 MCP 管理

**执行内容：** 从现有 workspace catalog 和驱动 turn 的 `mcpServerIds` 解析，保留 `[]`；Secrets 在 host 侧按 server 注入。复用独立 host、stdio/HTTP 鉴权与 Session 上下文，保持两阶段启动解析。通用 bridge 处理 tools/list 分页、稳定别名/顺序、schema hash、来源映射、变更通知、撤销、deadline 和子进程所有权。

运行中撤销拒绝缓存调用，变更 schema 不重新指向同名工具；新集合仅下轮启用。第三方 stdio 明确展示命令与运行环境需求；不承诺其零依赖。未实现的资源/sampling/elicitation/OAuth/task 能力按兼容原因报错。

**退出条件：** 同名工具不串 server，分页不遗漏，单 server 断连不影响其他 server；撤销、重连和迟到权限不能突破当前快照。取消、关闭有上限；无外部 MCP 不阻塞基本设计。HTTP 继续 loopback 鉴权，不新增未认证本地控制面。

### B08：图片、操作记录与完整设计回归

**执行内容：** 复用已有 generate/edit 传输和素材持久化，增加外部图片声明式绑定、统一结果导入及操作持久记录。操作在发送前落盘；每个逻辑请求关联 run、授权范围、connection revision、工具版本及结果。付费请求无法确认结果进入 outcome_unknown，恢复只查询原请求/取回素材；不以参数哈希禁止用户有意重复生成。

导入验证 URL/base64/image/resource 来源、MIME/真实编码、尺寸/字节上限、重定向、下载时间、路径和 mask；不把远程 file URI 变成任意本机读取。编辑冻结目标与输入顺序。已有图片 HTTP 180 秒、Pi MCP 210 秒和取消投递 30 秒作为初始链路基线，核对 SDK 默认值和所有层级，不机械叠加成不可控等待。

**退出条件：** 合成断网、响应丢失、超时、取消、重复事件和迟到成功不产生自动第二次付费提交；素材恢复不重启 turn 或直接改 canonical。完整回归海报/信息图/长图、选中图替换、原图 edit、mask 支持/明确拒绝、历史、重开和导出。真实 generate/edit 只在给定预算内执行；一次任务默认总计最多五次，失败也计入调用记录，不隐式追加。

### B09：受管社区扩展

**执行内容：** B00 候选按当前设计需求选择，审核许可证、版本、SDK/TypeBox 依赖、资源、固定 hook 顺序、工具重名、路径、网络、Key、spawn、自更新及后台任务。至少一个实际社区扩展锁到准确版本/commit，必要补丁有来源与摘要；审核失败选择其他候选，不能以自研空壳冒充社区验证。

GUI bridge 只适配该扩展实际需要的确认/选择/输入/通知/工具元数据。Slash commands 分为只读、改配置和触发执行，分别服从宿主权限及安全边界；不把流式任务中的命令当普通 prompt。付费直接请求改为受管调用或拒绝预装；扩展启用变更待空闲后重建 worker。

**退出条件：** 真实扩展在 SDK worker 中加载、持久状态隔离、恢复、取消、禁用和失败处理通过；不触及用户 Pi 状态，不覆盖核心工具。窗口关闭/超时拒绝授权；TUI 不兼容明确报错。生产默认启用依实际需要确定，验收一个扩展不扩成插件市场。

### B10：补齐用户界面

**执行内容：** 在既有设置框架中完成模型连接、图片/MCP、内置能力、执行/隐私；composer 展示连接/模型/真实思考能力及权限。移除新配置的 CLI 类型、命令、runtime path、下载和订阅登录；保留旧来源显示供 B11 接入。

连接保存、认证/连通、MCP handshake、工具发现、generate/edit 就绪分别显示；付费测试明确其成本。等待用户显示等待状态，取消关闭确认，迟到回应无效。明确认证、额度、网络、能力、权限、冲突和远端结果未知；不将“render 成功”显示为“模型看过”。

**退出条件：** 空配置用户完成最小 BYOK 引导；无模型/无图片仍可手改保存；运行中改 Key/模型/工具不会偷偷改变当前快照。组件验证加 built Electron 旅程，必要截图交人审，不以组件快照替代真实行为。

### B11：旧会话、Role 与回滚

**执行内容：** 使用版本化幂等迁移，保留旧 AgentConfig/Role 来源并标记不可执行；迁移偏好只处理语义明确的非秘密字段。旧聊天、文件、素材、候选历史和 Git 内容只读兼容。显式“用 Molly 继续此设计”创建新的产品执行上下文/Pi native session，关联同一 artwork 和来源 Session，不复用旧 native identity。

新上下文带入明确的当前设计、可信附件和可追溯历史摘要；历史工具调用永不重放。每一步有持久标记，恢复不重复创建连接/Session；失败保留旧记录。回滚先验证旧二进制能否读取新 schema；不能时只读打开或恢复受保护迁移备份，不能把新画布回滚为旧画布。B03 秘密不复制回旧明文配置。

**退出条件：** 各写入边界中断重启、重复迁移、缺失附件、旧 Role、旧 native 历史损坏及重复点击继续均可观察。新会话只能选择内置 Pi；历史检索无需启动旧 CLI。现有画布/素材/草稿/历史不搬迁、不删除，外部 Pi/Claude/Codex 配置不变。

### B12：关闭所有旧执行路径

**执行内容：** 以 B00 入口清单逐项在宿主后端拒绝 legacy 执行，覆盖聊天/任务/Role/Operation、准备/恢复/重发、程序化 Session 创建、能力探测、认证、标题及历史 catalog。受管任务中的旧配置失败要给出可迁移原因，不能自动换引擎执行旧任务。

核对 `setting.ts`、`acp-runner.ts`、`session-manager.ts`、`acp-capabilities.ts`、`acp-authentication.ts`、`title-generator.ts`、`history-session-catalog-client.ts`、`lib/lody.ts` 自动注册和 `task-automation`。关闭 registry/custom/runtime override、下载/预取/登录链；再按消费者移除旧 shim、adapter 依赖、构建/打包资源和文案。保留共享 ACP core、通用任务、MCP 与历史解码；Kimi 子模块不得并入根 workspace。

**退出条件：** 直接调用后端、遗留 Role/任务、深链、恢复和残留环境变量均无法产生外部 harness 进程。正式产物不存在可开启旧路径的开关；开发灰度仅用于过渡。依赖锁、资源 manifest 和安装包探针一致；不清理用户 CLI 或默认删除旧 Molly runtime 缓存。

### B13：冻结发布候选并验收

**执行内容：** 冻结 source commit、lock 摘要、runtime manifest、安装包摘要及测试环境；复用现有 Electron harness 的 installed executable/source identity 校验。macOS arm64 验证干净安装、无全局运行时、污染目录、与受控本地 Pi 并存、独立升级/卸载、凭据、设计与恢复。Windows/Linux 做目标构建与资源探针，另列未进行原生用户验收。

真实 Provider/MCP 验证按获授权连接和预算执行；视觉由人工检查可编辑性、布局、选图替换及旅程。黄金参考/固定提示词可复用，但新 Pi 的具体 model/thinking 与费用条件必须明确，不能把旧 Kimi CLI 证据改名。失败后的修复形成新构建/新验收轮，不覆盖失败记录。

**退出条件：** §6 全部有可追溯结果，附件 DoD 12 项逐项映射证据；required checks、原生安装包、真实服务和人工视觉分别判断。更新 Spec/本笔记、模块 README、用户配置/恢复/卸载帮助与依赖许可；已知未验证项仍开放。发布、签名/公证和更新渠道不是“测试通过”自动获得的结论或权限。

## 6. 验收用例与证据模板

| 原用例             | 主要归属           | 必须观察的结果                                                       |
| ------------------ | ------------------ | -------------------------------------------------------------------- |
| A01 干净安装       | B02、B13           | 固定 worker 可启动；无隐式 runtime 下载；离线手改仍可用。            |
| A02 配置污染       | B02                | 上下文/插件/Key 不被默认扫描或继承。                                 |
| A03 并存/升级      | B02、B13           | 配置摘要、PID 所有权、安装边界独立；不使用用户真实安装做破坏性测试。 |
| A04 双连接         | B03、B06           | 合成请求记录中 Key/endpoint/模型正确归属。                           |
| A05 Provider 异常  | B04、B06           | 错误、截断、取消不会假成功或切换账号。                               |
| A06 真实图像输入   | B05、B06、B08      | 模型请求实际包含图像；无视觉能力明确显示限制。                       |
| A07 MCP 工具集合   | B07                | 分页、同名、撤销与 schema 变化都有稳定路由/拒绝证据。                |
| A08 生成/编辑      | B08                | 原图顺序/mask/模型正确；素材回执可追溯，应用走设计事务。             |
| A09 付费未知结果   | B04、B08           | 同一操作不重复派发，unknown 和迟到素材不触发新 turn。                |
| A10 资源攻击       | B07、B08           | file URI、越界、重定向、超大/伪 MIME 被拒绝，秘密不外发。            |
| A11 运行中配置变更 | B03、B06、B07、B10 | 本轮快照稳定、撤销生效、下轮 revision 明确。                         |
| A12 重复/迟到事件  | B04                | 同一终态/提交不重复，旧 epoch 与迟到授权无效。                       |
| A13 崩溃恢复       | B04、B08           | 区分未派发、派发未知、执行完成/提交未确认，不重放副作用。            |
| A14 社区扩展       | B09                | 实际锁定扩展加载与恢复通过，状态隔离且 UI 诚实。                     |
| A15 秘密扫描       | B03、B13           | 新写入无 canary 泄露；历史秘密残留单独披露和处置。                   |
| A16 设计旅程       | B05、B08、B13      | 人工编辑、预览、冲突、历史、导出、重开和视觉检查分别有证据。         |
| A17 迁移重入       | B03、B11           | 记录与素材保留，不重复创建、不伪造 native 身份。                     |
| A18 旧入口绕过     | B12                | UI 外的直接后端请求也不能启动 legacy。                               |
| A19 取消清理       | B02、B04、B07      | 实际状态、子进程、连接/句柄的有界释放。                              |
| A20 性能稳定性     | B00、B13           | 同条件样本/分布与预定阈值；本地开销和远端延迟分开。                  |

每个结果保存：用例/批次、source commit、安装包摘要、manifest/引擎/插件、OS/架构/实际 Node、Provider/preset/模型/能力来源、MCP transport/schema、pass/fail/blocked/not_run、观察到的状态与回执、失败归属、限制。付费项另列 operation/request ID、结果与已知费用或未知。证据使用合成数据及脱敏摘要；禁止提交原始用户/Agent transcript、Key、敏感 endpoint 或认证头。原始测试产物沿用被忽略的 `e2e/artifacts/`，可公开摘要写入所属笔记。

### 6.1 检查命令与执行时机

以下命令已核对当前 package scripts；在真正实施批次执行，不代表本轮已运行：

```sh
# 每轮开始与文档结束
pnpm run docs status
pnpm run docs check

# 实施开始安装依赖；不在嵌套 checkout 安装
pnpm install

# 按批次选择模块测试（文件级缩小范围时使用实际测试路径）
pnpm --filter @molly/shared test
pnpm --filter molly test
pnpm --filter @molly/components test
pnpm --filter @molly/electron test

# 每次准备代码提交前的仓库要求
pnpm check
pnpm format
git diff --check

# 包/平台组合变化；构建与本地安装包分别验收
pnpm check:public-boundary
pnpm build
pnpm build:electron:mac
pnpm build:electron:win
pnpm build:electron:linux

# E2E 元数据变更及 harness/活动 P0 变更
pnpm e2e:check
pnpm e2e:build
pnpm e2e:smoke
```

不在每个文档批次跑全套 runtime 测试。B02/B12 的打包变化补所有受影响目标探针；B13 还需 installed acceptance，源码 smoke 不能代替。`pnpm format` 后审查无关改动；若产生实质代码变化再跑对应检查。新 `harness-pi` 包脚本在建立包后补齐，不在当前计划伪造已有命令。

基线失败记录保持可见，定位为既有/本次引入/外部/未知，不能删除断言或只写“check 已知失败”跳过其余检查。通过文档检查不代表产品正确、性能达标或 Spec 获批。

## 7. 切换、回滚与未决输入

开发过渡开关只在 B02–B11 的开发构建使用；B12 正式编译产物不保留旧路径 fallback。单批失败可撤回尚未启用的新入口；进入存储迁移后按显式 schema 恢复流程处理，不通过 Git 回退二进制就假定数据已回退。不降级写入新数据，不移除旧历史，不重新执行付费操作。

需要在对应批次结束前解决的输入如下，当前编写计划不因此停工：

| 输入/结论                                          | 最迟批次    | 未就绪时行为                                       |
| -------------------------------------------------- | ----------- | -------------------------------------------------- |
| 引擎依赖闭包、实际包内 Node/资源与公开 SDK 边界    | B02         | 合成探针未通过则不启用 worker，不隐式换引擎版本。  |
| SecretStore 取用通道、旧秘密历史与备份处置         | B03         | 新凭据路径保持关闭，先完成可验证迁移/残留说明。    |
| 首个及各目标 Provider 的账号、模型、外发授权与预算 | B05/B06/B13 | 继续模拟；真实支持项保持 blocked，不宣称整体通过。 |
| 实际社区扩展及兼容范围                             | B09         | 按需求审核候选，至少一个通过才完成 T10。           |
| 新 Pi 黄金用例的连接/model/thinking 与人工视觉判断 | B13         | 保留旧 Kimi 证据，新用例 not_run/待人审。          |
| 公开发布与真实签名/公证、更新渠道条件              | 发布前      | 可形成本地候选，不公开发布。                       |

## 8. 取舍与相关决定

沿用 ACP 可复用现有 UI/会话/权限，但 adapter 必须弥补原生结算信息，不能直接接受旧 pi-acp 的成功语义。SDK 独立进程增加打包与依赖审计工作，换取不依赖用户安装；不同时重写通信协议或自建模型 loop。资源封闭加载降低社区兼容范围，但符合本地隔离目标；任意原生插件及强沙箱仍不在本次范围。

本计划是下列决定的后续补充或局部替代：

- [范围收敛](../simplification/2026-09-11-design-result-feedback.zh.md)：保留自主创作、渲染/看图、回执及既有编辑能力；新增引擎/BYOK/受管扩展属于本次显式提案范围。
- [既有 Pi hooks](../../implemented/architecture/2026-09-11-pi-design-hooks.md)与[Pi MCP 扩展](../../implemented/architecture/2026-09-12-pi-geon-mcp-extension.md)：保留提醒、原生结算和取消语义，后续替换外部 shim/特定工具加载路径，不把旧验收转为新 worker 验收。
- [上游采用计划](../process/2026-09-17-lody-upstream-adoption.zh.md)：本次自有 SDK worker 并非仅升级 builtin Pi ACP；多 Agent 兼容目标在 B01/B12 按新范围明确调整。
- [统一画布与版本](2026-09-18-version-based-canvas-editing.zh.md)：复用设计数据和旅程；本计划不重写该决定或覆盖其尚待完成的人审。

## 9. 规划与实施验证记录

已读取附件、相关 Spec/作用域规则/active notes、启动与设计模块说明，核对实际源码字段、入口调用点与脚本，并查询固定 Pi 版本的官方包/SDK 文档。已执行 `pnpm run docs status`、`pnpm run docs check` 和文档差异空白检查；文档检查零错误，18 条既有 AGENTS 大小警告，未注册 SHA 保护主题。两份新文档保留 proposed/draft 与 translation pending，不刷新任何审批或保护基线。

以上为最初规划阶段记录。当时未安装依赖或运行产品；随后用户授权完整实现，新增证据如下，不能将两阶段混为一次完整验收：

- 全仓 typecheck 通过；lint 初次发现 10 个本次新增问题，修复后零错误（既有警告未清理）。i18n、Code Collab imports、platform/public boundary 通过。
- harness 35 项、components 3069 项、Electron 156 项通过。宿主/Session 配置和 MessageHandler 定向 146 项回归通过；构造时绑定 broker 曾破坏旧测试替身，已移到受保护 main-host 首次交换，未以可选调用掩盖缺少生产接线。
- `pnpm check` 未整体通过：typecheck 后先被上述 lint 问题阻断；修复后 `test:ci` 在既有 design-authoring Git lineage 断言失败处停止（136/137 通过）。未删断言，也未将后续步骤视为已由总命令执行。
- 单独运行 shared 全套时 1205/1212 通过，其余 7 项因沙箱禁止监听失败/超时；获准在沙箱外重跑这两组及新共享合同，18/18 通过。CLI 全套初次 2569 通过、186 失败、9 跳过，包含当时 broker 测试替身问题、沙箱限制及未修改的既有环境问题；修复后对应 MessageHandler 用例通过，另对 6 个本地网络/IPC 文件获准重跑，32/32 通过。未把这次分组重跑声明为 CLI 全套已全绿。
- CLI production bundle 已重建，逐资源 manifest 检查和实际 Electron runtime 离线 ACP smoke 复验通过（build `287879b02c8998b9f116492c66648adcd4abdf09830aec30d66f62050db0b5bb`）。新增撤销后迟到成功/退出未确认回归后，host control、broker、config applier 与旧 Pi MCP 合计 26/26 通过。完整应用安装包、Windows/Linux 目标、真实 Provider/MCP、旧秘密迁移、社区插件和人工视觉均未执行。
- 另单独复现未修改的 `cli-platform.test.ts` 1 项环境失败和 `machine-lifecycle-upgrade.test.ts` 2 项失败；后者试图写真实用户 `.molly` 而不是其临时 fixture，本轮没有为它扩大写入权限。保留失败供后续隔离修复，不声称整体通过。
- 本次源码和文档做了定向 Prettier 格式化，未运行会覆盖无关目录的全仓格式化。最终 lint 零错误、docs check 零错误/18 条既有大小警告，`git diff --check` 通过；按 writing-for-agents 将进度和实现边界留在所属文档，作用域规则只增加必要合同。

最新接线增量完成后，Harness 40 项和两个设置组件 21 项再次通过；CLI/shared/harness/components/Electron 类型检查通过。lint 零错误、11,271 项警告；修正图片设置错误文案缺失的翻译键后 i18n 通过，Code Collab/platform/public boundary 通过（public：4,523 文件、25 manifests）。定向 Prettier 检查和 `git diff --check` 通过。锁文件使用 pnpm 自身规范化，避免保留通用格式化造成的无关变更。

CLI 生产构建及同步资源通过，Electron/Bento/main/preload/renderer 构建通过。首次 Bento 构建因沙箱禁止临时 worktree 登记失败，提升权限后仅重跑构建完成，没有启动应用。重新生成与当前 lock 对齐的闭包后，用实际 Electron Node 执行离线 ACP 启动再次通过：Pi 0.85.1，darwin/arm64，build `10fc061e309f240b43151c439f0d6f13bcddd8dc34e8e8ce288584e999e5ed3d`，212 依赖实例、13,749 资源。该结果不是原生安装包或真实 Provider 验收；本次未重跑已记录的全仓 `pnpm check` 基线失败。

完整方案仍在实施，B00–B13、A01–A20 和原 DoD 未整体关闭。真实模型、生成、编辑、原生历史恢复和工具看图已有证据；基本可编辑海报的辅助纠错续改、预览读取、提交、人工编辑、版本、PNG 和重开已分别验证。完整设计矩阵、外部 HTTP MCP 真实验收及远端素材恢复、社区扩展、旧记录显式迁移与旧执行入口退役仍开放。资源桥接、文件/命令权限显示、可定位格式诊断、MCP 加密设置与运行准备均已进入当前桌面构建；受保护本地 stdio MCP 已通过原生设置、两轮单次授权及重启恢复验证。严格图片解码、统一内置/外部内联导入及本地只读恢复已部署；真实新内置素材的列举和摘要核验通过，canonical 未改变。外部资源链接导入与等待授权时 Stop 已完成源码/合成检查，尚待解锁后的桌面部署和原生验收。真实请求累计文本 **45**、图片 **3**；用户已取消这两个既有模型的调用次数限制，继续按需使用，不再次索取 Key。其他账号/服务不因取消次数限制而自动获得授权。
