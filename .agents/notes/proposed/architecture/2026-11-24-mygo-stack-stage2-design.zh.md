# Molly 转向 MyGo 技术栈：Stage 2 架构设计、生产激活与桌面切壳实施方案（修订版）

Status: proposed
Date: 2026-11-24
Translation: pending
Related Proposal: [Stage 1 MyGo 架构迁移详细方案](2026-11-23-mygo-stack-stage1-design.zh.md)
Related Report: [Stage 1 收口与 M1.4 门禁实证报告](2026-11-23-mygo-stage1-m14-gate-report.zh.md)

## 摘要

本修订版吸收两份独立对抗式架构评审（Claude Opus 5.5 High 与 GPT-6.2 Sol xHigh）的全部 P0/P1 纠偏意见，承接已签收提交的 Stage 1（commit `b2a1f596`，纯 Go `molly-core` 11 个包、`CGO_ENABLED=0`），定义 Stage 2 的收敛架构、安全红线与可独立止损的里程碑切片（**M2.0、M2.1a/b、M2.2、M2.3a–d、M2.4**）。

核心纠偏与边界收敛如下：
1. **将“Electron 下激活 `molly-core`”（M2.1a/b）与“MyGo 实验桌面壳”（M2.3a–d）彻底解耦**：M2.1 无需引入 `mygo`/`purego`，也不触碰密钥库与画稿写入，可独立交付并立即在生产激活 Stage 1 纯 Go 能力（端点在 daemon 生命周期内固定、不写入 daemon 全局 `process.env` 以防 Agent 子进程继承、`molly-core` 监听 stdin EOF 防孤儿进程、封印采用既有 `files[]` 清单格式）。
2. **严守两项 P0 单写者红线**：
   - **凭证库单写者**：并存期 Electron 继续独占 `userData/secrets/model-connections.enc` 的读写与后台 OAuth refresh 轮换；M2.2 收敛为隔离 profile 下的兼容性与原子重封验证引擎（v2 头部绑定源 `.enc` SHA-256，源变更即拒绝使用旧 v2；诚实声明 v2 发生 OAuth 刷新轮换后回退 Electron 需重新登录；生产独占切换另需共享 profile 级写者租约与在途刷新排空）。
   - **画稿回合授权单写者**：`baseRevisionId` CAS 与 `.design.lock` 不等于 Agent 回合只读门；真实 profile 画稿写入必须经过权威 `designCanvasAccess` / `design/canvas-host` 回合协调协议与既有 Node `design-worker`，MyGo 壳首轮先在隔离副本验证只读/导出与编辑，再接入共享回合门。
3. **显式补齐 Node ≥22.19 运行时供给前提**：`CGO_ENABLED=0` 的 MyGo 壳不含 `ELECTRON_RUN_AS_NODE`，复用 CLI daemon、`design-worker` 与 Pi harness 必须随包交付并封印独立 Node ≥22.19 运行时；G2 同机对照基线必须将 Node daemon 计入整棵进程树 RSS 与冷启指标。
4. **诚实声明 G1/G4 物理环境边界**：本机无 `TeamIdentifier=Q96C8424X6` 正式 Developer ID 证书（G1 仅在隔离测试 Keychain 验收 `purego` 读写重封，正式签名 ACL 留待签名机）且无 Windows 主机（G4 维持 `BLOCKED`，本机仅保 `GOOS=windows GOARCH=amd64` 交叉编译与平台无关单测）；Stage 2 期间默认发布壳仍维持 Electron，不提前删除 `apps/electron`。

本提案在所有者对新增 Go 依赖与实施范围显式确认前，不授权运行态实现或发布。

---

## 1. M1.4 门禁现状、物理边界与 Stage 2 收敛边界

### 1.1 G1–G5 门禁诚实边界表

