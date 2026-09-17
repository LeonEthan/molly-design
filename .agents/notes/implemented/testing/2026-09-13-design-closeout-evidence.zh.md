# 设计首批收尾：证据边界与回归修复

Status: implemented
Translation: pending

## 摘要

本次核对将历史票据中的旧读证明要求与当前非侵入式 Agent 合约分开，并复用已有人工评价。Daily 的失败包括 Windows 文本换行、macOS CLI 构建堆内存、Review 合成仓库被运行时技能污染，以及退出时过早检查子进程；报告器还使用了 Actions token 不支持的附件上传。修复保持原场景断言，并通过 Actions artifact 链接保留录像。另一个确定性并发测试发现等待历史锁的操作可能沿用恢复前的当前稿，现于持锁后复核版本；这不扩大到任意外部文件系统操作的原子性保证。本地完整桌面回归和安装包验收已通过；Windows 归档的原生重复关闭另见下文。远端三平台 full Daily 与主分支集成依各自执行记录确认，不由本地包验收推导。

## 有效标准与证据归属

当前行为遵循 [编辑器拥有当前 PPTD](../simplification/2026-09-12-editor-owned-pptd-save.md)；历史生成级读证明、候选流程和自动重试不再构成验收标准。
GitHub #20、#21、#22、#23、#24、#25、#30 已增加当前标准和历史证据边界、保留旧正文，并按以下具名证据关闭。#7、#19 由维护者关闭为已被替代；#1 保留历史设计讨论。

2026-09-13 人工确认以下共用工作台项目全部通过：宽窄窗口、Focus/Properties 切换、深浅主题、中文输入法与弹窗焦点、参考图粘贴与拖入。与此前三个已通过的创作场景一起复用，无需重复人工评价。此项只证明已检查的界面体验，不代表后来安装包的二进制身份、Agent 负路径或持续集成已验收。

## Daily 修复及边界

