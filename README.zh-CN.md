# Molly

[English](README.md)

Molly 是基于 [Lody](https://github.com/LodyAI/Lody) 代码库的独立本地桌面平面设计
工作台，每件作品使用一张可编辑画布。它保留 Lody 的界面与 Agent 执行架构，结合
YAML 画稿创作与 Bento 编辑器。

## 当前开发版本

- 创建设计、选择尺寸，在 Bento 中编辑文字、形状和图片，保存、重新打开并导出 PNG 或 JPEG。
- 手工编辑自动保存；使用“存为版本”保留作品的本地历史节点，查看旧版并从所选版本继续编辑。
- 请已配置的 Agent 使用 YAML 创作或修改设计。BentoDoc 是可编辑画布，YAML 是面向
  Agent 的创作格式。Agent 自主选择创作方法，并可使用可用的文件与图片工具审阅作品。
- 使用既有会话导航，继续对话、处理权限请求或取消执行。视觉质量由你判断。
- 未配置图像服务也可以编辑画布。图像生成是可选连接；在设置中填写你自己的端点、
  凭据和明确的 model 标识。Molly 不推荐产品默认型号。

当前开发版本正在迁移到单一内置 Pi 引擎和显式模型连接。图片读取、公开先读提醒和创作
预览已有局部实现证据，但迁移后的完整流程尚未验收。能够配置某个供应商，不代表其全部
设计操作都已验证。
[设计规范](specs/graphic-design-platform.zh.md) 描述草案目标，不是已交付功能清单。

## 安装 macOS 安装包

本地构建产出 `MollyDesign-<version>-arm64.dmg`（macOS，Apple 芯片）。打开 DMG 后把
**Molly.app** 复制到你有权限的任意文件夹；它不会替换或修改其他应用。安装包为
ad-hoc 签名、未经公证：首次启动时右键点击应用选择**打开**并确认。不要为运行它
而关闭 Gatekeeper 或移除隔离属性。

首次启动时，macOS 会询问是否允许 Molly 使用钥匙串中的“Molly Safe Storage”条目，
它保护已保存的连接凭据。选择**始终允许**可在重启后保持已存连接可读；**允许**
仅本次有效；**拒绝**时应用仍可使用，但已存连接无法读取，需在设置中重新填写。
ad-hoc 本地构建没有稳定签名身份，每个新构建都会再次询问。在通过自动化接口驱动
应用之前先回应该弹窗：弹窗未决期间自动化接口不会响应。

## 配置连接

1. 打开设置 → Agents → Molly model connections，添加供应商/产品、连接名称、端点和
   API key。密钥只填写在本地设置字段中，不放进聊天或画稿文件。保存会加密连接，但不
   测试推理，也不修改已有会话的模型选择。
2. Kimi 会员凭据选择 **Kimi Code (membership API key)**，不是 Moonshot 开放平台。
   在会话输入框选择 Molly，并明确选择连接、模型和受支持的思考等级。缺失或无效选择
   会报错，不静默切换供应商或模型。
3. 按需单独配置设置 → Image Connection。填写兼容 OpenAI Images 的 API 根地址
   （不含 `/images/generations` 或 `/images/edits`）、密钥和准确模型名称，启用并保存。
   **Test connection** 只检查 `/models`；成功不证明生成、编辑或蒙版可用。
4. 外部工具在设置 → MCP 中配置，再为当前回合选择服务器。保存不会测试或自动选中。
   stdio 服务器会运行本地代码，只配置你信任的命令和服务器。

内置能力区域显示随包版本和兼容条件，不代表当前会话已经启用。精选问答扩展需要桌面
问答接口；必要的 Slash 命令映射尚未完成。使用内置引擎不需要用户自行安装插件。

选择 **OpenAI-compatible（高级）** 时，在连接表单中添加明确模型定义，包括 ID、token
限制和服务实际支持的能力。此路径使用标准 Chat Completions 流式协议，不是 Responses 或
厂商专属思考格式。含工具的回合需要声明支持工具调用。保存不验证声明、不选择模型；
未知价格保持未知。

## 试做一张设计

创建单画布后，可以尝试：

> 制作一张 800 × 600 的工作坊海报。使用深蓝背景，大标题为“动手创造”，
> 副标题为“周六 · 14:00”。保持文字可编辑。

然后继续：

> 缩小标题，并给副标题更多留白。保持画布尺寸。

你也可以直接在 Bento 中选中文字编辑、改色、插入图片或调整布局。保存设计后导出
PNG 或 JPEG。生成图片是可选步骤，文字和形状设计不需要图像服务。

## 本地运行

使用 Node.js `>=22.14.0 <23 || >=23.6.0`（Node-API 10），通过 Corepack 使用仓库锁定的 pnpm：

```sh
git clone --recurse-submodules https://github.com/LeonEthan/molly-design.git
cd molly-design
corepack pnpm install
corepack pnpm start:local
```

按上文在设置中配置内置引擎的模型连接；安装外部 Agent CLI 不再是新的执行路径。
这里的 Node 要求针对源码开发。
OSS 桌面使用本地产品存储，不登录 Lody 托管工作空间，也不提供其网页、手机、团队
共享或云端功能。

Molly 已有独立应用身份（`dev.molly-design.app`、`molly-design://`）。自有工作区包使用
`@molly/*`，环境选项使用 `MOLLY_*` 并兼容读取 `LODY_*` 别名（新名称优先）。
外部 ACP 协议名称保持不变，不会自动迁移或清除 Lody 数据。

内部后台架构见 [运行组件 README](apps/cli/README.md)，继承的贡献条款和开发检查见
[CONTRIBUTING.md](CONTRIBUTING.md)。本 README 是 Molly 的公开帮助入口；`site-docs`
保留上游 Lody 网站材料，不是 Molly 的功能参考。

## 备份、卸载与数据恢复

结束执行、解决保存错误并退出 Molly 后再复制数据。一起备份完整桌面配置、本地服务
数据和外部项目/画稿目录，不要只复制会话 JSONL 文件。未覆盖路径时，macOS 默认位置为：

| 位置                                         | 内容                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `~/Library/Application Support/Molly Design` | 桌面配置，包含加密的 `secrets/model-connections.enc` 存储。                     |
| `~/.molly`                                   | 本地服务数据；受管 Pi 配置、缓存、原生会话和运行/操作回执位于 `harness/pi` 下。 |
| 用户选择的项目目录                           | 存在应用目录之外的项目文件和画稿资产。                                          |

`MOLLY_DATA_DIR`、`MOLLY_ELECTRON_USER_DATA_DIR` 或 `--user-data-dir` 可以改变这些位置。
复制加密凭据不保证能在另一台机器或操作系统账户中解密；必要时通过设置重新填写。
备份应视为敏感数据：新写入改为加密不会抹除旧备份或复制历史中的明文。

删除应用不等于重置数据。在 macOS 上若要保留数据，退出后只把应用移入废纸篓。
永久移除数据需要另行确认目标配置和项目并备份；保留 Lody 数据、外部 CLI 目录和用户
仓库。移除本地凭据不会撤销供应商端的密钥。

目前没有已验证的一键降级。不要用可写的旧版本打开已迁移的新配置：严格读取器可能拒绝
新记录。仅恢复另行保留且已核对兼容性的备份，不把加密密钥复制回旧明文设置。

## Repository

- `apps/cli` — Agent 执行和本地设计存储
- `apps/electron` — Molly 桌面应用
- `packages/components` — 复用的工作台界面
- `packages/design-bento` — 固定版本的 Bento 编辑与渲染资源
- `packages/design-authoring` — YAML 画稿转换和 Agent skills
- `packages/harness-pi` — 固定版本的内置引擎和已审核随包资源
- `packages/platform` — 平台能力与端口
- `packages/shared` — 共享 schema 和协议
- `packages/cloud-api` — 可选云 DTO，不包含托管后端
- `packages/acp-extension-{core,kimi}` — ACP 扩展子模块

## 来源与许可证

Molly 是基于 [Lody](https://github.com/LodyAI/Lody) 的独立衍生项目，保留上游署名、
[Apache-2.0 许可证](LICENSE)和归属声明；来源摘要见 [NOTICE](NOTICE)。当前 Molly
标记（带轻柔入锋的手写一笔 M，墨色落于圆角格线纸面）与排版开场为 Molly 新制作；旧素材保留原有归属。新品牌的视觉验收随独立发布工作记录。创作格式和编辑器适配来自
`agentic-listing-design`；
[Bento 来源与许可证说明](packages/design-bento/README.md)及
[创作格式来源说明](packages/design-authoring/README.md)记录各自来源。
应用内“开源许可证”入口保留依赖声明。
内置引擎打包见[模块 README](packages/harness-pi/README.md)；精选社区扩展在
[manifest](packages/harness-pi/vendor/pi-ask-question/manifest.json) 中记录版本、来源和适配，
并保留其 [MIT 许可证](packages/harness-pi/vendor/pi-ask-question/LICENSE)。

新的 Molly 问题和建议请提交到 [Molly Issues](https://github.com/LeonEthan/molly-design/issues)。

## 持续创作、预览与恢复

手工修改自动更新当前画稿及其 YAML 画稿文件。Molly 在派发前等待已打开画布的保存完成，在 Agent 执行及文件处理期间保持作品只读。文件预览展示工作中的源文件，不代表画布已保存或 Agent 已结束；正式提交后可再次编辑当前画布。显式导入绑定用户看到的源快照。

发生文件或最终保存冲突时，保留当前已保存画布与 Agent 草稿。通过新消息明确继续解决冲突，不自动重启结束的回合。既有草稿和历史内容仍可通过文件入口读取。保存失败时，先解决错误，再把最新编辑视为已保存或退出。

取消、超时或崩溃后，已派发请求的远端结果可能未知。停止不证明供应商已经停止计算或计费。
保留回执和已恢复的资产；Molly 不自动重复付费请求，明确发起新请求可能再次计费。
恢复已完成执行的资产处理不得重新启动模型。

旧设计会话通过明确的 Molly 续作入口迁移，并先审阅迁移预览。它为同一作品建立新上下文，
保留原历史，不将旧记录重放成 Pi 原生历史。旧 Role 也需要明确迁移。这些路径已有实现
测试，原生重启及回滚验收仍待完成。原生历史无效时保留原文件并报告错误，不通过删除
日志强制重试。

## 故障说明

- **首次启动看似卡住、自动化接口无响应。** 上述钥匙串弹窗仍未处理，可能在窗口
  后面；先回应它。
- **已保存的连接消失或无法读取。** 弹窗被拒绝或构建已更换。在设置中重新填写
  连接；加密存储不能跨机器或跨系统账户迁移。
- **图片调用在超时后报告结果未知。** Molly 保留回执，不自动重试可能已付费的
  请求，也不谎报成功。只有通过明确的新请求重试，且可能再次计费。
- **画布只读或报告保存冲突。** 先让进行中的回合结束或停止并保存已打开的画布；
  Molly 不会用旧草稿覆盖当前作品。保留的草稿仍在，通过新消息解决冲突。
- **回执与日志。** 运行与付费操作回执在 `~/.molly/harness/pi` 下；桌面与服务
  数据位置见下文备份一节。

## 发布状态与支持限制

内置 Pi 迁移已有**局部验收证据**，并非完整验收。证据与剩余工作记录在
[实施笔记](.agents/notes/proposed/architecture/2026-09-19-embedded-pi-harness-implementation.zh.md)与
[最终安装包交付记录](.agents/notes/implemented/testing/2026-09-20-final-package-delivery.zh.md)。

| 连接                                                | 当前证据与限制                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Kimi Code `k3-256k/high`                            | 真实文本回合、设计创建/修改、取消与旧会话延续已在本地安装构建上验证；本次交付包在不新增付费调用的情况下复验了渲染、编辑/保存/导出与延续画布路由。不代表完整厂商或旅程覆盖。                        |
| 已配置的 Images-compatible `gpt-image-2.5-sunburst` | 真实生成与编辑输出已在本地安装构建上的同一作品中验证；本次交付包复验了这些资产的渲染。完整蒙版、多图、JPEG、长图及人工视觉矩阵仍开放。这是测试时的用户选择，不是默认模型。                          |
| 其他具名模型预设                                    | 固定 SDK 目录及代码/离线检查，不证明真实账户、区域或产品兼容。                                                                 |
| 高级 OpenAI-compatible 语言模型                     | 显式模型表单、加密持久化和标准 Chat Completions SDK 路径已有合成测试；原生界面和真实服务验收仍开放，与 Image Connection 独立。 |

macOS arm64 交付包已从 DMG 安装副本完成验证：首次启动、会话重开、作品渲染（含此前
生成的图片）、手工编辑与自动保存、PNG 导出、旧会话延续画布路由与重启持久化。已配置
模型回合与图片生成在此前各期的安装构建上验证，见链接记录。Windows/Linux 资源构建不是
原生执行证据。
已审核的 `pi-ask-question` 子集有 SDK 测试，原生问答交互及恢复仍开放。这些检查不确立
通用画布尺寸或性能上限。

本次交付明确延期：Google 及其他 SDK 升级、插件斜杠命令体系、复杂图片组合（蒙版、
多参考图、格式矩阵）、跨平台专项验收、长期性能测试，以及内置 Pi 升级/卸载演练。

此前的[设计验收](.agents/notes/implemented/testing/2026-09-11-complete-design-acceptance.md)与
[五 Agent 矩阵](.agents/notes/implemented/testing/2026-09-11-installed-five-agent-matrix.md)
是迁移前运行时的历史证据，不能验证当前内置引擎。
[验收说明](e2e/DESIGN-ACCEPTANCE.md)提供设计评审背景，不代表迁移已通过。

本地临时签名包验证不代表公开发布、Developer ID 签名、公证或自动更新通道已就绪。
