# Molly 转向 MyGo 技术栈：Stage 3A 并存期收敛与本机可闭环门禁实施方案（R21 修订版）

Status: proposed
Date: 2026-11-25
Translation: pending
Related Proposal: [Stage 2 架构设计提案](2026-11-24-mygo-stack-stage2-design.zh.md)
Related Report: [Stage 2 M2.4 门禁评估报告](2026-11-24-mygo-stage2-m24-gate-report.zh.md)

## 摘要

本修订版吸收 R1–R20 二十轮只读对抗式架构评审的全部意见（GPT-6.2 Sol xHigh 已连续七轮 **0 P0** 且 R20 已闭合 Bento 许可清理/重试时序，本版彻底闭合其最后 2 项 P1；此前 Claude Code / Opus 5.5 已在 R15 给出 **Approve（0 P0 / 0 P1）**，当前 Claude Code 处于待重新登录状态），承接已提交的 Stage 2（commit `7544cadf`），定义 **Stage 3A（并存期收敛与本机可闭环门禁，本文范围）** 与 **Stage 3B（生产发布切壳与退役 Electron，继续维持 HOLD）** 的精确实施方案。

R21 关键收口如下：

1. **POSIX 派生端口与 Windows 隔离管道完全对称：严格限定于 MyGo `stdin` 监管实验目录，普通 POSIX 自定义目录沿用基线共用宿主租约（闭合 Sol P1-1）**：
   - POSIX 派生宿主端口（`20000 + uint32(sha256[:4]) % 40000`）与 Windows `-<scope>` 隔离管道采用完全统一的边界：**严格限定于 MyGo `stdin` 监管实验目录（`.molly-mygo-experimental` + `MOLLY_SUPERVISOR_TRANSPORT=stdin`）**；非 `stdin` 的新版 `molly start` / `daemon-runner` 遇 `.molly-mygo-experimental` 一律拒启（`experimental_dir_owned_by_mygo_shell`）；
   - **普通非实验 POSIX 自定义 `MOLLY_DATA_DIR`** 保持与基线 `7544cadf` 相同的 `profile.localCliHostPort` 宿主租约，使新旧两代 `molly start` / `daemon-runner` 在进入 `start.ts:143` 读写 `local-identity.json` 与 `machine-id` 之前即于同一内核 TCP 租约串行互斥，彻底消除跨代覆盖已发布本地身份的窗口。
2. **无硬链卷 `wx` 回退引入 `.wx-pending` 提交标记与失败回滚，杜绝残留前缀被当作有效 `machine-id`（闭合 Sol P1-2）**：
   - 标准 POSIX 卷继续走零空窗 `.tmp` + `fsync` + `fs.link(tmp, target)`；
   - 仅在普通 CLI 无硬链回退（`fs.link` 报 `EXDEV`/`EPERM`/`ENOTSUP`）时，在 `<file>.init.lock` 内：① 调用 `openSync(target, 'wx')` **之前**先写 `<target>.wx-pending`（记录期望值并 `fsync`）；② 若 `writeAllSync` 或 `fsyncSync` 失败（如 `ENOSPC`），立即在锁内关闭并回滚 `unlinkSync(target)` 与 `unlinkSync(.wx-pending)`；③ 仅在全写且 `fsyncSync` 完成后删除 `.wx-pending`；④ 所有读取入口（`readPersistedMachineId` / `loadOrCreateLocalIdentity`）见到 `.wx-pending` 即视目标为未提交（返回 `null` 入锁复核：内容与期望值全等则提交删标，截断前缀则替换修复），而合法历史非 UUID `machine-id` 无 `.wx-pending` 标记得以 100% 保留。

本提案在完成 R21 只读评审并获得所有者对决策项的显式确认前，不授权运行态实现或发布。

---

## 1. Stage 2 实证现状与 Stage 3A / 3B 边界切分

### 1.1 G1–G5 门禁状态与 Stage 3A 收敛目标

| 门禁 | Stage 2 结论 | Stage 3A 目标与本机可验证交付物 | Stage 3A 预期结论 | Stage 3B 外部前置（继续 HOLD） |
|---|---|---|---|---|
| **G1** | PARTIAL | 实验隔离 profile 内使用独立 Keychain 服务名（`Molly Experimental Safe Storage`）与 `MV2\x01` 读写自测，**绝不触碰生产 `.enc` 或生产 Keychain 项** | **PARTIAL**（保持） | 发布签名机 Developer ID（`TeamIdentifier=Q96C8424X6`）签名公证 + 生产 Keychain ACL 实测 + 跨壳写者租约 |
| **G2** | PARTIAL | 1) 官方自包含 Node 供给与 `--require-standalone-node` 零外链 dylib；2) `.molly-mygo-experimental` 归属标记 + 全顶层 `lstat` + Git 读写共用防重定向（剔除全部继承 `GIT_*` 后固定 `NOSYSTEM`/`GLOBAL=devNull`）+ `molly-core` `os.SameFile` 校验、直绑握手根与转义 `file:` SQLite URI；3) POSIX 复用内核 TCP `127.0.0.1` 租约 + `daemon-stop` 兼容（含 `17790`）+ Windows MyGo 专属隔离管道与无 `daemon.pid` 破坏跨代互斥；4) 全链路私有 `stdin` 握手下发高权令牌 + 实验 `harness/host` + Windows 启动前 Job Object + POSIX 先验 `runId` 三边界不动点清理（含 `mcp-tool-discovery.ts` 与 `harness-pi/environment.ts`）；5) 双向 `1_610_000 ms` 静默超时 + 全隔离沙箱整棵进程树基准 | **PASS**（macOS arm64 本地闭环） | Windows/Linux 目标包 CI 实测 |
| **G3** | PARTIAL | 3 组合成夹具（含 3000×2000 跨瓦片重阴影与跨瓦片 SVG `<image>`）无 `rAF` 依赖且覆盖 HTML `<img>` + SVG `<image>` 解码的隐藏窗口采集 + 原生倍率/面积重采样区分 + 局部滑窗接缝检测 + `bleedPx=0` 负向变异必败验证 | **PASS** | 视需要补充字体/平台回归样本 |
| **G4** | BLOCKED | 维持 `publicBrowser.navigate` 默认关闭（`public_browser_disabled_pending_g4`）与 `GOOS=windows` 交叉编译通过；记录 WKWebView DNS 重绑定缓解评估供 Stage 3B 决策 | **BLOCKED**（保持） | Windows WebView2 实机 + 受控账号站点 OAuth/Cookie 注入 + WKWebView 连接时 IP 固定 |
| **G5** | PARTIAL | 分片 `molly-design://` 保存协议（`<= 4 MiB` 分片 + Preload 对象化 `doc` 与未引用素材预裁剪 + 统一 `64 MiB` UTF-8 上传与落盘 / `68 MiB` 双向帧 / `128 MiB` 活跃上传 + `256 MiB` 含修复总暂存上限 + `beforeSend` 提交点 + 成功前写回执 + 首次异常即先登记 `partial`/`uncertain` 再试重试 + 端到端结构化 `DESIGN_PROJECTION_PENDING` + `/save/repair` 透传当前 `writePermit` 衔接后续编辑 C + 幂等 `/save/status` + 同 surface 替换与 `15s` 闲置回收 + 移除 `ServeHTTP` 公共入口复制 + 不变严格 CSP） | **PASS（选 G5-B 且含单请求 `5 MiB` + 全局 `32 MiB` + 无入口复制验证）** 或 **PARTIAL-BOUNDED（选 G5-A）** | 若选 G5-A，需等待上游 `mygo` 合并 `scheme.go` 单请求 + 全局在途字节预算补丁 |

### 1.2 不可破坏的 Stage 3A 安全与架构不变量

