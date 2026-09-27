# 格式准入知识正向查询（format.mjs）

Status: implemented
Translation: current

[English](2026-09-17-format-query-script.md)

## 摘要

`artwork-format.md` 是刻意不完整的格式指南（自承 "not a complete whitelist"），Agent 对 `molly-canvas/1` 准入规则的正向知识只能经"写入 → finalize 失败 → 读诊断"的负反馈循环逐条习得；一类"解析通过但导入/渲染静默丢失"的失败甚至不在该循环覆盖内。本记录在 `design-authoring` 包内新增 `describeAuthoringFormat()` 导出，从 validator 自身的封闭词表与显式排除规则派生格式描述，并以 skill 辅助脚本 `format.mjs` 暴露给 Agent。选择 skill 通道而非 Elyx 式独立 CLI 或 MCP：格式准入是静态知识，应与随任务物化的知识载体同行，其可用性不应依赖 daemon 连接；skill 物化与 intake 由同一构建产出，天然版本锁步。对抗分析已否决以 capability matrix 的 active 子集为数据源（`theme`/`seriesDefaults` 反例）。已实施并验证（127 项包测试含 15 项新增、全仓 check/format/docs check 通过）；"减少试错轮次"的收益仍未实测。

## 问题与证据

- 目标 Agent 材料只有一份 compact 指南：[`artwork-format.md`](../../../../packages/design-authoring/skills/graphic-design/references/artwork-format.md) 自称 "compact"，类型字段 "not a complete whitelist"（:1、:48），并要求"不得因 TypeScript 类型或 Bento 内部提及就写字段"（:111-112）。同时 [`graphic-canvas-profile.md`](../../../../packages/design-authoring/skills/graphic-design/references/graphic-canvas-profile.md) 说明现有投影文档可携带指南未列举的可编辑 Bento 字段（:91-96）。Agent 面对的"允许写什么"因此是一个三信息源（prose、frozen matrix、vendored schema）之间的模糊地带。
- 负反馈循环覆盖不到"静默丢失"类失败：指南自己定义"解析通过但 reset/placeholder/flatten 也是失败能力"（artwork-format.md:127-130），这类问题 validator 放行，发生在 import/render 层，Agent 无法在 finalize 输出里看到。
- push 模式失效的实证：Agent 可能只读到长格式指南的开头。纸面完整的静态文档不等于上下文里被读完。
- 数据可达性的事实更正（Codex 对抗分析，已复核）：物化 bundle `packages/design-authoring/skills/graphic-design/scripts/lib/molly-authoring.mjs`（esbuild 产物，由 `pnpm build` 重新生成，不入库）已导出 `AUTHORING_PROJECTION_CAPABILITIES` 与 `FROZEN_CAPABILITY_MATRIX`（:11855、:11859）。真问题是"无文档化、难发现、原始 matrix ≠ 创作语法"，不是不可达。
- matrix 不能当数据源（致命反例，已复核）：`common.theme` 与 `chart.seriesDefaults` 均为 matrix 的 active 行，却被当前 validator 显式拒绝（[`canvas-format.ts`](../../../../packages/design-authoring/src/canvas-format.ts) :223、:290）。`common.createDelete` 等动作能力行、`image.pipeline` 等 derived 行没有可写 YAML 语法。active 标签不能替代当前准入证据。

## 调研收敛

起点是 Elyx（elyx.design）的 `elyx man` / `diagnostics` / `inspect` CLI 三件套。经 Codex 对抗分析两轮收敛：

- "完整白名单在迁移中丢失"叙事被削弱：原始项目的文档亦非自包含（`shapeName` 白名单在另一个 `shapes.md`），本地导出脚本只做浅校验，文档与远端实际行为分离；其真实安全网是强制看图 QA，而 Molly 侧保留的是另一类强制（flush、只读、CAS 冲突拒覆盖）。"纠错轮次退化"无任何 A/B 数据支撑，撤回。
- 幸存结论只有一个：把 **validator 自己已完整持有的准入判决**（fail-closed 意味着边界显式写在代码里）以 Agent 可查询的形式公示。派生源就是规则本身，因此不存在第二份真相的漂移面。
- Elyx 的价值是触发"Agent 写前知道什么"这一审视，其 CLI 机制本身不必搬运。

## 通道决策：skill 脚本，而非独立 CLI 或 MCP

三种方案的知识来源相同（都从 validator 派生），分歧只在交付通道。决定性维度是**可用性语义与知识性质是否匹配**：

| 维度 | skill 脚本 | Elyx 式全局 CLI | MCP tool |
| --- | --- | --- | --- |
| 可用性 | 随 skill 物化即在，离线可用 | 依赖全局安装与 PATH | 依赖 daemon 连接、会话启用、per-turn 选中 |
| 版本锁步 | 与 intake 同一构建物化，天然锁步 | 独立安装 → 漂移风险 | daemon 提供，锁步 |
| 机制成本 | 复用现有物化/打包；1 导出 + 1 脚本 | 新发布物、版本策略、PATH 管理 | daemon 注册、shared MCP 目录契约、权限面 |
| 可发现性 | Agent 学格式时由 SKILL.md 路由告知 | 需 Agent 主动在 PATH 发现 | 工具列表可见，但背上前三行代价 |

