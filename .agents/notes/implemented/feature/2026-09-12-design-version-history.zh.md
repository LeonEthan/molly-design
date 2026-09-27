# 当前稿自动保存与人工存为版本

Status: implemented
Translation: current

[English](2026-09-12-design-version-history.md)

## 摘要

用户已确认采用 Git 作为唯一设计历史存储，取消自建文件快照后端；当前稿自动保存与历史版本分开。“存为版本”记录人工确认的节点，画布右上角选择历史版本只读查看，“从此编辑”将其恢复为新的当前稿。Geon 继续复用当前稿校验、保存及草稿保护，不将 Git 引入 Agent 创作步骤，也不复用自动 commit/push 编排。已确认由 Geon 管理独立本地 Git 仓库，方案已纳入 Spec 和计划。（事实更正：Git 裸仓历史与画布版本 UI 随后已实现，证据与剩余限制见文末；原文“运行时尚未实施，记录保持 proposed”为 2026-09-12 裁定阶段状态。）

## 范围与依据

2026-09-12 用户确认 Git 历史方案并授权更新文档，取代 [Spec](../../../../specs/graphic-design-platform.zh.md) 和[迁移计划](../architecture/2026-09-09-graphic-design-platform.zh.md)原先不提供历史版本的范围。本记录不恢复候选审批、分支合并、素材库、逐轮结果卡或历史缩略图；用户随后确认由 Geon 管理独立本地 Git 仓库，与用户项目 Git 隔离。

本方案与[人工编辑自动更新 PPTD](../simplification/2026-09-12-editor-owned-pptd-save.zh.md)衔接，后续已确认自动回写并保留公开的先读文件提醒 hook。自动保存维护工作状态；人工存为版本提供可返回的明确节点；编辑器撤销/重做继续沿用 Bento，不用版本列表代替每次操作的撤销。Git 历史不可编辑，不与当前稿争夺权威身份。

## 本地代码核对

| 现有实现 | 证据和复用边界 |
| --- | --- |
| Bento 当前稿自动保存 | [product-session.ts](../../../../packages/design-bento/src/product-session.ts) 已有 changed → schedule → flush → saveOne，返回“已自动保存”。无需为了版本功能再建自动保存机制 |
| 当前稿与资产保存 | [store.ts](../../../../apps/cli/src/design/store.ts) 的 design.json 内嵌资产，revisionId 是内容摘要，designOperation 在作品锁内检查基线并发布当前文件；摘要本身没有保存旧文件，不能据此声称已有历史版本 |
| 当前稿实际位置 | 当前实现位于 dataRoot/chats/<artworkId>/design.json，Agent 工作文件由 [workspace.ts](../../../../apps/cli/src/design/workspace.ts) 解析到会话目录或项目 .folio/artworks 下。提交用户 Git 项目不能保证包含 canonical 画稿 |
| 另存作品入口 | [design-canvas.tsx](../../../../packages/components/src/components/sessions/design-canvas.tsx) 的 Save as new design 调用 create 创建作品；它与同一作品内创建版本不同，不能只改文案而沿用创建作品的行为 |
| Lody 项目分支切换 | [local-project.ts](../../../../packages/shared/src/node/local-project.ts) 的 checkoutLocalProjectBranchAtRootPath 要求工作树干净，并切换项目分支；不是只恢复一幅画稿 |
| Lody worktree 与自动提交 | [worktree 规则](../../../../apps/cli/src/session/worktree/AGENTS.md) 保护原项目目录；[turn-post-processing-service.ts](../../../../apps/cli/src/session/turn-post-processing-service.ts) 的自动提交路径在特定 GitHub/PR 条件下再次提示 Agent commit/push，不适合作为本地“存为版本”的实现 |
| 来源项目快照经验 | 相邻 agentic-listing-design 的 packages/authoring/src/revisions.ts 已有 writeSnapshot、listRevisions、loadRevision、commit、rollback，保存文档、素材及来源信息。其完整实现还带事件日志、trace、候选分叉等合同，只借用本次需要的快照/校验经验，不整体移入 |

## 建议交互

画布右上角显示“当前稿 ▾”和“存为版本”，自动保存状态继续使用现有状态提示。

