# Molly 转向 MyGo 技术栈：Stage 0 实证结论、Stage 1 Go 核心详细设计与 Spec 修订方案

Status: proposed
Date: 2026-11-23
Translation: pending

## 摘要

本提案基于 20 项前期源码与生态调研、macOS Apple Silicon 实机 Stage 0 验证及一次独立对抗式架构评审，设计将 Molly 本地后台与桌面壳分阶段演进至无 CGO Go/MyGo 技术栈的可行路线。评审指出，原方案试图在 Stage 1 一并替换 Loro 数据面、重封密钥库并引入 Go 编排层，会触发前端大面积重写、密钥库双写冲突与违反既有 ACP 契约红线；同时实测证实内置浏览器页面向自定义协议发出的跨源请求仍会抵达 Go 处理器，必须强制实施页身份与令牌鉴权。据此，本修订版将 Stage 1 严格收敛为低耦合、单写者的最小可交付切片：以纯 Go 实现图像与字体检查、内置图像生成服务、个人记忆 SQLite 表以及与现行文件锁逐字节互操作的设计保存与隔离 Git 版本库，期间由 Electron 保持密钥库唯一写者，并将 Loro 数据面替换与 ACP 编排迁移拆出单独立项。Stage 1 预计仅缩减约 40–50 MiB 安装体量（167 MiB 的 Pi 与 Node 运行时仍需保留），且正式签名下的真实钥匙串密钥解密、完整 React 工作台与 Electron 同机基线对照、Windows WebView2 离屏导出与真实登录态浏览均尚未完成验证；本提案仍待审阅批准，未授权任何运行时实现或新增 Go 模块落库。

---

## 1. 已确认方向、评审纠偏与不可破坏不变量

### 1.1 已拍板方向（待修订进 `AGENTS.md` 与 Spec 后生效）

1. **内置浏览器优先放弃原生 Chromium/WebMCP，经验证收敛**：macOS 侧不再为内置调研浏览器绑定 Chromium/CDP 与原生 WebMCP，改由受控 `WKWebView` 承载并诚实声明 WebMCP 不可用；但同会话 OAuth 登录弹窗与 Chrome Cookie 注入尚未实测验证，暂标为待验证项，不作功能承诺。
2. **接受终止上游 Lody 的直接代码复用**：不再以合并或对齐 Lody 上游 TypeScript/Electron 提交为前提；已采纳的 U1–U9 可靠性语义保留为迁移期行为验收基线。
3. **坚持分阶段收敛与独立止损**：Stage 1 只迁与 Loro、密钥写者和 ACP 编排解耦的本地能力；**Loro 数据面替换与 ACP 编排迁移单独立项评审**，不绑架 Stage 1。

### 1.2 必须保持的产品与安全不变量

- **单一可编辑真源**：`BentoDoc` 仍为当前画稿唯一权威状态；`design.yaml`（写入 `molly-canvas/1`，只读兼容 `geon-canvas/1`）仅为按需投影与 Agent 创作草稿。
- **单写者与串行编辑**：任一数据域（密钥库、画稿、会话库、个人记忆）同一时刻严格只有一个写者，或在过渡期逐字节兼容既有跨进程文件锁协议；Agent 回合派发前完成 flush，执行与产物处理期间全部画布实例只读。
- **自定义协议防盲写（P0 安全红线）**：MyGo 文档明确指出，不可信页面虽读不到自定义协议响应，但其 `POST` / `no-cors` 请求**仍会抵达 Go Handler**（`mygo@v0.10.0/page.go:388–391`）。所有自定义协议 Handler 必须强制校验 **`mygo.CallerPage(ctx)` + 能力令牌 + HTTP Method + `Content-Type` + 非空 `baseRevisionId`**。
- **诚实能力与开源本地边界**：能力缺失如实声明，禁止静默修复、静默切模型或自动重试付费调用；开源桌面端保持纯本地、无认证云请求与遥测；遵循 `AGENTS.md` “Never duplicate shared ACP contracts”与“additions need explicit confirmation”。

---

## 2. Stage 0 实机实证（含评审修正）与未验证边界

本地原型位于 `.scratch/mygo-stage0-poc/`（未改动任何仓库既有跟踪源码），基于 Go `1.27.3`、`CGO_ENABLED=0` 与 `github.com/egoist/mygo@v0.10.0`，在 macOS `27.0.1`（Apple Silicon `arm64`）上挂载真实编译版 `apps/electron/resources/design/editor.html` 与 `sample.json`。

### 2.1 实测事实与边界说明

