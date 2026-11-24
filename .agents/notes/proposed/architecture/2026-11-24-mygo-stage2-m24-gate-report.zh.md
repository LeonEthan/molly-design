# MyGo 桌面壳与 `molly-core` 集成：Stage 2 M2.4 门禁评估报告

Status: proposed
Translation: pending
Date: 2026-11-24
Related:
- [Stage 2 架构设计提案](2026-11-24-mygo-stack-stage2-design.zh.md)
- [Stage 1 M1.4 门禁报告](2026-11-23-mygo-stage1-m14-gate-report.zh.md)

## 摘要

本报告记录 Molly Design Stage 2（M2.1a/b、M2.2、M2.3a–d、M2.4）在 macOS arm64（Go `1.27.3`、`CGO_ENABLED=0`、`github.com/egoist/mygo@v0.10.0`、`github.com/ebitengine/purego@v0.11.1`）上的实测结果与 G1–G5 门禁状态：Stage 2 并存基础设施与 Electron 下 `molly-core` 集成已完成并通过自动化验收，但 G1/G2/G3/G5 仍有明确留待 Stage 3 闭环的边界项，G4 在当前宿主机维持 `BLOCKED`，因此 **Electron 生产默认路径保持不变、Stage 3（退役 Electron）维持 HOLD**。

## 1. 交付总览与当前决策

- **Stage 2 并存落地范围**：M2.1a/b（Electron 下 `molly-core` 托管、安全回退与签名重封）、M2.2（`internal/security` 隔离凭据迁移库）、M2.3a–d（并存实验性 `cmd/molly-desktop/` + `internal/shell/`）、M2.4（实验性打包脚本与 4 份 `draft` Spec 同步）均已完成并有回归测试覆盖。
- **G1–G5 切壳总门禁**：**HOLD（未全部闭合，不得退役 Electron）**。各门禁均如实标注 `PARTIAL` 或 `BLOCKED`，不将单点自测充当全量签收。

## 2. M2.1 – M2.4 里程碑证据

### 2.1 M2.1a/b：Electron 下激活 `molly-core` 与打包签名重封

- `cmd/molly-core/main.go` 升级至 `0.2.0-m2.1`，新增 `--watch-stdin`（stdin EOF 时优雅停机，防孤儿进程），`internal/security/open_unix.go` 在 `os.Root` 约束下使用 `O_NONBLOCK` 拒绝 FIFO 等非普通文件阻塞。
- `apps/cli/src/mcp/molly-core-supervisor.ts`：
  - 固定私有 `0700` socket + 32 字节随机 `authToken`，绝不污染 daemon `process.env`；
  - 复用 `childExitPromise` 并同时检查 `exitCode !== null || signalCode !== null`，避免信号退出卡死；
  - 仅在 `MollyCorePreConnectError`（TCP/UDS 连接建立前失败、零字节发出）时对 `molly_view_image` 和 `molly_image` 安全回退至 TS 实现（已连接/已派发的付费图片请求绝不重试或重放）；只读 `molly_view_image` 与派发前本地输入解码阶段的 `molly_image.edit`（`!imgErr.Dispatched`）遇到 `.svg` 或 Go 返回结构化 `unsupported_image_format` 错误（如 TIFF、动图 WebP）时回退至 TS `sharp`；`internal/mcp/image_mcp.go` 对用户配置的图片端点保留 `proxyFromCurrentEnv`（代理配置异常仅返回无凭据诊断、全协议剥离 URL userinfo，远端返回图片下载直连固定公网 IP）；supervisor 进入永久退出后自动回收并重启 `molly-mcp-http-host` 清除旧环境变量；
  - `PersonalMemoryService` 依据 daemon 生命周期内固定配置选择唯一写者（核心启动中返回可重试 `molly_core_starting`，仅在 supervisor 永久停止 core 后释放单例切回 TS），消除 SQLite 双写竞争。
- `apps/electron/scripts/molly-core-resources.mjs` 已接入 `eb-before-pack.mjs`、`eb-after-pack.mjs` 与 `sign-embedded-harness.mjs`，复用 `prepareEmbeddedHarnessSigning` 完成 Mach-O 签名重封；`.gitignore` 已忽略 `apps/electron/resources/molly-core/`。

### 2.2 M2.2：凭证库隔离兼容与原子重封（`internal/security`）

