# agent-browser + WebMCP 内置浏览器实现方案

Status: implemented
Date: 2026-10-10
Translation: pending

## 摘要

Molly 已将内置浏览器生产驱动替换为固定派生构建的 agent-browser，并接入 WebMCP 的发现、调用、结果和取消。实现保留 Electron 可见页面、网站 profile、现有 Agent、权限与素材发布路径，新增严格的通用单页工具、观察身份和显式能力协商。原生源码补丁处理不确定命令重发、非破坏性轮询、ref 元数据及宿主隔离；旧 Playwright 生产驱动和依赖已移除。按用户要求不运行测试或浏览器探针；构建与静态检查不能证明真实网页、签名安装包或 DMG 大小收益。下文保留初始方案依据，末节记录实施结果与差异。

## 决策、基线和复用

方向已确定，不再把候选比较或性能基准作为选择驱动的前置步骤。初始阶段只交付设计；用户随后明确要求开始实现，实施结果见末节。产品目标见[Spec 草案](../../../../specs/agent-browser-webmcp.zh.md)；前序证据见[方案调研](../../proposed/architecture/2026-10-10-electron-agent-browser-options.zh.md)与[Electron 包体分析](../../proposed/architecture/2026-10-10-ego-lite-browser-replacement.zh.md)。

| 对象          | 实现基线                                               | 依据与限制                                                                                                                    |
| ------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Electron      | 从 39.5.1 升级到固定稳定版 44.7.0                      | Chromium 152.0.7977.130 的协议含 `WebMCP.enable/invokeTool/cancelInvocation` 及目录、调用事件；不是最低版本断言，也未运行验证 |
| agent-browser | 0.39.0 / `44af39842650f0bb9c1afb7354df9a82921d4f09`    | 原生 Rust CDP 驱动；必要宿主扩展以可审查补丁管理并单独标注构建身份                                                            |
| Agent 与权限  | 现有 Pi、MCP adapter、`molly_browser`、本地控制 socket | 沿用任务身份、工具权限、工具组合与结果呈现                                                                                    |
| 页面          | 现有 `WebContentsView`、partition、隐藏宿主与侧栏      | 首版一个 Session 的一个获准页面及其 iframe/worker 后代                                                                        |
| 分发          | 现有 macOS arm64 正式发布链                            | 不安装 Chrome，不引入网站工具云服务；实验平台继续按原有范围处理                                                               |

复用阶梯：现有 Playwright/MCP 加 WebMCP 可以减少迁移，但本轮已选择 agent-browser 的通用原生能力与上游演进方向；不再实现第二套生产驱动。继续复用 Molly 的外层 MCP 和 VS Code CDP 代理；适配 agent-browser 的公开 CLI JSON，避免直接绑定其内部 daemon socket 协议。上游 stdio MCP 也已检查：它在每次调用时再启动同一 CLI，采用它会多一个常驻转发进程且仍需要 Molly 参数裁剪，因此本方案直接调用 CLI。自建快照、定位、自动等待或 WebMCP 注册引擎没有必要。

## 目标结构

```mermaid
flowchart LR
    A[现有产品 Agent] --> M[molly_browser]
    M --> H[现有 CLI BrowserHost]
    H --> E[Electron 页面租约控制器]
    E --> D[AgentBrowserDriver]
    D --> C[原生 CLI / 独立 daemon]
    C --> W[租约专属 WebSocket]
    W --> P[既有 CDPBrowserProxy]
    P --> V[同一个 WebContentsView]
    V --> T[站点 WebMCP 工具]
    E --> I[现有图片获取与资产发布]
```

页面和 run 身份由 Molly 提供。agent-browser 只得到租约内的连接。WebMCP 是这一页面上的操作方式，不是新的 Agent、浏览器或每站点一个 MCP server。浏览授权和站点登录态不复制到 agent-browser 的 auth/state 存储。

新增的深模块为 `AgentBrowserDriver`：对控制器保留 `connect()`、`execute(command)`、`dispose()` 三个操作；内部封装子进程、返回值解析、输出文件和宿主身份映射。直接替换当前具体驱动，不为单一实现新建通用多驱动框架。`dispose()` 的同步部分撤销 CDP 访问，返回的 Promise 仅表示进程与文件清理完成。

## 1. 运行时与私有连接

