# MyGo Stage 3A 并存期门禁实测报告

Status: proposed
Translation: pending
Date: 2026-11-25
Related:
- [Stage 3A 实施提案](2026-11-25-mygo-stack-stage3a-design.zh.md)
- [Stage 2 门禁报告](2026-11-24-mygo-stage2-m24-gate-report.zh.md)

## 摘要

macOS arm64 上，实验包携带自包含 Node，Go supervisor 与重建后的 CLI 完成私有控制面握手。三组合成画布在 WKWebView 中的单次整图和瓦片拼接逐字节相同，但两组大图与 Electron 的局部差异超过既定阈值，原生零 bleed 变异也未被检出。Electron 继续作为默认生产桌面壳；Stage 3B 维持 HOLD。

## 门禁裁决

| 门禁 | 结论 | 证据及边界 |
| --- | --- | --- |
| G1 | PARTIAL | 实验 profile 的存储与迁移测试不覆盖发布身份签名、公证及生产 Keychain ACL。未对生产 Keychain 或生产密文做实测。 |
| G2 | PASS（macOS arm64） | 独立实验包携带 Node 22.23.5，报告为 `nodeRuntimeSelfContained: true`、`nodeExternalDylibs: []`，CLI 资源完整且 harness 已封装。Windows amd64 仅交叉静态检查，原生 Job Object、命名管道与启动回收仍须在 Windows 验证。 |
| G3 | PARTIAL | 同引擎接缝与整图平均误差通过；跨引擎局部滑窗和原生变异两项未过。 |
| G4 | BLOCKED | 公共浏览器导航继续返回 `public_browser_disabled_pending_g4`。WKWebView 导航前的 DNS 检查无法固定实际连接 IP，仍待连接级措施、Windows WebView2 实机与受控账号 OAuth/Cookie 验证。 |
| G5 | PARTIAL-BOUNDED | 已确认 G5-A。应用层分片、总量预算和修复回执有界；上游 MyGo 在进入处理器之前读取请求体，该阶段缺少单请求与全局在途预算。 |
| Stage 3B | HOLD | 上述发布、跨平台与浏览器证据仍缺，继续使用 Electron 生产壳。 |

## 里程碑与实测方法

- **M3A.1** 复用现有 CLI、私有探针和宿主租约，隔离实验身份、控制端点与进程回收。在临时 Go 测试 overlay 中实际调用 `startPrivateCLI` 启动包内 Node 和 CLI。监管凭据由 stdin 的 `lody/supervisor-hello` 传递，子进程环境剔除监管令牌。`confirmPrivateDaemon` 对私有探针执行 GET /state，收到 200，核对 PID、实例 ID 与启动模式后确认归属。
- **M3A.2** 复用 Bento 保存入口与设计工作进程。规范化后的文档上限 64 MiB，分片上限 4 MiB；分片状态、投影部分成功与携带写许可的修复使后续编辑可继续。
- **M3A.3** 复用隐藏窗口与现有导出器，等待字体及 HTML/SVG 图像解码后采集；局部指标和负向变异结果见下表。
- **M3A.4** 并存壳增加受限文件预览、分页恢复待关联作品、画布只读与关闭前 flush 协调。实验端按已实现能力开放入口，公共浏览器保持关闭。
- **M3A.5a** 重建 CLI、Bento 和桌面 renderer，复用仓库打包、基准与检查脚本。所有真机用户目录均为临时目录，生产 `~/.molly`、`~/.molly-preview`、Application Support 与生产 Keychain 零触碰。本报告待终审。

## G3 像素实测

下列误差单位均为 1/255。每格依次为整图 RGB MAE、Alpha MAE、瓦片边界滑窗最大误差。三个上限依次为 2、0.5、1.5。宿主 DPR 为 2，Electron 离屏页面报告 DPR 为 1，舞台按 2× 绘制。直接比较保留 2× 像素，面积重采样比较 1× 输出。

| 夹具 | 2× 直接比较 | 1× 面积重采样 |
| --- | --- | --- |
| 800×600 样例 | 0.738368 / 0.000212 / 0 | 0.730008 / 0 / 0 |
| 3000×2000 图像 | 0.033894 / 0.000619 / 3.140625 | 0.033334 / 0.000322 / 1.804688 |
| 3000×2000 重阴影 | 0.234745 / 0 / 3.980469 | 0.234535 / 0 / 3.609375 |

临时 Go overlay 仅将瓦片边长从 1536 提至 8192，以同一渲染入口采集单次整图。两组大图从四块变为一块，小图原本即一块。下列每个 SHA-256 同时属于该组单次整图及拼接 PNG，解码像素误差均为 **0.0000/255**。