1. **实验数据根归属、全顶层扫描、Git 配置隔离与 `molly-core` `os.SameFile` + 转义 URI 硬绑定（P0）**：
   - **归属标记防接管自定义生产目录**：`RunDesktop`（Go `ValidateIsolatedShellPaths`）及 `MOLLY_ISOLATED_DATA_ROOT_STRICT=1` 下的 Node CLI / `design-worker` / `molly-core` 启动时，拒绝任何与 `~/.molly`/`~/.molly-preview`/`~/.lody`/Electron `userData` 重合（相等/祖先/后代）的路径及任意顶层符号链接，并强制校验 `<dataDir>/.molly-mygo-experimental`（`0600` 普通非软链文件；仅空/新建目录自动创建，已有非空目录缺标记直接拒绝启动 `refusing_non_experimental_data_dir`；Stage 2 遗留非空实验目录需换新目录或手动补标记）。
   - **Git `history.git` 读写全覆盖防重定向与用户配置隔离**：`apps/cli/src/design/history.ts` 的 `locate()`（`openRepository()` 亦经由其执行）在第一条 `git` 命令前调用 `assertSafeDesignHistoryRepository`，复刻 [gitstore.go:787](../../../../internal/gitstore/gitstore.go#L787) 拒绝 `.git` 文件/软链、`commondir`、`objects/info/alternates`、`objects/info/http-alternates` 及内部软链；每次 `git` 调用均**剔除全部继承的 `GIT_*` 环境变量**（含 `GIT_CONFIG_COUNT`、`GIT_CONFIG_PARAMETERS`、`GIT_COMMON_DIR`、`GIT_ALTERNATE_OBJECT_DIRECTORIES`、`GIT_OBJECT_DIRECTORY`、`GIT_WORK_TREE`），随后显式固定 **`GIT_CONFIG_NOSYSTEM=1`**、**`GIT_CONFIG_GLOBAL=os.DevNull`** 与 `--git-dir`/`GIT_DIR`。
   - **`molly-core` 数据根作用域 RPC 按 `os.SameFile` 授权、直绑握手根且使用转义 SQLite URI**：`stdin` 监管模式下，CLI 经 `molly-core` 私有 `stdin` 管道下发 `{ authToken, allowedDataRoot }`；`cmd/molly-core/main.go` 校验 `<allowedDataRoot>/.molly-mygo-experimental` 并记录 `allowedDataRoot` 规范路径及其 `os.FileInfo`：① 记忆 RPC（`main.go:83`）限定文件名必为 `preferences.sqlite`、直接父目录名必为 `memory`，从父目录层级做 `os.SameFile` 归属校验，若 `preferences.sqlite` 已存在另行 `lstat` 确认非软链普通文件，最终由 `internal/memory/store.go:81` 构造**逐段转义 `%`/`?`/`#` 的 `file:` SQLite URI**（附 `?mode=rwc`）直接打开 `filepath.Join(allowedDataRoot, "memory", "preferences.sqlite")`（杜绝 `modernc.org/sqlite` 剥离 `?` 参数导致路径截断逃逸，同时覆盖首次建库与已有库重开）；② `design.read` 与 `gitstore.list`/`gitstore.read`（`main.go:307`）通过 `os.SameFile(stat(req.DataRoot), stat(allowedDataRoot))` 验证身份，且实际 I/O 一律使用握手绑定的 `allowedDataRoot`；工作区文件工具 `view_image.inspect` / `image_mcp.edit` 保持工作区路径合同不变。
   - **分级运行时边界（诚实声明）**：Go 直接读写文件（`secrets/`、`tmp/`、`design-thumbnails-v2/`）经内核 **`os.Root`** 访问；`molly-core` SQLite（保留 WAL 与回切 TS 合同）与全部 Node 存储（经共享 `resolveIsolatedDataPath`）受归属标记 + 全顶层 `lstat` + 路径 containment + 末级 `O_NOFOLLOW` + Git 仓库校验约束，不宣称用户态路径 API 能防御同 UID 攻击者系统调用间隙并发换父目录的内核级 TOCTOU。
2. **全链路私有 `stdin` 管道令牌（零新增/高权令牌入 `env`/`argv`，P0）**：
   - 当 `MOLLY_SUPERVISOR_TRANSPORT=stdin` 时：
     1. **Supervisor & Coordinator 令牌**：Go 不向子进程 `env`/`argv` 写 `MOLLY_SUPERVISOR_TOKEN`，拉起 CLI 后经私有 `stdin` 管道发送一次性 `lody/supervisor-hello` 帧下发独立 `token` 与 `coordinatorToken`；`local-control-handler.ts` 对且仅对 **6 个主进程专属方法**（`harness/host`、`design/canvas-host`、`design/render-host`、`mcp/catalog-entry`、`browser/host`、`browser/pause-all`）强制常量时间校验 `X-Molly-Coordinator-Token`（缺/错返 `403`）；
     2. **MCP 与 `molly-core` 令牌同走私有 `stdin` 握手**：`molly-mcp-http-server.ts` 拉起 `molly-mcp-http-host` 后，经其既有私有 `stdin` 管道（不复用 fd 3）发送一次性启动握手帧同时下发 `mcpToolAuthToken` 与 `mollyCore: { socketPath, authToken }`（**绝不写入 `molly-mcp-http-host` 或 `molly-core` 的 `env`/`argv`**；`molly-core-ipc.ts` 优先读该内存握手状态；原有基线 `MCP_HTTP_TOKEN` 沿用既有机制）；`design/image-connection` 直接复用基线 [message-handler.ts:6092](../../../../apps/cli/src/lib/message-handler.ts#L6092) 的 `params.acquireCredential === true`——仅明文密钥签发强制验 `X-Molly-Mcp-Token` + 活跃租约，`!params.acquireCredential` 的 `molly_view_image` 只读作用域查询免令牌放行；
     3. **`browser/{host-status,execute,cancel}`** 无主进程令牌要求；`stdin` 监管下等 `molly-mcp-http-host` 就绪再发设计生图回合，真正回退 stdio MCP 时 `molly_view_image` 可用、`molly_image` 诚实报 `image_credentials_require_mcp_http_host`；渲染进程 `machineRpc.send` 仍封禁上述全部方法。
3. **单协调器、在途写屏障、全出口 close-freeze 无损退场与轻量分页 `design.pending`（P0/P1）**：
   - 仅当 `CLISupervisor.OwnsPrivateDaemon() == true` 时启动 `design/canvas-host`、`design/render-host` 与实验 `harness/host` 轮询；所有读取路径（含分页 `pending-associations` 枚举）在非私有或活动回合期间强制 `readOnly: true`（零写盘、不进入写屏障）；处于可写空闲态允许触发投影修复的非 `readOnly` 读取/`repair-projection` 与全部写盘 `design.*` 方法均**登记进入 `CanvasAccessGate.Write` 在途屏障**并在 `beforeSend` 校验 `AssertIdle`；
   - **全出口无死锁 close-freeze 保护、有界页面求值、按次许可绑定与零实例重拍放行**：`closeFreezes` 采用多持有者嵌套映射 `map[artworkID]map[ownerToken]permit` 并入 `CanvasAccessGate.isReadonlyLocked`/`refresh`/`Write`（`Write` 区分 `g.permits` 允许 `Preparing` 阶段落盘与 `g.closeFreezes` 仅允许 `!isActive`），由**按 `artworkID` 独立的后台合并刷新协程**（门级全局单调 `stateSeq`）与全画布有界 `Page.EvalContext`（覆盖主线程仍可调度而单页无响应场景，G5-A/G5-B 边界一致）及独立准备协程向唯一串行 exchange 循环入队回报避免单页无响应拖垮健康作品；Bento `flush(permit)` 先静默等待既有 `prevSaving` 落定再以新 `permit` 发起保存，且 `finally` 仅按单调 `flushRunSeq === runId` 清除 `writePermit`（配合 `Retry Save` 轮换许可）；`Flush` 在 `WaitApplied` 与 `inFlight` 排空后重拍存活实例快照（零实例或末实例注销后直接返回 `nil` 报 `OK: true`）；全部可取消退出否决收敛在 `OnBeforeQuit`（且遇 `winCloseInProgress` 对称拦截），区分 `confirming`（自拦截时 `OnQuitCanceled` 为空操作）与 `approved`（所有 `OnClose` 放行且无否决性 `OnWillQuit`），进程级拆除仅在不可逆 **`OnQuit`**（`mygo/app.go:322`）执行；`design.acknowledge` 在单次 worker 操作的同一 `withDesignLock` 内原子完成投影校验/修复与删标（作品目录缺失直接删标不 `mkdir`）；
   - `design.save`/`prepareForSend` 保留已知活动回合放行语义以支持 `queue`/`guide`；`design.settleNotes` 保留活动回合内内存批注结算能力。
4. **凭据隔离、沙箱隔离与默认目录零回归（P0/P1）**：
   - 实验壳 `modelConnections` 仅经 `os.Root` 读写 `<isolatedDataDir>/secrets/model-connections.v2.enc` 与独立 Keychain `Molly Experimental Safe Storage`；基准脚本全隔离 `HOME`/`MOLLY_DATA_DIR`/`MOLLY_ELECTRON_USER_DATA_DIR`/`--user-data-dir`/`XDG_*`；默认生产目录（`~/.molly`/`~/.molly-preview`/`~/.lody`）所有端点 100% 字节不变；不触碰 `approved` Spec；保持 `CGO_ENABLED=0` 与 `!cloud` 边界。

---

## 2. 复用阶梯分析（逐子系统决策）

| 子系统 | 检查的既有组件 | 选用层级与方案 | 拒绝更高阶梯的原因 |
|---|---|---|---|
| **官方独立 Node 供给（M3A.1）** | [package-mygo-desktop.mjs](../../../../scripts/package-mygo-desktop.mjs)、[check-node-runtime.mjs](../../../../scripts/check-node-runtime.mjs)、[package-kimi-runtime.mjs](../../../../scripts/package-kimi-runtime.mjs) | **直接复用校验 + 借模式**：复用 `package-mygo-desktop.mjs` 既有校验，新增 `scripts/fetch-standalone-node.mjs` 锁定版本与 SHA-256 落盘至 `.cache/standalone-node/` | 本机 Homebrew `node` 含外部 ICU dylib，不满足自包含打包门禁 |
| **宿主租约与跨平台零破坏互斥（M3A.1）** | [local-cli-host-lease.ts:76-99](../../../../packages/shared/src/node/local-cli-host-lease.ts#L76-L99)、[local-ipc-socket-server.ts:70-235](../../../../apps/cli/src/lib/local-ipc-socket-server.ts#L70-L235)、[cli-platform.ts:73](../../../../apps/cli/src/lib/cli-platform.ts#L73)、[const.ts:111](../../../../apps/cli/src/utils/const.ts#L111) | **POSIX/Windows 对称收口 + `.wx-pending` 回退提交协议**：POSIX 派生 TCP 端口与 Windows `-<scope>` 隔离管道均**严格限定于 MyGo `stdin` 监管实验目录**；普通非实验自定义目录全平台保留基线共用宿主租约（新旧 `molly start`/`daemon-runner` 在身份读写前串行互斥）；无硬链卷 `wx` 回退以 `.wx-pending` 标记 + 失败回滚杜绝截断前缀被当作有效 `machine-id` | 让普通 POSIX 自定义目录换用派生端口会绕开旧代 `molly start` 的固定端口租约，导致旧代 `writeFile` 覆写已发布的 `local-identity.json`；无提交标记的 `wx` 短写遇 `ENOSPC` 会留下非空前缀被基线校验误认 |
| **`molly-core` 转义 `file:` URI + 父目录 `os.SameFile` + Git 全量清除（M3A.1）** | [internal/memory/store.go:89,542](../../../../internal/memory/store.go#L89)、[cmd/molly-core/main.go:83,307](../../../../cmd/molly-core/main.go#L83)、[history.ts:67-90](../../../../apps/cli/src/design/history.ts#L67-L90) | **适配复用**：`store.go` 共用 `sqliteFileURI(path, mode)`（`:89` 用 `rwc`，`:542` `ImportLegacyMem0File` 用 `ro`）；父目录 `os.SameFile` + 已有文件 `lstat`；`design.read`/`gitstore.*` `os.SameFile` 后直用握手根；`history.ts` 全量剔除 `GIT_*` 后再固定 `NOSYSTEM`/`GLOBAL=devNull` | `modernc.org/sqlite@v1.63.0/conn.go:73` 会剥离原始路径 DSN 中 `?` 及后续部分，必须改用转义 `file:` URI |
| **POSIX 全受管子进程 `runId` 透传与三边界清理（M3A.1）** | [session-sandbox.ts:311](../../../../apps/cli/src/session/session-sandbox.ts#L311)、[mcp-tool-discovery.ts:53](../../../../apps/cli/src/mcp/mcp-tool-discovery.ts#L53)、[packages/harness-pi/src/environment.ts](../../../../packages/harness-pi/src/environment.ts) | **适配复用**：覆盖全部 Molly 受管子进程透传 `MOLLY_SUPERVISOR_RUN_ID`，停机/CLI 崩溃/新代启动三边界先验 `runId` 再 `SIGKILL`，诚实声明 `env -i` 边界 | 覆盖全部受管白名单环境构造器且绝不误杀无关复用 PID |
| **G5 预规范化 + 首次异常即先登记 `partial`/`uncertain` + 带许可 `/save/repair`（M3A.2）** | [boot.ts:268](../../../../packages/design-bento/bento/slides/src/a1a2/boot.ts#L268)、[store.ts:332,449](../../../../apps/cli/src/design/store.ts#L332)、[design-entry.ts:79](../../../../apps/cli/src/design-entry.ts#L79)、[canvas_host.go:245,444](../../../../internal/shell/canvas_host.go#L245) | **适配复用**：Preload 预解包 `doc` + 裁剪未引用素材统一 `64 MiB`；首次落盘异常/超时即先写 `partial`/`uncertain` 再试立即重试（即使重试被 `Flush` 写门拒也不丢状态）；`/save/repair/<uB>` 透传当前 `writePermit` 统一裁决 | 若等到重试失败才登记，一旦 `Flush` 在首次返回与立即重试间冻结画布，重试被写门拒后将丢失恢复状态 |
| **G3 无 `rAF` 采集 + Bento `flushRunSeq` 隔离旧保存、`WaitApplied` 后重拍与串行回报（M3A.3 / M3A.4）** | [canvas_host.go:130,192,250,304](../../../../internal/shell/canvas_host.go#L130)、[app.go:278,309,331](../../../../internal/shell/app.go#L278)、[product-session.ts:499,797](../../../../packages/design-bento/src/product-session.ts#L499)、[store.ts:487,502](../../../../apps/cli/src/design/store.ts#L487) | **1:1 合同 + 全竞态闭合**：`SetReadonly`/`EditorState`/`Flush` 全用有界 `Page.EvalContext`（G5-A/G5-B 统一限定于主线程可调度场景）；Bento `flush(permit)` 先 `prevSaving.catch(() => {})` 再以新 `permit` 落盘，且 `finally` 按单调 `flushRunSeq === runId` 清理（`Retry Save` 同步轮换许可）；`Flush` 在 `WaitApplied`+`inFlight` 后重拍存活实例；独立准备协程入队唯一串行 exchange 循环 | 按字符串比较 `writePermit === permit` 在 `Retry Save` 复用许可时仍会被旧调用 `finally` 误清触发 `423`；改用单调 `flushRunSeq` + 许可轮换彻底闭合 |

---

## 3. 详细技术设计（M3A.1 – M3A.5）

### 3.1 M3A.1：G2 闭环 — 自包含 Node、转义 URI 绑定、隔离租约与全链路 `stdin` 令牌

#### 3.1.1 官方自包含 Node 运行时供给（`scripts/fetch-standalone-node.mjs`）

- 锁定官方 Node.js LTS 发行版本（满足 `>=22.19.0 <23 || >=23.6.0` 与 `NODE_API_VERSION >= 10`）及官方 `SHASUMS256.txt` 中 `darwin-arm64`、`darwin-x64`、`win-x64`、`linux-x64` 的归档 SHA-256。
- 仅解压单一 `node[.exe]` 至 `.gitignore` 忽略目录 `.cache/standalone-node/<version>-<platform>-<arch>/node[.exe]`（拒绝路径穿越与符号链接成员），校验归档 SHA-256、`node -v`、`process.versions.napi >= 10`、macOS `/usr/bin/otool -L` 零外部 dylib 与 `/usr/bin/lipo -archs`。
- `scripts/package-mygo-desktop.mjs` 在 `--require-standalone-node` 下消费 `MOLLY_STANDALONE_NODE_BIN` 或已验签缓存，确保 `nodeRuntimeSelfContained: true`、`nodeExternalDylibs: []`。

#### 3.1.2 隔离数据根归属、Git 隔离、`molly-core` 转义 URI 与 Windows 无 `daemon.pid` 破坏互斥

1. **目录规范化、`.molly-mygo-experimental` 标记与全顶层扫描**：
   - 端点派生统一规范化（TS 与 Go 100% 一致，附 golden vector 测试）：绝对路径 + Clean + 最深已存在祖先 `realpath` + 拼回未创建尾段 + 平台分隔符规范化（**所有访问授权判定均改用文件系统真实身份 `os.SameFile`**）。匹配 `~/.molly`/`~/.molly-preview`/`~/.lody` 任一默认根目录返回 **`scope = null`**（默认端点 100% 不变），否则 `scope = sha256(canonicalDataDir).slice(0, 16)`。
   - MyGo 启动入口 `ValidateIsolatedShellPaths` 校验 `dataDir` 不与生产目录或 Electron `userData` 重合，枚举 `dataDir` 下**全部顶层条目** `lstat` 禁符号链接，并要求 `<dataDir>/.molly-mygo-experimental` 存在（空/新建目录自动写 `0600` 标记；已有非空无标记目录拒绝启动，Stage 2 遗留旧实验目录需换新目录或手动补标记）。
   - Go 写 `secrets/`、`tmp/`、`design-thumbnails-v2/` 使用内核 `os.Root`；全部 Node 存储经共享 `resolveIsolatedDataPath` 在 `MOLLY_ISOLATED_DATA_ROOT_STRICT=1` 下统一校验。
2. **Git 读写共用入口防重定向与全量 `GIT_*` 清理**：
   - 在 `apps/cli/src/design/history.ts` 的 `locate()`（覆盖 `history-list`/`history-read`/`openRepository()`/`history-create`/`history-restore`/`recordBeforeAgentVersion`）执行第一条 `git` 命令前调用 `assertSafeDesignHistoryRepository`：校验无符号链接组件，复刻 [gitstore.go:787](../../../../internal/gitstore/gitstore.go#L787) 拒绝 `.git` 文件/软链、`commondir`、`objects/info/alternates`、`objects/info/http-alternates` 及内部 `objects`/`refs`/`HEAD` 符号链接；先**剔除全部继承的 `GIT_*`**（含 `GIT_CONFIG_COUNT`、`GIT_CONFIG_PARAMETERS` 等），再显式固定 **`GIT_CONFIG_NOSYSTEM=1`**、**`GIT_CONFIG_GLOBAL=os.DevNull`** 与 `--git-dir`/`GIT_DIR=repoPath`。
3. **`molly-core` 私有 `stdin` 握手、`os.SameFile` 绑定与转义 `file:` SQLite URI（关闭 Sol P0-1）**：
   - `cmd/molly-core/main.go` 扩展 `--watch-stdin`（新增 `--stdin-handshake`）：启动 IPC server 前先从私有 `stdin` 管道读取一次性 JSON 握手帧 `{"authToken":"<64-hex>","allowedDataRoot":"<absPath>"}`（后续继续监听 `stdin` EOF）；`molly-core-supervisor.ts` 在 `stdin` 监管模式下使用 `--stdin-handshake`（绝不写进子进程 `env`）；
   - 当 `allowedDataRoot` 非空时，`cmd/molly-core/main.go` 校验 `<allowedDataRoot>/.molly-mygo-experimental` 并缓存 `allowedRootInfo = os.Stat(allowedDataRoot)`：
     - **记忆 RPC（`main.go:83`）**：校验 `filepath.Base(dbPath) == "preferences.sqlite"` 且 `filepath.Base(filepath.Dir(dbPath)) == "memory"`；校验父目录归属（`memory/` 若存在验证 `lstat` 非软链目录且其父目录 `os.SameFile(allowedRootInfo)`；尚不存在时验证父目录 `os.SameFile(allowedRootInfo)`）；若 `preferences.sqlite` 已存在再另行 `lstat` 确认非软链普通文件；
     - **转义 `file:` SQLite URI（闭合 `?`/`#` 截断逃逸）**：`internal/memory/store.go`（`:89` 主库传 `mode=rwc`，`:542` `ImportLegacyMem0File` 只读导入传 `mode=ro`，共用 `sqliteFileURI(path, mode)`）打开数据库时，先将绝对路径规范为正斜杠形式并逐段转义 `%` → `%25`、`?` → `%3F`、`#` → `%23`，构造 **`file:<escapedPath>?mode=rwc`**（Windows 盘符前缀 `/C:/...`）传给 `sql.Open("sqlite", uri)`，确保 `modernc.org/sqlite@v1.63.0/conn.go:73` 绝不会截断含 `?`/`#` 的目录路径（同时覆盖首次建库与重开已有库，并保留既有 WAL 与回切 TS 合同；补充含 `?` 与 `#` 临时目录名的首次建库及重开单测）；
     - **`design.read` 与 `gitstore.list`/`gitstore.read`（`main.go:307`）**：对调用方 `dataRoot` 执行 `os.Stat` 并要求 `os.SameFile(reqInfo, allowedRootInfo) == true`，验证通过后**直接使用握手绑定的 `allowedDataRoot`** 执行读取；工作区文件工具 `view_image.inspect` / `image_mcp.edit` 保持工作区路径合同不变。
4. **POSIX/Windows 对称收口宿主租约与无破坏跨代互斥（闭合 Sol R20 P1-1/P1-2）**：
   - **POSIX 派生端口与普通自定义目录跨代边界（闭合 Sol R20 P1-1）**：
     - POSIX 上派生宿主 TCP 端口（`20000 + (uint32(sha256(canonicalDataDir)[0:4]) % 40000)`，支持 `MOLLY_LOCAL_CLI_HOST_PORT` 覆盖，与可选 `dataDirScope`）**与 Windows 隔离管道完全对称，严格限定于 MyGo `stdin` 监管实验目录（`MOLLY_SUPERVISOR_TRANSPORT=stdin` + `.molly-mygo-experimental`，非 `MOLLY_E2E=1`）**；业务 socket 位于 `<dataDir>/run/<ns>-{control,probe,loro-data-plane}.sock`（`MAX_UNIX_SOCKET_PATH_BYTES = 103`）；
     - 非 `stdin` 的新版 `molly start` 与 `molly daemon start`（`daemon-runner.ts`）检测目标目录存在 `.molly-mygo-experimental` 标记即拒绝启动（`experimental_dir_owned_by_mygo_shell`）；在**普通非实验 POSIX 自定义目录**上则**保持与基线 `7544cadf` 相同的 `profile.localCliHostPort` 宿主租约**，确保新旧两代 `molly start` / `daemon-runner` 在 `start.ts:108` 先于身份初始化（`start.ts:143`）在同一内核 TCP 租约上串行互斥，彻底消除旧代 `writeFile` 覆写新版已发布 `local-identity.json` 的并发窗口；
     - 在 POSIX 实验目录上，MyGo `CLISupervisor` 启动前亦预检 `<dataDir>/daemon.pid`、`run/daemon.json` 与 `run/daemon.lock`（存在存活旧代即 fail-closed 等待），并经 `.tmp` + `fsync` + `fs.link` 原子发布校验双身份后再拉起受管 CLI。
   - **Windows 管道隔离、父锁核验与无 `daemon.pid` 破坏跨代边界**：
     - Windows 上 `-<scope>` 隔离管道（`\\.\pipe\<ns>-{control,probe,loro-data-plane,agent-host}-<userSuffix>-<scope>`）**严格限定于 MyGo `stdin` 监管运行时（`MOLLY_SUPERVISOR_TRANSPORT=stdin` / `MOLLY_MYGO_ISOLATED_PIPES=1`，`mode: 'electron'`，由 `stdin` + Job Object 管控，不写入也不依赖 `daemon.pid`）**；
     - 新版 CLI `molly start` / `molly daemon start`（`daemon-runner.ts`）检测目标目录若存在 `.molly-mygo-experimental` 标记即拒绝启动（`experimental_dir_owned_by_mygo_shell`），在普通非实验 Windows 自定义目录上则保持与旧代共用既有未加后缀命名管道——使新旧两代 `daemon-runner` 在发布 `daemon.pid` 之前仍在同一命名管道互斥，绝不发生旧代覆盖新代 `daemon.pid`；
     - **Go supervisor 预检、`FILE_SHARE_READ` 不可删父锁 + 零空隙 `FileRenameInfo` 双身份发布与同锁凭据迁移**：在 Windows 实验目录上，MyGo `CLISupervisor` 启动前先预检（若 `<dataDir>/daemon.pid`、`run/daemon.json`、`run/daemon.lock` 存在存活 PID，或默认旧代 Host/probe/control 管道及 `MOLLY_E2E=1`/`LODY_E2E=1` 下的 `MOLLY_E2E_LOCAL_CLI_HOST_PIPE`/`LODY_E2E_LOCAL_CLI_HOST_PIPE` 活跃且归属无法排除本目录 → fail-closed 等待）；随后获取全拥有期 OS `LockFileEx` 锁 `<dataDir>/run/daemon-owner.lock`，清理已死 PID 残留的过期 `run/daemon.lock` 后，通过 Windows **`CreateFileW(..., GENERIC_READ|GENERIC_WRITE, FILE_SHARE_READ /* 禁 FILE_SHARE_WRITE 与 FILE_SHARE_DELETE */, CREATE_NEW)`** 创建并**在整个监管周期持续持有 `<dataDir>/run/daemon.lock` 打开句柄**，立即写入双行 `<supervisorPid>\n<supervisorInstanceId>\n` 并 `FlushFileBuffers`（Windows 内核以 `ERROR_SHARING_VIOLATION` 直接阻断任何旧代进程——包括先前读到空文件后延迟执行的 `unlinkIfExists`——删除或替换 `run/daemon.lock`，同时允许受管 CLI `O_RDONLY` 只读核验）。**在 `FlushFileBuffers` 之后、拉起受管 CLI 之前，Go 强制执行锁后二次复核**——重检 `daemon.pid`、`run/daemon.json`（存活 PID）、默认旧代 Host/probe/control 管道与 `MOLLY_E2E_LOCAL_CLI_HOST_PIPE`/`LODY_E2E_LOCAL_CLI_HOST_PIPE`：若任一旧代抢先启动并写入了 `run/daemon.json`，Go **立即回滚**（关闭句柄后删除自身 `run/daemon.lock`、释放 `daemon-owner.lock`）并 fail-closed；二次复核通过后、拉起受管 CLI **之前**，Go 与普通 CLI 的 **`apps/cli/src/lib/cli-platform.ts:73`（`local-identity.json`）** 及 **`apps/cli/src/utils/const.ts:111`（`machine-id`）** 按以下协议发布并保护双身份：
       1. **宽松校验与三类路径显式区分**：合法性校验与基线 1:1 一致（`local-identity.json`：`userId` 以 `local:` 开头且 `createdAt` 为字符串；`machine-id`：trim 后非空字符串，保留历史非 UUID 合法 ID）。对 `machine-id`，在同一把 `<machine-id>.init.lock` 内显式区分三类路径：**① 凭据迁移**（`readCredentialMachineId()` 非空且 `!== persisted`，按 `const.test.ts:63` 优先级最高，写完整 `.tmp` + `fsync` + 原子替换）；**② 首次初始化**（目标缺失，严禁覆盖他进程刚写完的有效 ID）；**③ 空/损坏残档修复**（锁内二次确认目标为空/损坏后原子替换并重读落盘值）；
       2. **Windows Go `FileRenameInfo` 零空隙持柄发布**：在拉起受管 CLI 之前（此时本代尚无任何调用方消费旧值），Go 先检查 `<dataDir>/credentials.json` 是否存在待迁移的 `credentialMachineId`；随后对 `local-identity.json` 与 `machine-id`：
          - 若目标文件已存在且合法（且无待执行的凭据迁移），直接以 `CreateFileW(target, GENERIC_READ, FILE_SHARE_READ, OPEN_EXISTING)` 打开并经该句柄重读校验合法后持续持有至停机；
          - 若需首次创建、残档修复或凭据迁移，Go 先以 **`CreateFileW(uniqueTmp, GENERIC_READ|GENERIC_WRITE|DELETE, FILE_SHARE_READ /* 禁写禁删 */, CREATE_NEW)`** 创建带唯一随机后缀的同目录 `.tmp`，写入完整校验字节并 `FlushFileBuffers`（`.tmp` 阶段无人读取，零空文件窗），再在**不关闭该 `FILE_SHARE_READ` 句柄的前提下**调用 Win32 **`SetFileInformationByHandle(h, FileRenameInfo, target, ReplaceIfExists)`**（首次创建 `ReplaceIfExists=false`；锁内确认空/损坏残档或凭据迁移 `ReplaceIfExists=true`，若因旧代瞬时读柄返回 `ERROR_ACCESS_DENIED` 则短退避有界重试后 fail-closed）将句柄原子就位至目标路径——文件一出现即 100% 完整且已受内核 `FILE_SHARE_READ` 禁写禁删保护，并持续持有该句柄至停机；若首次创建遇 `ERROR_ALREADY_EXISTS`/`ERROR_FILE_EXISTS`（旧代先落盘），关删 `.tmp` 并以 `GENERIC_READ`+`FILE_SHARE_READ` 打开目标重读校验：合法即持柄复用，空/损坏则以 `ReplaceIfExists=true` 原子接管；
       3. **普通 CLI（`cli-platform.ts:73` 与 `utils/const.ts:111`）`.wx-pending` 回退提交协议与失败回滚（闭合 Sol R20 P1-2）**：均在同一把 `<file>.init.lock`（`O_CREAT | O_EXCL` + 过期/死 PID 回收）内先重读复核目标文件，再准备完整校验字节：
          - **隔离实验目录（`ValidateIsolatedShellPaths` / `MOLLY_ISOLATED_DATA_ROOT_STRICT=1`）**：在 POSIX 上启动即校验数据目录所在卷支持硬链、`0600` 权限与 Unix 域套接字（否则 fail-closed 报 `unsupported_data_dir_filesystem`，拒绝 exFAT/FAT32 等非 POSIX 语义卷）；
          - **首次缺失时**：全部标准 POSIX 卷（APFS/ext4/XFS/btrfs/ZFS）写完整 `.tmp` + `fsync` 后执行 **`fs.link(tmp, target)`**（100% 原子不覆盖 + 完整字节可见 + 零短写，随后删 `.tmp`）；仅在普通非实验 CLI 遇到无硬链卷（exFAT/SMB 报 `EXDEV`/`EPERM`/`ENOTSUP`）时，在 `.init.lock` 内执行**带提交标记的 `wx` 发布**：
            1. **建档前先落盘 `<target>.wx-pending`**（写入 `{ expectedValue }` 并 `fsync`）；
            2. 调用禁止覆盖的 `fs.openSync(target, 'wx', 0o600)` + 循环全写 `writeAllSync(fd, completeBuf)` + `fs.fsyncSync(fd)` + `fs.closeSync(fd)`（若 `openSync` 报 `EEXIST` 则删 `.wx-pending` 并重读复用既有合法值；若 `writeAllSync` 或 `fsyncSync` 遇 `ENOSPC`/`EIO` 抛错，**立即在锁内关闭句柄并回滚 `fs.unlinkSync(target)` 与 `fs.unlinkSync(<target>.wx-pending)`** 后重抛）；
            3. **仅在 `writeAllSync` 与 `fsyncSync` 全部成功后才删除 `<target>.wx-pending`**；
            4. **读取入口未提交检测**：`readPersistedMachineId()` 与 `loadOrCreateLocalIdentity()` 每次读取前检查 `<target>.wx-pending`——若存在，视 `target` 为未提交残档返回 `null` 并进入 `.init.lock` 恢复（核对 `target` 内容是否与 `.wx-pending` 的 `expectedValue` 全等：全等则补 `fsync` 删标提交，若为截断前缀或空文件则原子替换修复并删标），从而彻底杜绝 `ENOSPC`/崩溃残留前缀被误当有效 `machine-id`，同时无 `.wx-pending` 的合法历史非 UUID `machine-id` 100% 保留；并诚实声明无硬链卷上与忽略 `.init.lock` 的非协作旧版非守护 CLI 直接并发调用 helper 时仍受限于无硬链卷缺少内核单一原子不覆盖原语（普通 POSIX 目录上的新旧 `molly start`/`daemon-runner` 已先由同一 TCP 租约 `start.ts:108` 互斥）；
          - 凭据迁移或锁内二次重读确认空/损坏残档时：写完整 `.tmp` + `fsync` 后以原子 `fs.rename(tmp, target)` 替换并重读落盘值返回，完整保留 `const.test.ts:63` 合同（注：Windows 实验目录运行期间若外部修改 `credentials.json`，因 Go 持柄而沿用启动期已锁定的持久化值，本地 OSS 实验目录无云凭据）；
       4. 停机时等 CLI 退出后再依次关闭 `machine-id` 句柄、`local-identity.json` 句柄、`run/daemon.lock` 句柄并删 `run/daemon.lock`、最后释放 `daemon-owner.lock`；
     - **受管 CLI 核验父锁而不自撞、旧代进程继续被阻断**：`apps/cli/src/lib/local-ipc-socket-server.ts:183` 在**且仅在**已验证 MyGo `stdin` 监管态（`MOLLY_SUPERVISOR_TRANSPORT=stdin` + 成功收到 `lody/supervisor-hello` 的 `{ supervisorPid, supervisorInstanceId }` + Windows `MOLLY_MYGO_ISOLATED_PIPES=1`）时，不调用 `withStartupLock(lockFilePath)`（避免撞父进程 `supervisorPid` 报 `local_ipc_lock_in_use`，并避免 `finally` 误删父锁），改为执行 **`verifySupervisorOwnedStartupLock(lockFilePath, supervisorPid, supervisorInstanceId)`**——只读打开 `run/daemon.lock`（与 Go 的 `FILE_SHARE_READ` 句柄兼容）校验两行精确匹配存活 `supervisorPid` 与握手 `supervisorInstanceId`（失配即 fail-closed 抛 `local_ipc_lock_owner_mismatch`），随后直接监听两个 `-<scope>` 隔离管道且**绝不删改 `run/daemon.lock`**；任何无握手的旧代 worker/runner 仍走原 `acquireStartupLock(run/daemon.lock)`，既无法 `unlink` 内核保护的父锁（`unlinkIfExists` 直接因共享冲突抛 `EBUSY`/`EPERM` 拒启）又会撞 `EEXIST`/存活 `supervisorPid` 报 `local_ipc_lock_in_use`；普通非实验自定义目录仍走原 `withStartupLock` + 未分域旧管道。
     - M3A.1 单测覆盖十类 Windows/POSIX 场景（① MyGo 先启：受管 CLI 只读核验 `FILE_SHARE_READ` 双行父锁启隔离管道且不删锁、失配拒启、旧代撞 `local_ipc_lock_in_use`；② 旧 runner 先启、MyGo 后启且旧代 `daemon.pid`/`daemon stop` 完好；③ **跨代并发启动竞争**：旧 worker 在 Go 预检后、发锁前发布 `run/daemon.json` 并释放短期锁 → Go 锁后二次复核检测并回滚，任意并发顺序至多一方取得目录；④ **旧版延迟 `unlink` 竞争**：模拟旧版判定空锁可删后暂停、Go 持 `FILE_SHARE_READ` 建锁写双行、旧版恢复 `unlinkIfExists` → 断言 Windows 句柄保护令 `unlinkIfExists` 直接因共享冲突抛错拒启且父锁完好；⑤ **Windows `FileRenameInfo` 零空隙双身份发布与跨代竞争**：验证 `.tmp` 持 `FILE_SHARE_READ` 句柄就位后旧代 `writeFile` 立即遭共享冲突拒写、`ERROR_ALREADY_EXISTS`/`ERROR_FILE_EXISTS` 复用既有合法值，且 Go 在持柄前完成适用的 `credentials.json` 迁移；⑥ **普通 CLI `cli-platform.ts` 与 `utils/const.ts` 凭据迁移 + `.wx-pending` 故障注入回滚/重启恢复**：覆盖 `const.test.ts:63` 凭据迁移、历史非 UUID 合法 ID 保留、以及无硬链回退下“首次短写 + 下次 `ENOSPC`”锁内回滚与崩溃留存 `.wx-pending` 截断前缀不被误认有效 `machine-id` 而被自动修复；⑦ **POSIX 普通自定义目录新旧 `molly start` 共用固定端口租约互斥**：验证新旧代在 `start.ts:108` 即串行、旧代无法在身份初始化阶段覆写 `local-identity.json`；⑧ `MOLLY_E2E=1` 下 `MOLLY_E2E_LOCAL_CLI_HOST_PIPE` 活跃时 Go 复核拒启及已死 PID 残留旧单行锁安全接管；⑨ 新旧 `daemon-runner` 在普通 Windows 自定义目录共用旧管道互斥且运行中 `daemon.pid` 与停止能力完好；⑩ 默认 `~/.molly` 全端点零回归）。
   - `daemon-stop.ts` 优先查当前端点，未命中 `matchesDaemon` 时依次回查旧默认端点与历史 `127.0.0.1:17790`，严守 `mode`/`pid`/`instanceId`/`controlToken` 校验（`/healthz` 增量返回 `dataDir`）。

#### 3.1.3 全链路 `stdin` 令牌鉴权、实验 `harness/host` 与先验 `runId` 三边界清理

1. **CLI `stdin` 握手与零 `env` 身份传递**：`MOLLY_SUPERVISOR_TRANSPORT=stdin` 下 Go 不向子进程 `env`/`argv` 写 `MOLLY_SUPERVISOR_TOKEN` 或 `coordinatorToken`，拉起 CLI 后经私有 `stdin` 管道发送一次性 `lody/supervisor-hello` 帧（含独立 `token`、`coordinatorToken`、`supervisorPid`、`supervisorInstanceId`，5s 超时）；`start.ts:273` 二次注册仅原子替换活跃 `shutdown` 回调指针。
2. **MCP 与 `molly-core` 同走私有 `stdin` 握手 + 复用 `acquireCredential`**：
   - `molly-mcp-http-server.ts:155` 拉起 `molly-mcp-http-host` 后，经既有私有 `stdin` 管道（不复用 fd 3）发送一次性启动握手帧 `{"type":"molly/mcp-host-hello","mcpToolAuthToken":"<64-hex>","mollyCore":{"socketPath":"...","authToken":"<64-hex>"}}\n`；`molly-core-ipc.ts` 优先读该内存凭据，严禁将 `MOLLY_CORE_IPC_TOKEN`/`mcpToolAuthToken` 写入子进程 `env`/`argv`；
   - `local-control-handler.ts` 在 `dispatchMachineRpc` 前执行常量时间比对：6 个主进程专属方法（`harness/host`、`design/canvas-host`、`design/render-host`、`mcp/catalog-entry`、`browser/host`、`browser/pause-all`）强制验 `X-Molly-Coordinator-Token`（`403`）；`design/image-connection` 在 `params.acquireCredential === true` 时强制验 `X-Molly-Mcp-Token`（`403`）+ `ownerSessionId` 活跃租约，`!params.acquireCredential` 的 `molly_view_image` 只读作用域查询免令牌放行；`browser/{host-status,execute,cancel}` 沿用既有鉴权；`stdin` 监管下等 `molly-mcp-http-host` 就绪再发设计生图回合，回退 stdio 时 `molly_view_image` 可用、`molly_image` 诚实返回 `image_credentials_require_mcp_http_host`。
3. **实验 `harness/host` 凭据宿主接线**：仅当 `CLISupervisor.OwnsPrivateDaemon() == true` 时启动实验 `harness/host` 轮询（携 `X-Molly-Coordinator-Token`），仅发布与签发 `<isolatedDataDir>/secrets/model-connections.v2.enc` 内的实验连接。
4. **跨平台先验 `runId` 三边界不动点子树清理**：
   - **Windows**：以 `CREATE_SUSPENDED` 创建 CLI → 绑定 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` Job Object → `ResumeThread`，长期持有 Job 句柄至该代退出。
   - **macOS / Linux**：启动前 `0600` 原子写 `<isolatedDataDir>/run/supervisor-active-run.json`，注入非机密标记 `MOLLY_SUPERVISOR_RUN_ID=<runId>`，在 `session/{session,session-sandbox}.ts`、`packages/harness-pi/src/environment.ts`（`createWorkerEnvironment`）与 `apps/cli/src/mcp/mcp-tool-discovery.ts` 全部显式透传；停机/CLI 崩溃/新代启动恢复三边界执行 `sweepRunSubtree(runId)`，每次 `SIGKILL` 前必先验明同 UID 且携带 `MOLLY_SUPERVISOR_RUN_ID=<runId>`（混入无关进程的 PGID 仅逐 PID 杀已验明成员），循环直至连续两轮零存活匹配进程。诚实声明用户命令主动 `env -i` + `setsid` 逃逸在 macOS 无 cgroup 时跳过不误杀。

#### 3.1.4 双向单计时器静默重置超时矩阵

- `sessionControl.send` 与 `localProjects.*` 使用非复用连接（`DisableKeepAlives: true`）+ 互斥保护的 `activityDeadlineConn`：建连成功及任一方向（`Read` 或 `Write` 返回 `n > 0`）均调用 `conn.SetDeadline(time.Now().Add(idleTimeout))` 同时刷新读写空闲预算，`http.Client.Timeout = 0`、`ResponseHeaderTimeout = 0`。
- 精确预算：`machine/acp-capabilities-refresh` = **`1_610_000 ms`**；`machine/acp-authenticate`/`machine/acp-binary-install` = `300_000 ms`；`session/file-send-local` = `120_000 ms`；`sessionControl` 默认 `10_000 ms`；`localProjects` 列表/历史同步 = `120_000 ms`，默认 `20_000 ms`。

#### 3.1.5 全隔离沙箱整棵进程树基准脚本（`scripts/bench-mygo-vs-electron.mjs`）

- 在 `os.tmpdir()` 创建 `<benchRoot>`，同时隔离 `HOME`、`MOLLY_DATA_DIR`、`MOLLY_ELECTRON_USER_DATA_DIR`、`--user-data-dir`、`XDG_CONFIG_HOME`、`XDG_DATA_HOME`，启动前硬断言全部位于 `<benchRoot>` 内、与真实 home / `Application Support` 零重叠且零 `.enc` 文件。采集 MyGo `.app` vs Electron 44 冷启耗时、稳态 10s 完整进程树 RSS 与 `.app` 体积对照。

---

### 3.2 M3A.2：G5 闭环 — 预规范化 `64 MiB` 预算、先登记后重试与带许可 `/save/repair`

#### 3.2.1 零入口复制、Preload 预规范化与明示暂存预算

1. **移除 `protocol.go:245` 公共入口无条件整稿复制**：先校验 scheme、surface 存活与 `CallerPage == ownerPage` 后再路由分派；`surface.payload` 改为不可变只读切片引用，仅 `GET /ws/<artworkId>` 直接写出，0 字节按请求复制。
2. **Preload 预规范化与三层自洽 UTF-8 预算**：
   - `BuildCanvasPreloadScript` 在计算字节数与 `save/init` 之前解包字符串 `doc` 为 JSON 对象，并按 [store.ts:332](../../../../apps/cli/src/design/store.ts#L332) 规则裁剪未引用历史素材（服务端 `store.ts` 保留权威二次校验）；
   - 上传上限（`save/init`）与规范落盘/重开上限（`store.ts:382` 与 `:448` `Buffer.byteLength(bytes, 'utf8')`）统一为 **`64 MiB` UTF-8 字节**；双向 worker 帧（Go `SetEscapeHTML(false)` + `design-entry.ts:25` `Buffer.byteLength` + Go scanner）统一为 **`68 MiB` UTF-8 字节**；
   - 磁盘暂存分项上限：活跃在途上传 **2 路并发 / `128 MiB`**（超限 `429`）；每打开画布至多保留 1 份 `partial`/`uncertain` 修复暂存（`<= 64 MiB`），全进程总磁盘暂存硬顶 **`256 MiB`**。

#### 3.2.2 端到端结构化错误、先登记 `partial`/`uncertain` 再试重试与 `/save/repair`（关闭 Sol P1-4）

1. **鉴权与分路由校验**：全部保存路由（`save`、`save/init`、`save/chunk`、`save/commit`、`save/upload` `DELETE`、`save/status` `GET`、`save/repair` `POST`）强制 `CallerPage == surface.ownerPage`、`!surface.IsRevoked()`、`surface.Editable`、`X-Molly-Capability-Token` 常量时间比对，保留 `AllowOpaqueCustomSchemeOrigin: callerVerified`；`save/chunk` 走专用二进制校验（`application/octet-stream`，`<= 4 MiB`）。
2. **`init` 丢回执防槽位耗尽**：同 surface 新 `save/init` 持锁原子中止删除自身旧 `active` 上传并释放活跃槽位；`active` 上传具 `15s` 无活动自动回收，启动时清扫 `<isolatedDataDir>/tmp/design-upload-*.tmp` 崩溃残余。
3. **端到端三跳结构化投影错误合同**：
   - **`apps/cli/src/design/store.ts`**：在首次发布 `design.json` 后（`:475`）与原样重试分支（`:449-456`）两处调用 `ensureCurrentProjection` 失败时均抛结构化 `DesignProjectionPendingError(revisionId, cause)`（`code: 'DESIGN_PROJECTION_PENDING'` + `revisionId`）；
   - **`apps/cli/src/design-entry.ts:79`**：错误 JSON 扩展为 `{ ok: false, error: message, code?: string, revisionId?: string }`；
   - **`internal/shell/canvas_host.go:444`**：解码为类型化 Go `*DesignWorkerError{ Message, Code, RevisionID }`。
4. **`beforeSend` 提交点、首次异常即先登记再试重试及 `/save/repair` 统一裁决（关闭 Sol P1-4）**：
   - `DesignWorkerClient.Request(ctx, req, beforeSend)` 出队写入 stdin 前最后瞬间调用 `beforeSend` 复核 `!surface.IsRevoked() && !upload.IsAborted() && canvasGate.IsWriteAllowed(artworkID, writePermit)` 并置 `upload.dispatched = true`；
   - **成功路径**：`saveFn` 成功返回 `revisionId` 后，服务端**先**写入 `surface.lastUnackedCommit = { uploadId, baseRevisionId, state: "done", revisionId, projectionReady: true, contentSha256 }` 并删除暂存，再写 HTTP `200 { ok: true, revisionId }`；
   - **首次异常即先登记再尝试立即重试（防止 `Flush` 冻结写门导致恢复状态丢失）**：
     - 一旦 `upload.dispatched == true` 且首次 `saveFn` 返回 `DESIGN_PROJECTION_PENDING`、30s worker 超时/崩溃或 `DESIGN_BUSY`，**在发起任何立即重试之前，服务端立即原子写入** `surface.lastUnackedCommit` 并保留 B 的 `0600` 暂存：
       - 遇 `DESIGN_PROJECTION_PENDING` → 先行登记 `state: "partial", revisionId: revB, projectionReady: false, spoolPath`；
       - 遇超时/崩溃/`DESIGN_BUSY` → 先行登记 `state: "uncertain", projectionReady: false, spoolPath`；
     - 随后尝试用原样 B 暂存 + 原 `baseRevisionId` A + 本次 `writePermit` 立即重试一次（经 `store.ts:451`）：
       - 若立即重试成功 → 升级 `surface.lastUnackedCommit` 为 `state: "done", revisionId: revB, projectionReady: true` 并删除 B 暂存，返回 `200 { ok: true, revisionId: revB }`；
       - 若立即重试因 **`Flush` 已冻结画布而被 `beforeSend` / 写门拒绝**、或再次返回 `DESIGN_PROJECTION_PENDING` / `DESIGN_BUSY` / 超时 → **原样保留上述已登记的 `partial`/`uncertain` 状态与 B 暂存文件**，向客户端返回 `500 projection_pending`（`partial`）或 `503 save_outcome_uncertain`（`uncertain`），绝不丢弃恢复状态；
   - **`POST /ws/<artworkId>/save/repair/<uB>` 统一裁决 `partial` 与 `uncertain` 并透传当前 `writePermit`**：
     - 当 B 处于 `partial` 或 `uncertain`、用户继续编辑为 C（含发消息触发带新 `writePermit` 的 flush）时，preload 查询幂等 `GET /save/status/<uB>` 后先向 `POST /ws/<artworkId>/save/repair/<uB>` 发送 `{ writePermit: reqC.writePermit }`（纳入同一 `CanvasAccessGate.Write` 门禁与在途等待），重放保留的 B 原载荷与原基线 A 经 `store.ts:451` 裁决：
       - B 已落盘（修投影）或未落盘（正常落盘）成功 → 转 `"done", revisionId: revB`，删 B 暂存，preload 前移 C 的 `baseRevisionId` 从 `A` 至 `revB` 并携同一 `reqC.writePermit` 保存 C（零粘滞 `409`）；
       - 外部 Agent 已推进磁盘至其他版本 → 返回真实 `409 DESIGN_CONFLICT`；
       - 仍 `DESIGN_BUSY`/`DESIGN_PROJECTION_PENDING` → 维持 `uncertain`/`partial` 并返回 `503`/`500`，保留 C 未保存编辑且持续阻止派发。
   - `GET /save/status` 严格幂等；`DELETE /save/upload/<uploadId>` 遇 `active`/`!dispatched` 即中止删文件，遇 `dispatched` 等待裁决返回结果。
   - M3A.2 回归用例覆盖：① 4 次换 15 MiB 图仅引用最后 1 张（20 MiB 规范稿）保存重开 + `63.9 MiB` 规范稿保存重开；② 连续 3 次 `init` 丢回执后第 4 次成功；③ B 首次报 `DESIGN_PROJECTION_PENDING` 后恰逢 `Flush` 冻结致立即重试被写门拒，验证 `partial` 状态与 B 暂存保留且后续携带新 `writePermit` 的 `/save/repair` 修复 B 并保存 C 成功；④ 30s 超时+`DESIGN_BUSY` 进 `uncertain` 后经 `/save/repair` 裁决保存 C；⑤ HTTP 丢回执 >60s 多次查 `/save/status` 幂等恢复。
5. **G5-A vs G5-B 诚实边界（提请所有者二选一）**：
   - **选项 G5-A（推荐默认，零 `mygo` fork）**：落地上述全部分片/预规范化/无入口复制/端到端 `DESIGN_PROJECTION_PENDING` 与先登记后重试 + `/save/repair` 协议（零新增 Go 依赖、零本地 fork），同时向上游 `mygo` 提交单请求 + 全局在途字节预算 PR；报告诚实标注 G5 为 **`PARTIAL-BOUNDED`**。
   - **选项 G5-B（Stage 3A 立即完全关闭 G5 至 `PASS`）**：在 G5-A 基础上，允许对 `github.com/egoist/mygo` 采用受审最小补丁/版本替换，在 `scheme.go` 入口同时施加 `5 MiB` 单请求上限 + `32 MiB` 全局在途字节信号量，并结合无入口复制一并验证处理器内存边界。

---

### 3.3 M3A.3：G3 闭环 — 隐藏窗口无 `rAF` 确定性采集（含 HTML/SVG 图片解码）与局部滑窗门禁

1. **隐藏 WKWebView 无 `rAF` 确定性采集信号（保留双类图片解码）**：遵循 Stage 1 `RAF_STALLED` 实证与 [specs/graphic-design-platform.zh.md:61](../../../../specs/graphic-design-platform.zh.md#L61)，禁止把 `requestAnimationFrame` 用作隐藏窗口硬门槛；复用 [internal/shell/app.go:720](../../../../internal/shell/app.go#L720) 与 [design-service.ts:1403](../../../../apps/electron/src/main/services/design-service.ts#L1403) 等待 `document.fonts.ready` + 全部 HTML `<img>.decode()` + 全部 SVG `<image>`（`href`/`xlink:href`）预加载解码 + 同步布局提交 + `MessageChannel` 确认 `tileReady(tileSeq)`（移除 60ms 竞态静默放行），随后 `CapturePage()` 合成快照。
2. **原生采样倍率区分与面积重采样**：报告显式记录 `hostNativeDPR`、`captureDPR`、`targetScale` 与 `resamplingMode`（`direct-1to1` vs 盒式/双线性 `area-resampled`）。
3. **三组夹具与局部滑窗门禁 + `bleedPx=0` 负向变异必败**：`sample-800x600.json`、`large-3000x2000.json`（含跨 `x=1536`/`y=1536` 瓦片边界的嵌入 data-URL SVG `<image>`）、`heavy-shadow-bleed-3000x2000.json`（动态 bleed `180 px` 跨 `x=1536` 接缝）；Electron 全隔离沙箱对照；`8×32`/`32×8` 局部滑窗接缝门禁（整图 MAE `<= 2.0/255`、Alpha MAE `<= 0.5/255`、局部接缝差 `<= 1.5/255`）+ `bleedPx=0` 负向变异必败 + 隐藏窗口无 `rAF` 采集单测。

---

### 3.4 M3A.4：安全并存期桌面壳能力补齐

#### 3.4.1 `machineRpc.previewFile` 与 `molly-resource://`

- 对齐 `LOCAL_TEXT_EDIT_BYTES = 512 * 1024`（`512 KiB`）、`LOCAL_TEXT_PAGE_BYTES = 64 * 1024`（`64 KiB`）与完整内联 Schema；**`attachment` 请求（`resourceOnly = true`）即使小文本也强制返回 `status: "resource"`**，兼容 [session-file-download.ts:47](../../../../packages/components/src/lib/session-file-download.ts#L47)。
- `LocalFileResourceStore` 用单把 `mu sync.Mutex` 互斥保护 `currentGen`、签发与撤销；维护活跃 reader 集合，导航/重载/关闭/LRU 淘汰立即置 `revoked = true` 并关闭全部活跃 reader；`64 KiB` 分块流式传输中，每块 `ReadAt` 后、写入响应前复核 `fstat` 版本与 `!revoked`。

#### 3.4.2 `design.*` 按作品隔离超时刷新、`Preparing` 许可分权与同锁原子 `acknowledge`（闭合 Sol P1-1/P1-2 & Opus P2-2）

- **全路径 `readOnly` 防磁盘修复 + 非只读修复入屏障（明示不与活动回合冲突）**：`store.ts`、`history.ts:229` 与 `design-entry.ts` 为 `read`/`history-list`/`history-read`/`pending-associations` 统一支持 `readOnly?: boolean`；在非私有态、状态未知或活动回合期间，Go 在 `beforeSend` 强制注入 `readOnly: true`（不写盘、**不进入** `CanvasAccessGate.Write` 屏障，绝不与 `AssertIdle` 冲突）；仅当 `ownsPrivateDaemon == true && gate.Known && !gate.IsReadonly(id)` 且需要修复投影时，才登记进入 `CanvasAccessGate.Write(id, "", ...)` 执行单作品修复。
- **`design.pending` 轻量分页枚举 + 逐件容错确认 + 同锁原子投影校验/修复删标**：
  - 保留既有 `pendingDesigns(dataRoot)`（供 Electron 与现有 `store.test.ts` 使用），在 `apps/cli/src/design/store.ts` 与 `apps/cli/src/design-entry.ts` 新增/扩展三项轻量 worker 操作：
    1. **`pending-associations`**（`{ operation: 'pending-associations', readOnly?: boolean, cursor?: string, limit?: number }`，默认 `limit = 100`）：`readOnly: true` 且 `design-pending` `ENOENT` 时直接返回 `{ items: [], nextCursor: null }`（绝不 `mkdir`）；对合法 UUID 文件名按字典序分页，逐件校验 `design.json` 并以 verify-only 模式检查 `ensureCurrentProjection(..., true)`，仅返回轻量 `{ items: [{ sessionId, association, revisionId, projectionStale }], nextCursor }`（**不含 `doc`/`assets`/`editing`**，单页 100 项 `< 64 KiB`，彻底杜绝多份大作品触发 `68 MiB` 帧上限）；在 `readOnly: true` 下若单件投影过期，仍返回已校验的规范关联并标 `projectionStale: true`（不写盘、不因单件投影过期中断整批恢复）；缺失 `ENOENT` 项照常跳过；
    2. **`repair-projection`**（`{ operation: 'repair-projection', sessionId }`）：在 `withDesignLock` 内执行 `read()` + `ensureCurrentProjection` 并仅返回轻量 `{ sessionId, revisionId }`（`< 1 KiB`）；
    3. **原子 `acknowledge`（`{ operation: 'acknowledge', sessionId, verifyProjection?: boolean }`，含目录缺失快速删标）**：扩展 `store.ts:502` `acknowledgeDesign(dataRoot, sessionId, { verifyProjection })`——当 `verifyProjection: true` 时，先 `lstat` 检查作品目录与 `design.json` 是否存在：若作品目录或 `design.json` 已 `ENOENT`，**不 `mkdir` 也不进 `withDesignLock`**，直接 `unlink(design-pending/<sessionId>)` 清理孤立标记（闭合 Opus P2-2）；若存在，则获取该作品的 **`withDesignLock`**，在**同一把锁内**依次执行 `read()`（若并发变为 `ENOENT` 则放行）→ `ensureCurrentProjection(directory, latest, assertHeld)` → `await assertHeld()` → `unlink(design-pending/<sessionId>)`，绝不拆成两次 worker 请求；若投影修复或锁校验失败，不删标并抛出错误。
  - Go 桥 `design.pending` 先分页拉满全部 `pending-associations`（`readOnly: true`），随后仅对 `projectionStale == true` 且处于 `ownsPrivateDaemon == true && gate.Known && !gate.IsReadonly(sessionId)` 的作品，逐一经 `CanvasAccessGate.Write(sessionId, "", ...)` + `beforeSend` `AssertIdle` 调用 `repair-projection`（单件修复失败或被回合打断不阻断其余作品恢复；活动回合/非私有态零写盘、不入写屏障），最终返回 `[{ association, revisionId }]`；
  - Go 桥 `design.acknowledge(sessionId)` 登记进入 `CanvasAccessGate.Write(sessionId, "", ...)` + `beforeSend` `ownsPrivateDaemon == true && AssertIdle`，发起**单次** `{ operation: 'acknowledge', sessionId, verifyProjection: true }`；
  - **React `usePendingDesignRecovery` 逐件容错 `acknowledge` 与可写补确认**：在 [design-canvas.tsx:1443-1474](../../../../packages/components/src/components/sessions/design-canvas.tsx#L1443-L1474) 的循环内将 `await service.acknowledge(association.sessionId)` 单独包裹 `try/catch`（对齐 [chat-landing.tsx:1523](../../../../packages/components/src/components/chat/chat-landing.tsx#L1523)）：单件 `acknowledge` 被写门拒绝时 `upsertDocMeta` 已落库且 `design-pending/<id>` 原样保留在磁盘，循环继续恢复后续作品，同时记入 `deferredAckIds` 并在后续转空闲/运行态就绪时（事件驱动，零轮询）经同一写门禁补发 `service.acknowledge(id)`（在单次同锁操作内完成投影校验/修复 + 清标）。
- **多持有者 `closeFreezes`、按次许可绑定、`WaitApplied` 后重拍与串行回报（闭合 Sol R17 P1-3/P1-4/P1-5 & Opus P2-1）**：
  - **`CanvasAccessGate` 门级单调序号 + 按作品独立刷新协程 + `WaitApplied` 后重拍 + 许可分权**：
    1. 新增多持有者嵌套映射 **`closeFreezes map[string]map[string]string`**（`closeFreezes[artworkID][ownerToken] = permit`）、**门级全局单调递增 `stateSeq uint64`**（永不因单作品刷新器重建归零）与按作品隔离的刷新状态 **`refreshers map[string]*artworkRefresher`**（含 `targetSeq`/`appliedSeq`/`appliedErr`/`appliedCond`/缓冲为 1 的 `refreshCh`/`stopCh`，在首实例注册时启动；末实例注销关闭 `stopCh` 时同步 `appliedCond.Broadcast()` 唤醒所有等待者）；
    2. **`isReadonlyLocked(artworkID)` 与每作品刷新**均检查 **`len(g.closeFreezes[artworkID]) > 0`**（对应 `reason: "processing"`）——同一作品存在多个并发冻结持有者时，仅当最后一位持有者释放后才恢复可写；`ReleaseCloseFreezeByOwner(ownerToken)` 仅删除内层 map 中对应的 `ownerToken` 条目（内层为空才删外层键），互不覆盖、互不误释；
    3. **按 `artworkID` 独立合并刷新协程 + 有界 `Page.EvalContext`（诚实界定主线程边界）+ `WaitApplied` 后重拍存活实例 + 串行回报（闭合 Sol R17 P1-3/P1-4/P1-5 & Opus P2-1）**：
       - 全部状态变更（含 `Disconnected`/`updating` 全局变化及单作品 `UpdateFromDaemon`/`Flush`/`AcquireCloseFreeze`/`ReleaseCloseFreezeByOwner`/`OnQuitCanceled`）仅**短持 `g.mu`** 更新状态、递增门级 `g.stateSeq++`、更新受影响（或全部活跃）刷新器的 `r.targetSeq` 并向 `r.refreshCh` 非阻塞投递即返回 `seq`（**主线程回调永不同步调用 `SetReadonly`/`Page.EvalContext` 或等待 `appliedCond`**）；
       - 每件作品各自的刷新协程从 `r.refreshCh` 唤醒后，短持 `g.mu` 取该作品最新 `readonly`/`reason`/`targetSeq` 与存活实例快照，释 `g.mu` 后严格按单调 `seq` 顺序调用 `inst.SetReadonly(evalCtx, seq, readonly, reason)`——**`internal/shell/app.go` 全部画布 `Page.Eval` 均改用带独立有界超时的 `Page.EvalContext`**：`SetReadonly`（`3s`）、`EditorState`（`3s`，超时即返回错误由 `confirmCanvasClose` 视状态未知立即弹出原生三选一对话框）、Bento `Flush`（`30s`）（Go 包装层与 JS preload 均拒收 `seq < lastAppliedSeq`）；**诚实界定边界（G5-A 与 G5-B 一致，闭合 Sol R18 P1-3）**：鉴于 MyGo v0.10.0 `Page.EvalContext`（`window.go:1853` / `bridge.go:169` / `window.go:886`）先经 `w.do` 同步在主线程提交求值再等待可取消通道，且 `internal/darwin/scheme.go:40-103` 在原生主线程同步调用 `HTTPBodyStream.read:maxLength:`，**无论选择 G5-A 还是仅限字节预算的 G5-B**，上述跨作品隔离与超时保障均限定于**原生主线程仍可调度、单个 WebContent 页面迟迟不回执**的场景（Stage 3A 保存分片 `<= 4 MiB` 避免常规路径卡住主线程；若流读取本身停滞于原生主线程，G5-B 的字节预算不提供主线程脱耦）；
       - **`Flush(artworkID)` 零实例快速放行 + 等待后重拍存活实例**：`Flush` 先写 `g.permits[artworkID] = permit` 取得 `permitSeq` → 调用 `WaitApplied(ctx, permitSeq, artworkID)`（若目标作品当前无任何存活画布实例、或等待期间末实例注销触发 `Broadcast()`，立即返回 `nil`）→ 排空已有 `inFlight` 写入 → **在 `WaitApplied` 与 `inFlight` 排空之后重新在 `g.mu` 下快照该作品的存活未销毁实例**（绝不复用等待前的旧实例快照！）：若重拍为零存活实例，直接返回 `nil` 确认准备成功（`OK: true`）；若对某实例调用 `Flush` 期间该实例注销/销毁且已无在途写入，复核 `g.mu` 确认其已注销后不误报失败；
       - **Bento `flush(permit)` 隔离旧保存失败并以单调 `flushRunSeq` 绑定每次调用（闭合 Sol R19 P1-2）**：将 [packages/design-bento/src/product-session.ts:797-807](../../../../packages/design-bento/src/product-session.ts#L797-L807) 的 `flush(permit)` 改为：新增模块/会话内单调递增 **`flushRunSeq`**，每次进入 `flush(permit)` 分配 **`const runId = ++flushRunSeq`**，先捕获既有 `const prevSaving = saving`、赋 `writePermit = permit`、再执行 **`if (prevSaving) await prevSaving.catch(() => {})`**（等旧保存落定但不继承其拒绝，保留 `flush()` 行 506 对真实 `409` `conflict` 的抛错检查），随后执行 `await flush()` 重新落盘；`finally` 严格改为 **`if (flushRunSeq === runId) writePermit = undefined`**（不再以许可字符串相等判断）——同时 Go 在超时/新 `turnID` 切换及 `confirmCanvasClose` 的 **`Retry Save`** 中均轮换为新随机许可，使即使复用同一许可字符串且旧调用在重试等待 `prevSaving` 期间拒绝，旧 `finally` 也绝不清空新调用的 `writePermit`（零误报 `423 canvas_readonly`）；
       - **独立准备协程 + 唯一串行 exchange 循环回报（闭合 Sol P1-3 & Opus P2-1）**：`UpdateFromDaemon` 以 `inFlightPrepare[turnID]` 去重，为每件待准备作品启动独立后台准备协程执行 `g.Flush(st.ArtworkID)`，完成后不发并发 exchange RPC（防旧回包快照乱序覆盖新状态），而是把 `DesignCanvasReport` 投递进**唯一串行 `design/canvas-host` exchange 循环的待发队列并立即唤醒发送**——挂死页面 B 绝不阻塞健康作品 A 的毫秒级回报，且所有 daemon 状态快照严格单调有序；
    4. **`Write(artworkID, permit, action)` 显式区分派发前许可与关窗许可**：要求 `g.known && !g.updating && ownsPrivateDaemon`：
       - **无许可常规写**：仅当 `!isReadonlyLocked(artworkID)` 时放行；
       - **派发前 flush 许可（`permit != "" && g.permits[artworkID] == permit`）**：允许在 **`!isActive || g.active[artworkID].Preparing`** 时放行（因为 `UpdateFromDaemon` 先将 `Preparing=true` 写入 `g.active` 再调 `Flush`，保障 Bento 派发前带许可落盘；一旦 `Preparing == false` 进入 Agent 正式执行阶段即严格拒绝）；
       - **关窗/退出冻结许可（`permit != ""` 匹配 `g.closeFreezes[artworkID]` 中任一持有者 `permit`）**：仅在 **`!isActive`** 时放行（绝不绕过活动/准备中回合），且 `Flush` 返回后因 `closeFreezes` 非空而自然保持冻结；
  - **统一 `confirmCanvasClose(artworkID, hostID, ownerToken)`**（始终运行于后台协程，绝不阻塞主线程）：
    1. 获取 `permit, wasWritable, freezeSeq, release := gate.AcquireCloseFreeze(artworkID, ownerToken)`，随后调用 `gate.WaitApplied(ctx, freezeSeq, artworkID)` 确认最新 `seq` 的 `setReadOnly(true)` 已生效；
    2. 若 `wasWritable` 且存在未保存编辑，携带 `permit` 经写门禁尝试 flush（返回后因 `closeFreezes` 非空，画布继续保持冻结）；
    3. 在**持续冻结状态下**采样 `window.molly?.state()`：若状态已知且 `dirty === false && saving === false && composing === false` → 返回 `(allowed: true, discarded: false, release)` 且**继续持有该 `ownerToken` 的 close-freeze**；
    4. 若状态未知或任一为真（含只读脏稿或 flush 失败）→ 弹出原生 MyGo 对话框（`Keep Editing` / `Retry Save` / `Discard`）：`Keep Editing` 立即调用 `release()`（短持 `g.mu` 仅删本 `ownerToken` 条目并向 `refreshCh` 非阻塞发信号）返回 `(false, false, nil)`；`Retry Save` 在持续冻结下先将 `closeFreezes[artworkID][ownerToken]` 轮换为新随机 `permit` 再重跑步骤 2–3（`!wasWritable` 不可保存则保持保护）；仅用户显式选 `Discard` 才返回 `(true, true, release)` 且**继续持有该 `ownerToken` 冻结**；
  - **四处出口闭环接线、关窗前统一否决与 `OnBeforeQuit`/`OnQuitCanceled`/`OnQuit` 分权**：
    1. **`design.close`**：在后台协程执行 `confirmCanvasClose(..., closeToken)` → 放行时在**仍持该冻结期间**撤销 surface、销毁视图并清理本地缩略图，随后再 `release()`（非阻塞调度刷新）；取消时直接返回 `false`；
    2. **`design.leave`**：在后台协程执行 `confirmCanvasClose(..., leaveToken)` → `Keep Editing` 返回 `false`；`Discard` 立即撤销并退役该画布实例（对齐 Electron [design-service.ts:1210](../../../../apps/electron/src/main/services/design-service.ts#L1210)）后 `release()` 返回 `true`；干净通过则 `release()` 返回 `true`（紧接的 `design.close` 会再次持 close-freeze 兜底中间间隙）；
    3. **窗口原生关闭 `win.OnClose(e *CloseEvent)`**（同时覆盖独立画布窗与承载内嵌画布的主工作台窗，遵循 MyGo `document_flow.go:231-263`）：若 `quitState == approved || winCloseApproved` 直接放行（不二次询问且绝不否决，画布仍由 `closeFreezes` 锁住）；若 `winCloseInProgress || quitState == confirming` 则 `e.PreventDefault()` 返回；否则**同步先 `e.PreventDefault()`** 置 `winCloseInProgress = true`（分配独立 `winOwnerToken`），在后台协程对 `e.Window` 全部画布依次执行 `confirmCanvasClose(..., winOwnerToken)` 并保持已确认画布持续冻结；任一选 `Keep Editing` 则在后台调用 `ReleaseCloseFreezeByOwner(winOwnerToken)` 并回主线程清 `winCloseInProgress`（保存通道与 surface 100% 完好）；全部通过则保持冻结，回主线程撤销其 surface 并销毁画布视图、非阻塞调用 `ReleaseCloseFreezeByOwner(winOwnerToken)`、置 `winCloseApproved = true`、清 `winCloseInProgress` 后调 `w.Close()` / `w.Destroy()`；
    4. **应用退出 `OnBeforeQuit` / `OnQuitCanceled` / `OnQuit` 三段分权（对称防并发 + 全部否决收敛在关窗前）**：
       - **不可破坏架构约束**：Molly 全部可取消的退出否决检查均收敛在 **`OnBeforeQuit`（关闭任何窗口之前）**；`quitState == approved` 后，所有窗口 `OnClose` 一律放行、**不注册任何可否决的 `OnWillQuit` 监听器**，彻底消除晚期否决遗留已关闭窗口/已吊销 surface 的状态分裂；
       - **`OnBeforeQuit(e *QuitEvent)` 严禁撤销 surface、严禁关闭 `DesignWorkerClient` 或 `CLISupervisor`**：
         - 遇 `e.SessionEnding`（OS 强制注销/关机，MyGo `app.go:290` 忽略 `PreventDefault`、自动取消弹窗且运行于主线程）：诚实记录无法交互确认或阻塞 JS flush，依靠已持久化文件与既有草稿兜底，由随后的 `OnQuit` 清理子进程；
         - 若 `quitState == approved` → 立即放行（随后各窗 `OnClose` 见 `approved` 直接放行不二次询问，画布保持冻结至 `OnQuit`）；
         - 若 `quitState == confirming` **或存在任一 `winCloseInProgress == true`**（与 `win.OnClose` 对称互斥，防止 macOS 非应用级模态 sheet 确认期间并发触发退出）→ 仅调 `e.PreventDefault()` 拒启新退出确认（不修改任何正在进行中的关闭/退出冻结）；
         - 若 `quitState == idle` 且无 `winCloseInProgress` → **同步先 `e.PreventDefault()`**，置 `quitState = confirming` 并生成新 `quitAttemptToken`（拒绝确认期间新开画布 attach），在后台协程遍历全部已打开画布依次执行 `confirmCanvasClose(..., quitAttemptToken)` 并持续保留每扇已确认画布的冻结；若任一画布选 `Keep Editing` → 后台调用 `ReleaseCloseFreezeByOwner(quitAttemptToken)`、回主线程置 `quitState = idle` 取消退出（全部窗口、画布、surface、`DesignWorkerClient` 与 `CLISupervisor` 100% 完好在线）；全部画布通过后保持全部冻结，回主线程置 `quitState = approved` 并调 `mygo.App.Quit()`；
       - **`OnQuitCanceled`**：
         - **若 `quitState != approved`**（包括我方 `OnBeforeQuit` 主动 `PreventDefault()` 进入 `confirming`、或因 `winCloseInProgress` 拦截退出）→ **严格空操作（`return`）**，绝不修改任何进行中的状态或冻结；
         - **仅若 `quitState == approved`**（防御性兜底外部意外否决）：复位 `quitState = idle`，并**非阻塞**调用 `ReleaseCloseFreezeByOwner(quitAttemptToken)` 释放该次退出尝试持有的冻结（仅短持 `g.mu` + 信号 `refreshCh`，绝不在主线程阻塞）；
       - **`OnQuit`**（`mygo/app.go:322`，仅在事件循环彻底退出、不可逆转后触发一次，覆盖正常退出与 `SessionEnding`）：撤销全部 surface、清空冻结、`cancelApp()`、关闭 `browserHost`、排空关闭 `DesignWorkerClient`、关闭 `relay` 并停止 `CLISupervisor`。
- **其余方法分权**：
  - `design.save` / `design.prepareForSend`：保留基线已知活动回合放行（支持 `queue`/`guide`）、已知空闲 flush、未知/`!ownsPrivateDaemon` fail-closed；
  - `design.settleNotes`：仅结算画布内存临时批注状态，不要求 `AssertIdle`，保留活动回合内结算路径；
  - 全部实际写盘修改类 `design.*`（`create`、`acknowledge`、`rename`、`copy`、`finishCopy`、`applyCommand`、`saveVersion`、`restoreVersion`）：全部**登记进入 `CanvasAccessGate.Write` 在途屏障**（确保回合前 `Flush` 等待所有在途写入完成）并在 `beforeSend` 复核 `ownsPrivateDaemon == true && AssertIdle`。
- `saveVersion`（`history-create` + `baseRevisionId` + `ReplaceAfterFlush` + `window.molly.rebase`）与 `restoreVersion`（40 位 hex + `history-restore` + `baseRevisionId` + `ReplaceAfterFlush` + `SyncFromStore`）1:1 对齐 Electron 合同；补齐 `selection`、`selectionSummary`、`highlight`、`compareAvailable`、`compareHold`、`cover`、`thumbnail`（经 `os.Root` 写入 560px PNG `0600` 缓存）。

#### 3.4.3 `modelConnections` 完整设置页合同（含图片连接与实验 `harness/host` 闭环）

- 只读内置元数据：移植 [bundled-capabilities.ts](../../../../apps/electron/src/main/services/bundled-capabilities.ts) 实现 `getBundledCapabilities`、`getModelCatalog`、`getModelMetadataSnapshot`（校验 `runtime-manifest.json` 平台/架构与文件 SHA-256）。
- 实验隔离凭据库（经 `os.Root` 读写 `<isolatedDataDir>/secrets/model-connections.v2.enc` + 独立 Keychain `Molly Experimental Safe Storage` + 进程内互斥与跨进程 `O_EXCL` 锁文件）：
  - 模型连接：`getSnapshot()`、`save`（`expectedRevision` CAS）、`delete`（CAS）；
  - 图片连接：`getImageSnapshot()`、`saveImage`（CAS）、`deleteImage`（CAS）、`checkImage`（符合 `CheckImageConnectionResult` 合同）；
  - MCP 凭据：`getMcpSnapshot()`、`saveMcp`（CAS）、`deleteMcp`（CAS）；
  - 每次写入成功后通知实验 `harness/host` 刷新发布目录至 MyGo 私有 daemon；其余 OAuth/恢复/发现方法返回符合 Electron Schema 的诚实不可用响应。

#### 3.4.4 `app.*`、`image.*`、`notifications.*` 契约对齐

- **`app.*`**：修正 `openExternalUrl`、`getFullscreen`（推 `app.fullscreen`）；补齐 `revealLocalPath`、`openLocalPath`（绝对路径 + 存在性校验，无 shell）、`setNativeTheme` + `app.nativeTheme`、`completeOnboarding`、`getPreventSleepEnabled`/`setPreventSleepEnabled`、`notifyRendererMounted`、`reportRendererFatalError`、`requestRendererReload`、`setLanguage`。
- **`image.*`**：修正 `saveAs`（`mygo.Dialog.Save` + `0600` 原子写入）；实现 `copyToClipboard`（先 `image/png.DecodeConfig` 校验再写 `mygo.Clipboard`）与 `showPreviewMenu`（`mygo.Menu`）。
- **`notifications.*`**：补齐 `openSystemSettings` 与诚实状态返回。

---

### 3.5 M3A.5：Stage 3A 门禁实证报告、Draft Spec 同步与双模型终审

1. 产出 `.agents/notes/proposed/architecture/2026-11-25-mygo-stage3a-gate-report.zh.md`，完整记录 G2 / G3 / G5 实测数据与 G1 (`PARTIAL`) / G4 (`BLOCKED`) / Stage 3B (`HOLD`) 结论。
2. 仅按需同步 `draft` 状态 Spec（绝不触碰 `approved` Spec），运行 `pnpm run docs check`、`pnpm check:public-boundary`、`pnpm check`、`pnpm format:check`、`GOFLAGS=-mod=readonly CGO_ENABLED=0 GOTOOLCHAIN=go1.27.3 go test ./...` 与 `GOOS=windows GOARCH=amd64 go vet ./...`。
3. 完成 `claude-opus-5-5 high` + `gpt-6.2-sol xhigh` 双模型只读终审（**0 P0 / 0 P1**）后，以 Conventional Commit（尾注 `Model: <runtime-model-id>`，按仓库 `AGENTS.md` 规范记录实际运行模型 ID）提交本地 `main`。

---

## 4. 里程碑与独立止损门禁

| 里程碑 | 交付切片 | 强制退出门禁（Go/No-Go） |
|---|---|---|
| **M3A.0** | 本提案 R21 只读对抗式架构评审（0 P0 / 0 P1）+ 所有者显式确认决策项 | 无未决 P0/P1 设计漏洞；所有者显式确认决策项后方可写运行态代码 |
| **M3A.1** | `.molly-mygo-experimental` 归属标记 + POSIX 实验目录校验本地硬链/`0600`/Unix 套接字卷 + 全顶层 `lstat` + Go `os.Root`（自有文件）+ Node 共享 `resolveIsolatedDataPath` + `history.ts` `locate()` 共用防重定向（剔除全部 `GIT_*` 后固定 `NOSYSTEM`/`GLOBAL=devNull`）+ `molly-core` `stdin` 握手、父目录 `os.SameFile`、全处转义 `file:` SQLite URI（`internal/memory/store.go`，`:89` `rwc`/`:542` `ro`）与 `design.read`/`gitstore.*` 直绑握手根 + `fetch-standalone-node.mjs` + POSIX/Windows 对称收口（派生端口与 `-<scope>` 管道仅用于 MyGo `stdin` 实验目录，普通自定义目录全平台保留基线共用宿主租约）+ `daemon-stop`（含 `17790`）+ Windows `FILE_SHARE_READ` 不可删双行父锁与 `FileRenameInfo` 零空隙双身份持柄发布 + 普通 CLI（`cli-platform.ts` + `utils/const.ts`）同锁凭据迁移/残档自愈/无硬链 `.wx-pending` 回退提交与失败回滚 + 锁后全量复核（含 E2E Host 管道）与受管 CLI 父锁核验 + 全链路私有 `stdin` 握手令牌 + `acquireCredential` 分权 + 实验 `harness/host` + Windows 启动前 Job Object + POSIX 全受管子进程先验 `runId` 三边界不动点清理 + 双向 `1_610_000 ms` 静默超时 + 全隔离沙箱基准 | `--require-standalone-node` 0 外链 dylib；默认 `~/.molly` 0 变更；已有非空无标记自定义目录及无硬链实验卷被拒；含 `?`/`#` 隔离目录名下 `molly-core` 首次建库与重开均仅打开授权根内 DB；区分大小写 APFS 同名不同目录被拒；Windows/POSIX 十类场景单测全绿（含 POSIX 普通自定义目录新旧 `molly start` 共用固定端口租约互斥不覆写 `local-identity.json`、`FileRenameInfo` 持柄就位防旧代覆写、`const.test.ts:63` 凭据迁移、历史非 UUID ID 保留、无硬链回退下短写+`ENOSPC` 锁内回滚与崩溃留存 `.wx-pending` 截断前缀不被误认有效 `machine-id` 而被修复、旧代延迟 `unlinkIfExists` 抛错拒启、跨代并发抢先发布 `run/daemon.json` 回滚、E2E Host 管道活跃拒启与运行中 `daemon.pid`/停止能力完好）；所有高权令牌零入子进程 `env`/`argv`；4 类 MCP 鉴权单测全绿；三边界先验 `runId` 清扫零误杀；全隔离沙箱基准落盘 |
| **M3A.2** | 移除 `ServeHTTP` 公共入口复制 + Preload 对象化 `doc` 与未引用素材预裁剪 + 统一 `64 MiB` UTF-8 上传/落盘与 `68 MiB` 双向帧 / `128 MiB` 活跃上传 + `256 MiB` 总暂存 + 端到端结构化 `DESIGN_PROJECTION_PENDING` + 分片保存（`init`/`chunk`/`commit`/`DELETE`/幂等 `status`/带当前 `writePermit` `repair` + 成功前写回执 + 首次异常即先登记 `partial`/`uncertain` 再试重试 + 同 surface 替换与 `15s` 闲置回收）+（若选 G5-B）`scheme.go` 单请求 `5 MiB` + 全局 `32 MiB` 补丁 | 真实 `DesignWorkerClient` + 真实 Bento `flush` 实测连续替换 4 张 15 MiB 图保存重开、`63.9 MiB` 规范稿保存重开、超 `64 MiB` 拒绝、连续 3 次 `init` 丢回执后第 4 次成功、B 首次报 `DESIGN_PROJECTION_PENDING` 后遇 `Flush` 冻结致立即重试被写门拒仍保留 `partial` 且经 `/save/repair` 修复并保存 C、30s 超时+`DESIGN_BUSY` 进 `uncertain` 后经 `/save/repair` 裁决保存 C、HTTP 丢回执 >60s 幂等恢复、CSP 保持 `connect-src 'self' data:` |
| **M3A.3** | 3 组 G3 合成夹具（含跨瓦片 SVG `<image>`）+ 无 `rAF` 且覆盖 HTML `<img>` + SVG `<image>` 解码的隐藏窗口采集 + 面积重采样 + `bench-g3-pixel-diff.mjs` + 局部滑窗接缝检测 + `bleedPx=0` 负向变异必败用例 | 隐藏窗口无 `rAF` 采集与 SVG `<image>` 跨瓦片夹具通过；原生 DPR 与重采样档均满足整图与局部接缝阈值；`bleedPx=0` 变异用例必败 |
| **M3A.4** | `machineRpc.previewFile`（`512 KiB` + 附件强制 `resource` + 互斥 `docGen` + 流式撤销与逐块复核）+ `molly-resource://`、`design.pending` 轻量分页 `pending-associations` + `store.ts` 单次同锁原子 `acknowledge(verifyProjection: true)`（目录缺失直接删标不 `mkdir`）+ `usePendingDesignRecovery` 逐件容错与事件驱动补确认、`design.*` 全路径 `readOnly` + 全量写入入 `CanvasAccessGate.Write` 在途屏障 + 保留 `PrepareForSend` 排队放行 + `CanvasAccessGate` 多持有者 `closeFreezes[artworkID][ownerToken]`、`Write` 区分 `g.permits`（允许 `!isActive \|\| Preparing`）与 `g.closeFreezes`（仅 `!isActive`）、门级单调 `stateSeq`、按作品独立刷新协程 + 有界 `Page.EvalContext`（G5-A/G5-B 统一诚实界定主线程可调度范围）+ `WaitApplied` 与 `inFlight` 后重拍存活实例快照 + Bento `flush(permit)` 隔离旧 `prevSaving` 失败并以单调 `flushRunSeq === runId` 清许可（`Retry Save` 同步轮换许可）+ 独立准备协程入队唯一串行 exchange 循环 + `quitState`（遇 `winCloseInProgress` 对称拦截、`confirming` 下 `OnQuitCanceled` 空操作、关窗前统一否决、`OnQuit` 不可逆拆除）+ `settleNotes` 允许活动回合结算、`modelConnections` 设置页完整合同（含 `saveImage`/`deleteImage`/`checkImage` + 实验 `harness/host`）、`app.*`/`image.*`/`notifications.*` 对齐 | 全部新增 Go/TS 单测全绿；双份 40 MiB 待关联作品（总 80 MiB > 68 MiB 帧上限，1 份过期投影在非私有/活动回合被延后确认）验证首件不阻断次件恢复、转空闲私有后同锁原子 `acknowledge` 修复投影并清标（并发保存 B 投影失败时不删标、缺失作品目录直接删标不 `mkdir`）；`Preparing=true` 下 `g.permits` 写盘成功、`Preparing=false` 及 `g.closeFreezes` 在 `Preparing=true` 下被拒；末实例在 `WaitApplied` 期间注销后重拍零实例、排空 `inFlight` 并由 daemon 收到 `OK: true`；旧回合或关窗 `Retry Save` 在旧 `flush` 尚未回执即启动新调用（含复用同许可与轮换许可两种情形）、旧保存随后拒绝 → 验证旧调用返 `{ ok: false }` 且不清除新调用 `writePermit`、新调用成功保存返 `{ ok: true }`（零 `423`）；主线程可调度下页面 B 挂死超时仅独立报 B `OK: false` 且不阻塞健康作品 A 经唯一串行 exchange 回报 `OK: true`；`EditorState` 超时直接进入原生三选一对话框不挂死；多持有者冻结任一 `Keep Editing` 不解冻另一流程；`OnBeforeQuit` 自拦截触发同步 `OnQuitCanceled` 后断言 `quitState == confirming`、已确认画布仍冻结、重复 Quit 不重入；后台 `SetReadonly` 阻塞等主线程时主线程释冻零死锁；关窗前取消退出全部窗口/surface/worker 完好且批准退出仅确认一次并在 `OnQuit` 拆除；在途 `rename` 期间 `Flush` 必等完成后再确认准备；只读脏稿拒关、干净只读画布直接离开、活动回合 `settleNotes` 正常结算 |
| **M3A.5** | Stage 3A Gate Report、draft Spec 同步、全量检查与双模型只读终审 | 双模型终审 **0 P0 / 0 P1 Approve**；全部静态/单测/边界/文档检查全绿；Electron 默认生产路径不变，Stage 3B 维持 HOLD |

---

## 5. 提请所有者在开工前显式确认的 3 项决策

1. **G5 上游 `scheme.go` 入口前内存预算策略二选一**：
   - **选项 G5-A（推荐默认，零第三方 fork）**：落地分片 `molly-design://` 保存、移除 `ServeHTTP` 公共入口复制、Preload 预规范化对象 `doc` + 未引用素材裁剪、端到端结构化 `DESIGN_PROJECTION_PENDING` 与首次异常即先登记 `partial`/`uncertain` + 透传 `writePermit` 的 `/save/repair` 协议（零新增 Go 依赖、零本地 fork），同时向上游 `mygo` 提交单请求 + 全局在途字节预算 PR；报告诚实标注 G5 为 **`PARTIAL-BOUNDED`**。
   - **选项 G5-B（Stage 3A 立即完全关闭 G5 至 `PASS`）**：在 G5-A 基础上，允许对 `github.com/egoist/mygo` 采用受审最小补丁/版本替换，在 `scheme.go` 读取 `HTTPBody`/`HTTPBodyStream` 前同时施加 `5 MiB` 单请求上限与 `32 MiB` 全局在途字节信号量。
2. **自定义 `MOLLY_DATA_DIR` 与私有监管器共享契约微调确认（完整受影响文件清单）**：
   - 共享契约：`packages/shared/src/node/{installation-profile,local-ipc,local-cli-host-lease,local-cli-supervisor}.{ts,cjs}`（默认 `~/.molly`/`~/.molly-preview` 生产行为 100% 不变；POSIX 派生 TCP 端口与 Windows `-<scope>` 隔离管道均严格限定于 MyGo `stdin` 监管实验目录，普通自定义目录全平台保持基线共用宿主租约；仅 `MOLLY_ISOLATED_DATA_ROOT_STRICT=1` 启用 `.molly-mygo-experimental` 归属校验、全顶层扫描与共享 `resolveIsolatedDataPath`）；
   - CLI 监管、控制面、MCP/`molly-core` `stdin` 握手与子进程追踪：`apps/cli/src/lib/local-supervisor-control.ts`、`apps/cli/src/commands/{start,daemon-runner,daemon-stop}.ts`、`apps/cli/src/lib/{molly-fleet,cli-platform,local-ipc-socket-server,local-control-handler,local-session-control,local-probe,message-handler}.ts`、`apps/cli/src/utils/const.ts`、`apps/cli/src/mcp/{molly-mcp-http-server,molly-mcp-http-host,molly-core-supervisor,molly-core-ipc,mcp-tool-discovery,design-tools,molly-image-mcp-server}.ts`、`apps/cli/src/session/{session,session-sandbox}.ts`、`packages/harness-pi/src/{entry,environment}.ts`、`cmd/molly-core/main.go`、`internal/memory/store.go` 及对应 Node 存储入口；
   - Design worker 与恢复前端边界：`apps/cli/src/design-entry.ts`（`68 MiB` UTF-8 帧上限、结构化错误 `code`/`revisionId`、`readOnly` 透传、轻量分页 `pending-associations`、单作品 `repair-projection` 与 `acknowledge` `verifyProjection` 透传）、`apps/cli/src/design/store.ts`（UTF-8 字节口径、首次与原样重试双分支结构化 `DESIGN_PROJECTION_PENDING` 错误、`read` 支持 `readOnly: true`、新增 `pendingDesignAssociations` 与单作品投影修复、同锁原子 `acknowledgeDesign(verifyProjection: true)`、共享 `resolveIsolatedDataPath`）、`apps/cli/src/design/history.ts`（`locate()` 共用入口防 Git 重定向、全量剔除 `GIT_*` 后固定 `GIT_CONFIG_NOSYSTEM=1`/`GIT_CONFIG_GLOBAL=devNull`、`readOnly` 透传与路径校验）、`packages/design-bento/src/product-session.ts`（`flush(permit)` 先静默等既有 `prevSaving` 落定再以新 `permit` 保存且仅按单调 `flushRunSeq === runId` 在 `finally` 清除 `writePermit`）与 `packages/components/src/components/sessions/design-canvas.tsx`（`usePendingDesignRecovery` 逐件容错 `acknowledge` 与事件驱动空闲补确认）。
3. **无新增 Go 第三方依赖确认**：Stage 3A 目标为 **0 个新增 Go 第三方依赖**（仅复用 `go.mod` 既有依赖如 `golang.org/x/sys/windows` 与官方独立 Node 缓存）；如后续发现需新增依赖将暂停并重新申请确认。