在 Electron ready 前合并 `WebMCPTesting`、`DevToolsWebMCPSupport` 特性开关，保留已有其他 `enable-features` 值。agent-browser 自启 Chrome 时添加的 flags 不能替代 Electron 自己的启动配置。完整原生 WebMCP 路径依赖升级；不在 Chromium 142 上另造 JS polyfill 桥。

将 `browser-cdp-connection.ts` 中的页面注册、target 筛选和输入守卫保留，移除 `chromium.connectOverCDP` 及 Playwright 类型。继续通过 generator 复用原样的 `CDPBrowserProxy`、`BrowserViewDebugger`，不修改生成的上游文件。给代理增加宿主编写的 WebSocket transport：

- 每个活动租约绑定 `127.0.0.1` 的随机端口和随机能力令牌，只接受该租约的一个驱动连接；页面先创建并注册，再交出连接，避免上游在空 target 列表中自行创建页面。
- 拒绝来自网页的 Origin；不提供全局 `/json/list` 或 Electron `--remote-debugging-port`。令牌通过私有配置交给受控子进程，不进入 Agent 参数、工具结果或日志。
- 浏览器级发现只返回这一个获准页面，frame/worker 仅由其后代事件登记。拒绝其他 target、创建/关闭 target/context、关闭整个浏览器等跨租约操作；保留上游需要的 scoped session 消息与事件。
- `Input.*` 继续走同步 `dispatchInput`，在 CDP 请求发出后立即恢复人工输入拦截，不把等待期间当作 Agent 输入窗口。
- WS 收发、CDP 转发、异步返回都检查 lease 身份；撤销令牌、停止转发、detach 在清理进程之前完成。页面留给人工使用。

选择复用 browser-level proxy，因为它已处理扁平 session 和后代。上游也有 direct-page 模式，但改走该路径并不能自动证明 frame/WebMCP 事件完整；没有必要为此丢弃现成代理。此处新增的是驱动私有的本机监听器；原来的“无监听器”实现说明必须在迁移落地时更新，不能继续沿用。

## 2. 原生进程与输出

`browser-agent-runtime.ts` 负责定位随包二进制和受控启动；`browser-agent-driver.ts` 只把严格类型的动作映射为参数数组。使用 `spawn`、`shell: false`，不用 shell 拼接，也不接受 Agent 提供的命令字符串。

一个活动 run/page 租约对应一个随机 agent-browser session 和一个 native daemon。普通动作由短命 CLI 发送，daemon 持有 refs 和 WebMCP 事件状态；多个 Molly Session 的活动页面不能共享 daemon。没有 Agent 租约时不保留此后台进程。

固定私有 `--config`、工作目录和 `AGENT_BROWSER_SOCKET_DIR`，只传入必要环境；清除继承的 agent-browser 配置、provider、插件、自动连接、profile、state/restore、调试输出和第三方模型配置。所有命令固定当前连接，不允许发现系统 Chrome。私有目录权限为当前用户所有；退出时清理自己创建的资源，不能按名字杀其他 agent-browser 进程。退出清理须跟踪自有进程身份，不能只信可能陈旧的 PID 文件。

CLI 使用 JSON 模式。文本、schema、工具结果和 stderr 均有长度上限；固定错误码与诊断分离，地址令牌、宿主路径和原始 transport 错误不回传模型。截图由宿主指定私有目录与文件名，读取已确认属于该目录的常规文件并执行现有 JPEG/字节边界检查，转为 inline MCP image 后删除。上游输出路径不作为可信的任意文件读取请求，也不直接给 Agent。

同页普通操作仍串行。默认操作期限低于现有 45 秒宿主 RPC 截止值；WebMCP 长操作采用 detach 返回句柄，后续有界读取结果。杀掉 CLI 不等于 daemon 或网页停止；租约撤销以切断 CDP 为准，随后关闭/回收自有 daemon。页面已启动的请求或工具代码可能继续运行，结果须报告未知而非“已回滚”。

固定上游 `connection.rs::send_command` 对 EOF、connection reset 等错误执行最多五次尝试，不能证明前一次未执行。必须新增嵌入模式的单次发送选项，贯穿 CLI 的普通发送与 daemon 重启恢复分支：命令一旦开始写出，连接错误、部分写入、空回复和读取超时均返回 `outcome_unknown`，不得重发。只在尚未提交任何命令时允许建立连接；不为这一迁移建设持久去重表，也不宣称 exactly-once。该修订是沿用 Molly 不重放合同的必要条件，不是可以等到后续优化的事项。