| 验证项 | 实测结果 | 精确事实与局限（不夸大） |
|---|---|---|
| **无 CGO 编译与体量现实** | 通过 | 裁剪符号后单二进制 **15.19 MiB**（加安全与 Spike 3b 探针后），`otool -L` 仅链接 4 个系统库。**体量现实修正**：本机 `/Applications/Molly.app`（v0.1.7 实测 630.9 MiB）中 `resources/cli/harness`（Pi + Node ≥ 22.19）占 **167 MiB**，在 Stage 1 与 Stage 2 均会保留；**Stage 1 仅可净缩减约 40–50 MiB**（替换 `sharp` 与部分 `node_modules`，扣除 Go 进程增量），不消除 Node。 |
| **MyGo 分栏壳 + 真实 Bento** | 通过 | 顶层 MyGo Native 分栏挂载 3 个独立 `ui.WebView`；异步 `await window.molly.snapshot()` 实测初始 **`elementCount: 4`**，`applyCommands({verb:'add-element'})` → `flush()` 后 **`elementCountAfter: 5`**、CAS `revisionId` 更新、`goSaveEndpointHitCount: 1`；29 组字体加载 0 报错；`molly-design://` 下 Canvas 2D `getImageData`/`toDataURL` 无污染。 |
| **自定义协议防盲写负向测试（P0-4）** | 部分验证（Stage 2 补全） | 原型在 Handler 中加入了 `CallerPage` + `Content-Type: application/json` + 必填 `baseRevisionId` 守卫，并让 Untrusted 浏览器发出 `fetch('molly-design://canvas-poc/ws/.../save', {method:'POST', mode:'no-cors'})`，确认请求会抵达 Handler 且在 `CallerPage` 层被拦截（`blockedByHostGate: true`, `blockedDelta: 1`, `saveCount` 未变）；Untrusted 调用 `mygo.Bind` 0 泄漏。**未验证局限（转入 Stage 2 门禁）**：原型尚未实现每实例随机能力令牌；上述负向请求在 `CallerPage` 层即被拦截，未独立测试“可信调用方发送错误 `Content-Type` 或空 `baseRevisionId`”；`CallerPage` 绑定的是页面而非文档，且原型未锁定 Bento/渲染页顶层导航（`OnWillNavigate`）；`baseRevisionId` 为内容确定性哈希，不可作为鉴权凭据。 |
| **离屏透明渲染与 DPR 1:1 瓦片导出** | 通过（有局限） | 隐藏透明窗口内 `requestAnimationFrame` 确实卡死（`RAF_STALLED` 2503 ms），证实不能照搬 Electron 双 `rAF` 栅栏；跳过 `rAF` 后 `CapturePage()` 输出真透明 2× Retina PNG（角像素 `[0,0,0,0]`）。修正为按 `cssScale = targetScale / dpr`（Retina 下 `3/2 = 1.5`）后，仅需 **2×2 = 4 块瓦片** 直接 1:1 像素拷贝（无最近邻抽样锯齿），耗时 **448 ms** 输出 `2400×1800` PNG 与 JPEG 95。**未验证局限**：截图前仍含固定 `60–150 ms` 等待而非确定性绘制完成信号；未做与 Electron 导出的像素差异（SSIM/diff）比对；未覆盖阴影/模糊跨瓦片重叠裁切；16384×1024 仅为 80 KB 纯色条纹测试，且 Go 标准库 `image/png` **不支持流式编码**（16384² 整幅缓冲约 1 GiB，大尺寸内存方案仍待专项设计）。 |
| **Pinterest 实测（Spike 3b）** | 部分通过 | `UserAgentSuffix: "Version/18.0 Safari/605.1.15"` + `OnDidFinishLoad` + `complete` + 非零尺寸图片等待下，`ideas/` 与 `search/pins/?q=swiss%20poster%20design` 加载 0 JS 报错、无验证码、滚屏懒加载（2→8 张）、持久化 9 个 Cookie、`hasNativeWebMCP: false`。页内 Canvas 读回 `i.pinimg.com` 被 CORS 阻断，由 Go 宿主拉取 `474×667` **缩略图**成功（非原图）。**未验证局限**：全程未登录（存在“Log in to see more”遮罩）；`SetWindowOpenHandler` 未放行任何弹窗；Google 历来拦截嵌入式 WebView OAuth 且 Electron 曾遇 FedCM 失败，**同会话 OAuth 弹窗与 Chrome Cookie 注入均属待验证项**。 |
| **内存、启动与 `safeStorage` 向量** | 仅作参考基线 | 原型空载 3-WebView 进程树 RSS **364.5 MiB**（压测后 **491.3 MiB**），冷启至 `molly:ready` **641 ms**——**因左栏为极简测试页而非 34.7 万行真实 React 工作台，且缺同机 Electron 对照，不可直接宣称启动/内存优于现状**。`safestorage_test.go` 已补齐经 Node/OpenSSL 独立交叉核验的 `"peanuts"`/`"hello"` hex 向量断言（`7631308690a7cb3c7871d1a16024469ce35b43`），但**尚未对真实 Electron 产出的 `model-connections.enc` 实测解密**。 |

