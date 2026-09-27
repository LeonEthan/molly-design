# Molly Design 改名：Geon 首发名替换与命名空间分层

Status: proposed
Translation: pending

## 摘要

产品首发名 Geon 在公开发布前替换为 Molly Design，内部机器标识统一采用短 token `molly`。改名复用 Folio→Geon 的分层 playbook（见 [Geon 改名](../../implemented/feature/2026-09-13-geon-rename.zh.md)）：产品命名空间整体替换，`@lody/*` 与 Lody 署名保持事实不变；磁盘格式标识 `geon-canvas/1` 与项目级 `.geon/` 目录作为稳定格式保留；用户级数据目录随产品名迁移。名称可用性已做初步核查：`molly-design` 在 npm（含 `@molly-design` scope）、`.com`/`.app` 域名均未注册；`github.com/molly-design` 组织名被空账号占用，但仓库托管于 `LeonEthan` 个人账号下，不受影响。正式商标清查与域名注册经决定暂缓：当前发布内容与仓库级命名无绑定，不构成执行前置，后续面向公众发布前再补办。"Molly" 在英文俚语中是 MDMA（摇头丸）的俗称，英语语境搜索联想会混入相关内容，复合词 Molly Design 可稀释该联想，属知情接受项。Logo 已定稿：手写一笔 M 带轻柔入锋、墨色落于圆角格线纸面、无强调色，资产已替换并同步文档描述。

## 背景与名称可用性调研

2026-09-15 调研（Web 搜索 + npm/GitHub API + RDAP 实测）：

| 位 | 状态 |
| --- | --- |
| npm `molly-design`、`@molly-design/*` | 未注册（本项目包全部 private，仅影响未来） |
| GitHub `molly-design` / `mollydesign` 组织 | 被无活动空账号占用；`LeonEthan/molly-design` 仓库路径不受影响 |
| `molly-design.com` / `molly-design.app` | RDAP 404 未注册；溢价/保留状态需注册商下单时确认 |
| `molly.design` | RDAP 404 未注册，大概率溢价，可选 |

在先使用冲突（知情接受，非阻断）：getmolly.ai（AI 个人助手，品类有区分度）、mollyim/molly（Signal 分叉，安全圈知名）、itpk 茉莉机器人（中文语境避免自称"茉莉"）。裸 "Molly" 已被否，复合名 "Molly Design" 显著性更强，商标共存概率更高；正式商标清查（USPTO 第 9/42 类、CNIPA "MOLLY"/"茉莉"）与域名注册按 2026-09-15 决定暂缓，不阻断本次改名，面向公众发布前补办。

## 提议的改名映射

机器标识短 token 一律为 `molly`，展示名为 "Molly Design"：

| 面 | 现状 | 目标 |
| --- | --- | --- |
| 产品展示名 / productName | Geon | Molly Design |
| Bundle ID | `dev.geon.app` | `dev.molly-design.app` |
| 深链 scheme | `geon://` | `molly-design://` |
| 用户数据根 | `~/.geon` | `~/.molly` |
| macOS 支持目录 | `~/Library/Application Support/Geon` | `~/Library/Application Support/Molly Design` |
| 环境变量 | `GEON_*`（25 个，~70 处） | `MOLLY_*` |
| 包名 | `@geon/design-authoring`、`@geon/design-bento`、根 `geon` | `@molly-design/*`、`molly-design` |
| MCP 工具 | `geon_generate_image` 等 4 个 | `molly_*` |
| Bento 桥接 | `geon.*` / `geon:ready` | `molly.*` / `molly:ready` |
| 品牌资源文件 | `packages/components/src/assets/geon-*`（17 个） | `molly-*`（素材重做另列） |
| GitHub 仓库 | `LeonEthan/Geon`（25 处引用 / 16 文件） | `LeonEthan/molly-design` |
| 内部探测参数 | `--geon-p0-verify=` 等 | `--molly-*` |

## 稳定面裁定（与先例一致）

2026-09-17 后续提案：[Molly 命名统一](../../implemented/feature/2026-09-17-molly-namespace-convergence.zh.md)拟将以下自有包、环境变量、格式和路径的永久保留决定调整为“新写新名、兼容旧读”，并讨论展示名缩短为 Molly。用户随后授权实施；后续记录已列出实现与保留的兼容边界。以下保留当时裁定，不作为当前命名规则。

- `geon-canvas/1` 磁盘格式标识（38 处 / 27 文件，存在于每个已存作品 `design.yaml`）**保留不改名**，与上次保留 `.folio/` 同一裁决：格式 ID 是持久契约，不随品牌漂移。
- 项目级 `.geon/attachments`、`.geon/npm-cache` 目录保留为既有磁盘格式。
- `@lody/*` 包名、`LODY_*` 变量、`lody-resource` 与 Lody 来源署名保持事实不变。
- 已实现笔记保留历史 Geon/Folio 表述，仅修复指向被改名文件的链接。

