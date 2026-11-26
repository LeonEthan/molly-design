# Stage 3B 桌面更新与切换计划

Status: proposed
Date: 2026-11-25
Translation: pending

## 摘要

手动 macOS 门禁产出实验包的公证与钥匙串验证记录。生产切换仍需从已发布 Electron 版本升级并验证 MyGo 自身能接收下一次更新。

## 复用顺序

1. macOS 沿用现有 `Sparkle.framework`、发布渠道的 `appcast.xml` 和 EdDSA 密钥。MyGo 壳内已通过纯 Go（`purego/objc`，`CGO_ENABLED=0`）直接加载 `Contents/Frameworks/Sparkle.framework` 并实现 `SPUUserDriver` / `SPUUpdaterDelegate`（[updater_darwin.go](../../../../internal/shell/updater_darwin.go)），映射到现有 `updater.*` IPC 契约与 `updater.state` 推送事件。[打包脚本](../../../../scripts/package-mygo-desktop.mjs) 已支持嵌入 `Sparkle.framework`，按 `Installer.xpc → Downloader.xpc → Autoupdate → Updater.app → Sparkle.framework → .app` 由内向外签署并通过 `codesign --verify --deep --strict`。候选包须写入生产 `SUFeedURL`、`SUPublicEDKey` 和递增版本；占位公钥会被启动期 fail-closed 拒绝。
2. 复用 Electron 的 appcast 生成步骤，针对最终已装订的归档签名。单测已覆盖打包产物的 Ed25519 归档验签与篡改拒绝（[打包测试](../../../../scripts/package-mygo-desktop.test.mjs)）；真机本地 feed 演练沿用 [现有演练](../../../../apps/electron/scripts/verify-sparkle-update.mjs)，将目标包替换为 MyGo 候选包。
3. Windows 沿用现有 NSIS 安装身份、安装范围、目录和更新渠道的 `latest.yml` 与安装包。MyGo 壳内已实现零新增依赖的 `latest.yml` 解析、有界下载进度推送、SHA-512 校验、安装前 TOCTOU 复检、原生 Windows `WinVerifyTrust` + `CryptQueryObject` 发布者校验（`Leon Ethan`）及静默 `/S` 安装启动（[updater_nsis.go](../../../../internal/shell/updater_nsis.go)、[updater_nsis_verify_windows.go](../../../../internal/shell/updater_nsis_verify_windows.go)），并通过跨平台确定性单测（[updater_test.go](../../../../internal/shell/updater_test.go)）。无需新建更新服务。

## 切换清单

- 在手动 CI 核对候选包签名、Team ID、公证回执、装订和 Gatekeeper 结果。实验包使用独立标识。生产候选包须恢复 `dev.molly-design.app`，保持同一 Team ID、指定要求与安装路径。ACL 探针用两个不同二进制验证同标识原位替换；另用已发布的 Electron 包验证真实凭据创建进程与候选包的读写。[ACL 探针](../../../../scripts/verify-mygo-keychain-acl.mjs)
- Electron 更新前重启钩子已接入 `ModelConnectionStore.drainOAuthForHandoff()`（[index.ts](../../../../apps/electron/src/main/index.ts)），停止新 OAuth 刷新并等待在途轮换落盘释放写租约，且已通过跨进程 Go 迁移验证（[vault_lease_test.go](../../../../internal/security/vault_lease_test.go)）。仍需在隔离渠道完成 Electron → MyGo → 下一版本的双平台真机演练，验证作品打开、升级失败及回滚恢复。
- 关联 G1、G3、G4、G5 证据、Windows WebView2 真机记录和 MyGo 上游依赖决策。发布负责人核对候选版本、归档摘要和恢复包后再切换生产工作流。[就绪报告](2026-11-25-mygo-stage3b-readiness-report.zh.md)
