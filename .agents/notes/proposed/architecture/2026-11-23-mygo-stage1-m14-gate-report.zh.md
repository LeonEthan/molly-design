# Stage 1 收口与 M1.4（Stage 2 切壳五项准入硬门禁）实证评审报告

Status: proposed
Translation: pending
Date: 2026-11-23
Related Proposal: [Stage 1 MyGo 架构迁移详细方案](2026-11-23-mygo-stack-stage1-design.zh.md)

## 摘要

本记录汇总 Molly Design Stage 1（M1.0–M1.4）的工程交付结果，并按既定 5 项准入硬门禁对是否立项 Stage 2（MyGo 壳替换 Electron）做出基于实测证据的 Go/No-Go 判定。Stage 1 已交付零 CGO 的 `molly-core` 本地核心模块（覆盖本机双向鉴权 IPC、纯 Go 看图/联系表/HarfBuzz 字体样本行、Image MCP、浏览器安全抓图、纯 Go SQLite 个人记忆与 `mem0` 无损迁移、与 `lock.ts` 兼容的跨进程锁原语及只读画稿/隔离 bare Git 历史读取、自定义协议防盲写与离线 `safeStorage v10` 解析），移除 `mem0ai` 及其 27 个子依赖；在 Bento Kernel 与 `ensureCurrentProjection` 迁入 Go 前，画稿写提交与启动监管仍由现有 Node/Electron 负责，生产默认尚未自动拉起 `molly-core`。Stage 2 的 5 项切壳硬门禁当前为 **0 PASS / 4 PARTIAL / 1 BLOCKED**；按“5 项全过才立项 Stage 2”的原则，判定为 **Stage 2 暂缓立项（HOLD），Stage 1 纯 Go 核心与 `mem0ai` 移除成果先按显式光学开关/评审基线独立收口**。

---

## 1. Stage 1（M1.0–M1.3）交付与验证证据总览

| 里程碑 | 核心模块与代码位置 | 关键指标、当前边界与验证证据 |
|---|---|---|
| **M1.0** | [go.mod](../../../../go.mod)、[internal/platform](../../../../internal/platform/local.go)、[check-public-boundary.mjs](../../../../scripts/check-public-boundary.mjs)、[ci.yml](../../../../.github/workflows/ci.yml) | Go `1.27.3` `CGO_ENABLED=0` 默认模块与 `!cloud` 本地组合根落地；根 [AGENTS.md](../../../../AGENTS.md) 保持 `8,165 B < 8,192 B`；CI 新增独立 `go-core` 任务（含 `GOFLAGS=-mod=readonly` 与 `CGO_ENABLED=1 go test -race`） |
| **M1.1** | [internal/ipc](../../../../internal/ipc/protocol.go)、[internal/imaging](../../../../internal/imaging/view_image.go)、[internal/fonts](../../../../internal/fonts/sample_rows.go)、[internal/mcp](../../../../internal/mcp/image_mcp.go)、[internal/browserfetch](../../../../internal/browserfetch/fetch.go)、[molly-core-ipc.ts](../../../../apps/cli/src/mcp/molly-core-ipc.ts) | 纯 Go 实现看图/9 宫格/8 字体样本行（含确定性 CJK `widthRatio` 夹具、`os.Root` 根句柄读取防中间目录 TOCTOU）、Image MCP（双向 HMAC 握手后传凭据、连接级取消传播、错误全量脱敏、零自动重试）与浏览器抓图（拒绝无法保证目标公网 IP 钉扎的 HTTP 代理）；Node 薄桥接需显式配置 `MOLLY_CORE_IPC_SOCKET` + `MOLLY_CORE_IPC_TOKEN`，目前默认休眠未接入桌面启动监管器；实时 IPC 跑 `view-image.test.ts` 达 14/15 一致（唯一差异为 Pango hinting vs HarfBuzz 无 hinting `<&>"` 墨迹宽度 `276 vs 243`） |
| **M1.2** | [internal/memory](../../../../internal/memory/store.go)、[personal-memory.ts](../../../../apps/cli/src/agent/personal-memory.ts)、[apps/cli/package.json](../../../../apps/cli/package.json) | 选定纯 Go `modernc.org/sqlite v1.63.0`（Apple M4 实测 `10,282 ns/op`，WAL + FTS5 + 显式 `BEGIN IMMEDIATE`）；TS 回退同样收口至 `.immediate()` 单事务；完整实现 `32×300` 上限、修订号栅栏与一次性 `mem0` `vectors` 原地无损迁移；彻底移除 `mem0ai@3.3.1`（工作区依赖净减 27 包，lockfile 零残留） |
| **M1.3** | [internal/design](../../../../internal/design/lock.go)、[internal/gitstore](../../../../internal/gitstore/gitstore.go)、[molly-core-design-interop.test.ts](../../../../apps/cli/src/design/molly-core-design-interop.test.ts) | Go 侧覆盖 `lock.ts` 跨进程文件锁协议、`SetEscapeHTML(false)` 规范化摘要、隔离 bare Git 历史读取与库级原语；**生产 `molly-core` IPC 仅暴露只读接口（`design.read`、`design.canonical_digest`、`gitstore.list`、`gitstore.read`）**，在 Bento Kernel 回放与 `ensureCurrentProjection` 迁入 Go 前不开放画稿写 RPC，也不包含任何测试锁探针；通过独立测试辅助进程验证 Node↔Go 双向抢锁与含 `&<>`/乱序键/缺 `diagnostics`/真实 `sample.json` 的差分往返 |