格式准入是**静态知识**：不随会话、环境、时间变化。把它挂在动态能力通道（MCP）上，意味着 daemon 断开时 Agent 恰好失去最基本的格式知识——而它此刻仍能写 `design.yaml`，只是没了知识来源。知识应比能力更底层地可用。独立 CLI 服务的场景（无产品会话、直接在 repo 操作设计文件）在 Molly 不存在：创作必然发生在会话内，会话内已有 skill 物化。因此选 skill 脚本。

未来若出现**依赖会话状态**的查询需求（当前画布尺寸、本回合启用工具），那属于动态能力，MCP 是正确通道；本提案不预判该需求。`describeAuthoringFormat()` 导出通道无关，未来新通道可直接消费。

## 设计

### 包内派生导出

在 `canvas-format.ts` 新增并自 `index.ts` 导出：

```ts
describeAuthoringFormat(): ArtworkFormatDescription
```

派生数据源全部为 validator 现有常量，不新增任何手工维护的数据表：

- 根字段准入表：`['format', 'title', 'size', 'customFonts', 'background', 'elements', 'diagnostics']`（canvas-format.ts:231-235）；
- kind 词表：`BENTO_ELEMENT_KINDS_V4`（canvas-format.ts:208）；
- 每 kind 字段：`BENTO_DOC_V4_FIELDS.elements.common` + 各 kind 分表（canvas-format.ts:280-285），随现有 bundle 构建自动可达；
- 显式排除表及原因：`.pptd`/v2/v3、`theme`、`pages`、`notes`/`animations`/`pageType`、`elementId`/`elementType`/`content`、`chart.seriesDefaults`、远端 URL（canvas-format.ts:219-291、:297-302）；
- 遗留状态说明：`chart` 顶层 `fill` 仍在 v4 词表中、无 UI 写入器（canvas-format.ts:186-192 注释）；
- 值级约束只给指针不给复述（尺寸正整数对、bounds 几何、media 路径形态、字体注册与字节嗅探、kernel replay），规则细节仍以 validator 判决为准，派生物不复制数值语义。

对抗分析要求的五类区分在 `molly-canvas/1` 下自然塌缩为三类：可准入字段（可写且往返保留，无"仅保留"子集）、显式排除项（附 validator 原文原因）、值级约束指针。不建立不存在的分类。

### skill 脚本

`skills/graphic-design/scripts/format.mjs`，只 import `node:*` 与打包后的 `./lib/molly-authoring.mjs`（符合包自包含规则）：

```text
node scripts/format.mjs                  # 概览：根字段、kind 列表、排除摘要
node scripts/format.mjs kind <kind>      # 该 kind 准入字段 + 该层排除项
node scripts/format.mjs excluded         # 全部显式排除及原因（含 PPTD 遗留拒收）
```

可选辅助、不成门：与 `finalize.mjs` 同级，不提交、不评审、不阻断回合，符合 agent-naive 边界。

### 可发现性

SKILL.md"Route the task"段加一行：写字段前先按需 `format.mjs` 查询准入表；`artwork-format.md` 顶部把"not a complete whitelist"指到该脚本。这直接补上对抗分析指出的"可达但难发现"缺口。

## 明确排除

| 候选 | 排除理由（对抗分析后） |
| --- | --- |
| 以 matrix active 子集为查询源 | `theme`/`seriesDefaults` 反例：active ≠ 可写；动作/derived 行无可写语法；多行 contract 仍是草案 |
| `inspect`（文档结构查询） | 单画布 YAML 几 KB，Agent 直接 Read 更便宜 |
| `diagnostics`（YAML↔BentoDoc 同步查询） | 同步状态是 daemon 职责；暴露给 Agent 违背 agent-naive |
| 独立 `molly-design` CLI | 无会话外用户；新发布物与漂移风险；机制成本不抵收益 |
| 格式查询 MCP tool | 静态知识不该依赖动态能力通道的可用性；机制成本 |
| 恢复长格式完整规范 | 会把 vendored 上游字段冻结成公共承诺，日后无法收缩 |
| 把看图审查改回强制 | 哲学决定（advisory）非降级；原项目的"强制"实质也是提示词纪律 |

## 验证记录

1. 新增 `tests/format-description.test.ts`（10 项）：派生输出与准入表逐项相等（root 字段、7 个 kind 的 common+分表字段）；行为防线对 `ARTWORK_EXCLUSIONS` 每条注入夹具断言 validator 真实拒收（v2 版本标记、theme、pages、notes/animations/pageType、elementId/elementType/content、chart.seriesDefaults、远端 URL）。
2. 扩展 `tests/skill-scripts.test.ts`（新增 5 项）：`format.mjs` 概览/`kind chart`（不得把 seriesDefaults 列为可准入）/未知 kind 退出 1/`excluded` 含 theme/未知子命令退出 2。
3. `packages/design-authoring` 127 项测试全部通过（含 bundle 重建）；`pnpm check`、`pnpm format`、`pnpm run docs check` 通过。`apps/cli` 两项 `acp-authentication` 失败复验为 shell 继承 `ANTHROPIC_*`/`CLAUDE_CODE_*` 环境变量的既有问题（隔离环境后 31 项全过，与本次改动无关，历史记录见单画布重设计笔记）。
4. 未跑黄金复刻：改动不触碰 intake/渲染语义。

## 限制

- "减少试错轮次"是机制推断，无 A/B 实测。
- 收益上限受 Agent 是否真调用脚本限制；SKILL.md 路由只是提示，不成门。
- 值级约束（几何、媒体、字体）不在派生范围内，schema 无知只能部分缓解。
- 若未来格式出现会话相关的可变准入（特性开关），本设计的静态前提失效，需重新选通道。