1. 人工编辑或 Agent 成功提交更新当前稿，自动保存本身不创建一条用户版本。点击“存为版本”时排空已完成编辑的保存，捕获同一版本的文档及素材，成功后显示 V1、V2 等编号和创建时间。首期不强制填写名称。
2. 下拉列表列出“当前稿”及已存版本；选择历史版本在现有画布中只读呈现，提供“从此编辑”。仅查看不改变当前文件，也不创建快照；返回“当前稿”即可继续原工作。
3. 点击“从此编辑”时，先确保当前工作已落盘；若当前稿尚无对应的保存版本，自动保留一条标记为“切换前”的版本。保护失败则不替换当前稿。随后将所选历史内容作为新的当前稿，更新 PPTD，并重新绑定当前画布状态。
4. 原 V1/V2/V3 均不改变；从 V1 修改后人工存为版本得到 V4，可记录“基于 V1”的来源。首期用平面时间列表，不引入分支树、合并或 worktree。
5. 执行及产物处理期间可只读查看历史，但不能恢复或存为版本；预览与当前稿视图保持不同身份，不能把历史选区作为当前稿引用发送。恢复需复用现有作品锁和人工变更检查，防止另一窗口同时启动 Agent。
6. 恢复仅影响这幅作品及其当前稿 PPTD；会话记录和其他项目文件不回滚。旧 Agent 草稿及旧提交回执仍保留，恢复不自动赋予它们新的提交基线或使其成为新产物。

“切换前”保护版本是避免自动保存工作丢失的明确例外；不扩为每次编辑或每回合都自动存历史。只读查看历史与独立候选审批没有关系，也不要求预生成缩略图。

## 存储方案比较与裁定

| 方案 | 可复用与优点 | 额外成本 | 建议 |
| --- | --- | --- | --- |
| 现有作品存储旁保存不可变快照 | 可复用完整载荷、校验和保存 | 需要另建历史文件及索引维护 | 已取消，不实施 |
| Geon 管理独立的本地 Git 仓库 | Git 保存完整历史，与用户分支隔离 | 仓库初始化、引用管理及打包依赖，另需薄 UI/恢复适配 | 已确认采用 |
| 复用用户项目 Git | 利用已有 Git 项目和对象存储 | 非 Git 项目支持、暂存区/分支隔离、canonical 纳入范围及版本引用均需明确 | 与独立仓库比较后只选一种组织方式 |