### 关键选型压测数据（Apple M4, `CGO_ENABLED=0`）

1. **二进制体量**：全功能 `molly-core`（含 `modernc.org/sqlite` + FTS5 + `go-text/typesetting` + `fsnotify` + 双向鉴权 IPC + 图像/MCP/只读设计历史）stripped 后约 **13 MiB**，`darwin/arm64`、`windows/amd64`、`linux/amd64` 三平台均零 CGO 通过构建。
2. **SQLite 驱动基准**：`modernc.org/sqlite` `BenchmarkStoreReadWrite` 实测 `10.3 µs/op`（`2,145 B/op`, `54 allocs/op`），无需引入 CGO 或 WASM 运行时。
3. **Git 历史引擎对照压测（系统 `git` plumbing vs `go-git/v5` v5.19.3）**：
   - 32 KiB 作品提交：系统 `git` plumbing `28.30 ms/op`（274 KB/op）vs `go-git/v5` `0.61 ms/op`（292 KB/op）；
   - 2 MiB 作品提交：系统 `git` plumbing `35.87 ms/op`（6.50 MB/op）vs `go-git/v5` `4.94 ms/op`（9.16 MB/op，堆分配高 41%）；
   - **选型结论**：设计版本保存属低频用户/回合边界事件，`28–36 ms` 远低于感知阈值，系统 `git` plumbing 保持 0 传递依赖、0 体积增量且原生具备 packfile/GC 能力，故 Stage 1 拒绝引入 `go-git/v5`（及其 19 个传递包）。

---

## 2. M1.4：Stage 2 切壳准入硬门禁实测矩阵（0 PASS / 4 PARTIAL / 1 BLOCKED）