### 2.2 进入 Stage 2 切壳前必须补齐的硬门禁

1. **真实 Electron 密文与正式签名 Keychain ACL 实测**：使用正式签名的 Go 原型读取既有 Electron 写入的真实 `svce="Molly Safe Storage"` / **`acct="Molly Key"`**（及 Preview `Molly Preview Safe Storage` / **`Molly Preview Key`**）与 Windows `%APPDATA%\Molly Design\Local State`，验证解密与 macOS Keychain ACL 系统授权弹窗体验。
2. **完整工作台与同机 Electron 对照基准**：在 `WKWebView` 中挂载真实 `packages/components` 与 Bento，与同机同画稿 Electron 44 对比整棵进程树内存、冷启耗时与导图像素差异（含阴影跨瓦片与 16k 内存上限方案）。
3. **Windows x64 WebView2 离屏与协议实测**：验证 Windows 屏幕外窗口替代隐藏 WebView2 的截图行为、自定义协议串行响应影响与 Chrome App-Bound Encryption 下的账号导入边界。
4. **MyGo 打包中间封印钩子与框架预发布风险控制**：验证签名嵌套二进制与主 `.app` 之间插入 `sign-embedded-harness` 清单封印；锁定 MyGo 精确版本并保留 Wails v3 作为 Go 路线备选。
5. **自定义协议防盲写完备性（P1-C）**：在 Stage 2 交付前补齐每实例随机能力令牌校验、Bento/渲染页顶层导航锁定（`OnWillNavigate` 拒绝跳离预期 Origin，防止同 `CallerPage` 沿用身份），以及“可信调用方发错 `Content-Type` / 空 `baseRevisionId`”两个独立负向用例。

---

## 3. 复用阶梯与架构范围收敛

按 `AGENTS.md` 复用阶梯，并吸收独立评审意见后，明确划分 **Stage 1（近期可交付）** 与 **独立后续提案**：

| 层级 | 模块 | Stage 1 决策 | 原因 |
|---|---|---|---|
| 保持复用 | `packages/components`（React 19）、`packages/design-bento`（Bento）、`packages/harness-pi`（Pi Worker） | **不动** | 占仓库大部分代码与产品核心体验；Pi 已有 ACP stdio + fd-3 边界。 |
| **Stage 1 优先 Go 化** | `molly_view_image`、Image MCP、个人记忆（替换 `mem0ai`）、画稿权威保存与隔离 Git | **纳入 Stage 1** | 边界清晰、无前端重写耦合、单写者可控、可直接替换 `sharp` 与 `mem0ai`。 |
| **单独立项（移出 Stage 1）** | **Loro → SQLite 全量替换**与 **ACP/Pi 编排迁移** | **移出 Stage 1** | Loro 耦合前端 29 文件 + CLI 43 文件 + shared 13 文件及已批准的 `communication-architecture.md` / `session-orchestration.md`；Go 写 ACP 编排亦会触碰 “Never duplicate shared ACP contracts”。需独立做前端读/写/订阅 API 与 `WorkspaceWriter` 接缝评审。 |
| **推迟至 Stage 2 切壳** | 密钥库重封、MyGo Native 分栏壳与 `WKWebView` 浏览器切换 | **Stage 2 执行** | 避免 Stage 1 期间与 Electron 形成密钥库双写（OAuth refresh token 轮换冲突）；等待 2.2 节 4 项门禁实测通过。 |

---

## 4. Stage 1：收敛后的 Go 本地核心详细设计

### 4.1 仓库布局与开源边界（需所有者显式确认新增 Go 模块）

根据 `AGENTS.md` “Migration only reduces scope; additions need explicit confirmation”，在根目录引入 `go.mod` 属于显式新增，须由所有者在 M1.0 审批确认。Stage 1 仅建立实际有里程碑认领的最小模块集合（**删除悬空的 `internal/orchestration`**）：

