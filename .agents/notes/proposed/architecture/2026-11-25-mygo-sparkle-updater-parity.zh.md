# Stage 3B 桌面更新与切换计划

Status: proposed
Date: 2026-11-25
Translation: pending

## 摘要

手动 macOS 门禁产出实验包的公证与钥匙串验证记录。生产切换仍需从已发布 Electron 版本升级并验证 MyGo 自身能接收下一次更新。

## 复用顺序

1. macOS 沿用现有 Sparkle.framework、发布渠道的 appcast.xml 和 EdDSA 密钥。Electron 主进程的更新入口依赖 Electron；MyGo 需要原生入口调用同一框架。打包时先嵌入并签署框架和辅助程序，再签署应用。候选包须写入生产 SUFeedURL、SUPublicEDKey 和递增版本。当前两个可选 plist 参数仅配置元数据。
2. 复用 Electron 的 appcast 生成步骤，针对最终已装订的归档签名。沿用本地 feed 演练，将新包替换为 MyGo；验证 Sparkle 按 enclosure 的 edSignature 验证下载，篡改包必须拒绝。[现有演练](../../../../apps/electron/scripts/verify-sparkle-update.mjs)
3. Windows 沿用现有 NSIS 安装身份、安装范围、目录和更新渠道的 latest.yml、安装包与 blockmap。先用现有 Electron 更新器安装 MyGo，再为 MyGo 适配检查、下载、校验和启动安装器的入口。保留签名发布者校验；在 Windows 验证静默替换、重启、卸载及下一跳升级。只有现有封装无法承载 MyGo 时才适配 NSIS 模板，无需新建更新服务。

## 切换清单

- 在手动 CI 核对候选包签名、Team ID、公证回执、装订和 Gatekeeper 结果。实验包使用独立标识。生产候选包须恢复 dev.molly-design.app，保持同一 Team ID、指定要求与安装路径。ACL 探针用两个不同二进制验证同标识原位替换；另用已发布的 Electron 包验证真实凭据创建进程与候选包的读写。[ACL 探针](../../../../scripts/verify-mygo-keychain-acl.mjs)
- 在隔离渠道完成 Electron → MyGo → 下一版本的双平台演练。停止旧壳发起 OAuth 刷新，等待在途轮换落盘，验证写租约、迁移备份、作品打开、升级失败及回滚恢复。
- 关联 G1、G3、G4、G5 证据、Windows WebView2 真机记录和 MyGo 上游依赖决策。发布负责人核对候选版本、归档摘要和恢复包后再切换生产工作流。[就绪报告](2026-11-25-mygo-stage3b-readiness-report.zh.md)