| 门禁 | M1.4 现状 | Stage 2 本机可推进实证范围 | 不可绕过的环境 / 合同边界 |
|---|---|---|---|
| **G1** | PARTIAL | 在 `internal/security` 完成 macOS `purego`（显式 `OSStatus`/`UInt32` ABI、`SecKeychainItemFreeContent`/`CFRelease` 所有权、`kSecUseAuthenticationUI=Fail` 非 UI 线程调用）+ Windows DPAPI + AES-256-GCM 原子重封，并在**隔离临时 Keychain** 中覆盖旧格式夹具（`image`、`legacyImages`、`mcp`、`installationId` 缺席、旧 OAuth 字段） | 隔离测试 Keychain 无法证明正式签名下的 macOS ACL 行为（同 Team ID 本身亦不自动等价无弹窗）；正式验收仍须在发布签名机上以最终签名二进制实测允许/拒绝/锁定路径，**G1 维持 PARTIAL** |
| **G2** | PARTIAL | M2.0/M2.3a 先验证真实构建的 `apps/electron/out/renderer` 挂载于 MyGo `WKWebView` + 真实 Loro 中继（wire v7）首屏、会话读取、重载与重连；M2.3c 补齐编辑保存后执行含 **Node daemon 在内的整棵进程树** 同机 Electron 44 vs MyGo 对照 | 避免用“首屏加载”冒充“工作台等价”；完整 124 个 `@IpcMethod()` 逐端点核定宿主归属与缺席语义（`modelConnections` 写、`updater` 诚实报 unavailable） |
| **G3** | PARTIAL | 独立验收离屏导出引擎：逐瓦片校验实际像素尺寸/DPR/坐标、使用可验证的每瓦片合成完成信号（非仅初始 `molly:ready`）、按文档实际最大阴影/模糊半径动态计算 bleed（替代固定 64 px）、大尺寸有界编码或超限显式回退既有导出，对照 Electron `offscreen: true` 渲染输出接缝/透明度/字体 diff 报告 | WebKit 与 Chromium 存在已知次像素字体微调差异，须按引擎基线明示容差并保留人眼抽检边界 |
| **G4** | BLOCKED | 保持 `GOOS=windows GOARCH=amd64 CGO_ENABLED=0` 交叉编译（含 Named Pipe 与 DPAPI）与平台无关单测通过；`-race` 沿用 CI 独立 `CGO_ENABLED=1` 作业 | 当前为 macOS arm64 宿主，无真实 Windows 主机执行 WebView2 离屏、DPAPI 实机、Node↔Go Named Pipe 实机及真实账号 Pinterest OAuth/Cookie 注入；Go↔Go SID 证据不转记为 Node↔Go 链路；**G4 维持 BLOCKED** |
| **G5** | PARTIAL | 在运行中的 MyGo 实例内验证完整安全面：自定义协议头统一 `X-Molly-Capability-Token`（与 [protocol_gate.go:15](../../../../internal/security/protocol_gate.go) 一致）+ 真实 Bento 64 MiB 保存传输适配 + 入口内存预算控制 + `CallerPage` 与文档代次绑定 + `OnWillNavigate` 与原生 `LoadURL`/重定向/弹窗/销毁撤销令牌 + Bento CSP 维持 `default-src 'none'` 且禁子帧 + `mygo.Bind` 全局服务在 Go 入口严格校验调用页/文档代次/方法/参数，覆盖真实保存成功、旧 revision 拒绝、越权页调工作台桥接与超限请求 | 需同时证明旧文档与非工作台页面（画布/渲染/浏览器）均无法调用 `mygo.Bind` 工作台服务，而非仅测 4 个 handler 负例 |

### 1.2 不可破坏的架构与安全不变量

1. **已批准合同与 ACP 边界不动**：不触碰 `approved` 状态的 [communication-architecture.md](../../../../specs/communication-architecture.md) 与 [session-orchestration.md](../../../../specs/session-orchestration.md)，不在 Go 中复制共享 ACP 契约。
2. **凭证库单写者互斥（P0）**：
   - Electron 实际使用 `userData/secrets/model-connections.enc`（[model-connections.ts:6](../../../../apps/electron/src/main/services/model-connections.ts)），且后台会经 `mutateOAuth` 刷新并轮换整组 OAuth token（[model-connection-store.ts:37,906](../../../../apps/electron/src/main/services/model-connection-store.ts)）。
   - **Stage 2 并存期**：Electron 保持 `model-connections.enc` 唯一写者；MyGo 壳不直接写 `.enc`，日常实验复用既有凭证宿主或保持只读元数据。
   - **v2 源摘要防脑裂**：M2.2 产出的 `model-connections.v2.enc` 头部/AAD 必须记录源 `.enc` 的 SHA-256 摘要；若源 `.enc` 发生变化，拒绝静默复用旧 v2。同时如实声明：一旦在独占切壳后的 v2 中发生 OAuth 刷新轮换，回退旧版 Electron 将导致旧 refresh token 失效、需重新登录（不承诺 OAuth 零损回退）。
   - **独占切换前置**：正式生产启用 v2 写者前，需在独立切换评审中建立跨 Electron/MyGo 共享的 profile 级写者租约（停发新授权 → 排空在途 OAuth 刷新 → 原子迁移发布），不再依赖仅局部的 `O_EXCL` 锁文件。
