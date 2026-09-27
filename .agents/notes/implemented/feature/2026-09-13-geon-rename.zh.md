# Geon 改名：首发定名与命名空间分层

Status: implemented
Translation: pending

## 摘要

产品在 Lody 之上形成的独立身份经历了 Folio 阶段，但 Folio 从未公开发布；首发定名已批准为 Geon，Geon 即首个发布名称。改名按命名空间分层裁定：产品名 Folio→Geon，`@folio/`→`@geon/`，`FOLIO_*`→`GEON_*`，`dev.folio.app`→`dev.geon.app`，`folio://`→`geon://`；`@lody/*` 包名、`LODY_*` 变量与上游署名保持事实不变。项目级 `.folio/` 存储目录作为磁盘格式保留；用户级数据按 `~/.folio`→`~/.geon` 等路径迁移。已批准的设计平台 Spec 只做保持含义的产品名编辑替换，批准继续有效；已实现笔记保留历史 Folio 表述，仅修复指向被改名文件的链接。Logo 按 G 方向重做，引导插画与音乐复用。

## 决定

### 定名与分层

- 产品 lineage：Lody（上游来源）→ Folio（未公开发布的中间独立身份）→ Geon（首发名称）。不存在已发布的 Folio 用户需要对外迁移公告；迁移只服务既有开发数据。
- 命名空间分层：`@lody/*`、`LODY_*`、`lody-resource` 及 Lody 来源/署名陈述保持事实不变；`@folio/`→`@geon/`；产品可见名称、`LeonEthan/Folio` 仓库引用与 "Folio Desktop" 一律改为 Geon。
- 身份常量同步修改：`dev.folio.app`→`dev.geon.app`、`folio://`→`geon://`、安装身份与桌面显示名。

### 稳定面裁定

- 项目级 `.folio/` 存储目录（如 `.folio/artworks`、`.folio/attachments`）是既有磁盘格式，保留不改名。
- MCP 工具改名：`folio_render_preview`→`geon_render_preview`；图像工具 `folio_generate_image`/`folio_edit_image` 及 `folio_resubmit_draft` 同属 `folio_*` 标识符，一并按映射改为 `geon_*`。
- 环境变量 `FOLIO_*`→`GEON_*`（如 `GEON_RUNTIME_BASE_URL`、`GEON_DESIGN_LAUNCH_ID`、`GEON_PROBE_*`）；`LODY_*` 兼容别名不变。
- Bento 桥接通用 API 随产品改名：`folio.setReadonly/flush/state/selection`、`folio:ready`→`geon.*`、`geon:ready`。

### 数据迁移计划

- 用户级数据根 `~/.folio`→`~/.geon`；macOS `Application Support/Folio`→`Application Support/Geon`；新建工作区显示名 Lody→Geon（既有工作区保留已存名称，与 T26 的既有分支语义一致）。
- 不扫描、不迁移 Lody 数据；项目内 `.folio/` 内容原地保留。

### 文档处理裁定

- 设计平台 Spec（`specs/graphic-design-platform.md` / `.zh.md`，Status: approved）：仅替换产品名及 `folio_*` 工具名为 Geon/`geon_*`，属保持含义的编辑性修改，按 Spec 规则批准继续有效，Status 与 Approved 记录不变。
- 独立首发 Spec 改名（现 `specs/molly-design-independent-release.zh.md`），保持 draft 与 Issue #32 引用。
- 已实现（implemented）笔记保留历史 Folio 表述；仅修复指向本次被改名文件的链接目标，不改写历史理由。证据路径（`/tmp/folio-*`、探针轮次目录名）按事实保留。
- Logo 按 G 方向重新制作；四幕引导插画与开场音乐复用。README 保留当前标记的视觉描述文本，仅替换名称，G 标志选定后再修订。

## 依据与链接

- 独立品牌范围与首发条件：[独立首发规格](../../../../specs/molly-design-independent-release.zh.md)（draft）、[独立发布提案](../../proposed/feature/2026-09-13-geon-independent-brand-release.zh.md)；Issue [#32](https://github.com/LeonEthan/Geon/issues/32)。
- 设计行为合同：[设计平台规格](../../../../specs/graphic-design-platform.zh.md)（approved）。
- T26 身份与公开帮助基线：[Folio public identity and help](2026-09-11-folio-public-help.md)（历史记录，保留原名）。

## 验证和限制

- 本轮完成文档面改名：全仓 `*.md`、`AGENTS.md`、README、CONTEXT、Specs、`.agents/docs/` 与 proposed 笔记按上述映射替换；`git diff` 核验两份已批准 Spec 除名称替换外无任何文本变化。
- `corepack pnpm run docs check` 通过情况见交付报告；链接检查覆盖被改名文件的全部入站链接。
- 限制：代码与资源面的改名由各实施切片并行进行，本记录不断言任一运行时标识已完成替换；`output/`、`e2e/` 文档、`site-docs/` 上游材料与 `packages/acp-extension-kimi` 子模块不在本轮范围。音乐曲名 `Folio — Form & Rhythm` 与 `folio-*` 资源文件名在文档中按映射写作 Geon/`geon-*`，实际素材文件改名由资产切片执行。
