# Stage 3B 默认桌面壳切换就绪报告

Status: proposed
Date: 2026-11-25
Translation: pending
Related: [Stage 3A 设计](2026-11-25-mygo-stack-stage3a-design.zh.md) · [Stage 3A 门禁报告](2026-11-25-mygo-stage3a-gate-report.zh.md) · [上游 MyGo 补丁记录](2026-11-25-mygo-upstream-g4-g5-patch.md)

## 摘要

默认生产壳继续使用 Electron，Stage 3B 切换结论为 **HOLD**。macOS arm64 按本轮所有者显式批准的 Stage 3B 双层修订口径通过 G3，按 Stage 3A 原口径仍为 PARTIAL。G5 请求体预算门禁通过。G1 已完成本地 Developer ID 签名、同标识 ACL 探针、纯 Go Sparkle/NSIS 更新器对齐、Sparkle.framework 嵌套签名与 Ed25519 验签测试，以及 Electron OAuth 刷新排空与跨进程写租约交接测试；尚待合入 `main` 后执行 CI 公证及真机签名升级演练。G4 的 macOS 传输、字面回环与受控账户 Cookie 会话隔离验证通过，Windows WebView2 环境变量覆盖 fail-closed 拦截已接入 `windows-latest` CI；整体仍待上游 `egoist/mygo#2373`（Windows CDP Fetch 代理认证）合入后完成 Windows 真机认证代理端到端验证。切换还需等待上游 `egoist/mygo#2372` / `#2373` 合并或形成明确的依赖决策。

| macOS arm64 门禁 | 结论 |
| --- | --- |
| G3 · Stage 3A 原口径 | PARTIAL |
| G3 · Stage 3B 双层修订口径 | PASS（Stage 3B 修订双层口径） |

## G1 签名、凭据与共存写入 — PARTIAL

Wave 1 的应用包通过 `codesign --verify --deep --strict`，TeamIdentifier 为 `Q96C8424X6`，签名标志为 `flags=0x10000(runtime)`。跨进程测试让 Node 子进程运行 Electron 的 ModelConnectionStore，持有写租约期间 Go 返回 ErrVaultWriterBusy；释放后 Go 完成迁移并生成备份。该测试使用合成密钥提供方。[租约测试](../../../../internal/security/vault_lease_test.go)

本机探针复用已有签名检查和 Go Keychain 读写入口。所有口令项均显式指定同一临时目录中的测试钥匙串，三个场景各用独立账号。两个进程均在读写前关闭 Security.framework 用户交互，结束后删除钥匙串及目录。[探针](../../../../scripts/verify-mygo-keychain-acl.mjs)

| 签名与 ACL | 新程序读取 | 新程序更新 | 旧程序读回新值 |
| --- | --- | --- | --- |
| 不同标识，同团队，默认 ACL | 拒绝，OSStatus -25293 | 未执行 | 未执行 |
| 不同标识，同团队，显式信任两个程序 | 成功 | 成功 | 成功 |
| 相同标识、相同团队，默认 ACL，原路径替换 | 成功，0 | 成功，0 | 成功，0 |

第三组以两个独立构建的 Mach-O 模拟新旧壳，签名后 SHA-256 不同。旧程序创建并读回初值；新程序在同一路径替换旧程序后读写成功，场景结果为 `passed: true`。两份二进制各自的 `codesign -d -r-` 输出给出相同指定要求：

```text
identifier "com.molly.stage3b.acl-test" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = Q96C8424X6
```

该证明覆盖经典文件钥匙串中的合成 generic password。生产旧包、实际创建凭据的进程与发布候选包仍需在升级演练中核对。本地 Developer ID 签名、Hardened Runtime、跨壳写租约和同 CFBundleIdentifier、同 TeamID 的原位替换 ACL 均通过。Electron 侧已补齐 `ModelConnectionStore.drainOAuthForHandoff()` 与 `prepareToRelaunch` 接入：在更新重启前拒绝新 OAuth 刷新、等待在途轮换落盘并释放写租约；[跨进程交接测试](../../../../internal/security/vault_lease_test.go) 与 [Electron 单元测试](../../../../apps/electron/src/main/services/model-connection-store.test.mjs) 均已验证轮换后的令牌无损迁入 v2。

Step 3B 新增 [macOS 发布工作流](../../../../.github/workflows/release-mygo-macos.yml)，[打包脚本](../../../../scripts/package-mygo-desktop.mjs) 现支持嵌入 `Sparkle.framework` 并按由内向外顺序签署 XPCServices/Autoupdate/Updater.app/Framework 与主应用，且通过 `codesign --verify --deep --strict` 与 Ed25519 归档验签/篡改拒绝测试。MyGo 壳内已实现零 cgo 的 macOS `Sparkle.framework` 纯 Go 桥接（[updater_darwin.go](../../../../internal/shell/updater_darwin.go)）及沿用 `latest.yml` 与 WinVerifyTrust/Authenticode 发布者校验的 Windows NSIS 更新器（[updater_nsis.go](../../../../internal/shell/updater_nsis.go)）。其余门禁为合入 `main` 后在 CI 通过 Apple notarytool 完成公证，以及真机隔离渠道完成 Electron → MyGo → 下一版本的签名升级演练。[Sparkle 更新器对齐记录](2026-11-25-mygo-sparkle-updater-parity.zh.md)

