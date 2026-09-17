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

这是开发版本，不代表已经满足发布标准。各 Agent 的图片输入、公开先读提醒、创作文件实时
预览及其它流程改进仍分别作为后续工作处理。能够配置某个 Agent，不代表其全部设计操作
都已验证。
[设计规范](specs/graphic-design-platform.zh.md) 描述草案目标，不是已交付功能清单。

## 试做一张设计

创建单画布后，可以尝试：

> 制作一张 800 × 600 的工作坊海报。使用深蓝背景，大标题为“动手创造”，
> 副标题为“周六 · 14:00”。保持文字可编辑。

然后继续：

> 缩小标题，并给副标题更多留白。保持画布尺寸。

你也可以直接在 Bento 中选中文字编辑、改色、插入图片或调整布局。保存设计后导出
PNG 或 JPEG。生成图片是可选步骤，文字和形状设计不需要图像服务。

## 本地运行

使用 Node.js 22.14 或更高版本，通过 Corepack 使用仓库锁定的 pnpm：

```sh
git clone --recurse-submodules https://github.com/LeonEthan/molly-design.git
cd molly-design
corepack pnpm install
corepack pnpm start:local
```

在设置中选择并配置 Agent。Agent 运行时安装可能需要公共下载及供应商自己的认证。
OSS 桌面使用本地产品存储，不登录 Lody 托管工作空间，也不提供其网页、手机、团队
共享或云端功能。

Molly 已有独立应用身份（`dev.molly-design.app`、`molly-design://`），本地服务数据位于 `~/.molly`。
Electron 使用当前操作系统的 Molly 用户数据位置。现有 `LODY_*` 环境选项及
`@lody/*` 包名、协议名仍是兼容接口，不会自动迁移或清除 Lody 数据。

内部后台架构见 [运行组件 README](apps/cli/README.md)，继承的贡献条款和开发检查见
[CONTRIBUTING.md](CONTRIBUTING.md)。本 README 是 Molly 的公开帮助入口；`site-docs`
保留上游 Lody 网站材料，不是 Molly 的功能参考。

## Repository

- `apps/cli` — Agent 执行和本地设计存储
- `apps/electron` — Molly 桌面应用
- `packages/components` — 复用的工作台界面
- `packages/design-bento` — 固定版本的 Bento 编辑与渲染资源
- `packages/design-authoring` — YAML 画稿转换和 Agent skills
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

新的 Molly 问题和建议请提交到 [Molly Issues](https://github.com/LeonEthan/molly-design/issues)。

## 持续创作、预览与恢复

手工修改自动更新当前画稿及其 YAML 画稿文件。Molly 在派发前等待已打开画布的保存完成，在 Agent 执行及文件处理期间保持作品只读。文件预览展示工作中的源文件，不代表画布已保存或 Agent 已结束；正式提交后可再次编辑当前画布。显式导入绑定用户看到的源快照。

发生文件或最终保存冲突时，保留当前已保存画布与 Agent 草稿。通过新消息明确继续解决冲突，不自动重启结束的回合。既有草稿和历史内容仍可通过文件入口读取。保存失败时，先解决错误，再把最新编辑视为已保存或退出。

## 发布状态与支持限制

约定的本地设计验收范围已完成；公开发布是独立事项。macOS 安装包已用原生 Claude 与合成 provider 完成海报、信息图、长图的脚本化旅程。用户已在后续真实素材评审副本上通过海报与 12 图作品的六项视觉/编辑检查，并随后总体通过全部三个人工 Agent 旅程。此前报告的画布中间过程预览缺失已修复并在安装包内观察到。补充的真实图像 MCP 输出、选中替换、提交、导出与重开已有各自范围证据，失败的测试轮次单独保留。Apple M4、16 GiB 内存机器已记录 9 组受控画布操作样本；这不确立最大画布尺寸、通用性能预算、应用冷启动时间或物理输入延迟。首发支持平台为 macOS arm64——唯一完成安装态原生验收的平台；Windows/Linux 资源打包仅为构建与完整性证据，不代表原生执行通过，其实机验收另行决定。详见[实际证据](.agents/notes/implemented/testing/2026-09-11-complete-design-acceptance.md)和[验收说明](e2e/DESIGN-ACCEPTANCE.md)。

当前采用自动保存 YAML 画稿与公开先读提醒，不修改 Agent runtime，也不要求逐次模型生成的读取证明。Pi、Claude、Codex、Grok 的提醒已有各自原生证据；Kimi 公开插件也在正常安装包内以隔离 Kimi home 显式登记通过。在用户自己的目录启用该提醒需要其自愿登记插件；Molly 不静默安装，也不在登记前声称可用。Pi 已通过公开 extension 接通 Molly 图像与渲染工具，并有安装包内生成、编辑和原生读图证据。[安装态 Agent 矩阵](.agents/notes/implemented/testing/2026-09-11-installed-five-agent-matrix.md)分别记录各组合及限制；出现在设置中不代表完整设计流程已获支持。

真实图像生成与编辑已记录七份测试输出，原失败回执与成功调用及免费文件恢复分别保留。真实图像 TODO 已在记录范围内完成；评审作品、原编辑目标和三场景旅程均有明确人工通过结论。Grok 完整关闭式停止与显式会话恢复已通过安装态原始证据审查，测试脚本后续的辅助请求失败单独保留。Pi 图像请求取消已通过安装包内合成 provider 回归，但不代表付费供应商侧的取消行为已验证。图像生成需要自备受支持连接及明确模型，没有产品默认模型或自动付费重试。

本地临时签名包验证不代表公开发布、Developer ID 签名、公证或自动更新通道已就绪。