## 外部面与发布连续性

- **断代而非迁移**：Geon 未公开发布，无存量公网用户；Bundle ID 直接更换为 `dev.molly-design.app`，`app-updater-service.ts` 的 `CFBundleIdentifier` 断言同步更新，开发期安装的旧构建不做平滑升级承诺。
- **GitHub 改名后即时更新全部引用**：旧 URL 依赖重定向工作，一旦同名仓库被重建重定向即静默失效——Sparkle appcast、runtime artifacts 下载（`runtime-artifacts-v1` release tag）、菜单/分享卡链接均在此列。
- **更新源**：Sparkle `SUFeedURL` 与 `latest*.yml` 产物名 `Geon-*`→`MollyDesign-*`，首发 Molly Design 构建起用新 feed，旧 feed 不维护（无公网用户）。
- 迁移代码复用现成模板：`apps/electron/src/main/user-data-migration-core.ts` 与 `apps/cli/src/lib/cli-platform.ts`（Folio→Geon 迁移实现），本次仅服务开发数据。

## 文档处理裁定

- 已批准 Spec（`specs/graphic-design-platform.md` / `.zh.md`）：仅替换产品名与 `geon_*` 工具名，属保持含义的编辑性修改，批准继续有效，`git diff` 核验无其他文本变化。
- 独立首发 Spec 改名 `specs/molly-design-independent-release.zh.md`，保持 draft 与 Issue 引用。
- 根 `AGENTS.md`、README×2、`CONTEXT.md`、locales（en ~95 行 / zh_CN ~94 行）、`.agents/docs/` 与 proposed 笔记按映射替换。
- Logo 已定稿并落地：手写一笔 M 带轻柔入锋，墨色 #26281F 落于圆角格线纸面（沿用既有 icon 容器与浅格线），无强调色（用户裁定：无特别理由不出现红色）。方向自 Higgsfield 艺术划线形式出发，经三组方向（一笔 M / 划线字标 / 校样圈注）与三个单色变体对比后选定"手写起笔"变体；候选稿在 `output/molly-logo-candidates/`（不入产品源码）。已替换 `molly-mark.svg`、`molly-icon.png` 与 electron 全套 icon（png/mac/padded/win-transparent/icns/ico）；README×2 与 `intro-illustration-direction.md` 的描述同步更新。引导插画与音乐复用沿用先例裁决。

## 执行顺序（各切片可并行）

1. **身份单点**：`packages/shared/src/node/installation-profile.ts`（+`.cjs` 镜像与测试）——命名空间、数据目录、scheme、productName、Bundle ID 全部由此发出。
2. **构建与发布面**：`apps/electron/package.json`、`electron-builder.yml`（appId、协议、产物名、publish owner/repo、SUFeedURL）、`.github/workflows/release-electron.yml`、sparkle 脚本与策略测试。
3. **迁移代码**：用户数据目录迁移（复用模板），CLI 侧 `~/.geon`→`~/.molly`。
4. **机械批量**：环境变量、MCP 工具名、桥接事件、locales、组件字符串、README、AGENTS.md、Specs、e2e。
5. **GitHub 仓库改名**放在代码面合并之后、首个 Molly Design 构建发布之前，改名同 PR 更新全部 `LeonEthan/Geon` 引用。
6. **资产切片**：Logo 定稿（手写一笔 M，无强调色），替换 `molly-mark.svg`、`molly-icon.png` 与 electron 全套 icon，README 与插画方向文档同步。

## 依据与链接

- 改名先例与分层 playbook：[Geon 改名：首发定名与命名空间分层](../../implemented/feature/2026-09-13-geon-rename.zh.md)。
- 独立首发范围：[独立首发规格](../../../../specs/molly-design-independent-release.zh.md)（draft，随本提案改名）；Issue [#32](https://github.com/LeonEthan/molly-design/issues/32)。
- 设计行为合同：[设计平台规格](../../../../specs/graphic-design-platform.zh.md)（approved）。

## 验证和限制

- 本提案基于 2026-09-15 的仓库扫描（约 1032 处词边界匹配 / ~300 文件）与名称可用性实测；合并前须重扫确认无新增 `geon` 引用逃逸。
- 完成标准：`pnpm check`、`pnpm format`、`pnpm run docs check` 通过；两份已批准 Spec 的 `git diff` 仅含名称替换；链接检查覆盖被改名文件入站链接；迁移路径以注入时钟/确定性 fixture 的单测覆盖。
- 限制：商标清查与域名注册经决定暂缓（面向公众发布前补办），本提案不断言名称法律可用；"Molly" 的 MDMA 俚语联想为知情接受项；Logo 仅定方向（Higgsfield 艺术划线形式），视觉细化未完成；`packages/acp-extension-kimi` 子模块与 `output/` 生成物不在范围内。