3. **画稿回合授权单写者（P0）**：
   - 现有保存入口在发往 worker 前强制经过 `designCanvasAccess.write(id, writePermit, ...)`（[design-service.ts:298](../../../../apps/electron/src/main/services/design-service.ts)）并与 daemon 经 `design/canvas-host` 协议协调冻结/flush（[design-canvas-host-service.ts:25](../../../../apps/electron/src/main/services/design-canvas-host-service.ts)）。
   - 同一作品的全部人工写入必须共用唯一权威回合门；MyGo 壳在接入真实 profile 前仅编辑隔离副本，接入真实 profile 时必须完整实现并验收跨壳 flush、活动回合拒写、断连只读、提交后重载与退出排空 worker。
4. **不污染 daemon 全局环境（P1）**：`MOLLY_CORE_IPC_TOKEN` 与 `MOLLY_CORE_IPC_SOCKET` **严禁写入 daemon 进程的 `process.env`**（Agent 子进程在 [session.ts:482](../../../../apps/cli/src/session/session.ts) 会继承 `process.env`），也绝不写入 ACP 配置文件或 argv；仅通过显式内存对象注入 daemon 内消费者（`PersonalMemoryService`）及通过子进程私有 `env` 传入 `molly-mcp-http-host`。
5. **不静默跨后端重放付费调用 / 不跨引擎双写 SQLite（P1）**：Image MCP 一旦向 `molly-core` 派发，失败绝不自动回退 TS 重发；`PersonalMemoryService` 在 `open()` 选定 `molly-core` 后若发生连接中断，直接报错而不静默回退 `better-sqlite3` 双写同一数据库。

---

## 2. 复用阶梯分析（逐子系统决策）