## G3 像素门禁

**Stage 3A 原口径：PARTIAL。** 两个大图夹具的跨引擎局部滑窗误差分别为 3.14/255 与 3.98/255，超过 1.5/255。WKWebView 默认保留瓦片外元素投下的阴影，纯 `bleedPx=0` 无裁切变异实测为 0/255，未触发门禁。[Stage 3A 实测记录](2026-11-25-mygo-stage3a-gate-report.zh.md)

**macOS arm64：PASS（Stage 3B 修订双层口径）。** 三个夹具各测 1× 与 2×，六组 WKWebView 单图与拼接 PNG 的 SHA-256 均逐组相同，解码后的像素误差为 0.0000/255，满足同引擎接缝上限 1.5/255。这证实上述两个局部峰值来自跨引擎栅格化差异。六组跨引擎整图 RGB / Alpha MAE 均满足 2.0/255 与 0.5/255 上限。真实负向变异将 bleed 清零并裁切瓦片外元素，检出 48.75/255；合成对照为 44.625/255。[像素基准](../../../../scripts/bench-g3-pixel-diff.mjs)

## G4 公共浏览器网络隔离 — PARTIAL（macOS PASS / Windows 待上游 #2373 接入）

macOS arm64 显式启用的真机 WKWebView 测试通过。WKContentRuleList 与 PublicEgressProxy 配合，阻止了对 `http://127.0.0.1`、`http://localhost`、`http://[::1]` 和 `http://rebind.test:80` 的请求，私有服务端收到 0 次访问。模拟公网页面成功加载，源站未收到 `Proxy-Authorization`；注入到独立公共浏览器会话的受控账户 Cookie 成功送达模拟公网源站，且未泄露至默认应用会话 `mygo.DefaultSession()`。[原生验证](../../../../internal/shell/g4_browser_proxy_test.go)

Windows `windows-latest` CI 已跑通全部 Go/WebView2 协议映射、流式请求体、跨进程写租约及 OAuth 排空交接测试，并新增 [Windows 环境变量覆盖拒绝测试](../../../../internal/shell/g4_browser_proxy_windows_test.go) 验证设置 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 或 `WEBVIEW2_USER_DATA_FOLDER` 时代理会话 fail-closed。当前默认桌面继续禁用 `publicBrowser.navigate`。待验证项为等待上游 [egoist/mygo#2373](https://github.com/egoist/mygo/pull/2373)（Windows WebView2 CDP Fetch 代理认证）合入并切换 `go.mod` 后，在 `windows-latest` 完成认证代理真机端到端验证。此外，Linux 侧需注意 WebKitGTK/libsoup 存在 CVE-2026-66339（未修补的 libsoup 3.6.5-3 会在跨主机场景泄露代理凭据），且 macOS/Linux WebKit 均无独立的 WebRTC 非代理 UDP 禁用开关，公共浏览器默认策略保持仅针对受控传输边界开放。[Windows 工作流](../../../../.github/workflows/mygo-windows-verify.yml)

## G5 原生请求体预算 — PASS（macOS 真机）

原综合草稿 PR [egoist/mygo#2360](https://github.com/egoist/mygo/pull/2360) 已拆分为两个独立 Ready PR：[egoist/mygo#2372](https://github.com/egoist/mygo/pull/2372)（自定义 scheme 请求体与全局在途字节预算）与 [egoist/mygo#2373](https://github.com/egoist/mygo/pull/2373)（每会话 HTTP 代理与跨平台真机验证），均已通过上游 CI 与独立代码审查，静待维护者 API 决策。当前仓库 `go.mod` 暂固定 `github.com/LeonEthan/mygo v0.10.1-0.20261125154445-f1967691cfde`（`feat/scheme-body-limits-proxy-rules`），待上游合入发布后统一切回主仓。

macOS 真机上，单请求达到 5 MiB + 1 B 时返回 HTTP 413，在途请求体合计达到 32 MiB + 1 B 时返回 HTTP 503。两次拒绝均发生在到达 `DesignProtocolHost` 之前。首批请求经历正常完成、错误和取消后，第二批请求再次同时占用了完整的 32 MiB 预算。[原生预算验证](../../../../internal/shell/g5_budget_test.go)

## 默认壳切换清单

1. 对同一发布候选包在 macOS CI 完成 Developer ID 签名、严格验签、公证、装订及 Gatekeeper 验证，记录版本、摘要和公证回执。
2. 在隔离升级环境中从已发布 Electron 版本经正常更新渠道安装 MyGo，验证 Sparkle 或对应更新器的渠道、签名验证、重启和下一版本更新。演练更新失败后的恢复，确认凭据仍可读写、作品可打开、写租约与迁移备份可用。
3. 收齐 G1、G3、G4、G5 的绿色证据，记录上游补丁的合并结果或依赖决策，关联 macOS 原生端到端记录和首次绿色 windows-latest WebView2 运行。任一项待验时继续发布 Electron 默认壳。
4. 发布负责人核对候选包与实测版本一致后切换默认生产壳；保留已验证的 Electron 恢复包及备份。若升级、凭据或作品恢复失败，暂停分发并按已演练流程恢复。