Git 的 [对象模型](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects)可表达快照；[git show](https://git-scm.com/docs/git-show)可读取历史内容，不必切换整个工作区。[worktree](https://git-scm.com/docs/git-worktree)管理多工作树，不是恢复单幅作品所需的基本操作。实施时读取指定历史内容后走 Geon 的受控恢复入口，不通过项目级 reset/checkout 来替换作品，也不调用既有自动 commit/push 模型流程。

Git 版本可复用当前自包含载荷保存 BentoDoc、确切素材/字体和格式版本；版本编号、创建时间与来源从 Git 提交/引用及必要元数据生成。历史 PPTD 可从该载荷派生，不建立第二套可提交的历史。图片不能只引用可能被替换或删除的当前 media 路径。存版本与恢复分别校验实际版本；可见版本必须完整，失败不丢工作稿，恢复加载失败不能冒称磁盘未保存。

图片与字体必须进入同一 Git 历史后端，布局选择须根据真实样稿和版本数量评估，不宣称无限历史或 Git 对图片一定有高压缩率。不再为历史增加自建素材备份库、垃圾回收或 Git-LFS 系统；当前稿资产存储仍保留其职责。

## 选用 Git 时的替代边界

Git 已选定为唯一历史后端，与“当前作品存储旁保存快照”互斥。文件历史尚未实施，因此这里是取消建设该后端，而非删除当前稿存储已有代码。

| 能力 | 选用 Git 后 |
| --- | --- |
| 自建不可变历史文件目录、历史快照发布和读取 | 不建设，由 Git 对象与提交保存完整历史内容 |
| 独立的权威版本列表/版本索引库 | 不建设；从受管理的 Git 提交/引用及必要元数据生成版本列表，缓存必须可重建 |
| 历史素材的另一套备份/对象库 | 不建设；确切素材字节随设计内容进入对应 Git 版本，不能只保存当前媒体路径 |
| 当前稿自动保存与 PPTD 更新 | 保留。它们提供未提交的工作状态，Git 历史不会替用户自动保存 |
| 当前稿结构校验、并发版本检查和完整发布 | 保留。Git 提交只保证存入的对象可寻址，不能证明捕获了同一编辑版本的所有文件 |
| 版本选择、只读历史查看、受控恢复和草稿保留 | 保留为薄产品适配；历史内容从 Git 读取，不复制另一套长期快照 |

由 Geon 管理独立本地 Git 仓库，支持普通非 Git 项目；用户项目分支、暂存区及无关内容不受影响。人工“存为版本”把经校验的一致内容写成一个 Git 版本，版本身份采用其提交 ID，显示编号/时间由列表生成；创建后必须由稳定引用保留，不能仅存不可达对象。恢复前的“切换前”保护也使用同一 Git 后端，不另留平行备份体系。

日常编辑只更新当前稿；存版本才产生历史提交。历史查看通过读取 Git 对象渲染，从旧版编辑则把该版本内容经既有校验恢复为新的当前稿，后续存版本继续追加提交；不移动历史引用去丢弃后续版本。当前稿 CAS 标识与 Git 历史提交 ID 职责不同，不能机械互换。临时一致性快照/发布暂存目录仍可能需要，但它们不是第二个持久历史库。

前面的成本比较应据此理解：Git 的接入成本同时替代自建历史对象、索引及保留机制，不在文件快照后端之上叠加 Git。只实现一个历史后端，不设计双后端抽象或双写。

## 原则与验证限制

该功能是用户主动保存与恢复文档状态，不规定 Agent 创作流程，也不依赖新增 runtime hooks。按钮命名推荐“存为版本”；“版本”适合下拉入口，“存档”可能与会话归档混淆，“另存”容易与创建新作品混淆。

设计裁定阶段将已确认的 Git 历史决定写入正式 Spec、迁移计划及根规则；Spec 保持 draft，本记录保持 proposed，仓库组织已确认，运行时实现及验收尚未完成。该裁定阶段未修改运行时代码、创建 Git 历史仓库、发布 Issue、运行产品测试或性能测量；后续实施见下节。现有自动保存的源码证据不等于自动更新 PPTD 的上一项新建议已经实现。

## 实施进展（2026-09-12，未完成）

已开始独立的 Git 历史后端与既有 worker/IPC 接入：每幅作品使用当前稿目录下的
`history.git`，以 Git 对象和受管理引用保存完整文档/素材；不使用用户项目暂存区、
分支、全局 Git 配置、远程或 hooks。普通保存不创建历史。只读查看验证版本属于
该历史；恢复先在相同 Git 历史保护未存版本的当前内容，再通过原当前稿 CAS 保存。
并发版本变化、历史缺失/被重定向时拒绝，保留当前稿；显示与磁盘保存失败分别处理。

五项真实本地 Git 的确定性测试验证旧版查看不改当前稿、恢复前保护、后续版本追加、
陈旧恢复拒绝、作品隔离、目录重定向拒绝、PNG/WOFF2 原始字节留存、重复恢复、保护性 Git 发布失败时保留当前稿，以及恢复后 PPTD 的实际往返。
重复恢复比较确切内容，不把内容摘要当作包含作品关联信息的当前稿 revisionId。
测试与两项 Agent 提醒/MCP 接线的组合检查共 16 项通过，Electron 主进程和界面类型
检查通过；记录在 `/tmp/folio-history-integration-tests.log` 与
`/tmp/folio-history-electron-typecheck-4.log`。早期重复恢复测试失败保留在
`/tmp/folio-history-tests-2.log`，修复后通过。

版本选择与“存为版本 / 从此编辑”已接入既有 IPC 与只读 renderer。历史无文件监听，
不能走外部预览导入，也不能提供当前稿选区；当前编辑器隐藏保留撤销状态，明确恢复
才加载新当前稿。执行时按钮沿用 presence 显示，真正变更仍由现有 daemon 作品门禁
拒绝 active/unknown 状态。Git 使用 Lody 现有系统可执行文件，缺失时如实报错，
不回退第二套存储。

真实 built OSS Electron 界面轮 `/tmp/folio-history-ui-nDwlNI/result.json` 已验证：
通过按钮存 V1/V2，历史版本可见且显示原始元素，当前编辑器隐藏保留、返回后撤销/重做
仍可用，显式恢复先创建“切换前”版本，再修改存为 V4，应用重启后重新打开作品仍有
四条历史。独立画布截图 `history-canvas.png` 与界面截图一同留在该轮目录；harness
完成所属进程和端点清理，执行 handle 80370 exit 0。两次早期 probe 失败分别为同名
按钮定位不唯一及重启后未导航到作品；保留 `/tmp/folio-history-ui-probe.log`、
`/tmp/folio-history-ui-probe-2.log`，修正 probe 后第三轮通过，不掩盖失败。

该界面构建包含 Codex/Pi MCP 与本功能，尚未包含后续自动回写变更；不能据此声称新
保存合同的原生组合轮已完成。随后自动回写与 Git 历史在源码组合后，69 项专项检查
通过；补上恢复后 PPTD 与保护性 Git 发布失败测试后完整检查通过，记录
`/tmp/folio-editor-save-history-fullcheck.log`。测试证明恢复操作确实更新相同版本 PPTD，
不能代替组合后的安装包验证。多实例实际交互、正常安装包、完整视觉与图像生成验收
仍待完成；不得宣称 P4.6/P6.6 完成，本记录保持 proposed。

后续确切组合 `c683038` 重新构建通过，并完成 `/tmp/folio-history-ui-3hA6WO/result.json`
（handle 2549 exit 0）：每次人工编辑保存后，直接读取磁盘当前稿、PPTD marker 和页面
核对版本/元素，没有先调用可能修复投影的 read IPC；历史原生编辑按钮无法改变内容，
恢复后当前 PPTD 同版本，V1/V2/切换前/V4 与重启回读全部通过。所属 Electron/CLI 与
端点由 harness 正常清理；未调用模型。这补齐 built OSS 的自动回写组合证据，仍不
替代正常安装包、真实图像供应商及人工完整旅程验收。

正常 macOS arm64 安装包 `50ddd41bfb3e88537c0dcbec40c0ce86ca40b8e4` 随后通过同一轮
版本界面、只读历史、保留当前稿/撤销栈、保护版本、恢复后 PPTD、继续编辑和退出重开验证。
DMG 校验、只读挂载复制、签名校验均通过；私有安装目录为
`folio-current-50ddd41b-78c0b9vz`，包身份记录为该目录的 `package-identity.json`。
安装包轮 `/tmp/folio-history-ui-S9u0fO/result.json`（handle 73932 exit 0）的 boot-state
确认 `isPackaged: true`，installed-source 记录上述确切提交，关闭后 endpoint-release、
directory-cleanup 和 finished 均完成。本轮没有模型调用；补齐正常安装包版本操作证据，
多实例与真实多图负载、人工视觉/编辑评定仍分别待完成。

## 证据与剩余限制

**事实更正**：本文早期章节称“运行时尚未实施，记录保持 proposed”，该状态已更正为
`Status: implemented`。实现证据包括：

- Git 历史后端：`apps/cli/src/design/history.ts` 以每幅作品 `history.git` 独立裸仓保存
  完整 `design.json` 及内嵌素材；`history.test.ts` 覆盖版本追加、恢复前保护、素材字节
  留存、冲突拒绝、重定向拒绝与 PPTD 往返。
- IPC/UI：`apps/electron/src/main/ipc/services/design-ipc.ts` 暴露 `versions` /
  `saveVersion` / `restoreVersion` / `viewVersion`；
  `packages/components/src/components/sessions/design-canvas.tsx` 在画布右上角提供
  “存为版本”“从此编辑”与只读历史下拉。
- 版本 UI 与自动 PPTD 保存的组合已在 built OSS 及正常安装包验证通过。

剩余限制：跨实例并发竞争（如 A 实例存版本、B 实例同时恢复）的完整验证仍未执行，
见 `specs/graphic-design-platform.zh.md` 待实施验证项；多实例实际交互、真实多图负载、
人工视觉/编辑评定与普通目录/Windows/Linux 运行依赖供给仍待后续验收。