| 子系统 | 检查的既有组件 | 选用层级与方案 | 拒绝更高阶梯的原因 |
|---|---|---|---|
| **`molly-core` 生产监管器（M2.1a）** | [molly-mcp-http-server.ts](../../../../apps/cli/src/mcp/molly-mcp-http-server.ts)（`McpHttpHostSupervisor`）、[molly-fleet.ts](../../../../apps/cli/src/lib/molly-fleet.ts) | **借模式 + 复用接入点**：在 `apps/cli/src/mcp/molly-core-supervisor.ts` 复用 `McpHttpHostSupervisor` 的生命周期模式，**在 daemon 生命周期内固定 socket 路径与 32 字节随机 token**（core 崩溃重启复用同一端点，避免已启动的 `molly-mcp-http-host` 失效），并通过 **stdin 管道 EOF** 传递父进程死亡信号 | `McpHttpHostSupervisor` 硬编码 Node + TCP 握手，无法直接复用单类；同时 `cmd/molly-core/main.go` 需新增 stdin EOF 监听以匹配 `molly-mcp-http-host.ts:110` 的父进程死亡退出契约 |
| **daemon 内消费者与 MCP 宿主接线（M2.1a）** | [personal-memory.ts](../../../../apps/cli/src/agent/personal-memory.ts)、[molly-mcp-http-server.ts](../../../../apps/cli/src/mcp/molly-mcp-http-server.ts)、[molly-image-mcp-server.ts](../../../../apps/cli/src/mcp/molly-image-mcp-server.ts) | **适配复用**：向 `PersonalMemoryService` 显式注入 `getCoreEndpoint()`（不读全局 `process.env`）；向 `molly-mcp-http-host` 子进程私有 `env` 注入固定 `{ socketPath, authToken }`；ACP stdio 回退路径在 M2.1 首批继续走 TS，避免向 ACP 配置暴露 token | 直接靠 `process.env` 会同时导致：① 泄露 token 给 Agent 子进程；② 只传给 HTTP host 时 daemon 内的 `PersonalMemoryService` 根本切不到 Go |
| **Electron 打包与清单封印（M2.1b）** | [eb-after-pack.mjs](../../../../apps/electron/scripts/eb-after-pack.mjs)、[sign-embedded-harness.mjs](../../../../apps/electron/scripts/sign-embedded-harness.mjs) | **适配复用**：`molly-core` 放入 `app.asar.unpacked/resources/molly-core/`，采用与 `prepareEmbeddedHarnessSigning` 100% 一致的 **`files[]` manifest 格式**（`buildId = sha256(JSON.stringify(files))`）；参数化 `sign-embedded-harness.mjs` 的封印目录列表；CLI 按自身所在目录相对路径定位 `molly-core`（含 Windows `.exe`），不依赖 `process.resourcesPath` | 原 `sign-embedded-harness.mjs` 硬编码三个目录且强依赖 `manifest.files[]` 结构，必须对齐其结构并参数化 |
| **Node ≥22.19 运行时供给（M2.3 / M2.4）** | [cli-service.ts](../../../../apps/electron/src/main/services/cli-service.ts)、[design-service.ts](../../../../apps/electron/src/main/services/design-service.ts)、[eb-after-pack.mjs](../../../../apps/electron/scripts/eb-after-pack.mjs) | **显式独立供给**：MyGo 壳无 `ELECTRON_RUN_AS_NODE`，必须明确两级运行模式：① 开发/并存实验态可 attach 既有运行中的 CLI daemon；② 独立实验包（M2.4）随包交付并封印目标架构的独立 Node ≥22.19 可执行文件、CLI `index.js`、`design.js`、N-API 绑定与 Pi harness 闭包 | 忽略 Node 运行时会导致独立 MyGo 包无法拉起 CLI daemon、`design-worker` 或 Pi harness，也会使 G2 内存对照失真 |
| **密钥库兼容与重封验证（M2.2）** | [safestorage.go](../../../../internal/security/safestorage.go)、[model-connection-store.ts](../../../../apps/electron/src/main/services/model-connection-store.ts) | **复用核心 + 平台最小封装**：复用 `safestorage.go` `v10` 解密；新增 `keychain_darwin.go`（`purego`）与 `dpapi_windows.go`（`x/sys/windows`）及 `vault_migrate.go`，在隔离 profile 中验证旧格式全字段兼容、源摘要绑定、备份保护与崩溃恢复 | 标准库无 Keychain/DPAPI 封装且禁止 CGO；并存期不在生产写覆盖 Electron 密钥库 |
| **React 工作台、13 组 / 124 个 IPC 与 Loro 中继（M2.3a–d）** | [ipc-bridge.ts](../../../../apps/electron/src/preload/ipc-bridge.ts)、[ipc-invoke-policy.ts](../../../../apps/electron/src/preload/ipc-invoke-policy.ts)、[loro-data-plane-relay.ts](../../../../apps/electron/src/main/services/loro-data-plane-relay.ts)、[register-services.ts](../../../../apps/electron/src/main/ipc/register-services.ts) | **直接复用前端产物 + 分层桥接**：挂载 `apps/electron` OSS 静态产物（保持 `file:` 或等价路由初始化行为）；`preload.js` 完整保留推送订阅、退订与早到事件缓冲；Go 侧 `mygo.Bind` 入口强制校验 `CallerPage` + 文档代次 + 方法白名单 + 参数校验，复刻 Electron 主进程 `assertSender` 语义；Loro 中继严格遵循 wire v7、32 MiB 单帧上限、64 MiB 发送队列上限与导航/关闭合成 `detach` | `mygo.Bind` 为全局服务且 MyGo 默认信任自定义 scheme，仅靠省略非工作台页的 JS shim 不足以构成安全边界，必须在 Go 入口做强制鉴权 |
| **自定义协议防盲写与离屏导出（M2.3a / M2.3b）** | [protocol_gate.go](../../../../internal/security/protocol_gate.go)、[product-session.ts](../../../../packages/design-bento/src/product-session.ts)、[design-service.ts](../../../../apps/electron/src/main/services/design-service.ts) | **适配复用**：统一 `X-Molly-Capability-Token` 头与真实 Bento 64 MiB 保存传输（评估经受鉴权本机回环或原生预算控制传输，规避 macOS MyGo scheme handler 在调用业务 handler 前全量拷贝请求体导致的分配失控）；导出采用动态 bleed + 每瓦片绘制完成信号 + 大图有界策略 | 直接套用 4 MiB 的 `protocol_gate.go` 会拒收合规大画稿（64 MiB）且无法阻止原生层先分配内存；固定 64 px bleed 无法覆盖 Bento 允许的更大阴影半径 |

