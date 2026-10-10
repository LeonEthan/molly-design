# 保留 Electron 时的通用 Agent 浏览器驱动候选

Status: proposed
Date: 2026-10-10
Translation: pending

## 摘要

在保留 Electron 和可见内嵌页面的前提下，建议先适配现有 Playwright/MCP 的通用能力和按需观察，再以 agent-browser 原生 Rust 驱动作最有力的替换对照。当前锁定的 MCP 已提供页面搜索和局部/深度快照，只是 Molly 尚未开放；Pi 也已有代码组合，因此不能把旧七动作或默认 MCP 的冗长输出当作成熟方案的上限。agent-browser 0.39.0 的 macOS arm64 二进制为 15.07 MiB，与现装 Playwright 相关依赖 15.30 MiB 接近，尚不支持明显缩小 DMG 的预期。其现成 Agent 接口可能减少自有封装，但需要新增传输与运行生命周期适配；其他候选分别面临依赖闭包、扩展兼容或重复 Agent 运行时的取舍。结论来自源码与分发数据，尚未进行候选集成、任务成功率、内存或 DMG 对照。

## 范围与证据等级

后续决策：维护者已选择 agent-browser + WebMCP，并要求直接形成实现方案，不再进行候选对照测试。当前设计以[实现方案](../../implemented/architecture/2026-10-10-agent-browser-webmcp-implementation.zh.md)为准；下文的候选排序和比较建议保留为选型前的研究依据，不再是实施前置条件。后续方案补充了 Electron 44.7.0 的协议依据，以及单次发送、WebMCP 非破坏性结果读取、ref 元数据三项原生适配要求。

这是[ego 调研](2026-10-10-ego-lite-browser-replacement.zh.md)之后的不同决策：Electron 继续承担 Molly 界面、Bento、渲染和桌面能力，研究对象是网站自动化驱动。换驱动不移除 Chromium，也不自动移除仍服务于内嵌 profile 的登录导入依赖。通用 Agent 的页面读写、代码执行、文件与多页能力可以重新设计，旧七动作不是本提案的能力上限。

以下“已核验”指公开源码和发布元数据；“厂商主张”指项目自己给出的比较；“推论”指这些证据对 Molly 的意义。没有安装依赖、执行第三方浏览器、读取个人 profile 或修改运行时代码。研究日为 2026-10-10，引用使用固定提交；公开 registry 的 latest 值只代表该日查询结果。

| 候选                | 查询到的版本与固定源码                                           | 许可及实际定位                                               |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| Playwright CLI      | npm 0.1.22；`b85c7a736bb473bf55b584e54a09ffa698d6d871`           | Apache-2.0；Playwright 的 Agent CLI/Skill 接口               |
| Stagehand           | npm /源码包 4.2.0；`1fc884992b68a0196ea5c6e96cc29924b0922ef4`    | MIT；浏览器扩展 runtime、SDK 与自然语言 API                  |
| Puppeteer-core      | npm 25.13.0；本轮核对 registry 和官方 API                        | Apache-2.0；可连接既有浏览器的自动化库                       |
| agent-browser       | npm / tag 0.39.0；`44af39842650f0bb9c1afb7354df9a82921d4f09`     | Apache-2.0；Rust CLI、daemon 和 MCP，直接驱动 CDP            |
| Playwriter          | npm /源码包 0.8.0；`525732a474a14224d46469c2b85737dbcdc23e07`    | 仓库 MIT；Node 代码执行环境、Playwright fork、扩展或直接 CDP |
| browser-use         | PyPI /源码包 0.13.11；`c75e8476e26d18b7617643bc2ae082fae8eae431` | MIT；Python Agent、CDP Actor 与委托给 Browser Harness 的 CLI |
| Chrome DevTools MCP | npm /源码包 1.10.1；`f08dbe152502d66e75fa07fb2588dc0feb42bc20`   | Apache-2.0；Puppeteer 驱动的 MCP/CLI，偏调试与性能分析       |