- `internal/security/keychain_darwin.go`：全部含指针参数调用均改为 `purego.RegisterLibFunc` 类型化绑定（无 `unsafe.Pointer(uintptr)` 转换），查询携带 `kSecUseAuthenticationUIFail`，所有 `CFTypeRef`/`SecKeychainRef` 确定性 `CFRelease`，临时密码缓冲结束后清零。
- `internal/security/dpapi_windows.go`：`crypt32.dll` `CryptProtectData`/`CryptUnprotectData` + `LocalFree` 与 `UnwrapChromiumLocalStateKey`。
- `internal/security/vault_migrate.go`：`MV2\x01` AAD 绑定源 `.enc` SHA-256；对齐 Electron `StoreSchema`、`ProtectedImageConnectionSchema`、`LegacyImageCredentialSchema` 与 `StoredMcpCredentialSchema`（严格拒绝 JSON `null` 冒充字符串/数组，校验 `connection`+`values`、目标 `destination`、保留 Header/Env 禁单与 `fieldNames`/`values` 键集合一致）；重迁移绝不覆盖历史 `.enc.bak`；已绑定源摘要的 v2 在源 `.enc` 被修改或删除时均返回 `ErrStaleV2Vault`。

### 2.3 M2.3a–d：并存 MyGo 桌面壳（`cmd/molly-desktop/` + `internal/shell/`）

- `RunDesktop` 默认使用隔离的实验数据目录（`~/.molly-mygo-experimental` / `~/.molly-preview-mygo-experimental`），且 Stage 2 并存期间**不注册为竞争性 `design/canvas-host` 协调器**（保持画布 fail-closed 只读、绝不向外部 Electron daemon 确认 flush，直至 Stage 3 退役 Electron 后移交唯一协调权）；socket 路径对齐 `packages/shared/src/node/local-ipc.ts`（POSIX `<dataDir>/run/<ns>-{control,probe,loro-data-plane}.sock`，Windows 采用与 Node `os.userInfo()` 一致的 `-1:<username>:<homedir>` SHA-256 命名管道后缀并复用 `internal/ipc.DialLocal` 完成对端同用户 SID 校验）；`<dataDir>/workspace-catalog.json` 校验 `local:` / `lw_` 前缀与唯一 active workspace；`sessionControl.send` 协商 `Accept: application/x-ndjson, application/json` 并实时解包 `kind: "response"` 推送 `sessionControl.response`；`localProjects.{control,listDir,listFiles,readFile,getGitState,listSessionWorktreeFiles,readSessionWorktreeFile}` 按位置参数封装并自动注入/刷新 `machineId` 后转发 `/project-control`。
- `LoroRelay` 具备连接代次、自动指数退避重连、32 MiB 单帧与 64 MiB 队列上限；`preload.js` 通过串行 Promise 队列保序发送 `ipc.send`（避免 `join`/`detach` 反序）；断连期间丢弃出站帧且 `ReleaseSender` 清理非 `detach` 未发送帧同时保留待发 `detach`，`Close()` 确定性等待重连定时器与 I/O 协程退出。
- `DesignWorkerClient` 使用可取消信号量、非阻塞 stdin 写入、透传 `MOLLY_DATA_DIR` 及进程组清理；`mygoDesignController` 的 `SyncFromStore` 在替换窗口前逐一校验 `window.molly.state()` 拒绝丢弃任何 `dirty`/`saving`/`composing` 未保存草稿，且全路径锁外关窗；对接 React 位置参数合同 `design.attach(artworkId, bounds, hostId)`、`design.hide`、`design.presentToolbar`、`design.syncFromStore`、`design.versions` 与 `design.export(artworkId, format, title, scale)`（未实现方法显式 reject 而非返回错误对象，使用 `window.molly.setReadonly`/`window.molly.flush`、`BuildCanvasPreloadScript` 自动附带能力令牌、`mygo.Dialog.Save` 与 `0600` 原子写入）；实验壳未实现本地资源令牌前关闭 `machineRpc.previewFile`。
- `MollyBridge` 复用 Electron `machineRpc` 的 `main_process_only_method` 禁止清单并在 Stage 2 额外封禁 `design/canvas-host`（拒绝 `harness/host`、`mcp/catalog-entry`、`design/image-connection`、`design/canvas-host`、`browser/*`）；工作台重载推进 `docGen` 使旧文档调用失效，同时新文档通过受信任页专属 `MollyBridge.SyncDocGen` 恢复正常桥接。
- 受控公共浏览器入口（`publicBrowser.navigate`）在 G4 处于 `BLOCKED` 期间默认关闭（返回 `public_browser_disabled_pending_g4`）；仅在显式设置 `MOLLY_MYGO_ENABLE_UNTRUSTED_BROWSER=1` 时启用带独立 `mygo.NewSession("molly-public-browser")`、`Untrusted: true` 与 DNS 公网解析校验的实验窗口。
- `scripts/package-mygo-desktop.mjs` 强制校验完整 CLI 运行时闭包（`index.js`、`design.js`、`molly-pi-agent.js`、`harness/runtime-manifest.json`、目标平台 `better-sqlite3` 预编译二进制、`assertEmbeddedSharpPackages`、`loro-crdt/nodejs/{index.js,loro_wasm.js,loro_wasm_bg.wasm}` 与 `tinypool/dist/{index.js,entry/worker.js}`）。