---

## 3. 13 组 / 124 个 IPC 端点的准确盘点与分层归属

实测 [apps/electron/src/main/ipc/services/](../../../../apps/electron/src/main/ipc/services) 共 13 组、124 个 `@IpcMethod()` + 3 条 `ipcMain.on`：

| 分类 | 组数 / 方法数 | 包含服务组（方法数） | Stage 2 归属与策略 |
|---|---|---|---|
| **A 类 · CLI / 本地状态与 Loro 桥接** | **6 组 / 22 方法** + 3 条推流 | `localPlatform`（1）、`cli`（4 + `cliSubscribe`）、`loro`（1 + `loroSubscribe`/`loroSend`）、`sessionControl`（1）、`localProjects`（13）、`machineRpc`（2） | **M2.3a 首批接通**。注：`cli.restart`/`terminate` 操作壳监管器、`localPlatform.getSnapshot` 读校验本地 catalog，并非纯 socket 盲转，须逐端点实现真实宿主逻辑并复用既有 CLI 控制 socket 与 Loro wire v7 协议。 |
| **B 类 · 壳原生能力与画布/浏览器** | **5 组 / 77 方法** | `design`（33）、`publicBrowser`（19）、`app`（19）、`notifications`（3）、`image`（3） | **按切片分步落地**：M2.3b 仅开放 `design` 只读/预览/导出；M2.3c 开放 `design` 写入（先隔离副本、再接共享 `design/canvas-host` 回合门 + Node `design-worker`）；M2.3d 开放 `app`/`notifications`/`image` 与 Untrusted `publicBrowser`（复用 `internal/browserfetch`，`hasNativeWebMCP: false`，账号导入诚实报 `unavailable`）。 |
| **C 类 · 显式阶段门控** | **2 组 / 25 方法** | `modelConnections`（22）、`updater`（3） | **整个 Stage 2 不接管生产写入**：`modelConnections` 并存期仅复用既有凭证宿主或提供只读元数据（完整 OAuth/JWT/vault 写者切壳推迟至 Stage 3 独占切换评审）；`updater` 本地实验壳诚实返回 `unavailable`。 |

---

## 4. 详细技术设计（按纠偏后切片）

### 4.1 M2.1a：`molly-core` 父进程死亡感知与固定端点监管器（仅 CLI + Go，零打包风险）

1. **`cmd/molly-core/main.go` 增加 stdin EOF 退出契约**：
   - 新增 `--watch-stdin`（或在 `--serve-ipc` 下可选开启）：后台 goroutine 阻塞读取 `os.Stdin` 至 EOF，一旦父进程退出或被 `SIGKILL`，立即触发 `cancel()` 关闭 IPC server、取消在途 `connCtx`（含在途生图请求）并退出，消除孤儿进程。
   - 保持 `core.composition` 响应结构（`name`、`version`、`goVersion`、`goos`、`goarch`、`composition.capabilities.{localOnly,telemetryEnabled,cloud}`）。
2. **`apps/cli/src/mcp/molly-core-supervisor.ts`**：
   - 在监管器构造时一次性生成固定私有 `0700` 运行时目录、短路径 socket（macOS `sun_path < 104 B`；Windows `\\.\pipe\molly-core-<rand16>`）与 32 字节 CSPRNG hex `authToken`，整个 daemon 生命周期不变（core 重启复用同一端点）。
   - 解析 `molly-core` 二进制顺序：① 显式 `MOLLY_CORE_BIN`（开发/测试）；② 相对 CLI 入口目录（`../molly-core/molly-core[.exe]`）。缺失时记录一次性日志并保持休眠（TS 默认路径继续工作）。
   - 子进程以 `stdio: ['pipe', 'ignore', 'pipe']` 拉起，stdin 管道保持打开作为死亡信号；仅向子进程私有 `env` 传 `MOLLY_CORE_IPC_TOKEN`（绝不写入 daemon `process.env`）。
   - 就绪探测通过 `callMollyCoreIpc(socketPath, 'core.composition', {}, signal, { authToken, requireMutualAuth: true })` 严格校验 `res.composition.capabilities.localOnly === true && res.composition.capabilities.telemetryEnabled === false && res.goos && res.goarch`。
   - 停止时先封入口标记 `stopping = true`、关闭 stdin + `SIGTERM`（3s 宽限）+ `SIGKILL`，确认子进程退出后再清理本代私有 socket 目录。