版本证据：[agent-browser](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/package.json)、[Playwriter](https://github.com/remorses/playwriter/blob/525732a474a14224d46469c2b85737dbcdc23e07/playwriter/package.json)、[browser-use](https://github.com/browser-use/browser-use/blob/c75e8476e26d18b7617643bc2ae082fae8eae431/pyproject.toml)、[Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/f08dbe152502d66e75fa07fb2588dc0feb42bc20/package.json)。Chrome DevTools MCP 的 npm 元数据另记发布 `gitHead=e52c6b59b476c5e04d8dd9fd4bd017ba3b3d65df`，不能把所读 main 快照与发布 tarball 当作逐字节相同；本节代码结论以表中固定源码为准。

## 当前 Molly 的基线与可直接复用项

本轮保持 Electron 不变，并以继续使用 Molly 可见页面为主要比较场景；外部 Chrome 只作为不同产品路线标明。现状已经是复用 Electron 的 Chromium，没有另外打包或启动一套 Playwright Chrome。`BrowserCdpConnection` 通过 `webContents.debugger` 和固定 VS Code 适配器把获准 WebContents 及其 frame/worker 后代接到 Playwright 的内存 transport；官方 MCP server 与 client 均在 main 内，不存在另一个 Playwright daemon。通用多页会要求宿主扩展页面归属，因为当前适配明确拒绝创建/关闭 target 和 context；更换驱动不会自动完成该职责。[连接代码](../../../../apps/electron/src/main/services/browser-cdp-connection.ts)、[驱动代码](https://github.com/LeonEthan/molly-design/blob/856b8a44823e6ca964eddecb0a77ad39fd5fadeb/apps/electron/src/main/services/browser-mcp-driver.ts)

当前 Agent 只有七个动作，快照被截断到前 16,000 字符。这是 Molly 封装的能力，不是 Playwright 的上限。核查当前安装的 `@playwright/mcp@0.0.82` 文档，而非只看最新版本，已经包含 `browser_find` 和 `browser_snapshot` 的 `target`、`depth`、`boxes` 参数。因此，按需查找、子树观察、限定深度可优先适配现成能力；通用表单、文件、frame 与多页能力也应逐项复用成熟接口，保留宿主负责授权页面集合和人工接管。[0.0.82 上游工具](https://github.com/microsoft/playwright-mcp/blob/v0.0.82/README.md)、[当前动作合同](../../../../packages/shared/src/browser-agent-rpc.ts)

Molly 的 Pi 已通过原样 `pi-mcp-adapter` 支持脚本组合和每次工具调用的权限流程；普通浏览动作对 Agent 只返回 URL/title，只有显式 snapshot 才返回树，截图单独返回图像。不能把默认完整 MCP 每步返回整页树的 token 成本当作 Molly 的现状。上游在内部生成而随后被丢弃的内容仍可能消耗处理时间，但本次没有性能测量。[现有结果处理](../../../../apps/electron/src/main/services/public-browser-agent-controller.ts)、[Pi 集成](../../implemented/simplification/2026-09-28-standard-pi-mcp-integration.md)

微软的 Playwright CLI 提供按需读快照文件、局部快照、搜索和 `run-code`，这说明 Agent 友好交互可以建立在 Playwright 上。其 0.1.22 包仍依赖 Playwright 与 playwright-core，stock CLI 接已有浏览器需要 CDP endpoint 或扩展，不能直接代替当前内存 transport。优先复用它的观察模式及已存在的 MCP 能力，没有必要为了“代码组合”再安装一套 CLI/会话运行时。[固定 CLI 文档](https://github.com/microsoft/playwright-cli/blob/b85c7a736bb473bf55b584e54a09ffa698d6d871/README.md)、[依赖声明](https://github.com/microsoft/playwright-cli/blob/b85c7a736bb473bf55b584e54a09ffa698d6d871/package.json)

## agent-browser：原生引擎真实，但不是更小 Chromium

### 架构已经改变

已核验：0.20.0 changelog 明确移除了 Node/Playwright daemon；0.39.0 的 Rust `Cargo.toml` 和 `cli/src/native` 包含 CDP、浏览器管理、交互、快照、下载、网络、状态和策略实现，根 npm 包没有运行时依赖列表。因而把它描述成“Rust CLI 只是包了一层 Playwright”对本次版本已经错误。npm 的 Node >=24 声明属于包入口与安装工具链，原生可执行文件可以独立运行；但仍需一个浏览器引擎，默认安装命令下载 Chrome for Testing，不能把“无 Playwright”理解为“无 Chromium”。[版本变更](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/CHANGELOG.md#0200)、[Rust 依赖](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/Cargo.toml)、[安装与连接说明](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/README.md)

复用 Molly 的 Electron 页面时，应走连接模式而不是额外安装浏览器。预期路径为 Agent → CLI/MCP → Rust daemon → Molly 管理的 CDP 适配 → 已有 WebContentsView。原生驱动可消除这一条路径中的 Playwright JS 依赖，但新增本机子进程、平台二进制签名/分发、daemon 清理和跨进程故障处理；它不会减少 Electron 自身的 Chromium 运行成本。

### 通用 Agent 能力

| 能力       | 源码/文档支持                                                                                          | 对 Molly 的含义                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 快照与定位 | 原生 CDP 可访问性树，interactive、compact、selector 等裁剪；`eN` 引用；frame/session/document 状态关联 | 能研究其输出与引用策略；相似引用字符串不代表可直接兼容既有引用合同          |
| 页面操作   | 导航、输入、选择、滚动、等待、截图、文件上传/下载、标签页、cookie/storage、网络操作等                  | 通用能力较完整，需依据产品授权选择暴露面，而非全部透传                      |
| 批处理     | `batch` 一次提交多个命令，`--bail` 可在失败时停止                                                      | 降低逐命令 CLI 开销；不是跨网站操作的事务或回滚                             |
| 代码       | `eval` 调用页面 JavaScript                                                                             | 不等于在 Node 沙箱里获得完整 Playwright `Page` 对象；两种编程模型要分别比较 |
| MCP        | Rust 内置 MCP；core 默认含 eval，可用工具 profile 控制发现和调用                                       | 可以接现有 MCP 消费者，但默认 core 也已超出旧七动作权限                     |
| 观察与调试 | 截图、网络、控制台、追踪、可访问性审计、可选 WebMCP 等                                                 | 它不是只做极少命令的微型驱动；按实际任务裁剪输出仍有必要                    |

证据：[命令与批处理](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/README.md)、[原生快照及 iframe 引用](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/snapshot.rs)、[MCP profiles 与分发](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/mcp.rs)、[eval 执行](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/actions.rs#L5652)。

快照实现会关联文档身份，源码测试覆盖 iframe 文档或 session 变化使旧引用失效。它提供了可复用的机制，仍需在 Molly 的跨源 iframe、弹窗、重载和导航上核验；不能用功能列表代替 Electron 兼容性测试。官网所说的令牌下降，也不能直接套到 Molly：Molly 已经按需取快照，普通动作主要返回 URL/title，Pi 已可组合多个工具调用。

### Electron 接入需要新传输适配

已核验：`CdpClient` 建立 Tokio WebSocket/TCP 连接，并持有其连接与读写任务。普通 `--cdp` 路径调用 `connect_cdp`，先做 `Target.setDiscoverTargets`/`Target.getTargets`，再附着符合规则的 page/webview targets；其过滤主要排除 Chrome 内部页，并不是 Molly 的 run/session/page 许可列表。[WebSocket 客户端](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/cdp/client.rs#L194)、[目标过滤与连接](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/browser.rs#L181)、[CLI 连接路径](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/actions.rs#L5137)

同时，源码已有 provider 使用的 `connect_cdp_direct`：WebSocket 本身就是单页 session，不执行 browser-level Target 命令。因此“agent-browser 必须暴露整个浏览器”不成立。真正尚未找到的是公开 API 直接接收 Electron `webContents.debugger` 或 Molly 现有内存 transport 对象；普通 `--cdp` URL 路径也不会自动切换到该 direct-page 分支。[单页连接实现](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/browser.rs#L685)、[provider 分支](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/actions.rs#L2420)

可行适配方向有二：用 Molly 管理的页级 WebSocket/provider 代理承接现有 debugger transport；或向上游提供可插拔传输后复用该接口。二者都需证明子 frame 事件、目标生命周期、下载、网络和弹窗如何工作；并非把驱动名称或 endpoint 参数替换一下就完成。开放全局 Electron remote-debugging 端口不是必要前提，也不应作为默认集成方式。

`--pin-tab` 可以固定当前标签页；绑定页消失后返回 `tab_gone`，避免自动改控另一页。该机制有价值，但选择页面与授权调用者是不同职责：它不证明 Molly 某次运行有权读写该页面。连接外部浏览器后的 close 会断开控制连接而不关闭外部浏览器，这同样只解决浏览器所有权，不等于撤销所有已经派发的页面动作。[页面绑定和生命周期](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/browser.rs)

### 授权、接管和本地运行

项目提供动作策略、敏感类别确认、输出长度限制、内容边界和凭据 vault；这些是可选能力。Unix socket 的 session/namespace 管理、MCP tool profiles 与 `--pin-tab` 也不能替代产品自己的 owner/run/session 校验。应将“哪些通用能力被允许”与“何时该运行不再允许任何读写”分别建模，扩展能力不意味着取消运行所有权。[安全选项](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/README.md#security)、[daemon](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/daemon.rs)、[连接与 socket 目录](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/connection.rs)

接管时需要取消待发命令、拒收失效运行的迟到结果、失效化引用与事件观察，并断开对应传输。终止 CLI、断开 socket 或清空本地对象都不能单独证明浏览器端没有后续操作；已经提交到网站的副作用也无法由任何驱动撤销。上述是集成待验证项，不是本次确认的 agent-browser 漏洞。

其域名 allowlist 对既有 CDP/profile 和 direct-page provider 等场景会拒绝启用，因为无法在页面脚本之前建立同等约束；不能把该功能作为连接 Molly 既有 profile 时现成可用的隔离层。采样源码未找到驱动主动发送使用统计的实现，但本次未做运行网络核验；插件、浏览器 provider、升级与下载也应作为不同外联入口处理。[allowlist 限制](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/README.md#security)

### 包体、内存和 token 是不同指标

| 观测对象                                                | 原始值                                                      | 可得结论与限制                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| agent-browser 0.39.0 darwin-arm64 官方 release 二进制   | HTTP Content-Length `15,803,424 B` = **15.07 MiB**          | 仅用 HEAD 获取，没有下载/启动；适合作为单平台原生分发的量级                 |
| Molly 当前安装样本的 playwright + playwright-core + MCP | `16,043,941 B` = **15.30 MiB**                              | 此前对现装样本的文件字节核算；不是源码依赖图估值，也不是 DMG 压缩尺寸       |
| 二者纯算术差                                            | `240,517 B` = **0.23 MiB**                                  | 不含桥接、打包、签名和共享依赖；**不是替换后的实际净减少**                  |
| agent-browser npm unpackedSize                          | `119,426,417 B`，45 文件                                    | 多平台分发包；不可把整包当作只打 macOS arm64 的必要体积                     |
| 0.20.0 changelog 的历史比较                             | 安装 710 MB→7 MB，daemon 143 MB→8 MB，冷启动 1002 ms→617 ms | 厂商针对旧版 Node daemon 的比较；不是 0.39.0 当前尺寸或 Molly/Electron 实测 |

二进制来源：[v0.39.0 release assets](https://github.com/vercel-labs/agent-browser/releases/expanded_assets/v0.39.0)、[arm64 固定下载地址](https://github.com/vercel-labs/agent-browser/releases/download/v0.39.0/agent-browser-darwin-arm64)。release 页面公布 SHA256 `636fc9aa269e3819b539998aa5b87e1c3953556c19eeb9685053743283464faa`；本次未下载文件，因此未独立验证文件哈希。npm 来源：[0.39.0 元数据](https://registry.npmjs.org/agent-browser/0.39.0)。历史主张来源：[0.20.0 changelog](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/CHANGELOG.md#0200)。

推论：本轮没有证据支持“大幅减小 DMG”。Rust 驱动仍可能减少 JS 堆、启动和序列化开销，但需同一 Electron、同一页面、同一任务比较总进程 RSS 与延迟；不能把 daemon 的 8 MB 当成包括 Chromium 在内的总成本。令牌收益取决于快照裁剪、响应结构、工具发现和任务编排，不能换算成安装包收益。

分发上可以只纳入目标平台二进制；上游 postinstall 在缺失时从 GitHub release 下载，并对全局安装重定向入口。Molly 若采用它，需固定版本与校验、建立 macOS 签名/公证和其他平台构建流程，不能让产品安装过程默认走 latest 或另下浏览器。[上游分发脚本](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/scripts/postinstall.js)

## 其他候选的实际边界

### Playwriter：完整 Playwright 编程模型，不是删掉 Playwright

已核验：0.8.0 的核心依赖仍含 `@xmorse/playwright-core`，另有可选 patchright-core 和 sharp。它在持久 Node 执行环境提供 `context`、`state`、页面对象、截图和 CDP；一次代码执行可以组合等待、观察与多步交互。这比单个浏览器 `eval` 更接近“Agent 使用完整浏览器编程库”，同时意味着要定义本地主机代码能力、状态生命周期和文件权限，而不只是页面 JavaScript 权限。[包依赖](https://github.com/remorses/playwriter/blob/525732a474a14224d46469c2b85737dbcdc23e07/playwriter/package.json)、[执行器](https://github.com/remorses/playwriter/blob/525732a474a14224d46469c2b85737dbcdc23e07/playwriter/src/executor.ts#L1747)

默认路径用 Chrome 扩展加本地 relay，用户点击扩展连接标签页，能使用原浏览器登录状态；最新源码也支持 direct CDP 跳过扩展，最终调用 Playwright `connectOverCDP`。因此“必须装扩展”与“完全没有 Playwright”都不准确。其 Node state 按 session 隔离，浏览器 tabs 仍共享；tab group 与清理自建 tabs 不等于完整 profile 隔离或 Molly 的运行租约。[架构与 session 说明](https://github.com/remorses/playwriter/blob/525732a474a14224d46469c2b85737dbcdc23e07/README.md)、[直接 CDP](https://github.com/remorses/playwriter/blob/525732a474a14224d46469c2b85737dbcdc23e07/playwriter/src/executor.ts#L940)

其默认遥测可用 `PLAYWRITER_TELEMETRY=0` 或 `DO_NOT_TRACK=1` 关闭；执行环境允许 native import，源码明确它遵循普通 Node 权限，不能把“sandbox”名称当作 OS 安全边界。对保留内嵌 Electron 的 Molly，直接接入会新增 fork、执行器和可能的 relay 维护面；优先可借鉴持久代码上下文与观察 API，而非以减包为由整体替换。[遥测](https://github.com/remorses/playwriter/blob/525732a474a14224d46469c2b85737dbcdc23e07/playwriter/src/telemetry.ts)、[native import 执行](https://github.com/remorses/playwriter/blob/525732a474a14224d46469c2b85737dbcdc23e07/playwriter/src/executor.ts#L1838)

### browser-use：最新也不应再按 Playwright wrapper 描述

已核验：0.13.11 的 BrowserSession 导入 `cdp_use.CDPClient`，Actor 提供 Page/Element/Mouse 等 CDP API；公开支持连接既有 `cdp_url`。当前依赖没有 Playwright，因此“browser-use 只是再包一层 Playwright”同样过时。它主要提供 Python Agent、模型适配、浏览器事件和观察体系，不只是 TypeScript/Electron 的轻量驱动。[CDP session](https://github.com/browser-use/browser-use/blob/c75e8476e26d18b7617643bc2ae082fae8eae431/browser_use/browser/session.py#L1841)、[Actor API](https://github.com/browser-use/browser-use/blob/c75e8476e26d18b7617643bc2ae082fae8eae431/browser_use/actor/README.md)

包依赖包含多家模型 SDK、文档/图像处理、CDP、Browser Harness 等；当前 CLI 明确委托 Browser Harness，不能把较早 CLI 文档当成当前唯一实现。还存在按平台选择的可选 `browser-use-core` 原生包，本次没有审计该可选核心或 Browser Harness 的完整依赖、传输与体积，故不声称所有路径都只有 Python，也不把小 wheel 当成完整部署尺寸。[依赖与可选核心](https://github.com/browser-use/browser-use/blob/c75e8476e26d18b7617643bc2ae082fae8eae431/pyproject.toml)、[CLI 委托](https://github.com/browser-use/browser-use/blob/c75e8476e26d18b7617643bc2ae082fae8eae431/browser_use/cli.py)

Python 路径默认启用匿名遥测，可通过 `ANONYMIZED_TELEMETRY=false` 关闭；CLI/Harness 的外联还应单独核验。推论：若目标是复用完整浏览器 Agent，它是有意义的候选；如果现有 Pi 保留而只换内嵌执行驱动，直接加入完整 Python 生态不是当前最小的复用步幅。[配置](https://github.com/browser-use/browser-use/blob/c75e8476e26d18b7617643bc2ae082fae8eae431/browser_use/config.py#L58)、[遥测实现](https://github.com/browser-use/browser-use/blob/c75e8476e26d18b7617643bc2ae082fae8eae431/browser_use/telemetry/service.py)

### Chrome DevTools MCP：成熟调试能力，不是纯粹最小驱动

已核验：1.10.1 用 Puppeteer，发布构建将 puppeteer-core 等依赖打包，package.json 中列在 devDependencies 不等于运行时不包含。它提供网页交互、截图、网络/控制台和深度性能分析，支持 `--browser-url`、WebSocket endpoint 及 auto-connect。当前 BrowserManager 的公开配置使用 URL/endpoint；MCP 的 transport 参数属于 MCP 连接，不能误读为可直接注入 Electron CDP transport。[构建打包](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/f08dbe152502d66e75fa07fb2588dc0feb42bc20/rollup.config.js)、[浏览器连接](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/f08dbe152502d66e75fa07fb2588dc0feb42bc20/src/BrowserManager.ts#L330)、[MCP 接口](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/f08dbe152502d66e75fa07fb2588dc0feb42bc20/src/index.ts)

`--slim` 暴露 navigate、evaluate、screenshot 三个工具，这是缩小工具面而非删除发布包中全部调试实现；如果任务依赖语义快照和定位，需要评估完整模式或另行组合。auto-connect 文档说明可访问选定 profile 的所有窗口，这与 Molly 管理的单页租约不同；pageId routing 解决寻址，不自动构成授权。[slim 工具](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/f08dbe152502d66e75fa07fb2588dc0feb42bc20/docs/slim-tool-reference.md)、[连接和并发](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/f08dbe152502d66e75fa07fb2588dc0feb42bc20/docs/advanced-usage.md)

默认使用统计、性能 CrUX 查询和 registry 更新检查都有关闭路径；本地无遥测产品需要明确配置并核验这些独立开关。官方主要承诺 Chrome 支持，不能由 Chromium/CDP 共性推导当前 Electron 版本完整支持。若 Agent 要排查网页性能或控制台问题，这是强候选；单纯把浏览器驱动做得更小，其额外分析能力未必值得整体引入。[支持、数据收集与关闭选项](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/f08dbe152502d66e75fa07fb2588dc0feb42bc20/README.md)

### 其他分发量级仅作边界说明

| 发布元数据                                  | 数值                     | 为什么不能直接等于 Molly 净增减                                           |
| ------------------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| Playwriter 0.8.0 npm unpackedSize           | `11,742,727 B`，505 文件 | 不含外部依赖闭包、Playwright fork 与可选 native 包                        |
| Chrome DevTools MCP 1.10.1 npm unpackedSize | `14,250,471 B`，359 文件 | 已含打包 JS 依赖，但不含浏览器；主机适配和可选 peer 另计                  |
| browser-use 0.13.11 wheel                   | `753,512 B`              | 压缩 wheel；不含 Python runtime、依赖和可选核心，口径与 unpackedSize 不同 |

来源：[Playwriter 固定版本 registry](https://registry.npmjs.org/playwriter/0.8.0)、[Chrome DevTools MCP 固定版本 registry](https://registry.npmjs.org/chrome-devtools-mcp/1.10.1)、[browser-use 固定版本 PyPI](https://pypi.org/pypi/browser-use/0.13.11/json)。这里只读取发布元数据，没有安装这些包。字节值不能互相排序后当作实际产品体积排名。

## Stagehand 4 与其他驱动的补充判断

### Stagehand 4.2.0

固定源码为 `1fc884992b68a0196ea5c6e96cc29924b0922ef4`，不能沿用旧版“Playwright 包装”或 v3 的架构描述。v4 的运行时在浏览器扩展中，提供普通页面 API 及 `act` / `observe` / `extract` 自然语言接口。普通 API 不必另调模型；自然语言接口会增加模型推理路径，可配置模型或自有 client。对于已有 Pi Agent，这可能减少某些页面理解工作，也可能重复推理、增加延迟和费用，需比较整项任务，不能先认定收益。[固定 README](https://github.com/browserbase/stagehand/blob/1fc884992b68a0196ea5c6e96cc29924b0922ef4/README.md)、[模型与动作接口](https://github.com/browserbase/stagehand/blob/1fc884992b68a0196ea5c6e96cc29924b0922ef4/packages/sdk-ts/src/stagehand.ts)

官方 `localBrowser.connect` 能接 CDP 浏览器，但要发现或加载 Stagehand 扩展，并连接扩展 service worker。源码 manifest 使用 MV3、`debugger`、`offscreen`、`scripting`、`tabs`。Electron 只承诺部分扩展 API，且扩展只能载入持久 session；Molly 当前开发版使用内存 partition。因此，本轮没有证据表明 Stagehand 4 可以直接接现有 WebContentsView。它不强制使用 Browserbase 云浏览器，但把扩展 runtime 移植成 Electron 宿主能力仍是额外集成工作。[v4 浏览器配置](https://docs.stagehand.dev/v4/configuration/browser)、[固定 manifest](https://github.com/browserbase/stagehand/blob/1fc884992b68a0196ea5c6e96cc29924b0922ef4/packages/extension/manifest.json)、[Electron 扩展边界](https://www.electronjs.org/docs/latest/api/extensions)

公开 npm 4.2.0 tarball 为 1,072,857 B，成员原始大小合计 3,571,410 B，包含约 2.1 MB 扩展文件及其 ZIP 副本。本轮只下载并读取归档清单，没有安装或执行。SDK 本体确实不大，不能笼统称为“更重”；该数字未含依赖闭包、Electron 适配和额外模型调用，不能当 Molly 净节省量。[4.2.0 registry 元数据](https://registry.npmjs.org/@browserbasehq/stagehand/4.2.0)

### Puppeteer-core 与直接 CDP

Puppeteer-core 是成熟替代驱动，支持自定义 `ConnectionTransport`，理论上更容易保持当前内存连接形态；它也不自动下载浏览器。但它没有直接替换 Molly 所依赖的 Playwright MCP ref、快照和动作合同的现成证据，仍需适配 Agent 工具面。它是值得做包体筛查的备选，不应只凭包名带 `core` 就认定更轻。[连接选项](https://pptr.dev/api/puppeteer.connectoptions)、[安装边界](https://pptr.dev/guides/installation)

截至本次调研，`puppeteer-core@25.13.0` 单包 registry `unpackedSize` 为 6,010,962 B；递归解析声明的非 optional runtime dependencies、按包名与版本去重，共 24 包、26,812,392 B（25.57 MiB），其中 chromium-bidi 9,414,844 B、zod 6,140,311 B、devtools-protocol 3,707,736 B。范围版本按当日 registry 中满足范围的版本解析。本统计包含发布包内声明/映射等文件，未按 Molly 打包规则裁剪或复用已有依赖，故不能直接与现装 Playwright 的已打包字节比较；它只证明“6 MB 裸包替换 15 MB 就能省一半”不成立。没有安装依赖或运行候选。[Puppeteer 25.13.0](https://registry.npmjs.org/puppeteer-core/25.13.0)、[chromium-bidi 固定版本](https://registry.npmjs.org/chromium-bidi/157.0.8090-0)、[zod 固定版本](https://registry.npmjs.org/zod/4.6.5)

直接使用 Electron `webContents.debugger` 最有希望降低驱动依赖，但当前栈本来就通过它通信。删除 Playwright 后，需要另行维护快照语义、引用失效、可操作性等待、真实输入、frame/Shadow DOM、导航与文件交互。对于通用浏览目标，这比复用成熟驱动承担更多责任；可以借鉴公开模式，但目前不足以跳过复用阶梯采用自建方案。[Electron Debugger](https://www.electronjs.org/docs/latest/api/debugger)、[Playwright 自动等待](https://playwright.dev/docs/actionability)

### 无界面引擎与站点原生工具

Lightpanda 专门移除图形渲染来降低机器自动化成本，适合某些抓取任务；由此推断它不能直接替代当前可见网页、视觉选图与同页人工接管。保留 Electron 再加入一个 headless 引擎会新增运行时，不能把它的厂商单任务性能数据换算成 Molly 的 DMG 或总体内存收益。[Lightpanda 架构](https://lightpanda.io/docs/core-concepts/architecture-overview)

WebMCP 值得作为增量能力关注：网站主动提供结构化工具时，Agent 可减少页面定位步骤；它需要网站采用和目标 Chromium 版本支持，不能覆盖任意网站。后续源码核验确认当前 Electron 39.5.1 缺少 agent-browser 原生路径所需的 CDP domain，详见本文末尾的组合补充；不能仅换驱动就获得支持，也不能把页面自述能力等同于用户授权。[Chrome WebMCP 文档](https://developer.chrome.com/docs/ai/webmcp)

## 复用阶梯与建议

| 路线                               | Agent 友好度                                           | 轻量化判断                                                     | 本轮建议                                               |
| ---------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------ |
| 适配现有 Electron + Playwright/MCP | 可复用局部快照、搜索、成熟定位与等待；扩展通用任务接口 | 不增加驱动 daemon；包体变化小，重点验证 token 和模型往返       | 第一比较基线；当前七动作不足以代表其能力上限           |
| agent-browser 原生 Rust            | 现成 CLI/MCP、交互引用、批处理与多种观察接口           | arm64 原生文件与现有 PW 包几乎同量级；进程和内存尚无净收益证明 | 最值得做对照的替换候选，采用理由应是通用能力与维护收益 |
| Puppeteer-core + 现有宿主适配      | 成熟驱动，自定义 transport 可复用；Agent 语义需补齐    | 裸包小，完整依赖和最终打包未证明更小                           | 若包体是硬指标，先做依赖/打包筛查，再决定是否原型      |
| Stagehand 4                        | 自然语言操作与提取方便，普通页面 API 也可用            | SDK 本体较小；扩展适配和模型路径增加成本                       | 特定工作流候选，当前缺少直接嵌入 Electron 的证据       |
| 自建 Electron CDP 层               | 接口可完全按 Agent 需求设计                            | 可能最小增量包，但页面自动化维护最多                           | 最后考虑，通用目标不足以证明自建必要性                 |

“原样保留现有七动作”不满足新通用方向，所以首先适配既有上游组件；agent-browser 和 Puppeteer 是替换成熟组件的下一层；借鉴其快照/批处理模式不要求复制整套产品；自己实现底层自动化放最后。不建议同时引入多套驱动、第二个默认 Agent 循环或另一个浏览器作为通用默认配置。

## 验证界限与可推翻结论的证据

此前已安装 Molly 样本中，Playwright、playwright-core 与 MCP 共 16,043,941 B（15.30 MiB），约占 537.1 MiB `.app` 的 2.85%。保留内嵌 profile 时不能把约 4 MiB Cookie 导入依赖算作驱动替换收益。agent-browser 0.39.0 arm64 官方文件 HEAD 为 15,803,424 B（15.07 MiB）；两者只差 240,517 B（0.23 MiB），且比较尚未包含适配代码和打包差异。它足以否定“原生 Rust 必然大幅缩 DMG”的预期，但不是测得的最终净差额。Electron Framework 继续保留，任何一项都不能把 token、冷启动或进程数量宣传换算为 DMG 节省。[既有样本与方法](2026-10-10-ego-lite-browser-replacement.zh.md#现装样本测量)、[固定 arm64 分发文件](https://github.com/vercel-labs/agent-browser/releases/download/v0.39.0/agent-browser-darwin-arm64)

建议下一次实施验证只对照“补足上游按需观察能力的现有方案”与 agent-browser，不以受限七动作为弱基线。覆盖长页查找、动态表单、嵌套 frame、多页、文件和人工接管；记录成功率、误操作、完整上下文 token、模型往返、冷暖延迟、进程总内存、同配置 DMG 与自维护适配量。快照短必须同时保证任务所需内容没有丢失。浏览器连接先验证获准页面集合与撤销，再做真实任务；不能为了接入候选开放 Electron 全部 target，也不能把杀 CLI 进程当作已撤销 daemon 中的动作。

如果 agent-browser 能通过宿主边界验证，以薄适配显著改善任务成功率、总 token 或耗时，即使包体不变，也可成为更好的选择。若仅追求压缩包明显变小，当前没有证据支持替换成熟驱动；优先核对整个现有包的依赖和资源。

本轮按仓库要求运行一次 `gpt-6-astra`、high、read-only 的 Codex CLI 第二意见。其建议与上述排序大体一致，并强调 agent-browser 的现成 MCP/CLI/daemon 进程链、异步取消和 frame 覆盖需要真实对照；它认为 Puppeteer 值得包体筛查，随后本轮补查了依赖闭包。第二意见提醒不要把最新 MCP 能力误算到锁定版；本轮另核对了 0.0.82 的实际安装文档及固定 tag，确认 `browser_find` 和局部/深度快照已经存在。第二意见是 advisory，未自动应用代码，也不是运行验收。

本次只读检查源码、官方资料、registry 元数据及归档结构，写入研究记录；未安装或启动候选、未操作账号、未运行模型任务或生成对照 DMG，未修改产品实现、Spec 状态或批准迁移。

## WebMCP 与 agent-browser 的组合补充

WebMCP 适合作为浏览器通用操作之上的站点语义工具层：网站声明搜索、筛选或提交等实际工作流，Agent 可以直接传结构化参数，省去部分控件定位与状态猜测；未提供工具的页面仍需要快照、点击、输入和页面代码等能力。它不是浏览器驱动或渲染引擎，接入后不会移除 Chromium，也没有直接缩小 DMG 的理由。

### 原生版本边界

截至 2026-10-10，Chrome 官方页面仍将 WebMCP 标为提议中的 Web 标准，文档于 2026-10-07 更新；公开 origin trial 从 Chrome 149 开始，开发者也可通过 `enable-webmcp-testing` flag 测试。该信息证明功能仍在演进，**不等于 Chrome 149 起所有环境默认开启**，也不单独证明 agent-browser 所用全部 CDP 命令的最早版本。跨源 iframe 还需要站点允许 `tools` Permissions Policy。[官方状态与启用方式](https://developer.chrome.com/docs/ai/webmcp)

Molly 锁定的 Electron 39.5.1 对应 Chromium **142.0.7444.265**。本次读取这个精确 Chromium tag 的 `browser_protocol.pdl` 及其 `domains` 目录，二者都没有 `WebMCP` domain；直接访问同目录的 `WebMCP.pdl` 返回 404。agent-browser 0.39.0 的实现则实际发送 `WebMCP.enable`、`WebMCP.invokeTool` 和 `WebMCP.cancelInvocation`。据此，**只换 agent-browser 驱动不能为当前 Chromium 142 补出它需要的原生 CDP WebMCP 接口**。本次没有运行 Electron 验证，也没有确定能够兼容全部命令的最早 Electron 版本；如推进，需先选定包含对应协议的运行时，再核验开关及调用行为。[Electron 版本](https://releases.electronjs.org/release/v39.5.1)、[固定 Chromium 协议入口](https://chromium.googlesource.com/chromium/src/+/142.0.7444.265/third_party/blink/public/devtools_protocol/browser_protocol.pdl)、[固定协议目录](https://chromium.googlesource.com/chromium/src/+/142.0.7444.265/third_party/blink/public/devtools_protocol/domains/)、[agent-browser 调用实现](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/actions.rs#L9380)

网页 JavaScript polyfill 只能提供相应页面侧对象或函数，不能给旧 Chromium 的浏览器进程新增 CDP domain。用 `Runtime.evaluate` 自行调用 polyfill 是另一套 JS 桥接设计，须处理发现、来源、frame、导航、结果和取消，不能标成已经兼容 agent-browser 现有原生 WebMCP 路径。agent-browser 为自己启动的 Chrome 默认加入 WebMCP 特性开关；附着的浏览器仍须在启动时支持并启用功能，未知命令会成为 `webmcp_unsupported`，它不会自动安装 polyfill 补齐协议。[启动开关](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/cdp/chrome.rs#L440)、[不支持时的错误](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/webmcp.rs#L515)

### agent-browser 已有的组合机制

| 阶段 | 0.39.0 已核验行为                                                                                                                | 集成意义                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 发现 | 订阅 `toolsAdded`/`toolsRemoved`；首次发现和目录变化时，在普通动作回复附加摘要；最多 16 个工具、4 KiB，不主动放入完整 schema     | 已有低开销渐进发现；没有工具的普通页面不持续增加上下文                           |
| 调用 | 先 `webmcp list <tool> --frame …` 获取 schema，再 invoke；同名跨 frame 工具须明确 frame；支持 detach、result、cancel             | 工具属于当前页面和 frame，不能仅按全局名称永久缓存                               |
| 失效 | 空目录或 unavailable 更新替换旧可用性；schema-only 变化也更新；导航、frame detach 清理目录并把相关未完成调用标为 context changed | 目录与结果随页面生命周期变化；这些机制仍不能替代 Molly 的 run 撤销和迟到结果归属 |
| 权限 | 页面名称、说明、schema、annotations、结果均标为不可信；MCP `webmcp` profile 需显式加入                                           | 站点宣称 read-only 不构成用户授权；应继续使用宿主确认和运行边界                  |

证据：[官方 README 的 WebMCP 工作流](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/README.md#webmcp-experimental)、[事件与导航处理](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/actions.rs#L1787)、[目录和 invocation 失效](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/webmcp.rs#L460)。取消请求不能回滚已经发生的网站副作用；此处没有验证用户接管后所有在途执行立即停止。

网站未接入时，可靠回退仍是现有语义快照/DOM/视觉及普通交互。项目附带 `webmcp-gen` 工作流，可探索网站后生成 `webmcp.init.js`，再通过 init script 注入并验证工具；它要求检查可见效果、无效状态、导航、取消和与可访问性树回退的对照。**这不是自动赋予所有网站原生业务 API**：生成工具的维护、失效和授权成本仍在，而且注入注册脚本同样需要可用的原生 WebMCP 或另行设计的桥接环境。对于自己能修改的网站，可直接实现语义工具；对于任意第三方网站，应把它作为可选增强，保留通用回退。[生成与验证 Skill](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/skill-data/webmcp-gen/SKILL.md)

### 对现有组件的复用与选择

采用 WebMCP 与更换 Playwright 是两个决策。Molly 当前锁定的 `@playwright/mcp@0.0.82` 已提供 `webmcp` 配置及 `--no-webmcp` 开关；当前驱动明确设置 `webmcp: false`，并另有限定工具目录。因此，可以先在兼容运行时上评估开放现有组件的语义工具能力，但不能只翻开关就宣称完成产品集成。这里确认的是上游配置能力，没有实测该版本在 Electron 上的发现、调用和取消行为，也没有证明它与 agent-browser 使用相同实现。[0.0.82 上游配置](https://github.com/microsoft/playwright-mcp/blob/v0.0.82/README.md)、[当前驱动](https://github.com/LeonEthan/molly-design/blob/856b8a44823e6ca964eddecb0a77ad39fd5fadeb/apps/electron/src/main/services/browser-mcp-driver.ts)

按复用阶梯，先比较“适配现有 Playwright/MCP + WebMCP”与“agent-browser + WebMCP”。前者复用现有内存连接和宿主生命周期；后者的主要理由是复用已完成的渐进发现、schema 按需读取、调用状态管理及通用浏览接口，可能减少 Molly 自有封装。现有方案迁移少并不证明长期维护更好，但目前也没有证据排除它。仅借鉴 agent-browser 的观察模式不必换驱动；自建 WebMCP JS 桥与底层自动化放在成熟组件无法满足需求之后。

如果“不动 Electron”指保留技术栈，组合在架构上可行；如果连 39.5.1 版本也固定，现成 agent-browser 的原生 WebMCP 路径不成立。建议未来验证先选定同一个兼容的 Electron 版本，贯通工具发现、调用、结果、取消和 frame/导航失效，再对两种驱动比较有工具与无工具任务。Agent 继续复用 Molly 现有执行循环，由同一个浏览驱动按需使用页面工具或普通页面动作，不需要给每个站点启动独立 MCP server 或再引入一个 Agent。

回退需要区分“尚未执行且没有可用工具”和“已经调用但结果未知”。前者可以改用普通交互；后者必须先检查结果或页面状态，不能直接再点击提交、购买或发送来重试。页面工具执行及取消不提供事务回滚保证，用户接管与迟到结果仍须遵守宿主运行归属。[WebMCP 调用与取消](https://developer.chrome.com/docs/ai/webmcp/imperative-api)

轻量化收益首先是特定任务的观察内容、模型往返和自维护代码，仍需实测。WebMCP 不移除 Chromium；现装 Playwright 依赖 15.30 MiB 与 agent-browser arm64 文件 15.07 MiB 的静态比较，不能证明 DMG 或进程总内存明显下降。如果 WebMCP 只覆盖少量任务，普通页面能力与成功率仍决定通用浏览体验。

本次补充另运行一次 `gpt-6-astra`、high、read-only 的 Codex CLI 第二意见。它支持把 WebMCP 作为可选语义层，优先复用现有组件并以 agent-browser 作替换对照；最强反对意见是继续补现有封装可能重复实现候选已经提供的发现与调用管理。该意见只用于审视取舍，未自动应用实现，也不替代兼容性与任务测试。

本次组合补充只核验官方资料及既有固定源码，没有启动浏览器、改开关、注入页面、升级 Electron 或验证真实网站覆盖率。WebMCP 的潜在任务收益值得对照，但当前首先要解决运行时版本前提；它本身不是选择 Rust 驱动或替换 Playwright 的充分理由。