## 3. G1 – G5 实测门禁矩阵

| 门禁 | 目标 | 本机实测证据与已知边界 | 结论 |
|---|---|---|---|
| **G1** | Keychain / DPAPI 凭据平滑迁移 | 隔离临时 macOS Keychain（`t.TempDir()`）实测纯 Go `purego` 增删改查与 `MV2\x01` 重封全绿；`ErrStaleV2Vault`（含 `.enc` 变更/删除）、历史 `.enc.bak` 保留、严格 schema 与 DPAPI Local State 单测全绿；`GOOS=windows` 编译与 `go vet` 通过。**未闭环边界**：正式 Developer ID（`TeamIdentifier=Q96C8424X6`）签名读取 Electron 真实生产 Keychain 项 ACL 需发布签名机实测。 | **PARTIAL** |
| **G2** | 启动耗时、内存与安装包体积 | 真实挂载 `apps/electron/out/renderer`：`--self-test-renderer` 首屏挂载并完成 IPC 握手耗时约 **600 ms**，Go 堆分配约 **3.6 MiB**；打包脚本强制校验完整 CLI 原生依赖闭包与自包含 Node 选项。**未闭环边界**：本机 Homebrew `node` 为动态链接非自包含（`nodeRuntimeSelfContained: false`），发布需随附官方独立 Node >=22.19（约 +85–110 MiB）并在 Stage 3 纳入实验壳内建 daemon 托管与联合 RSS 基准。 | **PARTIAL** |
| **G3** | Bento 离屏导出与渲染保真 | 真实 WKWebView `--self-test-g3-sample apps/electron/resources/design/sample.json` 复用 `renderDesignOffscreen` 与 `IncrementalTileStitcher` 渲染 800×600 RGBA PNG，动态阴影出血与多瓦片拼接（0 像素偏差）单测全绿。**未闭环边界**：Electron `offscreen: true` vs MyGo WKWebView 跨引擎 3000×2000 大画布与阴影样本自动化像素对比基线留待 Stage 3 CI。 | **PARTIAL** |
| **G4** | 受控浏览器隔离、SSRF 与跨平台 | `ValidatePublicHTTPURL` 已接入 DNS 公网解析拦截私网域名解析；因 WKWebView 缺少连接时 TCP IP 固定能力，G4 未签收前 `publicBrowser.navigate` 默认关闭（`public_browser_disabled_pending_g4`），显式开启实验模式时强制独立 `mygo.NewSession("molly-public-browser")` 与 `Untrusted: true`；运行时诚实声明 `hasNativeWebMCP: false` 与 `importUnavailableReason: 'signing-required'`。**未闭环边界**：WKWebView 连接时 DNS 重绑定防护、Windows WebView2 实机与真实站点 OAuth/Cookie 注入留待 Stage 3。 | **BLOCKED** |
| **G5** | `molly-design://` 能力令牌、跨页隔离与桥接边界 | 真实 WKWebView `--self-test-g5` 全项通过：5 MiB 保存 **200**、缺令牌 **403**、`text/plain` **415**、空 `baseRevisionId` **409**、活动回合写锁 **423**、Untrusted 跨页写请求与跨页 `MollyBridge.Invoke` **均被拒**、**真实页面重载自动撤销能力令牌（403）、拒绝旧 `docGen` 且新文档通过 `window.ipc.invoke` 恢复正常调用**。**未闭环边界**：上游 `github.com/egoist/mygo@v0.10.0` 的 `internal/darwin/scheme.go` 在进入 Go handler 前于主线程读取完整 `HTTPBody`，因此 64 MiB 入口前内存上限需上游 MyGo 流式/预截断支持或大稿改走分片传输后方可签收。 | **PARTIAL** |

## 4. 下一步（Stage 3 前置条件）

1. 发布签名机用正式 Developer ID（`TeamIdentifier=Q96C8424X6`）完成 G1 真实 Keychain ACL 与公证测试。
2. 打包流程接入官方自包含 Node >=22.19 二进制（开启 `--require-standalone-node`），并补齐 Electron vs MyGo 完整 RSS 与 3000×2000 跨引擎像素对比基准（关闭 G2/G3）。
3. 解决上游 MyGo `scheme.go` 请求体预分配预算（关闭 G5），并在 Windows WebView2 + 独立测试账号环境验证 G4。