## 3. 公开工具面

保留 `molly_browser` 名称和“一项动作一个严格对象 schema”的惯例；修订七动作合同，使其覆盖通用单页任务。上游命令名由宿主常量映射，调用者不能透传任意 upstream tool 或全局参数。

| 能力       | 首版工具                                                                  | 接入说明                                                                                       |
| ---------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 浏览与观察 | `navigate`、`back`、`forward`、`reload`、`snapshot`、`read`、`screenshot` | 原生导航；快照支持交互/完整、深度与局部范围；完整阅读与视觉观察按需                            |
| 表单与交互 | `click`、`type`、`press`、`select`、`check`、`scroll`                     | 保留现有 `type` 的替换输入语义，映射上游 `fill`，不悄悄改为追加；`check` 接受目标布尔值        |
| 页面状态   | `wait`、`frame`、`dialog`                                                 | 条件等待限定元素、文本、URL、加载状态；frame 限当前页面后代；dialog 使用固定状态/接受/拒绝操作 |
| 站点工具   | `webmcp_list`、`webmcp_invoke`、`webmcp_result`、`webmcp_cancel`          | 固定工具入口，动态网站目录作为数据返回                                                         |
| 设计素材   | `save_image`                                                              | 保留来源和有界资产发布合同                                                                     |

细节：`read` 使用上游页面阅读能力；查找先复用带范围的观察与阅读，不新建全文索引。`snapshot` 默认按任务选择简洁的交互视图；素材选图必须允许完整视图，不能因为只保留按钮/输入控件而删掉 IMG 引用。视觉操作仍用截图与 refs，不额外引入视觉 Agent 循环。

不把上游 `core` profile 当作安全 allowlist：其中包括 `eval`、`tab_new`、`close`；常见参数还可改变 session/config/CDP。新增工具亦只接受本动作需要的参数。原生 `eval` 仅供固定宿主逻辑；页面自行提供的 WebMCP callback 不是 Agent 注入脚本。密码输入继续要求人工接管；新增键盘或表单接口不能绕过这一语义。

首版完成驱动替换、通用单页和 WebMCP 闭环；多页 UI/租约、上传下载管理、任意 eval、网络拦截、Cookie/存储导出不包含在此实施批次。它们可以在此栈上另做设计，无需保留 Playwright。网站未提供 WebMCP 时采用普通操作；不自动运行 `webmcp-gen`，不创建站点脚本注册表。

## 4. 引用与现有图片能力的衔接

上游原生 refs、frame 和失效规则继续由 agent-browser 管理。Molly 增加薄的调用身份：观察回复携带 opaque `observationId`，引用动作必须携带该值；主进程校验所属 lease、文档和 frame 后再传上游 `@e…`。不再仅校验旧 Playwright 的 `e5/f1e9` 正则。每次重新观察、改变 frame、文档替换或产生页面变化的动作后，旧观察身份失效；这不要求重写上游引用分配。

源码核对确认一个具体缺口：0.39.0 的 snapshot JSON refs 只公开 role/name，`eval` 是页面上下文表达式，`get attr` 读取 HTML attribute。它们不能原样替代现有 `browser_evaluate(target)` 对一个 ref 读取 `tagName/currentSrc/complete/naturalWidth/ownerDocument.URL` 的行为；拿 `src` 当成已加载图片会改变产品合同。

实施时在 pinned agent-browser 上增加一个可审查的最小宿主扩展，拟名 `get element-info <ref>`，复用上游 `resolve_element_object_id` 和 `Runtime.callFunctionOn`，一次返回固定的元素类型、输入类型、文档 URL 与图片加载元数据，不返回 input value、Cookie 或任意属性。它是待新增的接口，不是 0.39.0 已有命令。普通输入用它保留密码字段检查；如新键盘路径可写入密码字段，在上游实际输入路径同样补固定检查，避免宿主预检被新增动作绕过。

