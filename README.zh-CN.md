# Molly

[English](README.md)

Molly 是独立的本地桌面平面设计工作台，结合 Agent 与可直接编辑的画布。
通过对话创作海报、持续修改，再手工调整文字、形状和图片，导出 PNG 或 JPEG。

Molly 基于 [Lody](https://github.com/LodyAI/Lody) 的桌面与执行架构，结合 Bento
编辑器和内置 Pi 引擎。作品、版本与会话使用本地产品存储；模型和图片请求发送到
你明确配置的服务商，无需 Molly 云账户。

## 当前开发版本

- 通过对话或直接编辑创建、修改单画布设计。
- 自动保存手工编辑，保存作品版本、重新打开并导出。
- 使用自己的模型连接；图片生成与编辑可选，需单独配置连接和明确模型。
- BentoDoc 是可编辑作品，YAML 是面向 Agent 的画稿投影。

**发布状态：开发版本，首发目标为 macOS Apple Silicon。** 已有局部安装包验收证据，
完整迁移旅程、公开签名/公证分发及两个真实版本间的自动升级验收仍未完成。
macOS Intel、Windows 和 Linux 构建为实验性支持。
详见[已验证旅程与限制](USER_GUIDE.zh-CN.md#发布状态与支持限制)。

## 开始使用

已有本地 DMG 时，按[安装指南](USER_GUIDE.zh-CN.md#安装-macos-安装包)操作。
本仓库尚不宣称已建立公开下载通道。

1. 在设置 → Agents → Molly 模型连接中添加服务商连接。
2. 创建画布，明确选择连接、模型和思考级别。
3. 尝试：“制作一张 800 × 600 的工作坊海报，深蓝背景，保留可编辑的‘Make something’标题。”
   随后通过对话修改，或直接编辑画布。

[配置模型与图片工具](USER_GUIDE.zh-CN.md#配置连接) ·
[保存、预览与恢复](USER_GUIDE.zh-CN.md#持续创作预览与恢复) ·
[备份与卸载](USER_GUIDE.zh-CN.md#备份卸载与数据恢复)

## 本地运行

使用 Node.js `>=22.14.0 <23 || >=23.6.0`，通过 Corepack 使用仓库固定的 pnpm：

```sh
git clone https://github.com/LeonEthan/molly-design.git
cd molly-design
git submodule update --init packages/acp-extension-core packages/acp-extension-dsh
corepack pnpm install
corepack pnpm start:local
```

首次构建还会在临时 Bento checkout 中执行带锁文件的 `npm ci`，可能需要网络与原生构建工具。
桌面应用已内置执行引擎，用户无需安装独立 Agent CLI。
开发依赖、检查与模块边界见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## Repository

| 位置                                                        | 职责                                 |
| ----------------------------------------------------------- | ------------------------------------ |
| `apps/electron`                                             | 桌面应用、系统集成与打包             |
| `apps/cli`                                                  | 内嵌本地服务、Agent 执行与设计持久化 |
| `packages/components`                                       | 共享工作台界面                       |
| `packages/design-bento`                                     | 固定版本编辑器、Molly 适配与渲染资源 |
| `packages/design-authoring`                                 | 无损 YAML 画稿转换与 Agent 技能      |
| `packages/harness-pi`                                       | 内置模型引擎与已审核扩展             |
| `packages/platform`、`packages/shared`                      | 平台接口与共享合同                   |
| `packages/acp-extension-core`、`packages/acp-extension-dsh` | 必需的上游协议与能力合同             |
| `e2e`                                                       | 桌面验收工具                         |

`vendor/` 下的其他 ACP 子模块保留上游或历史材料，不参与默认工作区。
修改这些项目之前请阅读[依赖维护说明](CONTRIBUTING.md#source-dependencies)。

## 贡献与帮助

可复现问题和建议请提交到 [Molly Issues](https://github.com/LeonEthan/molly-design/issues)。
使用与恢复见[用户指南](USER_GUIDE.zh-CN.md)，安全漏洞通过 [SECURITY.md](SECURITY.md)
指定的私密渠道报告。贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 来源与许可证

Molly 是 Lody 的独立派生项目，保留原作者与 [Apache-2.0 许可证](LICENSE)。
从 `agentic-listing-design` 迁入的权利人自有适配代码亦已授权按 Apache-2.0 发布；
Bento 及其他第三方组件保留各自许可证。详见 [NOTICE](NOTICE)、
[Bento 来源](packages/design-bento/README.md)、[authoring 来源](packages/design-authoring/README.md)
与[依赖声明](THIRD_PARTY_NOTICES.md)。
