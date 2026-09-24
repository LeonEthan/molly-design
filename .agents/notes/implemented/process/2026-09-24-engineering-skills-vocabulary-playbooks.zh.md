# 面向 Agent 工作的命名工程原则与任务 Playbook

Status: implemented
Translation: current
PR: https://github.com/LeonEthan/molly-design/pull/3

[English](2026-09-24-engineering-skills-vocabulary-playbooks.md) | 中文

## 摘要

仓库规则约束着 Agent 行为，但规则没有名字，人类无法在任务中途引用一条短原则来精确纠偏；反复出现的任务类型也缺少标准动作序列。在评估 cursor/plugins 仓库中 MIT 许可的 pstack 技能包后，我们采纳了四份适配本仓库的 `.agents/agent-skills/` 文档：一份主要为现有约束命名的原则词汇表、三份任务 Playbook、一份验证标准，以及一份轻量决策日志。同一变更还加入了两条维护者提出的约定：一条命名的第一性原理设计规则，以及一条有边界界定的局部注释禁令。pstack 中偏向自主运行的元素被明确拒绝，因为本仓库规定规划与评审从不授权实施或发布。这些文档已随 PR #3 落地；其 steering 价值仍待真实任务实测。

## 问题

- 根部规则是没有名字的散文。维护者要在任务中途纠偏，只能引用或转述规则原文；缺少一套有明确定义的共享短词汇（如「用 subtract-first」）。
- 反复出现的任务形态——bug 修复、只读调查、发货 PR——每次都从零散规则中重新推导动作序列。「先复现再修」「failing 检查先于修复进入 git 历史」这类时序知识此前没有成文。
- 证据规则（「Report outcomes, evidence and limits」）只规定论断*要*带证据，没规定不同改动类型*如何*验证。
- 根 `AGENTS.md` 已占 8192 字节上限中的 7803，不做重构就没有空间指向新内容。

## 对 pstack 的评估

pstack 包含 23 条单规则命名原则、路由模式下的 23 个任务 playbook，以及若干支撑技能（MIT）。第一手通读的结论：

- 与现有规则直接等价的部分：laziness-protocol / subtract-before-you-add ≈「质疑需求、删除不必要机制」；test-behavior-not-implementation ≈ 本仓 mock/sleep 测试规则；prove-it-works ≈「Report outcomes, evidence and limits」。整套照搬会重复机制，违背 subtract-first 本身。
- 真正缺失且工具中立的部分：用于 steering 的命名原则词汇表；按任务类型的动作序列（复现先行、假设二分、复现提交先于修复提交）；attack-the-premise；blast-radius 的「证明安全所依赖的那一个事实」流程；按改动类型匹配验证方式的表格；追加式决策 TSV。
- 冲突或不可移植的部分：never-block-on-the-human 与过夜自主授权违背「规划/评审不授权运行时实施或发布」；反计划立场违背 Spec 治理；模型路由、sticky 模式、`/loop`、cloud agents 与 PR 监视脚本均为 Cursor 运行时专属。

## 决策

在 `.agents/agent-skills/` 下采纳四份叶子文档，沿用现有 issue-tracker/domain 模式（纯 Markdown、由根 `AGENTS.md` 链接、工具中立）：

- `engineering-principles.md`：词汇表。六条原则为现有规则命名（仅索引，不改规则）；七条采纳原则补充新指引——五条的机制落在其余叶子文档（falsifiable-done、repro-before-fix、attack-the-premise、prove-on-the-real-surface、name-the-safety-fact），另两条 `first-principles` 与 `names-over-comments` 见下段。
- `playbooks.md`：bug 修复、只读调查、发货 PR——动作序列全部基于本仓工具链（`pnpm check`、`docs check`、`gh`、Conventional Commits、note 规则、P0/P1 评审规则）。
- `verification.md`：改动类型到证明方式的对应表，外加带置信阶梯的 blast-radius 流程。
- `decision-log.md`：面向长任务或无人值守任务的追加式 TSV；明确从属于 Agent Notes，默认仅本地保存（不提交任何转录内容）。

同一变更还加入了两条维护者提出的约定。根 `AGENTS.md` 的设计原则规则增加了「From first principles:」前缀——现有的「质疑 → 删除 → 简化」顺序本就和 SpaceX Raptor 项目所普及的设计算法前三步一致，因此这次改动只是为方法命名并补上删除检验（「一轮没有删除任何东西的设计迭代不算完成」），而非新增机制；贡献规则一节则增加「No local comments: rename, extract, or retype; external constraints cite the issue/Spec」。词汇表将它们命名为 `first-principles` 与 `names-over-comments`。注释规则的边界：仅针对函数体内的局部注释——API 文档注释与工具指令（lint 抑制、`@ts-expect-error`）不在此列；外部约束（上游 bug、Spec 怪癖）用引用代替内联解释；规则适用于新增和被触碰的代码，清理历史注释属于单独的 scoped 任务。Raptor 3 范例只记录在本 note 而不进约束文本：文化引用会老化，理由归属于 note。

根「Agent skills」一节同步压缩（triage 标签清单与叶子文档中重复的约束被缩短），以容纳四个新指针；随后 verification 与 decision-log 两行指针合并为一行，为上述两条规则腾出字节：全部变更后为 8192 字节中的 8129。

## 已考虑的替代方案

- **原样导入 pstack 到 `.claude/skills/`**：拒绝。会重复现有规则、引入 Cursor 运行时依赖、与发布规则和图片预算冲突，且其个人化文风不是本仓的声音。
- **Claude Code 原生技能（`.claude/skills/`）**：暂不采用。`.agents/agent-skills/` 模式已确立、工具中立、受 `docs check` 覆盖；本次采纳的内容不需要模型调用前置元数据。
- **四份合并为一份**：拒绝。四类内容触发时机不同（steering 词汇 vs 任务开始 vs 宣告完成前 vs 长任务），分开才能让每次阅读按需且短。

## 取舍与限制

- 文档数量增加；已通过「原则表只链接约束原文、不复制」和「每条采纳机制只住在一份叶子」来控制维护成本。
- triage 标签名离开了根部一节；发现性现在依赖「triage: labels」指针，标签定义仍在 `triage-labels.md`。
- 变更后根 `AGENTS.md` 余量 63 字节；下一次新增需要自带压缩或迁移方案。
- steering 价值（人类引用名字、Agent 遵循 playbook）是预期，需在真实任务中使用后才能验证。
- pstack 评估基于 2026-09-24 的克隆版本，上游后续变化未跟踪。

## 验证

- 字节数实测：根 `AGENTS.md` 7803 → 8129（上限 8192），含两条新规则与指针合并。
- 纯文档变更；`pnpm run docs check` errors 为空、`pnpm check` 退出码 0，均于 2026-09-24 提交前运行。（更正：proposed 稿称未运行完整检查，实际提交前已运行。）
- 经 PR #3 实施，2026-09-24 合并（ff495327）。

## 来源

- pstack：<https://github.com/cursor/plugins/tree/main/pstack>（MIT），2026-09-24 本地稀疏克隆评估。