复用优先级已核对：`get attr` 不能读取这些 property；普通 `eval` 不提供 ref 绑定；上游 plugin 是外部可执行程序的数据/启动集成，不能替代 daemon 内 ref resolver。选择小补丁复用解析与输入行为，不在 Molly 另建 DOM 引用系统，也不通过 CDP transport 偷改命令含义。补丁与上游 commit、许可证、构建产物校验值一起追踪；被上游正式能力覆盖后删除补丁。提交上游 PR 是单独的发布动作，本方案不执行。

`save_image` 仍只允许当前主文档的已加载 IMG。拿到元数据后交给现有 `fetchSelectedBrowserImage` 和 CLI 设计素材发布；保留重定向、Cookie、解码、大小和迟到结果检查。站点工具返回的 URL、JSON 或图片不自动成为设计资产。

## 5. WebMCP 发现、执行与取消

沿用上游事件缓存，不在 Molly 新建网站工具数据库。普通结果有目录变化时保留上游 `data.webmcp` 的摘要，映射进共享回复 schema 和 MCP 结果；不能在当前只返回 `{url,title}` 的收敛步骤丢弃。无更新、清空目录和 unavailable 必须保持不同语义。

默认摘要沿用上游 16 个工具 / 4 KiB 上限，不主动包含完整输入 schema。`webmcp_list` 无工具参数时列目录，选定工具时获取 schema；全部输出有界，目录太大时由宿主分页返回，不能截坏 schema 或工具身份。选定 schema 超出边界就明确不可用，不把残缺 schema 当作可调用描述。

宿主分配短期 `toolId`，内部绑定 lease、文档、frame、工具名和目录修订。公开描述保留 origin 与 frame 来源供 Agent 理解，调用只接受句柄和结构化参数。目录变更使旧 schema 句柄失效，即使工具名未变；显式 list 重新获取。每次实际 invoke 在当前目录校验句柄，原始 CDP target/session id 始终留在主进程。

调用顺序：

1. Agent 从普通浏览结果发现摘要，按需读取某个工具的 schema。
2. 通过已有权限流程确认调用在用户任务范围内；工具的页面 annotations 不提升权限。
3. `webmcp_invoke` 固定 detached 执行，快速返回 Molly `invocationId`；该句柄映射上游 invocation、lease 和页面身份。
4. `webmcp_result` 返回 `pending/completed/failed/cancel_requested/canceled/unknown` 等明确状态；等待有界，原始结果保留不可信来源。取消请求成功不等于工具已结束。
5. 调用终态或需要进一步确认时，Agent 使用结果或重新观察决定下一步。

存在 pending 调用时，同页只允许观察、读取/取消该调用及人工接管；不能在 detached 之后立即放开另一项可能改变页面的动作。终态后释放这一局部占用。断连、导航或取消造成效果未知时，拒绝该旧结果，允许新观察；不冻结整个 run，不自动重发，也不自动转成 DOM 点击。

这里的非破坏性读取需要第二项原生补丁。0.39.0 的 `webmcp result` 复用等待函数，超时会发送 `cancelInvocation` 并把记录改成 `timed_out`；它不是普通状态轮询。新增明确的 `result --poll`（拟定接口）：处理当前已到达的事件后立即返回记录，未完成就返回 pending，不取消、不改写终态。`cancel --detach`（拟定接口）发送取消请求后返回 `cancel_requested`，实际终态由后续 poll 获取，避免长等待占住 daemon 的状态锁。宿主只使用这两个嵌入合同，不拿上游超时参数模拟轮询。

同步调整当前 Controller 的前后 `waitForDocument`：普通 DOM 观察/输入仍按需要等待页面可读，WebMCP result/cancel 和生命周期错误不依赖 dom-ready；导航中也能得到 `context_changed/unknown` 或取消状态，不能被“页面正在加载”检查挡住。当前 45 秒是每次宿主请求的边界，不是整个网站工具任务的截止时间。

人工接管顺序为停止接收新动作、同步撤销 CDP 访问、作废句柄和待发布输出、恢复人工输入、异步清理进程。Agent 显式请求取消 WebMCP 时，在活跃租约内向上游转发 cooperative cancel；强制接管不等待该请求成功。已在页面里执行的代码没有可靠的回滚保证。

## 6. 共享协议与 Agent 使用