3. **分步激活调用路径**：
   - `molly-fleet.ts` 先初始化监管器固定端点对象（不阻塞 daemon 启动 5 秒），并行启动 core 监管与 `McpHttpHostSupervisor`，向 `molly-mcp-http-host` 子进程传入固定端点私有 env；
   - `PersonalMemoryService.open(dbPath, { coreEndpoint })` 显式接收端点解析结果；启动即启用 Go 后端的实例在 core 异常时直接报错（不静默回退 `better-sqlite3` 双写）；
   - Image MCP 仅在派发前判断 core 是否就绪，已派发后失败绝不重放回退 TS。

### 4.2 M2.1b：Electron 打包封印接入与冒烟探针

1. 新增 `apps/electron/scripts/molly-core-resources.mjs`：为目标平台/架构暂存 `molly-core`（Windows 为 `molly-core.exe`），生成符合 `prepareEmbeddedHarnessSigning` 规范的 `manifest.json`：
   ```json
   {
     "version": "0.1.0-m2.1",
     "platform": "darwin",
     "arch": "arm64",
     "files": [{ "path": "molly-core", "sha256": "<hex>" }],
     "buildId": "<sha256(JSON.stringify(files))>"
   }
   ```
2. `apps/electron/scripts/eb-after-pack.mjs` 复制 `resources/molly-core/` 至 `app.asar.unpacked/resources/molly-core/`、校验 manifest；仅当目标平台与当前构建主机同平台同架构时执行 `molly-core --check-local-composition` 冒烟探针，交叉构建如实打印跳过日志。
3. `apps/electron/scripts/sign-embedded-harness.mjs` 将封印目录参数化为列表，纳入 `resources/molly-core`（复用 `prepareEmbeddedHarnessSigning` 在根 `.app` 签名前完成 Mach-O 仅签名变更校验与 `manifest.json` 重封）。
4. M2.1 阶段保留 `sharp` 作为打包期安全网，不提前删除。

### 4.3 M2.2：密钥库兼容与原子重封验证引擎（`internal/security`）

1. **平台密钥读写（零 CGO）**：
   - `internal/security/keychain_darwin.go`：基于 `github.com/ebitengine/purego` 调用 `Security.framework` / `CoreFoundation.framework`，显式声明 `OSStatus`/`UInt32` 与出参类型，密码缓冲区由 `SecKeychainItemFreeContent` 释放、CF 对象按 Copy/Create 所有权 `CFRelease`、Global CF 常量经 `Dlsym` 二次解引用；支持显式传入测试 Keychain 路径用于隔离验收；非交互读取统一设 `kSecUseAuthenticationUI=Fail` 并禁止在 UI 主线程调用。
   - `internal/security/dpapi_windows.go`：基于 `golang.org/x/sys/windows` 封装 `crypt32.dll` `CryptUnprotectData` / `CryptProtectData`（`CRYPTPROTECT_UI_FORBIDDEN`）。
2. **`internal/security/vault_migrate.go`（离线/隔离验证与源摘要防脑裂）**：
   - 严格校验 `schemaVersion: 1` 全字段兼容（包括 `entries`、`image`、`legacyImages`、`mcp`、`installationId` 缺席及历史 OAuth 字段）；
   - 先将源 `model-connections.enc` 原子备份为 `0600` `model-connections.enc.bak`（已有则比对 SHA-256，不覆盖历史备份）；
   - 生成 32 字节 CSPRNG 主密钥写入独立 Keychain/DPAPI 项（支持崩溃后幂等恢复），以 AES-256-GCM + AAD（渠道 + 版本 + 源 `.enc` SHA-256）原子发布 `model-connections.v2.enc`（`MV2\x01` 头部包含源 `.enc` SHA-256）；
   - 重入校验：读取 v2 时必须核对头部源摘要仍匹配当前 `.enc`（若 Electron 曾再次写入 `.enc`，立即拒绝过期 v2 并报错要求重新迁移）。