```text
go.mod                                  # go 1.27.3, CGO_ENABLED=0 默认
cmd/
  molly-core/                           # Stage 1 本地 Go 核心进程（内部控制面走 Unix Socket / Named Pipe）
internal/
  platform/                             # 本地组合根与能力接口（//go:build !cloud，无云客户端/遥测）
  ipc/                                  # 内部控制面：Unix 域套接字（0600 + 对端 UID/PID 校验）与 Windows Named Pipe
  imaging/                              # 纯 Go 图像解码/缩放/透明裁边/9 宫格（替代 sharp）
  fonts/                                # 纯 Go 字体解析/塑形/样本行渲染（go-text/typesetting，替代 Pango）
  mcp/                                  # 供 M1.1 委托调用的图像/字体/Image MCP 核心实现（Stage 2 支持 stdio / loopback HTTP+token）
  browserfetch/                         # 复用 public-browser-asset-fetch 契约的 Go 抓图器（仅在需要时启用）
  memory/                               # 个人记忆纯 Go SQLite 单表（替代 mem0ai，32×300 + 修订栅栏）
  design/                               # BentoDoc 权威保存（逐字节兼容 lock.ts）、YAML 投影发布、fsnotify 监听
  gitstore/                             # Molly 管理的隔离 bare Git 历史库（系统 git plumbing 基准）
  security/                             # realpath 无跟随打开、safeStorage v10 离线只读解析器（Stage 2 切壳启用重封）
```

**开源边界守卫扩展**：在 `scripts/check-public-boundary.mjs` 与 `scripts/check-platform-boundaries.mjs` 中同步加入 Go 静态检查，校验 `go.mod` 与 `cmd/`、`internal/` 下全部 `.go` 文件不含私有云依赖、遥测客户端或绕过纯本地组合的默认配置。

### 4.2 Stage 1 单写者、MCP 传输兼容与凭据授权边界（关闭 P0-2 & P1-A）

- **进程启动与内部控制面（禁 TCP 仅针对 `molly-core` 内部控制面）**：Stage 1 中由现有 CLI 守护进程（或 Electron 主进程监管器）启动并管理 `molly-core` 子进程；两者之间的**内部控制面**仅使用权限 `0600` 的 Unix 域套接字（macOS，带对端 UID 校验）或受限 ACL 的 Windows Named Pipe，**绝不暴露未鉴权 `localhost` TCP**。
- **Pi Harness MCP 传输兼容（按复用阶梯，严格遵守 `packages/harness-pi/src/mcp.ts:126` 与 `molly-embedded-pi-harness.zh.md:114`）**：
  - Pi harness **仅支持 `stdio`（`command`）与 `HTTP` 两种 MCP 传输**（其余直接报 `pi_acp_mcp_transport_unsupported`），且禁止传输拦截器与第二套 MCP 客户端；
  - 现行 [molly-mcp-http-server.ts](../../../../apps/cli/src/mcp/molly-mcp-http-server.ts) 已提供成熟的共享 `127.0.0.1` + 32 字节随机 Bearer Token + `loopback-peer-uid.ts` 对端 UID 校验 HTTP MCP 宿主（并保留 `stdio` 回退），且已完整持有 `getMcpSessionContext`、`resolveDesignGate` 与 `fetchImageHttpTransport`；
  - **Stage 1（M1.1）采用最高阶复用路径**：继续保留现有 `molly-mcp-http-server.ts`（及其 `stdio` 回退）作为 Pi 侧的唯一 MCP 入口，由其继续解析 `getMcpSessionContext`、`resolveDesignGate` 并通过现有 `fetchImageHttpTransport` 从 Electron 获取当次调用所需的临时图像凭据；随后经受鉴权的 Unix Socket / Named Pipe 将“看图/字体渲染”和“带当次内存凭据的 OpenAI/DashScope 图像请求 + SSRF 公网 IP 钉扎下载”委托给 `molly-core` 执行（凭据仅留内存、用毕即弃，不落盘）；
  - **Stage 2 演进路径**：待替换 Node MCP 宿主时，`molly-core` 直接以 Pi 原生支持的 `stdio` 子进程或复用相同 `127.0.0.1` + Bearer Token + Peer UID 契约的 HTTP 端点接入 Pi，不新增私有 MCP 传输协议。
- **密钥库唯一写者原则**：整个 Stage 1 期间，**Electron Main（`model-connection-store.ts`）保持密钥库 `model-connections.enc` 的唯一所有者与写者**，负责全部 API Key 读写与 OAuth refresh token 轮换，`molly-core` 绝不直接读写 `model-connections.enc`。
- **密钥库一次性迁移时机**：仅在 Stage 2 切换至 MyGo 壳、下线 Electron 写入口的那一刻，由 `internal/security` 执行一次性原子迁移：
  - **macOS**：经 `purego` 读真实钥匙串项 **`svce="Molly Safe Storage"` / `acct="Molly Key"`**（Preview 版为 **`svce="Molly Preview Safe Storage"` / `acct="Molly Preview Key"`**），按 OSCrypt `v10`（PBKDF2-HMAC-SHA1, `saltysalt`, 1003 次, AES-128-CBC, 16 空格 IV）解密；
  - **Windows**：从对应 `userData` 目录（`%APPDATA%\Molly Design\Local State`，Preview/自定义路径按 profile 解析）读取 `os_crypt.encrypted_key`，剥离 `DPAPI` 前缀并调 `CryptUnprotectData` 得 32 字节密钥，再以 **AES-256-GCM** 解密 `v10`；
  - **重封密钥来源**：生成新随机 32 字节主密钥写入 Molly 专属钥匙串项（macOS）或 DPAPI 保护块（Windows），以 AES-256-GCM 重封完整 `schemaVersion: 1` 文档，并保留原 `.enc` 备份。