当前 `browser-agent-rpc.ts` 的 strict unions 会拒绝新动作与 WebMCP 结果，必须同时修改 producers 和 consumers，包括 `local-machine-rpc.ts` 的 host/execute schemas 和 CLI RPC handler。复用 `machine-protocol-capabilities.ts` 的能力/版本定义，增加一项浏览协议能力；Electron `browser/host` 报告自身支持的协议版本和运行时能力，daemon 只在两端兼容时向 MCP 宣告新版工具。能力随现有 host TTL 失效，不能根据 CLI 版本或“桌面正在轮询”推断支持；缺少能力时不给活动 Agent 暴露一个稍后必然失败的新版目录。

工具目录是固定入口，网页工具摘要属于结果，不成为 workspace MCP catalog 的新条目。能力信息沿现有 host 状态传递，不另建持久存储。静态原生支持与具体页面的 `ready/no_tools/unavailable` 分开；页面不支持不影响普通浏览，产品的运行时不支持则明确报告 WebMCP unavailable。

同步检查 `molly-browser-mcp-server.ts` 的 `toToolResult`、output schemas 和 Pi 错误转换：structured result、截图和 WebMCP 摘要都要到达 Agent；错误也可能携带目录失效，不能只在 success 路径转发。schema 按需获取，任务方法写入 server instructions，现有 Pi 组合继续使用。不要把所有网站工具注册成永久模型函数，也不增加第二套 batch/workflow 引擎。

宿主内部的元数据预检也是 CLI 调用，可能先消费上游的一次性目录通知。Driver 要收集该次公开动作期间所有辅助调用的最新目录更新，并按顺序把最终有效状态带进公开回复；空目录/unavailable 不能被后续缺省字段覆盖。截图、出错和素材回复也遵守这一规则。只保存传递所需的短期更新与句柄身份，不重复实现上游目录发现。

新 instructions 表述“可用且适合任务的 WebMCP 工具可优先使用；无工具用页面操作；结果未知先检查”。它是 Agent 使用建议，不是隐藏的自动重试或执行编排器。上下文压缩后显式 list/snapshot 恢复观察，不由模型记忆推断旧句柄仍有效。

## 7. 打包、删除与迁移顺序

原生程序放入现有 Electron resources 路径并在 ASAR 外执行。构建输入锁定 upstream commit、补丁 revision、平台/架构和 SHA-256；复用现有 target staging、许可证和签名流程。签名前的来源校验值与签名后文件身份分开，不能用签名前哈希断言已经签名的 Mach-O。正式 macOS 分发将二进制纳入现有签名、公证与 app sealing 顺序。

首版随包携带一个目标架构程序，不增加启动时下载器或后台升级器，不运行 `agent-browser install`，不打包 npm 分发的所有平台程序。Electron 升级同时影响内嵌 Node（44.7.0 为 24.21.0）、原生 addon、CLI staging 和签名，不能把它当作只改浏览器开关。保留当前 `ELECTRON_RUN_AS_NODE`、N-API 与本地 OSS 组合约束。

| 顺序 | 交付内容                                                                                        | 主要落点                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1    | 锁定运行时与驱动构建；完成单次发送、非破坏性结果读取、元素元数据三项原生适配；形成版本 manifest | Electron/package manifests、lockfile、native staging 与可审查补丁                                                            |
| 2    | 页面专属 CDP 桥、受控 CLI/daemon 生命周期与同步撤销；用新驱动承接原七动作                       | `browser-cdp-connection.ts`、新 `browser-agent-driver.ts` / `browser-agent-runtime.ts`、`public-browser-agent-controller.ts` |
| 3    | 新共享动作/回复、观察和工具句柄、能力协商；接通通用交互与 WebMCP                                | `packages/shared/src/browser-agent-rpc.ts`、machine capabilities、CLI BrowserHost/MCP、Electron host service                 |
| 4    | 更新 Agent instructions 与界面可用性说明，保留登录、接管、选图与资产发布                        | `molly-browser-mcp-server.ts`、Pi 错误适配、浏览侧栏及账号说明                                                               |
| 5    | 移除旧生产驱动与依赖、收敛打包和文档                                                            | `browser-mcp-driver.ts`、Electron `package.json`、Vite/build hooks、afterPack、所属 README/AGENTS                            |