### 4.4 M2.3a–d：MyGo 桌面实验壳分步切片（`cmd/molly-desktop/` + `internal/shell/`）

1. **M2.3a（只读工作台壳 + Loro 中继 + G5 安全门）**：
   - 顶层 MyGo Native 窗口挂载真实构建的 `apps/electron/out/renderer`；
   - `preload.js` 提供 `window.__MOLLY_ELECTRON__`、`window.__MOLLY_PLATFORM__`、`window.ipc.{invoke,on,send}`（保留推送订阅/退订/早到事件缓冲）；
   - Go 侧 `mygo.Bind` 入口强制校验 `mygo.CallerPage(ctx) == workbenchPage` + 文档代次 + 13 组白名单 + 方法级参数校验，保证画布/渲染/浏览器页与旧文档无法调用工作台桥接；
   - 实现 A 类 6 组（含 `loro_relay.go` 遵循 wire v7、32 MiB 单帧、64 MiB 出队上限、15s ping / 45s idle 与导航/销毁合成 `detach`），验收冷启、会话读取、重载与重连；
   - 实现 `molly-design://` 自定义协议安全门：统一 `X-Molly-Capability-Token`、Bento CSP 保持 `default-src 'none'` 且禁子帧、支持真实 64 MiB Bento 载荷与入口内存预算控制（采用受控本机回环或分块预算传输避免原生层无界拷贝）、覆盖 `OnWillNavigate`/原生 `LoadURL`/重定向/弹窗/销毁时的令牌撤销，关闭 G5 全部实机负向用例。
2. **M2.3b（只读 Bento 画布 + 独立离屏导出引擎 — 推进 G3）**：
   - 开放 `design` 组只读加载、实时预览与 1×/2×/3× 离屏 PNG/JPEG 导出；
   - `exporter.go` 逐瓦片校验真实像素尺寸/DPR/坐标，采用文档级动态 bleed（按元素最大阴影偏移 + 模糊半径计算，替代硬编码 64 px）与每瓦片合成完成信号，对超出单帧预算的大尺寸输出采用有界策略或显式拒绝/回退，并输出与 Electron `offscreen: true` 的接缝/透明度/字体逐像素 diff 报告。
3. **M2.3c（Bento 编辑保存 + 共享权威回合门 — 推进 G2）**：
   - 复用 Node `design-worker` 在隔离作品上验收 `applyCommands` / `flush` / CAS 保存 / 重开 / 冲突；
   - 随后接入权威 `design/canvas-host` 回合协调协议，验收跨壳 flush、活动回合拒写、断连只读、提交后重载与退出排空 worker。
4. **M2.3d（外围壳服务）**：
   - 接入 `app`、`notifications`、`image` 与 Untrusted `publicBrowser`（独立 `mygo.NewSession` + `internal/browserfetch`，诚实上报 `hasNativeWebMCP: false`）；`modelConnections`（只读/复用宿主）与 `updater`（`unavailable`）保持显式门控。

### 4.5 M2.4：独立实验包闭包、Spec 同步与 M2.4 门禁验收报告

1. **实验包资源闭包（`scripts/package-mygo-desktop.mjs`）**：打包 `molly-desktop` + `molly-core` + 独立 Node ≥22.19 运行时 + `cli/index.js` + `design.js` + N-API 绑定 + 密封 Pi harness + 校验版 Bento 资源 + `resources/licenses`，调用 `prepareEmbeddedHarnessSigning` 封印全部嵌套原生目录，并在干净 profile 下从安装位置启动验收。
2. **Spec 同步**：仅更新 `draft` 状态的受影响 Spec（`molly-embedded-pi-harness.zh.md`、`molly-design-independent-release.zh.md`、`graphic-design-platform.zh.md`、`agent-browser-webmcp.zh.md`），标记对应英译为 `stale`；绝不触碰 `approved` Spec。
3. **M2.4 实证报告与双模型终审**：输出 `.agents/notes/proposed/architecture/2026-11-24-mygo-stage2-m24-gate-report.zh.md`（G2 进程树对照包含 Node daemon RSS），并按 Stage 1 同等流程完成 `claude-opus-5-5 high` + `gpt-6.2-sol xhigh` 双模型 0 P0/P1 终审后提交。