### 4.3 M1.1：纯 Go 图像/字体、Image MCP 与安全抓图契约

1. **`molly_view_image`（`internal/imaging` + `internal/fonts`）**：
   - 使用标准库 `image/{png,jpeg,gif}`、`golang.org/x/image/webp`、`github.com/disintegration/imaging`（Lanczos3）与 `github.com/go-text/typesetting`（纯 Go HarfBuzz 塑形 + `.ttc` 集合解析 + name 表读取）。
   - 严格保持 `realpath` + 无跟随打开防符号链接逃逸、透明图压灰底、长边 ≤ 1280 px JPEG q=70、9 宫格（400 px + 8 px 间距）、8 字体样本行（仅会话目录与平台系统字体目录常规 `.ttf`/`.otf`/`.ttc`，预览目录无权）、16 MiB / 16384 px / 64M 总像素 / 15s 解码预算。
   - **验收要求**：与现行 `sharp`/Pango 输出做 CJK/拉丁 `.ttc` 宽度比回归与坏图/超大动画图负向测试。
2. **内置 Image MCP（`internal/mcp`）**：
   - 基于 `modelcontextprotocol/go-sdk` 实现 OpenAI Images（`generations`/`edits`）与 DashScope 原生多模态双协议；用户必填 `model`，不设默认值，绝不自动重试付费调用；凭据由 Electron 宿主按次授予。
   - 返回图片 URL（非配置端点主机）强制禁用自动重定向、通过自定义 `net/http.Transport.DialContext` 解析并校验**全部**返回 IP 为公网地址后直接拨号（保持原始 SNI/TLS 校验），禁止经未核验代理绕过。
3. **浏览器参考图宿主抓图契约（`internal/browserfetch`，供 Stage 2 复用）**：
   - 按复用阶梯完整继承现行 [public-browser-asset-fetch.ts](../../../../apps/electron/src/main/services/public-browser-asset-fetch.ts) 契约：手动处理重定向（上限 5 跳）、单图 5 MiB 与 15s 超时上限、仅对 HTTPS 同站请求附带浏览器 Session Cookie（总长 ≤ 16,000 字节）、`Referer` 仅传 `page.origin/`、继承系统/会话代理配置，并叠加 `DialContext` 私网 IP 拦截。

### 4.4 M1.2（瘦身版）：仅个人记忆迁入纯 Go SQLite

- **驱动选型门禁**：先对 `modernc.org/sqlite` 与 `github.com/ncruces/go-sqlite3`（均 `CGO_ENABLED=0`）在 macOS arm64 / Windows x64 上实测冷启、事务写入、RSS 与二进制增量后定型。
- **表结构与契约**：建立独立 `memory.sqlite3`（WAL + `BEGIN IMMEDIATE`），包含 `personal_memory(id, content, created_at, updated_at)` 与 `memory_meta(enabled, revision)`；单事务内强校验 `COUNT(*) <= 32` 且 `utf8.RuneCountInString(content) <= 300`，不做向量检索；任何编辑/删除/开关变更递增 `revision`，使陈旧提取写回失效；提供从既有 `mem0` SQLite 表的一次性无损导入并核验条数与启用状态。
- **零连带冲击**：不改动 Loro、不改动 `operations`、不改动 `turn-diff-store`，也不改动前端 `packages/components` 的任何数据面订阅。

### 4.5 M1.3：画稿权威保存（兼容 `lock.ts`）与隔离 Git 历史

