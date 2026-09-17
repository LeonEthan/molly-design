# 设计技能改为自主创作参考

Status: implemented
Translation: pending

## 摘要

原先物化的 graphic-design 技能虽称 finalize 不是门槛，正文和引用仍强制 inspect→draft→review、单次参考分析、指定测量方式及两轮验证，imagegen 也规定固定调用顺序。这次按 T11 删除这些创作步骤，把脚本、构图与提示模板保留为可选知识，保留实际渲染后读图并自主修改的说明。格式、素材和版本校验继续由现有 intake 与提交机制负责，不新增创作 hook。图像编辑与必填模型属于 T09，本次仍准确描述现有文本生成能力；自动测试验证材料交付和结构行为，不证明真实 Agent 的视觉质量。

## 决定与边界

本记录落实 [T11](https://github.com/LeonEthan/Folio/issues/13) 和
[范围审查](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md)，
承接 [工作流收敛](../../proposed/simplification/2026-09-11-design-workflow-convergence.zh.md)，
替代迁入材料中的固定步骤，不改写历史来源或总 Spec 的 draft 状态。

- 主技能、重建和构图参考取消 inspect-once、像素分析禁令、固定方案数量、强制 finalize 和评审顺序。保留素材提取、构图、可读性和编辑能力说明；参考脚本的 PNG 编码限制只属于该脚本。
- finalize 保持现有可选验证/改名实现。直接写 design.pptd 后可被既有 intake 处理；没有新增完成标记、语义评分或自动修复。
- 渲染工具说明要求查看真实返回图片，同时把方法和修改次数交给 Agent。工具缺席只说明该工具不可用，不声称 Agent 无视觉能力。可选 render-preview 脚本明确自己只检查结构。
- 派发仍复用 message-handler 的设计技能指针；只改 skills.ts 生成的说明，不加入创作流程。应用回合结束/提交路径没有读取 finalize 执行记录或 review 次数的判断。
- imagegen 删除固定七步及必选分类，把现有误称 edit 的 frontmatter 更正为 generate。保留当前 gpt-image-2 默认事实及上游提示知识，同时明确编辑/多图参考不是当前工具接口。T09 另交付 generate/edit 与用户必填模型。
- PPTD 指南区分现有 v2 示例和 T03 已交付的 v3 投影；不另造格式转换器。v3 字段与往返证据见 [T03 记录](../architecture/2026-09-11-pptd-editable-roundtrip.zh.md)。

保留上游方法作为参考比删除全部知识更有用；只在主 SKILL 加“可选”而保留引用中的命令式步骤会继续交付互相冲突的指令，因此此次同步清理引用。general-poster 从 verbatim 改为 adapted，保留原 upstreamPath/upstreamSha256；其余修改材料原已标为 rewritten/adapted，来源哈希保持历史含义。

## 验证与限制

- `apps/cli/src/design/skills.test.ts`：12 项通过。新增测试执行真实 authoring build（含来源验证与 esbuild 库）和 CLI copy-design-skills，按正式相邻目录解析 bundled source，再向 `.claude/skills` 与 `.agents/skills` 物化 graphic-design/imagegen。逐文件比对实际字节和 SHA manifest，检查指令内容与 v2/v3 格式说明，保留人改 SKILL 并报告 drift。既有测试继续覆盖 managed-clean 升级、不受管文件及 symlink 拒绝。
- 该测试从物化目录复制最小项目并直接写 `design.pptd`，没有 `.tmp` 或 finalize 调用；运行物化的 `render-preview.mjs` 返回 intake OK，并明确输出不是渲染或视觉评审。`turn-outcome.test.ts` 34 项通过，覆盖直接文件采集提交、无效文件、基线冲突及回执恢复；未改变结构/版本门槛。
- `design-render-tool.test.ts` 12 项、`design-image-tool.test.ts` 13 项通过；新增断言读取实际 MCP `tools/list` 的描述，核对真实看图、自主方法、工具级缺席与付费不自动重试说明。
- `message-handler-design-skill-prompt.test.ts` 5 项、`message-handler-design-turn-input.test.ts` 7 项通过，检查实际派发得到的新指针、两套技能物化和既有输入完整性路径。仅同步三处旧指针期望，未改派发实现。
- 独立 `corepack pnpm install` 成功，Node 22+、pnpm 10.20.0；为此初始化公开 ACP submodules，Kimi 仅用于文档链接、仍在根 workspace 外。设置 `LODY_SKIP_ELECTRON_POSTINSTALL=1` 跳过 Sparkle 下载，未据此宣称 Electron 包装成功。

全仓 `corepack pnpm check` 通过：typecheck、lint、test:ci、i18n、Code Collab/platform/public boundary 均完成。检查子进程仅过滤继承的 `ANTHROPIC_*` / `CLAUDE_CODE_USE_*` 环境键，未打印凭据或修改全局环境。CLI 2809 项通过、4 项既有跳过；components 3345 项通过；authoring 91 项通过；Electron 113 项通过。loro-streams-rpc 另有 3 项既有集成测试跳过。`corepack pnpm format`、`corepack pnpm run docs check`、`git diff --check` 已通过；撤回全仓格式化带来的既有无关 Sparkle test 变化。docs 无 errors、无 SHA topic，有 21 条既有规则大小警告。

材料的“打包”证据到真实 authoring bundle 和 CLI resource staging，再到工作目录物化；未生成新 Electron 安装包。没有付费图像请求、真实 Agent 创作或安装包视觉验收；这些不是材料测试的证据范围。T09 后续须随接口更新 imagegen 说明及其当前 generation-only 断言；T27 汇总安装包资源验证。