| # | 准入硬门禁 | 当前判定 | 已有实证证据 | 剩余缺口 / 阻塞原因 |
|---|---|---|---|---|
| **G1** | 真实签名解 `Molly Key` + Keychain ACL 弹窗 | **PARTIAL** | 已将离线只读 OSCrypt `v10` 解析器（macOS PBKDF2-HMAC-SHA1/AES-128-CBC + Windows AES-256-GCM）迁入 [safestorage.go](../../../../internal/security/safestorage.go) 并通过 Node/OpenSSL 交叉向量单测；已核实 `/Applications/Molly.app` 签名标识（`Identifier=dev.molly-design.app`、`TeamIdentifier=Q96C8424X6`）及本机 Keychain 存在 `Molly Safe Storage`/`Molly Key` 与 `Molly Preview Safe Storage`/`Molly Preview Key` 元数据（未读密文） | 本地无 Developer ID 签名证书，尚未用 `TeamIdentifier=Q96C8424X6` 签名的 Go 二进制实测 macOS Keychain ACL 是否触发系统弹窗 |
| **G2** | 完整 React 工作台 Electron vs MyGo 实测对照 | **PARTIAL** | Stage 0 PoC 已在 `CGO_ENABLED=0` MyGo `WKWebView` 挂载真实 `@molly/design-bento` 并验证画布编辑落盘（`elementCount: 4 → 5`）与实时 Pinterest 浏览 | 尚未将完整 `apps/electron` React 工作台（含 Loro 同步与全部 preload IPC 表面）挂载至 MyGo 与 Electron 做同场景 A/B 内存、首屏与交互回归 |
| **G3** | DPR 1:1 瓦片 vs Electron 像素差异比对 | **PARTIAL** | Stage 0 PoC 已实测 MyGo 3× DPR 4 瓦片直拷（`2400×1800`、`direct1to1Copy: true`、`447 ms`）及离屏窗口 `rAF` 卡死下 `CapturePage()` Alpha `[0,0,0,0]` 保留 | 尚未对同一组含复杂排版/滤镜/透明层的 Bento 作品执行 Electron 截图 vs MyGo `WKWebView` 截图的逐像素 diff 矩阵比对 |
| **G4** | Windows WebView2 离屏与 Pinterest 登录/Cookie 注入实测 | **BLOCKED** | Go 侧 `GOOS=windows GOARCH=amd64 CGO_ENABLED=0`（含 Windows Named Pipe `FILE_FLAG_FIRST_PIPE_INSTANCE` + `D:(A;;GA;;;OW)` ACL + 双端进程 SID 校验）构建通过；[browserfetch](../../../../internal/browserfetch/fetch.go) HTTPS 同站 Cookie 与 SSRF 拦截单测全过 | 当前为 macOS arm64 环境，缺少真实 Windows 主机执行 WebView2 离屏截图与 Pinterest OAuth/Cookie 注入实测 |
| **G5** | 自定义协议每实例能力令牌 + 顶层导航锁定 + 可信调用方负向用例 | **PARTIAL** | [protocol_gate.go](../../../../internal/security/protocol_gate.go) 与 [protocol_gate_test.go](../../../../internal/security/protocol_gate_test.go) 已通过 `httptest` 单元测试覆盖常量时间令牌、`application/json` 校验、`Origin`/`Sec-Fetch-Site`、非空 `baseRevisionId` 与 `ValidateTopLevelNavigation`；Stage 0 原型验证了 `CallerPage` 盲写拦截 | 尚未在**同一个运行中的 MyGo 实机实例**内同时接入每实例随机令牌、顶层导航锁定拦截器与两个可信调用方负向用例做端到端回归 |

> **补充准入项（呼应提案 §2.2）**：立项 Stage 2 前还需同步补齐 MyGo 打包签名、嵌入式 Pi harness 清单封印与发布更新器验收，不在本 Stage 1 范围内。

---

## 3. Go/No-Go 结论与剩余限制

- **Stage 2 立项判定：HOLD（暂不切壳）**。5 项硬门禁为 `0 PASS / 4 PARTIAL / 1 BLOCKED`，未达立项标准。
- **Stage 1 当前交付边界**：
  - `mem0ai` 已从生产依赖移除，CLI `PersonalMemoryService` 默认走同构 `better-sqlite3`（`.immediate()` 单事务）并自带 `mem0` 无损迁移；
  - `molly-core` 已完成全部 Stage 1 纯 Go 核心与双向鉴权 IPC 实现，**当前默认休眠**（尚未接入 Electron/CLI 生产监管启动链）；在接入监管进程、打包分发与安装包冒烟前，不在生产默认开启 `MOLLY_CORE_IPC_SOCKET`；
  - 在 Bento Kernel 与 `ensureCurrentProjection` 迁入 Go 前，画稿写入仍由现有 Node Worker 独占，`molly-core` 仅暴露只读画稿/历史接口。
- **验证边界声明**：本报告未读取任何用户真实 Keychain 密文、未修改任何 `approved` Spec、未改动 Loro/Flock 数据面；所有测试均在本地确定性夹具与隔离临时目录完成。