证据来源为 [Daily 34744650650](https://github.com/LeonEthan/Geon/actions/runs/34744650650) 与 [报告器 34744902156](https://github.com/LeonEthan/Geon/actions/runs/34744902156)。

- Windows 的 PPTD 示例逐字节校验失败可由 LF 转 CRLF 精确复现；两个上游来源目录固定文本 LF，二进制保持自动识别。
- macOS 在 CLI Vite 构建阶段堆溢出，尚未执行界面测试；Daily、PR smoke 与 Scout 构建步骤提供 8 GiB 堆预算。
- Linux Review 期望三个源码文件却得到 27 个，新增项来自运行时技能。仅合成仓库的本地 exclude 排除两个技能目录，保留原三个 diff 断言。
- 退出后立即探测 PID 可能先于渲染进程结束。等待捕获的所属 PID 消失，有界超时仍失败并保留数据；不通过终止其他进程或删除证据使测试通过。
- Daily 报告器使用标准 Actions token 发布已验证录像的 artifact 链接，不增加个人令牌或权限。PR 报告器的既有默认模式未改变。

## 历史跨实例竞争

[原历史设计](../feature/2026-09-12-design-version-history.md) 使用独立 Git 历史锁与当前稿 CAS。新测试用显式屏障冻结等待操作，让另一调用恢复版本，再释放等待者；等待者必须返回 DESIGN_CONFLICT，恢复后的当前稿与恢复前保护版本都保留。移除持锁后的版本复核时测试失败，恢复修复后通过。另以两个独立 Node 进程和 IPC 屏障复现同一竞争：等待者返回 DESIGN_CONFLICT，恢复结果及保护版本保持正确，两个进程均以 0 退出。该证据不声称覆盖所有进程崩溃或锁失效路径。

引导页在当前设计中已由“跳过介绍”直接进入 Agent 配置。旧 Page Object 仍等待已移除的 Configure 按钮，现删去该过渡断言并保留配置页、摘要页及最终输入框的可见性断言。修正后完整桌面回归 4 场景、25 步骤通过。

## 验证状态

本机 provider 环境变量会影响两项 Claude 认证状态测试；清除认证及路由变量后，31 项认证测试全部通过，不修改运行时认证行为。

已完成本地完整构建、Daily 报告器测试、E2E 静态及支持层检查、历史六项测试和上述断言消融。隔离 provider 环境下的全仓 pnpm check、pnpm format 和 docs check 已通过。实际 Daily、最终包身份及本轮安装验收结果见下文。支持范围仍以 macOS arm64 首批设计验收为限；签名、公证及公开分发属于 #32，不能从本地打包推导通过。

## 最终安装包补验（2026-09-13）

运行时代码提交为 `5e070c00e4e046c1a184230ffa66a6911242aacb`，版本 Geon 0.1.0，macOS arm64，Electron 39.5.1。从经校验的 DMG 只读挂载、复制到独立目录后启动；Harness 核对 packaged 状态、包内提交标记和隔离路径。

- DMG SHA-256：`4b1b558f319d9cc7ed83eff856364574d014a6b7129bf0e7b69aa391b1a3995c`。
- ASAR SHA-256：`c0854a889251b0793c156c2d6b7d6bf742eb8e03829acb1f36e11cefd55e6507`。
- 可执行文件 SHA-256：`921b236e9b504826d2088296cecc78791d16f77b05815133d86148ab502ca29a`。
- 本地验收包采用 ad-hoc 签名、关闭 hardened runtime 与公证、禁止发布。首个包保留失败：ad-hoc 与 hardened runtime 组合导致 Electron Framework Team ID 不匹配，尚未进入应用。第二个包消除此打包配置问题，不修改正式发行设置。

| 路径 | 本轮结果及证据 |
| --- | --- |
| 完整桌面回归 | 4 场景、25 步骤通过；本地记录 `/tmp/geon-batch-installed-full-evidence`，包含启动身份与进程退出记录。 |
| 图片服务设置 | 空模型及含凭据 URL 拒绝，显式模型保存并重启恢复，密钥不回显，关闭的 loopback 地址明确报错，移除密钥禁用测试；`geon-settings-final-tw6bo9/evidence/result.json`，全部通过及正常退出。 |
| 原生画布 | 创建、编辑、隐藏后的 undo/redo、重开、过期宿主、提交同步、冲突保留、退出保存失败、独立副本、多实例保稿、PNG/JPEG 导出通过；`geon-batch-p1-final-2/evidence/result.json`。首次探测仅因 `/tmp` 与 `/private/tmp` 的隔离路径字符串不同失败，使用真实绝对路径后执行。 |
| 预览与导入 | 自动依赖/重命名/同路径素材更新、无效结果保留、晚到结果丢弃、执行期间只读、预览不保存、当前稿及 undo 保持；导入精确快照、活动实例拒绝、幂等、过期版本/素材/flush 失败保留当前稿通过。 |
| Codex 当前合约 | Native 0.153.4，哈希 `b973d440acac501fd2594a43e7ca9ce41e0a65b9dfb28d0d7a7837c99e1261e3`；公开提醒、完整当前稿读取、草稿写入及 committed 回执通过；`folio-t28-codex-current-BTSE6L/evidence/result.json`。前后完整版本分别 `a116f26b4a4c4d0e505aa6c1994b58ffe213aedbbf5de6122eddda3f4a5d70f7`、`ce4c3349b7508e9519763501cf24098ccc0afbefa0ffd7263ffb66c8c69848ed`。 |
| Grok 当前合约 | Native 1.0.13，哈希 `8669e0fdadceec25b8c159c355f427ffbd82583525d774b6ab1522197ea83b80`；实际提醒、读写、提交、最终原生画布及退出通过；`folio-installed-grok-stop-v2-2AsI5U/evidence/result.json`。本轮 `YjqjR1` 首次仍因未分类的 dashboard 摘要失败；只为已观察的精确摘要请求补充合成响应后重跑，保留原失败。 |

这些原生轮次仅模拟外部模型响应，不新增付费生成/编辑，也不替代已通过的真实图片与人工视觉评价。普通原生权限/取消证据与共享 collector 的 schema/replay/assets/CAS 测试分开归属；不将共同的提交检查误述为各 Agent 的全路径工具拦截。

远端 full Daily：[34763398667](https://github.com/LeonEthan/Geon/actions/runs/34763398667)，源提交与上述包相同，macOS、Linux 通过；Windows 已通过依赖、逐字节校验及构建，但启动场景时 package script 的 POSIX 单引号被 cmd.exe 当作普通字符，导致 `or` 和 `@P1` 成为文件参数。full 改用跨平台双引号，smoke 的单一标签去掉多余引号；这是测试入口修复，不改变包内运行时代码。其结果与本地安装验收分别记录。


### Codex 原生权限与取消补验

同一最终安装包的 `folio-t28-codex-input-BTrZmu/evidence` 通过原生图片字节输入、技能读取、真实取消选项与单次许可、Stop 连接关闭及显式新消息继续。拒绝后的文件保持原样；许可后仅写入预期的合成文件。请求 9 的 `response-close` 发生在测试服务清理之前，10 个请求结束后服务排空，Harness 正常退出。保留 `permission-NO-native-from-next-turn.json`、`permission-YES-native.json`、`native-cancel-transport.json`。

前序适配失败轮 `Vp2Nke`、`67Nfkd` 将新旧标题包装误认为主请求；`TxibZ2` 的无名称 combobox 选择器同时匹配消息与版本历史；`083iO6` 使用了仅属于新会话页的输入框 ID。最终脚本用独立首行标记识别主请求、显式识别标题格式、选择当前会话 textarea，保留实际权限及取消断言。上述失败不被覆盖，不改变产品运行时。


### Kimi 负路径及共享提交边界

同一最终包的 `folio-t28-kimi-input-mNN8fM/evidence` 使用固定 Kimi 0.39.1-lody.f255222661c9，原生图片与技能读取、Reject/Approve once、请求 9 的真实 `response-close`、显式新消息继续和正常进程清理全部通过。当前 PPTD/公开插件/collector 成功复用 `IovONp` 轮完整回执；公开插件是用户主动登记的条件支持，不推导任意未登记环境中的提醒投递。

Claude 与 Pi 的修订合约成功/失败/取消继续，复用五 Agent owning note 中具名的安装轮；Pi 后续 `81d54b6` 成功清理与 `dcc3c975` 冷安装/重提交替代对应旧故障的当前结论，原失败仍保留。Grok Stop/full-close/explicit-load/read 复用已审计的 v7 原始证据，本轮补齐其当前稿的最终画布断言。

同字节显式重提交、最终版本冲突、重复收集和取消/失败保稿由共享 `turn-outcome.test.ts`、`sync-service.test.ts`、`store.test.ts` 归属；本轮全仓检查已执行这些断言。各 Agent 提供真实输入、原生工具/权限/取消及进入 collector 的证据，不能以共同检查声称未有证据的原生 Shell 全面拦截。保留限制是既有历史锁失效窗口、各 Agent 原生工具能力和 opt-in 插件条件，而不是恢复已退休的逐 generation 读证明。


### 干净检出中的文档证据链接

PR 静态检查发现此前停止追踪 output 后，14 处历史证据本地链接在干净 CI 检出中失效。本地未追踪文件掩盖了该问题。将这些链接指向删除前、已发布的固定提交 `8bac4b433a3c7ac38ddd5be14b315363c75a8f92`，逐项用 Git 对象确认目标存在；不重新追踪生成产物、不改变历史验收结论或 Spec 的批准含义。以源码归档和精确固定的四个 submodule Git 对象重建干净递归检出后，docs check 通过；同时通过 PR base 检查。


### Windows 原生测试 Agent 命令

第二轮 Daily `34764016494` 的 macOS/Linux 通过，Windows 引导通过，另外三个场景在测试 Agent 探测失败。截图显示未加引号的 Windows 路径；确定性 round-trip 测试复现反斜杠被产品 POSIX 风格解析器移除。夹具改用已有的 `formatCustomAcpCommandLine`，与实际解析器共享合约，不改变产品解析规则或就绪断言。修复前回归失败，修复后通过；此前引号修复也保持有效。


### 统一桌面 E2E 构建内存

PR smoke `34764848785` 在 CLI Vite 构建阶段复现约 2 GB 默认堆上限 OOM，尚未进入场景。Daily 已有的 8 GB 构建步骤配置同步至 PR smoke 和调用相同构建的 Scout；仅扩大构建进程堆上限，不改运行时、场景选择或断言。


### Windows 归档终端清理

第三轮 Daily `34764854085` 的 Windows 已通过 3 场景、24/25 步，剩余 Work 归档后报 `terminal_socket_closed`，同时数据同步断开、CLI 控制管道消失。单次原生 PTY 关闭在 Windows Node/Electron 下均通过；归档路径会先调用 closeSession，Session terminated 回调又调用一次。确定性测试复现原生退出通知到来前的重复 kill。服务增加关闭中标记，保留记录至原生退出；调用失败则保留记录并允许显式重试。Windows 原生双关闭探针 `34765909003` 已确认：单次关闭的 Node/Electron 宿主均返回 0；Electron 双关闭宿主以 `3221226356` 退出，未发出终端退出回执。修复后的真实服务原生探针与完整场景验证另行记录。

同时将 Work 的终端输出标记拆分在 shell 表达式中，避免命令回显提前满足就绪断言；Windows 使用显式 cmd.exe 内建 echo，以 caret 分隔标记，使宿主为 cmd.exe 或 PowerShell 时输入都不含完整标记。更严格的信号在 `5e070c0` 安装包上完整 4 场景、25 步通过。PTY 运行时修复将另行生成带新源提交身份的包，旧包证据不会被覆盖。


## 当前收口安装包（替代前轮）

终端修复后的运行时源提交为 `ffe0e91944634a942b64b7465bb646a5eb9d65d2`。前文 `5e070c0` 是此前验收包，保留其历史证据；当前包仍为 Geon 0.1.0 / Electron 39.5.1 / macOS arm64、本地 ad-hoc 验收配置，未公证且未启用 hardened runtime。

- DMG：`cb258ed4158e804e9deaf46d18bbf07e52bf6bb580913db9368acad710411fbd`。
- ASAR：`993609184b5bda46b2d5ff86b9fa08c5e24c6993e785b7c909e1036bd319ce1d`。
- 可执行文件：`cae0733128ed35027ee2955c49bebf203e63ffe855790645ea08e2919135f83a`。
- 经过 DMG 校验、只读挂载、复制安装、卸载卷，再由 Harness 核对包内源提交。完整桌面 4 场景、25 步通过；设置八项及重启通过（`geon-settings-final-DFKjxr`）；画布/预览/导入三个结果全部 passed（`geon-final-p1`）。
- 同包 Codex 当前 PPTD 原生读写、collector 提交、最终画布及进程退出通过：`folio-t28-codex-current-IadjOC`。适用的其他 Agent 原生/权限/取消路径继续按前文具名证据归属复用；本轮没有再次付费生成，也没有重复人工视觉验收。
- 终端确定性测试：修复前失败，修复后两项通过；包含重复清理和关闭失败后显式重试。全仓 `pnpm check`、格式化、文档/公开边界检查通过。
- [运行时源提交的 full Daily](https://github.com/LeonEthan/Geon/actions/runs/34766275797) 与 [PR smoke](https://github.com/LeonEthan/Geon/actions/runs/34766272803) 保留独立 CI 结论。默认分支 full Daily 成功之前 #2 保持打开。

本机交付目录：`/Users/macmini/GeonReview-ffe0e91-20260913`，保存 DMG、校验值及当前包验收证据。公开分发仍归 #32，不把本地安装包通过等同于正式签名、公证和更新发布通过。

`34766275797` 的 macOS/Linux 通过，Windows 原生 PTY 服务探针通过；完整场景停在新加入的真实输出断言，因为宿主为 cmd.exe，不能直接执行 PowerShell 表达式。明确启动 PowerShell 修正此夹具假设，保留该失败；不放宽输出或资源释放断言。

`34766828689` 的 macOS/Linux 和 PR checks 通过；Windows 接受嵌套 PowerShell 命令后 30 秒未输出，仍停在终端就绪断言。该场景仅验证命令执行和清理，改用显式 cmd.exe 内建 echo，保留失败记录，不推导任意嵌套 Shell 支持。原生服务探针使用相同的 caret 标记构造，继续要求真实退出。