- **逐字节兼容 `apps/cli/src/design/lock.ts`**：现行 CLI 后台（回合后产物采集）与 Electron CLI Worker（用户保存）共享作品目录下的 `.design.lock` 文件锁。Stage 1 若由 Go 接管其中任一或全部写路径，**必须严格实现同一锁协议**：
  - 文件路径 `<artworkDir>/.design.lock`，以 `O_CREATE|O_EXCL|O_WRONLY`（等价 Node `wx`）权限 `0o600` 创建，写入 JSON `{"pid": <pid>, "token": "<uuid>"}` 并 `fsync`；
  - 获取超时 `DESIGN_LOCK_TIMEOUT_MS = 10_000 ms`（25 ms 轮询，超时返回 `DESIGN_BUSY`）；
  - 通过 `lstat` 读取 `mtime`，锁龄达到 `DESIGN_LOCK_STALE_MS = 45_000 ms` 时原子 `rename` 为 `<file>.<uuid>.stale` 再 `unlink` 并重试创建；
  - 写入 `design.json` 前执行一次 `assertHeld` 复核 JSON 内 `token` 字段未易主，释放时仅在 `token` 匹配时删除，绝不误删他人新锁；
  - 写入使用临时文件 → `fsync` → 原子 `rename` → 父目录 `fsync`，并支持丢回执同字节重试与非空 `baseRevisionId` CAS 校验。
- **明确 JS/WASM 校验器约束**：在保留现有 `packages/design-authoring` Bento Kernel 校验器的阶段，保存/采集校验路径仍需通过 Node Worker 执行，因此 M1.3 不宣称移除 Node，而是先冻结全部 round-trip 差分语料库。
- **文件监听与隔离 bare Git（`internal/gitstore`）**：`fsnotify` 对 `design.yaml` 与 `media/` 最近合法父目录做非递归监听 + 双次字节稳定复核；Git 历史在 Stage 1 保持调用系统 `git` plumbing 命令确保与现有 bare 仓库与 ref CAS 100% 兼容，并行对 `go-git` 做二进制素材与并发 CAS 基准后再决定是否替换。

---

## 5. 独立后续提案登记：Loro 数据面替换与编排迁移（不在 Stage 1 范围）

Loro 替换与 ACP 编排迁移因其架构影响面极大，需单独撰写设计提案并满足以下全部前置条件后方可立项：

1. **前端读/写/订阅与 RPC 替代设计**：必须覆盖 `packages/components`（29 文件）、`apps/cli/src/lib/loro/`（43 文件）与 `packages/shared`（13 文件）；优先评估复用现有 `WorkspaceWriter` 与 `workspace-target-router.ts` 接缝，并明确 `specs/communication-architecture.md` 与 `specs/session-orchestration.md` 退回 `draft` 后的新协议合同。
2. **修复 6 步迁移器的 4 个前置缺陷**：
   - 解决“先关所有窗口”与“汇聚渲染进程 IndexedDB 离线变更”的时序矛盾（需设计受控无头/单窗排空阶段）；
   - 显式覆盖全部多数据目录（`Molly Design`、`Molly Preview`、E2E 覆盖目录、历史 `.molly`）；
   - 遵循 `apps/cli/src/lib/loro/AGENTS.md` 有界并发打开约束，禁止无界遍历拉取全部房间流；导出时强制剥离/过滤 CRDT 历史中可能残留的旧明文图片 Key（响应 [molly-embedded-pi-harness.zh.md:102](../../../../specs/molly-embedded-pi-harness.zh.md)）；
   - **降级防分叉机制**：迁移完成核验通过后，必须将旧 `loro-repo` 移出活跃路径（重命名归档）或先发一版可识别迁移标记的守卫版 Electron，防止旧版二进制静默继续写入旧库造成数据分叉；同时明确 `operations`（启动期认领）与 `turn-diff-store` 写者归属同步切换。
3. **ACP 合同红线**：不得在 Go 中复制共享 ACP 合同，须明确是以子进程消费现有 `acp-extension-core` 还是经正式架构决策修订根 `AGENTS.md` 该条款。

---

## 6. 完整的 `AGENTS.md` 与 Spec 修订清单（待审批后执行）

### 6.1 根 `AGENTS.md` 精确逐行对照（经字节实测严控 `< 8,192` 字节上限）

当前根 [AGENTS.md](../../../../AGENTS.md) 实测为 **8,081 字节**（上限 `8,192 B`，见 `scripts/docs/main.mjs:22`）。下列 4 处替换经 Node 精确逐字节核验合计 **`+84 B`**，修订后为 **`8,165 B`**（距上限余 `27 B`），**零删减既有贡献者规则与存储复用约束**，且不触碰 “Never duplicate shared ACP contracts”：