| 夹具 | 1× PNG SHA-256 | 2× PNG SHA-256 |
| --- | --- | --- |
| 样例 | `e1575fed96715ca5d63feeb64186ab0eb72348ed8ffb3838b5c9baee847b1ae1` | `cef89e4fbc006c9bcc3b1ebd955d27aae762ad89b4369ec9ff3df2c4ca175332` |
| 图像 | `04373eccd52a54b39240fb14fda313cdea47a93ca540bba49fb3d6cfbce1d834` | `8c5f93b07e1f4b2872bf4e8b9488be296a0c8b7822ea89964c09c07b951c8d5f` |
| 重阴影 | `968c69c571be3c7382e10f0f948029466b7ee0f0be837365fcbbc13736e9c1b6` | `cac008f417c5c502bc13c9b93e308b89ff209691e06ed64ac49641a1a035418d` |

CoreGraphics 与 Skia 的局部滤镜和边缘栅格化差异与上述观测一致；同引擎对照排除了本组输出由拼接引入差异。用 `--verify-mutation` 对瓦片独立卷积，180 px bleed 对照最大误差 0，取消 bleed 后为 44.625/255，成功检出。`--native-mutation` 在真实 DOM 平移采集中将 180 px 降至 0，RGB、Alpha、局部误差仍全为 0，`mutationDetected: false`。三夹具跨引擎命令与原生变异命令均按原阈值退出 1。

## 桌面基准与验证

同一个临时包的逻辑大小为 389,179,194 字节，采用 ad-hoc 签名。基准以首次可见窗口为起点，随后等待 10 秒，根据 PID 父子关系相加 RSS；系统另行托管的进程不在此口径内。

| 壳 | 首个可见窗口 | 进程树 RSS | 包占用磁盘 |
| --- | ---: | ---: | ---: |
| MyGo 实验包（单次） | 830.82 ms | 314,703,872 B | 440,452 KiB |
| MyGo 实验包（R1 默认临时目录复跑，单次） | 402.75 ms | 136,740,864 B | 439,472 KiB |
| 已安装 Molly 0.1.7 / Electron 44.7.0 | 无样本 | 无样本 | — |

R1 复跑使用已有 ad-hoc 实验包和修订后的基准脚本，未覆盖本轮 TS 修改的重新打包。脚本按规范化后的系统临时目录计算 control、probe、loro-data-plane 三个 Unix 套接字路径。任一路径超过 103 个 UTF-8 字节时，改用系统 /tmp 下的私有短目录，启动进程前按实际目录复核三个长度。本次使用默认环境，自动选取短目录；采样前后均通过真实 HOME 无重叠与隔离根无符号链接、无 .enc 文件检查。WebKit 尝试在隔离根外创建两个缓存目录时被沙箱拒绝，仍完成首窗及 RSS 采样。

工作区产出 renderer 和 CLI，未发现对应版本的打包 Electron 应用。另试已安装的 0.1.7，受限环境中 Chromium 无法建立单实例套接字目录并报告 sandbox 初始化失败，未取得首窗。未放宽文件系统或 Keychain 限制，也无法据此推算性能提升比例。

本轮修复了 Electron 类型检查将 CLI 待关联列表推断为 `never[]`、未使用导入与提前返回的 lint 错误。严格隔离运行时的 core 私有套接字采用沙箱临时目录；此前固定使用系统临时目录导致启动被拒。Darwin 清理流程识别已经退出中的进程，保留对活动进程的身份核验；此前重复清理可能遇到 Mach 错误 5，修复后连续 20 次回收测试通过。Electron 离屏参考采集以实际页面像素比缩放舞台，并校验 PNG 物理尺寸；基准支持单独采集一个壳。

| 检查 | 实测结果 |
| --- | --- |
| `pnpm build` | 重建 CLI、Bento、Electron 主进程、preload 与 renderer，通过 |
| `pnpm format` / `pnpm format:check` | 通过；撤回 Electron 清单中无关的破折号转义 |
| `go test ./...` / `GOOS=windows GOARCH=amd64 go vet ./...` / `GOOS=linux GOARCH=amd64 go vet ./internal/...` | 通过；统一采用 Go 1.27.3、CGO 禁用、只读模块解析 |
| `node --test scripts/package-mygo-desktop.test.mjs scripts/bench-mygo-vs-electron.test.mjs scripts/bench-g3-pixel-diff.test.mjs` | R1 修复后复核，15 项通过 |
| `node scripts/package-mygo-desktop.mjs --require-standalone-node --out <临时目录>` | 通过；最终包内 CLI 与 Go supervisor 实际互通，同时核对其进程环境含 stdin 传输标记且不含两个握手令牌值 |
| `pnpm check` | 全部通过，包含类型、lint、工作区和 Electron 测试、i18n、Code Collab 导入、平台及公开边界检查 |
| `pnpm check:public-boundary` | 最终复核通过（4,755 个文件、24 个清单） |
| `pnpm run docs check` | 零错误；现存 AGENTS 文档大小预警不影响结果 |