步骤 2 到 3 可以在开发分支逐步衔接，最终产品只有 agent-browser 一套驱动，不保留运行时双栈设置或自动回退到 Playwright。错误恢复返回浏览器不可用/需要重新观察，不能悄悄换引擎或启动系统 Chrome。完整替换后，回退仅通过经授权的版本发布/代码撤回进行，不重放动作；Electron profile 的降级兼容性也不能假定。

删除范围：Electron 生产 `@playwright/mcp`、`playwright` 及确实不再有生产消费者的 `playwright-core`，旧 MCP driver、快照 Markdown 正则解析及仅服务旧驱动的打包断言。旧驱动专用探针随实现调整或退役；无关开发/E2E Playwright 依赖按实际消费者保留。继续使用的 VS Code proxy、generator、NOTICE、图片获取、账号导入和 Electron Framework 保留。

迁移落地时更新 `apps/electron/src/AGENTS.md`、`main/services/AGENTS.md`、CLI MCP 合同、Electron README 和 `sessions-browser.md`：新的私有监听器、原生驱动、WebMCP 动态数据和扩展动作需成为当前事实。旧实现说明在本轮只增加未来方案链接，不提前改写为已实现。Spec 保持 draft，方案记录在代码落地后才按证据迁移到 implemented。

## 交付判断与本轮限制

实现完成意味着 Agent 操作的是同一可见页面，已接通通用单页动作和 WebMCP 的发现/调用/结果/取消，原有接管、账号与素材能力有明确实现，新原生资源进入包且旧 Playwright 生产闭包已移除。这些是实现目标，不是本轮通过记录。

初始方案阶段没有升级运行时或编译补丁。实施阶段完成版本升级与编译，但按用户要求仍不运行测试、浏览器探针或生成 DMG；这些边界见末节。

包体预期保持克制：既有样本的 Playwright 生产文件约 15.30 MiB，官方 agent-browser arm64 文件约 15.07 MiB；带补丁的构建、桥接代码、签名和 Electron 升级均会改变最终字节。该静态差额既不是 DMG 差额，也不支持显著缩包承诺。主要预期收益是通用能力和复用上游维护，真实任务与内存收益未测。

## 独立第二意见

按仓库要求完成一次 Codex CLI `gpt-6-astra`、high、read-only 第二意见，没有运行测试。Codex 支持“现有外层 MCP + 原生 CLI + 独立 daemon + 页面专属 CDP 桥”，最强反对意见是不能把原版 0.39.0 当作已符合 Molly 合同的可直接嵌入程序。它指出 CLI 传输自动重发、result 超时主动取消，以及既有 ref 元数据能力缺口；本轮随后逐项复读固定源码，确认并纳入上述三项必要适配。

Codex 还指出 Controller 的页面就绪门槛和内部辅助调用吞掉工具摘要的消费链问题，方案已明确改动落点。上述是独立意见及本轮的设计判断，没有自动应用产品实现，也没有改变已确定的技术选型。若要求二进制必须逐字节保持官方 0.39.0，这三项合同缺口将阻止完整替换；当前计划选择固定派生构建，并使补丁可被后续上游版本替代。

## 证据