| 位置 | 原文 | 拟修订（待批准） | 实测字节变化 |
|---|---|---|---|
| L21–23 | `  Reuse Lody's architecture, UI and agent lifecycle with Bento. Migration`<br>`  only reduces scope; additions need explicit confirmation. Reuse modules`<br>`  before adding protocols/storage.` | `  Keep Bento, existing React UI and Pi boundaries; stop adopting upstream`<br>`  Lody code. Target Go/MyGo for local core & shell; additions need explicit`<br>`  confirmation. Reuse modules before adding protocols/storage.` | `+30 B` |
| L34 | `Lody owns execution; Bento owns independent editing/rendering and snapshot/flush;` | `Agent runtime owns execution; Bento owns independent editing/rendering and snapshot/flush;` | `+9 B` |
| L80 | `- Public source is \`apps/{cli,electron}\` and their packages. Exclude hosted backends,` | `- Public source is \`apps/{cli,electron}\`, \`cmd/\`, \`internal/\` and packages. Exclude hosted backends,` | `+15 B` |
| L104–106 | `- Node \`>=22.19.0 <23 \|\| >=23.6.0\` (Node-API 10); pnpm from \`package.json\`. Run \`pnpm install\` (skip nested checkouts);`<br>`  standalone work uses a separate clone. \`pnpm start:local\` and root \`pnpm build\``<br>`  use local desktop composition.` | `- Node \`>=22.19.0 <23 \|\| >=23.6.0\` (Node-API 10), pnpm (\`package.json\`), Go \`>=1.27.3\` (\`CGO_ENABLED=0\`).`<br>`  Run \`pnpm install\` (skip nested checkouts); standalone work uses a separate clone.`<br>`  \`pnpm start:local\` and root \`pnpm build\` use local desktop composition.` | `+30 B` |

### 6.2 全量受影响 Spec 追踪矩阵（9 份，含双语译文状态同步）

| 文档 | 当前状态 | 触发阶段 | 拟修订要点与英文版处理 |
|---|---|---|---|
| [AGENTS.md](../../../../AGENTS.md) | 绑定规则（8,081 B） | **M1.0** | 按 6.1 节 4 处实测替换（8,165 B < 8,192 B），并由所有者显式批准引入 `go.mod`。 |
| [specs/personal-memory.md](../../../../specs/personal-memory.md) | `draft`（仅英文） | **M1.0** | 去 `mem0` 实现绑定，改为 Molly Go 核心独立 SQLite 表，保持 32×300 与无向量检索语义不变。 |
| [specs/lody-upstream-adoption.zh.md](../../../../specs/lody-upstream-adoption.zh.md) | `draft`（双语 `current`） | **M1.0** | 登记自 2026-11-23 终止跟踪与采纳 Lody 上游新提交；已落地的 U1–U9 行为语义保留为兼容验收基线；同步将英文版 [lody-upstream-adoption.md](../../../../specs/lody-upstream-adoption.md) 标为 `Translation: stale` 或同步译出。 |
| [specs/graphic-design-platform.zh.md](../../../../specs/graphic-design-platform.zh.md) | `draft`（英译 `stale`） | **M1.0（微调） / Stage 2（切壳）** | M1.0 仅更新离屏无 `rAF` 约束与浏览器降级引用，**保留现有 Loro/Flock 描述不动**直至独立 Loro 提案获批；英文版保持 `stale`。 |
| [specs/agent-browser-webmcp.zh.md](../../../../specs/agent-browser-webmcp.zh.md) | `draft`（仅中文） | **M1.0 / Stage 2** | 明确 macOS 优先放弃 Chromium/agent-browser 与原生 WebMCP，改为受控 `WKWebView` 并诚实上报无 WebMCP；参考图继承 `public-browser-asset-fetch` 契约 + 私网 IP 拦截；OAuth 弹窗与 Cookie 导入标为待验证。 |
| [specs/molly-embedded-pi-harness.zh.md](../../../../specs/molly-embedded-pi-harness.zh.md) | `draft`（双语 `current`） | **M1.0 确认不变 / Stage 2 修订** | Stage 1 仍由 Electron 持有密钥库与 fd-3 授予、MCP 复用现有 HTTP/stdio 入口，与该 Spec 一致；Stage 2 切壳时修订并同步标记英文版 [molly-embedded-pi-harness.md](../../../../specs/molly-embedded-pi-harness.md) 为 `stale` 或同步翻译。 |
| [specs/molly-design-independent-release.zh.md](../../../../specs/molly-design-independent-release.zh.md) | `draft`（双语 `current`） | **Stage 2 修订** | Stage 1 仍沿用 Electron + Sparkle 分发；Stage 2 切壳前修订打包、harness 清单封印、更新器与原生 E2E 合同，并同步标记英文版 [molly-design-independent-release.md](../../../../specs/molly-design-independent-release.md) 为 `stale` 或同步翻译。 |
| [specs/communication-architecture.md](../../../../specs/communication-architecture.md) | **`approved`**（双语 `current`） | **Stage 1 不触碰** | 已批准合同；仅当独立 Loro 替换提案立项时退回 `draft` 并重新申请人工批准（双语同步标记）。 |
| [specs/session-orchestration.md](../../../../specs/session-orchestration.md) | **`approved`**（双语 `current`） | **Stage 1 不触碰** | 已批准合同；仅当独立编排/Loro 提案立项时退回 `draft` 并重新申请人工批准（双语同步标记）。 |

