# Stage 3B 默认桌面壳切换就绪报告

Status: proposed
Date: 2026-11-25
Translation: pending
Related: [Stage 3A 设计](2026-11-25-mygo-stack-stage3a-design.zh.md) · [Stage 3A 门禁报告](2026-11-25-mygo-stage3a-gate-report.zh.md) · [上游 MyGo 补丁记录](2026-11-25-mygo-upstream-g4-g5-patch.md)

## 摘要

默认生产壳继续使用 Electron，Stage 3B 切换结论为 **HOLD**。macOS arm64 按本轮所有者显式批准的 Stage 3B 双层修订口径通过 G3，按 Stage 3A 原口径仍为 PARTIAL。G5 请求体预算门禁通过。G1 尚待 OAuth 轮换交接、CI 公证及更新链路验证。G4 因 WKWebView 字面回环绕过代理、WebView2 注册表参数可覆盖代理配置而阻塞。切换还需 Windows WebView2 真机验证通过，并等待 MyGo 上游补丁合并或形成明确的依赖决策。

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

该证明覆盖经典文件钥匙串中的合成 generic password。生产旧包、实际创建凭据的进程与发布候选包仍需在升级演练中核对。本地 Developer ID 签名、Hardened Runtime、跨壳写租约和同 CFBundleIdentifier、同 TeamID 的原位替换 ACL 均通过。切换前必须先停止 Electron 发起新 OAuth 刷新，等待所有在途轮换完成并确认新令牌已落盘，再允许 MyGo 封存 v2。此单壳交接仍待验证。其余门禁为 CI 通过 Apple notarytool 完成公证，以及验证 Sparkle 或对应更新器的升级行为。

## G3 像素门禁

**Stage 3A 原口径：PARTIAL。** 两个大图夹具的跨引擎局部滑窗误差分别为 3.14/255 与 3.98/255，超过 1.5/255。WKWebView 默认保留瓦片外元素投下的阴影，纯 `bleedPx=0` 无裁切变异实测为 0/255，未触发门禁。[Stage 3A 实测记录](2026-11-25-mygo-stage3a-gate-report.zh.md)

**macOS arm64：PASS（Stage 3B 修订双层口径）。** 三个夹具各测 1× 与 2×，六组 WKWebView 单图与拼接 PNG 的 SHA-256 均逐组相同，解码后的像素误差为 0.0000/255，满足同引擎接缝上限 1.5/255。这证实上述两个局部峰值来自跨引擎栅格化差异。六组跨引擎整图 RGB / Alpha MAE 均满足 2.0/255 与 0.5/255 上限。真实负向变异将 bleed 清零并裁切瓦片外元素，检出 48.75/255；合成对照为 44.625/255。[像素基准](../../../../scripts/bench-g3-pixel-diff.mjs)

## G4 公共浏览器网络隔离 — BLOCKED

macOS 真机上，Go 的 `PublicEgressProxy` 与 `mygo.NewProxiedSession` 配合，通过认证代理加载了模拟公网页面。源站未收到 `Proxy-Authorization`，解析到回环地址的 DNS 重绑定主机名也在拨号前被拒绝。但 WKWebView 使用 Network.framework 的 `nw_proxy_config_create_http_connect` 时，对字面地址 `127.0.0.1` 的请求绕过了代理。浏览器报告 CORS 错误，私有回环服务器仍收到一次请求。因此 macOS 即使配置 `EnablePublicBrowser: true`，也继续禁用 `publicBrowser.navigate`，返回 `public_browser_disabled_pending_g4`。[原生代理验证](../../../../internal/shell/g4_browser_proxy_test.go)

Windows 上 WebView2 可追加注册表配置的浏览器参数，覆盖 `--proxy-server`；Cookie 查询仍可成功。代理强制执行尚待验证，Windows 与未验证的 Linux 同样禁用桌面公共浏览器。

1. macOS 需将代理与 WebKit 的 `WKContentRuleList` 配合，在子资源请求进入网络栈之前阻止字面回环或私有 IP、`localhost` 和 `*.local`，并以私有服务器未收到请求验证隔离。
2. 在 `windows-latest` 运行现有工作流，补齐 Windows WebView2 真机宿主及 OAuth/Cookie 验证并记录绿色运行。[Windows 工作流](../../../../.github/workflows/mygo-windows-verify.yml)

## G5 原生请求体预算 — PASS（macOS 真机）

`go.mod` 固定了下列替换版本，对应 LeonEthan/mygo 的 `feat/scheme-body-limits-and-session-proxy` 分支提交 `3a0110a8ee88f29aa9a827279cf6d4c4c71019a3`。上游 PR 草稿已备妥，尚未提交至 egoist/mygo。[上游补丁及草稿](2026-11-25-mygo-upstream-g4-g5-patch.md)

```go
replace github.com/egoist/mygo => github.com/LeonEthan/mygo v0.10.1-0.20261125123958-3a0110a8ee88
```

macOS 真机上，单请求达到 5 MiB + 1 B 时返回 HTTP 413，在途请求体合计达到 32 MiB + 1 B 时返回 HTTP 503。两次拒绝均发生在到达 `DesignProtocolHost` 之前。首批请求经历正常完成、错误和取消后，第二批请求再次同时占用了完整的 32 MiB 预算。[原生预算验证](../../../../internal/shell/g5_budget_test.go)

## 默认壳切换清单

1. 对同一发布候选包在 macOS CI 完成 Developer ID 签名、严格验签、公证、装订及 Gatekeeper 验证，记录版本、摘要和公证回执。
2. 在隔离升级环境中从已发布 Electron 版本经正常更新渠道安装 MyGo，验证 Sparkle 或对应更新器的渠道、签名验证、重启和下一版本更新。演练更新失败后的恢复，确认凭据仍可读写、作品可打开、写租约与迁移备份可用。
3. 收齐 G1、G3、G4、G5 的绿色证据，记录上游补丁的合并结果或依赖决策，关联 macOS 原生端到端记录和首次绿色 windows-latest WebView2 运行。任一项待验时继续发布 Electron 默认壳。
4. 发布负责人核对候选包与实测版本一致后切换默认生产壳；保留已验证的 Electron 恢复包及备份。若升级、凭据或作品恢复失败，暂停分发并按已演练流程恢复。