- [Electron 44.7.0 发布信息](https://releases.electronjs.org/release/v44.7.0)、[Chromium 152 WebMCP 协议](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/third_party/blink/public/devtools_protocol/domains/WebMCP.pdl)。本次读取精确 tag，确认命令参数和事件存在；未声称原生集成已通过。
- agent-browser 固定源码：[CLI/MCP 与进程链](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/mcp.rs)、[配置优先级](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/flags.rs)、[CDP 连接](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/browser.rs)。
- [CLI 自动重发](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/connection.rs#L1013)、[WebMCP 等待超时行为](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/actions.rs#L9497)、[daemon 执行锁](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/daemon.rs#L535)。
- agent-browser 固定源码：[ref/图片适配依据](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/actions.rs)、[上游 ref resolver](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/native/element.rs)、[公开 get 命令](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/cli/src/commands.rs)、[plugin 范围](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/docs/content/docs/plugins.mdx)。
- [WebMCP 上游流程](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/docs/content/docs/webmcp.mdx)、[调用与取消语义](https://developer.chrome.com/docs/ai/webmcp/imperative-api)。
- 当前实现：[CDP connection](../../../../apps/electron/src/main/services/browser-cdp-connection.ts)、[Agent driver](../../../../apps/electron/src/main/services/browser-agent-driver.ts)、[Controller](../../../../apps/electron/src/main/services/public-browser-agent-controller.ts)、[shared schemas](../../../../packages/shared/src/browser-agent-rpc.ts)、[外层 MCP](../../../../apps/cli/src/mcp/molly-browser-mcp-server.ts)。

## 实施结果（2026-10-10）

已落地原生 CLI/daemon、租约专属 CDP WebSocket、21 项固定 MCP 动作、WebMCP 短期句柄和 browser 协议 v2。宿主资源缺失、不兼容或 TTL 失效均使目录不可用；仍沿用活动本地设计 run 入口，没有新增 Agent 循环或多页权限。原生资源位于 ASAR 外，携带来源、补丁、Rust 1.99.0、目标架构及文件哈希；构建与签名沿用现有流程。编译缓存显式排除在安装包之外，运行时不下载浏览器。

与初始拟定语法的差异：`AGENT_BROWSER_EMBEDDED=1` 使 `webmcp result` 固定为即时只读轮询、`webmcp cancel` 固定为 detached 取消，不额外公开 `--poll` 参数。嵌入模式禁止自动启动浏览器、重启 daemon 或重发命令；原生 dashboard/stream listener 被关闭。daemon 控制消息使用宿主随机令牌，父进程管道结束后退出。旧节点 ref 不再通过 role/name 回退匹配新文档；图片与输入元数据继续使用上游 resolver。Electron 44 的异步剪贴板接口也已适配。

本轮另完成 Codex CLI `gpt-6-astra` / high / read-only 独立代码意见。Codex 报告三个 P1 源码问题，没有 P0；这些不是运行复现。逐项复读源码后做了以下修正：

- 输入和图片元数据预检后重新核对文档观察身份；底层 stale ref 拒绝跨文档重绑，素材抓取前后也核对文档版本。
- 观察失效与调用生命周期分离。新增/销毁无关 iframe 可以使 refs 失效，却不结束仍在执行的 WebMCP 调用或释放其占用；主文档提交及上游 frame 生命周期决定旧调用是否失效。
- 待处理调用允许检查和处理已有对话框。取消直接使用现有 CDP session，不先读取 renderer 的 URL；已终止调用直接返回记录，轮询仍不隐式取消。

上述修订由本轮源码检查确认，未把第二意见的建议自动当作验证通过。Pi 保留原生 MCP 集成：Molly 通过现有 text/image block 传递摘要，错误回复也带变化，无需修改或 fork Pi。

实施验证：原生 macOS arm64 release 编译与资源校验、CLI build/typecheck、Electron 主进程/renderer typecheck 与 build、CLI 资源 staging、全量 lint、public/platform boundary 检查通过。lint 保留仓库已有的大量警告，无错误。没有执行单元测试、回归测试、浏览器探针、真实网站操作、签名/公证或 DMG 构建；现有测试夹具只同步新合同。Spec 仍为 draft，没有新增发布批准。最终安装体积与运行兼容性尚无本轮证据。

复用取舍保持原方案：已有 Molly MCP/租约/权限/素材链及 VS Code 代理直接复用；原版 agent-browser 的合同缺口用局部补丁适配；其 stdio MCP 的额外驻留转发没有必要，未再建设自有定位或网站注册引擎。

## 代码审查后的修正（2026-10-10）

用户授权修复审查中的四个 P1，继续不运行测试或浏览器探针：

- WebMCP 旧句柄：在异步目录校验前绑定原工具身份与观察版本；目录增删、文档替换、frame/session 销毁立即使句柄及调用许可失效。既有 CDP interceptor 在实际发送前同步核对并消费一次性许可，失败不重新绑定。原生发现复用成功订阅，避免每次 `enable` 重放目录；返回目录前统一处理积压的生命周期事件，已知事件丢失则拒绝目录并要求重新建立连接。
- 图片保存：在上游 snapshot/RefMap 中给 `image`/`img` 可访问性节点分配引用，保留原有 IMG、加载状态、currentSrc、主文档和同 session 素材读取检查。
- 元素等待：嵌入模式的 ref 等待通过现有 frame-aware resolver 与可见性检查处理，保留期限和 stale ref 错误，不把 `@eN` 交给 CSS 解析器。
- 复选框：已有状态符合要求时不点击；否则只发送一次点击。状态仍未确认时返回需重新观察的结果，禁止 JavaScript `.click()` 自动重试。

复用阶梯检查了既有 WebMCP discovery、RefMap、元素可见性函数、CDP interceptor 和事件流：这些组件直接承接修复；上游原样行为缺少嵌入模式的身份与单次执行保证，故局部适配。无需新增公开协议字段、第二套目录或定位引擎。仅比较工具完整元数据不足以识别相同 schema 的移除再注册；增加原生 generation 仍需要宿主发送前的目录守卫，收益不足以支持多一层状态。

Codex CLI `gpt-6-astra` / high / read-only 的独立设计意见建议上述一次性许可方案，并指出必须覆盖事件缺口、会话销毁和重复订阅。逐项核对源码后采纳；第二意见本身没有修改代码，也不是运行验证。其最强反例是宿主漏接事件会削弱身份校验，修复因此保留同步事件失效和原生事件丢失时的拒绝行为。

保证边界来自固定 Chromium 的 [WebMCP 协议](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/third_party/blink/public/devtools_protocol/domains/WebMCP.pdl)：调用参数只有 frame、name 和 input，没有预期文档/注册版本。宿主已收到的变化会在发送前阻止旧句柄；尚未送达的变化和发送后的站点变化仍有协议层竞态，不能承诺浏览器端原子绑定或撤销副作用。

修复后的独立 Codex CLI 源码复审未在上述四项及其宿主/原生调用链中发现 P0/P1。该复审正常完成；它追加的嵌套意见调用因只读沙箱的 `Operation not permitted` 无法初始化，未重试，也未将其算作完成的独立检查。

修复验证：原生 macOS arm64 release 重新编译与资源哈希校验、Electron 主进程/renderer 类型检查及完整应用构建、全量 lint、public boundary、文档检查和 diff 空白检查通过。实际构建源码与审阅的九个补丁文件逐字节一致。lint 为 0 错误，保留原有 12023 项警告；文档检查为 0 错误，保留原有 16 项文件体积提醒。本轮未运行测试、浏览器探针或真实网站操作，没有构建 DMG、签名或发布；源码复审与编译不作为这些运行验收的替代证据。

准备 PR 时补跑完整工作区 `pnpm typecheck`，发现组件包引用 Electron 代码时 WebSocket 验证回调缺少上下文参数类型；补充 `IncomingMessage` 显式类型后全部通过。新增原生资源和源码缓存排除出 Electron 格式化范围；`pnpm format` 与 `pnpm check:quick` 均通过，没有带入无关格式化改动。继续按用户要求跳过包含测试的完整 `pnpm check`，以完整工作区类型检查、lint、i18n、导入及 public/platform boundary 检查覆盖其非测试部分。

## PR CI 修正（2026-10-10）

[PR #117](https://github.com/LeonEthan/molly-design/pull/117) 的首轮 CI 暴露两处遗漏：机器注册测试的完整能力清单未包含 `browserAgent: 2`；桌面 smoke 构建成功，但三个场景均在启动前因 Electron `path.txt` 缺失失败。

能力测试继续使用独立、完整的字面值断言，只补上已实现的协议版本。Electron 安装问题由升级跨越的[官方安装行为变更](https://www.electronjs.org/blog/electron-42-0#electron-no-longer-downloads-itself-via-postinstall-script)引起：42 起 npm 包不再通过自己的 postinstall 下载二进制；固定的 44.7.0 包提供 `install-electron`，而 E2E harness 直接读取已准备好的路径。

复用现有桌面 `postinstall.mjs` 调用固定依赖自带的安装器，再执行原来的 native dependency 准备，保留跳过桌面准备与缺少 Electron 依赖时的退出路径。安装器复用已有版本与下载校验；失败终止安装。检查过在各 E2E workflow 单独加下载步骤的方案，但它会重复准备逻辑并遗漏其他源码启动入口，因此选择修复已有 setup 层；没有新增下载器或在测试场景中联网。

本地继续只做类型、格式、静态和文档检查，不运行测试或浏览器探针。修复后的测试结果以 PR 对应提交的 GitHub Actions 记录为准；桌面 smoke 也不构成 WebMCP 站点兼容性或安装包验收。