---

## 7. Stage 1 收敛后实施里程碑（预计 2–3 人，2–3 个月）

| 里程碑 | 交付切片 | 强制退出门禁（Go/No-Go） |
|---|---|---|
| **M1.0（1 周）** | 所有者审批本提案与新增 Go 模块；落地 6.1/6.2 节 M1.0 文档修订；初始化 `go.mod`、Go 开源边界检查、独立 CGO `go test -race` CI 任务 | `pnpm run docs check`、`pnpm check:public-boundary`、Go CI 全绿；`AGENTS.md` < 8,192 B |
| **M1.1（3 周）** | `internal/ipc`（Unix Socket / Named Pipe）+ `internal/imaging` + `internal/fonts` + `internal/mcp`（纯 Go `molly_view_image` 与 Image MCP，凭据由 Electron 授予）+ `internal/browserfetch` 契约与自定义协议防盲写测试模板 | 看图/9 宫格/8 字体样本行（CJK 宽度比）与 SSRF/重定向/同站 Cookie 负向测试全过；生产可替换 `sharp` |
| **M1.2（1–2 周）** | `internal/memory`（SQLite 驱动选型压测 + 个人记忆表 + `mem0` 一次性导入器） | 32×300 上限、修订号栅栏与既有 `mem0` 数据迁移零丢数单测通过；移除 `mem0ai` 依赖 |
| **M1.3（2–3 周）** | `internal/design`（逐字节兼容 `lock.ts` 锁协议 + CAS 原子保存 + `fsnotify`）+ `internal/gitstore`（系统 `git` plumbing 基准 + `go-git` 压测报告） | 与 Node `lock.ts` 跨进程并发抢锁/超时/陈旧锁接管互操作测试通过；黄金 round-trip 差分语料库 100% 一致 |
| **M1.4（2–3 周）** | Stage 2 切壳 5 项准入硬门禁实测：真实签名解 `Molly Key` + Keychain ACL 弹窗、完整 React 工作台 Electron vs MyGo 实测对照、DPR 1:1 瓦片 vs Electron 像素差异比对、Windows WebView2 离屏与 Pinterest 登录/Cookie 注入实测、自定义协议每实例能力令牌 + 顶层导航锁定 + 可信调用方错 `Content-Type`/空 `baseRevisionId` 负向用例 | 输出实证评审报告；5 项全部通过才立项 Stage 2，否则 Stage 1 成果独立收口投产 |

---

## 8. 证据与参考

- **代码与契约依据**：[AGENTS.md](../../../../AGENTS.md)、[graphic-design-platform.zh.md](../../../../specs/graphic-design-platform.zh.md)、[agent-browser-webmcp.zh.md](../../../../specs/agent-browser-webmcp.zh.md)、[personal-memory.md](../../../../specs/personal-memory.md)、[lody-upstream-adoption.zh.md](../../../../specs/lody-upstream-adoption.zh.md)、[molly-embedded-pi-harness.zh.md](../../../../specs/molly-embedded-pi-harness.zh.md)、[molly-design-independent-release.zh.md](../../../../specs/molly-design-independent-release.zh.md)、[communication-architecture.md](../../../../specs/communication-architecture.md)、[session-orchestration.md](../../../../specs/session-orchestration.md)。
- **关键实现源码**：[lock.ts](../../../../apps/cli/src/design/lock.ts)、[store.ts](../../../../apps/cli/src/design/store.ts)、[public-browser-asset-fetch.ts](../../../../apps/electron/src/main/services/public-browser-asset-fetch.ts)、[model-connection-store.ts](../../../../apps/electron/src/main/services/model-connection-store.ts)、[user-data-migration.ts](../../../../apps/electron/src/main/user-data-migration.ts)、[view-image.ts](../../../../apps/cli/src/mcp/view-image.ts)、[image-generation.ts](../../../../apps/cli/src/mcp/image-generation.ts)、[design-service.ts](../../../../apps/electron/src/main/services/design-service.ts)。
- **上游固定点**：`github.com/egoist/mygo` `v0.10.0`（commit `ebde9399baf2734b3361856a53f4036859973d1d`，`page.go:388–391` 自定义协议不可信请求送达规则；MIT；Go `1.27.3`）。
- **本地验证原型（未入库）**：`.scratch/mygo-stage0-poc/main.go`、`.scratch/mygo-stage0-poc/safestorage.go`、`.scratch/mygo-stage0-poc/safestorage_test.go`、`.scratch/mygo-stage0-poc/results/report.json`、`.scratch/mygo-stage0-poc/results/spike3b-pinterest.json`。