---

## 5. 收敛后的里程碑与独立止损门禁

| 里程碑 | 交付切片 | 强制退出门禁（Go/No-Go） |
|---|---|---|
| **M2.0** | 本提案双模型架构评审定稿 + `mygo@v0.10.0` API 探针 + 隔离原型独立实测（G5 原生入口、G3 逐瓦片捕获、G2 首屏与会话读取）+ 所有者确认新增依赖 | 架构评审无未决 P0/P1；新增 `mygo`/`purego` 获显式确认；独立原型实测数据落盘 |
| **M2.1a** | `molly-core` stdin EOF 退出 + `apps/cli/src/mcp/molly-core-supervisor.ts`（固定端点/token、不污染 `process.env`、显式注入 `PersonalMemoryService` 与 `molly-mcp-http-host`）+ 监管器/父进程强退单测 | `pnpm check`、Go 11/11 + `-race`、父进程强退与端点复用单测全绿；无需 `mygo` 即可独立投产 |
| **M2.1b** | `molly-core-resources.mjs`（`files[]` manifest）+ `eb-after-pack.mjs` / `sign-embedded-harness.mjs` 参数化封印 + 同平台冒烟探针 | Electron 打包探针与封印单测全绿；交叉构建如实标注跳过冒烟；保留 `sharp` 安全网 |
| **M2.2** | `internal/security/{vault_migrate,keychain_darwin,dpapi_windows}.go` + 隔离临时 Keychain 与旧格式夹具全覆盖测试 | 三平台 `CGO_ENABLED=0` 构建全绿；源摘要防脑裂、备份保护、崩溃恢复、非 UI 线程调用全过 |
| **M2.3a** | `cmd/molly-desktop/` + `internal/shell/` 只读工作台壳、A 类 6 组 + Loro v7 中继、完整 G5 协议门与 `mygo.Bind` 调用页/代次守卫 | G5 实机正负向（含旧文档/跨页调用桥接拒绝与 64 MiB 传输预算）全过；重载/断连/重同步通过 |
| **M2.3b** | `design` 只读画布与独立动态 bleed 离屏导出引擎 | G3 逐瓦片像素 diff（接缝/透明度/字体）与大尺寸有界保护报告达标 |
| **M2.3c** | `design` 隔离作品编辑保存（复用 Node `design-worker`）→ 接入共享权威 `design/canvas-host` 回合门 | 跨壳 flush、活动回合拒写、断连只读、提交重载与退出排空 worker 验证全过 |
| **M2.3d** | `app`、`notifications`、`image`、Untrusted `publicBrowser`（`browserfetch`） | `hasNativeWebMCP: false` 诚实上报、`modelConnections` 写与 `updater` 显式门控 |
| **M2.4** | `scripts/package-mygo-desktop.mjs`（含 Node ≥22.19 + 封印）、draft Spec 同步、M2.4 实证报告（含 Node daemon RSS 对照）、双模型只读终审 | 双模型终审 **0 P0 / 0 P1 Approve**；`pnpm format:check`、`pnpm check`、Go 全套与 `pnpm run docs check` 全绿后提交 |

---

## 6. 提请所有者显式确认的 3 项决策

1. **新增 Go 依赖与模块确认**：允许在根 [go.mod](../../../../go.mod) 引入 `github.com/egoist/mygo@v0.10.0`（MIT）与 `github.com/ebitengine/purego@v0.11.1`（Apache-2.0），继续严守 `CGO_ENABLED=0` 与 `!cloud` 纯本地边界。
2. **并存演进与 M2.1 先行策略确认**：先独立落地 **M2.1a/b**（在 Electron 下激活 `molly-core` 并保留 `sharp` 回退，零破坏、不碰密钥库双写），随后推进 **M2.2**（隔离验证）与 **M2.3a–d**（与 Electron 并存的 MyGo 实验壳 + 独立 Node ≥22.19 运行时闭包）；默认发布壳切壳维持以发布机补齐 G1 与 Windows 主机补齐 G4 为前提。
3. **OAuth 回退诚实边界确认**：认可 M2.2 独占切壳后一旦在 v2 发生 OAuth refresh token 轮换，回退旧版 Electron 的 OAuth 连接需重新登录（v2 头部绑定源 `.enc` SHA-256 防止双写脑裂）。
