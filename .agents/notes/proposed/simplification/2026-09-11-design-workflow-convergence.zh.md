# 设计工作流收敛与实施边界

Status: proposed
Translation: current

[English](2026-09-11-design-workflow-convergence.md)

## 摘要

整体方案复核发现：既有 Bento 编辑能力超出当前 PPTD 表达范围，重新生成的特殊候选规则缺少显式输入依据，候选审批与 Agent 自行处理文件冲突的目标也不一致。用户已确认以必要格式适配保留编辑能力，将修改和重新生成统一提交，冲突交给 Agent 的文件工具循环处理，外部文件预览后直接显式导入。内置图像 MCP 同时提供 generate/edit，模型由用户必填而非产品预设。运行中仅观看实时结果，提交后基于当前稿继续编辑；这些决定减少产品流程，但仍需验证转换、实际工具接入与最终提交保护。本次将已确认方向写回文档并拆分实施，运行时代码尚未修改，记录保持 proposed。

## 已确认决定

本记录补充[范围复核](2026-09-11-design-result-feedback.zh.md)，取代其中继续建设最小候选 UI 的目标；同时修订[同步](../../rejected/architecture/2026-09-10-design-sync-hooks.zh.md)、[预览](../../implemented/architecture/2026-09-11-pptd-live-preview.zh.md)和[串行编辑](../../implemented/architecture/2026-09-11-design-serial-editing.zh.md)的相关边界。产品合同以 [Spec](../../../../specs/graphic-design-platform.zh.md) 为准，交付拆分位于[主计划](../../implemented/architecture/2026-09-09-graphic-design-platform.zh.md#下一步实施切片2026-09-11)。本轮范围已确认，实施证据与发布验收仍未完成；不将整份 Spec 自动标为 approved。

| 决定 | 最终行为 | 代价与删减 |
| --- | --- | --- |
| Bento 与 PPTD 往返 | 先列完整差异，为首期已有编辑能力做最小格式和双向转换适配 | 不是只写 serializer；不靠丢字段、栅格化或让正常手工操作阻断下一轮来交付 |
| 重新生成 | 与普通修改使用同一结构/版本检查和自动提交流程 | 删除特殊提交模式，不解析提示词来决定是否候选 |
| 运行中交互 | 同一画布区域观看只读创作进展，完成后引用当前稿继续修改 | 不新增临时预览元素引用/编辑上下文；Bento 仍只接受通用只读状态 |
| 文件冲突 | 工具/hook 返回冲突，Agent 重读、比较、修改并重试 | 应用只做数据保护，不做语义合并、人工候选挑选或自动续跑 |
| 图像能力 | 内置 MCP 提供 generate 和 edit，共享已有连接与素材保存 | 必填用户 model，删除产品默认值；补 edit 接口，不新建图片作业、模型路由或 mask 编辑器 |
| 外部文件导入 | 预览后明确导入，校验所见快照并原子保存为当前稿 | 删除“创建候选 → 采用/拒绝”中间层，仍保护未保存修改及原稿 |

## 事实与设计修正

### 反向转换需要补齐现有表达差异

Bento 的[分组控件](../../../../packages/design-bento/vendor/packages/editor-bento/src/ui/dom/transform.ts)写入 `groupId`，而[冻结能力矩阵](../../../../packages/design-bento/vendor/packages/contracts/capability-matrix/v1.json)明确记录 PPTD v2 无 group 字段。[阴影控件](../../../../packages/design-bento/vendor/packages/editor-bento/src/ui/dom/style.ts)允许多层阴影，但 [PPTD validator](../../../../packages/design-authoring/src/validate.ts)及 importer (`06aa8ba:packages/design-authoring/src/import.ts`)只处理单个阴影对象。

因此 P3.1a 先交付现有可见编辑能力的字段/素材差异表，再连同格式版本、校验、import/export、能力矩阵和来源补丁一起适配。分组和多层阴影只是已查到的例子，不冒充完整差异清单。不为此引入新编辑功能；旧文档继续按已声明版本读取，未知版本拒绝，不能只改矩阵宣称支持。沿现有 vendor/patch/source-manifest 规则维护来源。

### 冲突使用 Agent 工具反馈，不能冒称复用统一合并服务

[Lody ACP 文件入口](../../../../apps/cli/src/agent/agent-client.ts)读取旧字节用于 diff 后执行 `fs.writeFile`，没有通用 CAS 或语义合并服务。[Kimi Edit](../../../../packages/acp-extension-kimi/packages/agent-core/src/tools/builtin/file/edit.ts)则在 `old_string` 不匹配时返回错误并要求重读。这证明可复用的是工具错误返回给 Agent、由其继续处理的范式；不证明所有 Write/Shell 路径已经有同等保护。

| 时机 | 处理合同 |
| --- | --- |
| Agent 运行中的读取/写入冲突 | 返回原因、最新投影及草稿位置；Agent 使用已有文件工具重读和处理，正常工具循环可以继续 |
| 重读后再次尝试 | 为该明确尝试关联新读取基线及确切内容；不改写冻结的原始输入，也不把已生成的旧写入参数自动放行 |
| 回合结束后的提交冲突 | 当前稿不变，工作文件及诊断持久保留；下一次用户显式继续时提供给 Agent，不重新激活已结束回合 |
| 意图存在歧义 | Agent 向用户澄清设计取舍；应用不自行选择视觉结果 |

现有 [session-execution-service](../../../../apps/cli/src/session/session-execution-service.ts)在 Agent prompt 返回后才采集设计；[turn-outcome](../../../../apps/cli/src/design/turn-outcome.ts)把版本冲突转成候选。因此新目标不是现状描述：P3.1/P3.3 必须补工具可见错误和草稿继续路径，再停止产生新候选。最终原子版本检查仍保留，运行中的 hook 不能代替它；不增加强制 finalize/提交工具步骤来假装全部最终冲突可在同轮解决。

内容不变也可能需要明确重提交。例如上一轮提交冲突后，Agent 重读确认草稿内容仍适用；不能为了绕过摘要去重而改无意义字节。P3 应区分无人重新提交的遗留文件与绑定新读取基线、确切内容的主动新尝试；后者仍校验并原子保存。具体以已规划 hook 的可验证操作事实或最小显式操作承载，在首个端到端切片确定；仅有重读、mtime/事件变化或相同字节重写不能自动洗掉旧基线。普通未变化旧文件继续 no_artifact，不恢复 #2b 自动提升。

### 候选产品退出，已有数据保持可达

重新生成不再特殊候选，冲突不再人工挑选，外部导入也不再先创建候选，因此 P3.0/P3.3/P3.4 不再建设最小候选面板、待处理列表或采用/拒绝流程。保留提交回执、旧 outcome 与必要的内容/素材读回；历史 `candidate` 状态记录当时事实，不重写为新规则。

退役前核对已有候选的内容和素材可通过受控文件路径供 Agent 读取，或经相同预览/显式导入路径处理。复用现有读回与存储，不要求批量转换历史数据，不删旧目录，不以保兼容为由继续创建候选。原稿、草稿及导入暂存快照具有各自必要生命周期，但不构成作品版本库。P1 的手工保存异常另存暂保留，不能用“Agent 会处理”覆盖未配置 Agent 时的手工保稿出口。

外部导入对用户已看到的文档及素材执行结构检查、保存前 flush、原子版本校验和现有幂等语义。内容已变化且不能继续使用原快照时重新呈现；用户的一次明确导入就是操作意图，不伪造 Agent 读取事实。失败保留原稿和未保存内容，沿普通文件诊断处理。

### 图像 MCP 补 edit，取消模型默认值

当前 [image-generation](../../../../apps/cli/src/mcp/image-generation.ts)只有文本生成请求，[image connection](../../../../packages/shared/src/image-connection.ts)仍定义产品默认模型；两者都需纠正，不能把这项工作写成仅连接选区。[来源清单](../../../../packages/design-authoring/source-manifest.json)与 [README](../../../../packages/design-authoring/README.md)供迁入追溯；上游 `skills/imagegen/scripts/image_gen.py` 已有原图与 mask 的编辑路径，接入时核对其实际接口，不照搬整套 Python 运行环境。

接入沿 [OpenAI Images API](https://developers.openai.com/api/docs/guides/image-generation)：generate 使用 generations；edit 使用 edits，携带提示词、原图/参考图和可选 mask。复用用户 URL、Key、必填 model、权限和工作区素材保存；不设置推荐型号、别名映射或模型静默降级。参数及 multipart/文件传输须按实际接口适配，不将现有 JSON-only transport 冒称已支持编辑。工具结果先成为文件，Agent 决定文档修改；用户自配服务不支持某能力时返回明确错误，应用不自动转文生图或重试付费调用。mask 表达局部编辑意图，不承诺未遮罩像素完全不变。

设置、配置归一化、MCP schema/说明、技能和物化、错误处理与对应验收一起更新。保留已有明确保存的模型值，不重写用户配置；空白新配置或空 model 不再补默认值。生成式编辑与附件/Agent 看图/Bento 手工裁切相互独立。

## 实施次序与验证限度

主计划沿用 Pn.x 编号并改变交付内容：P3.0 退役卡片/缩略图及旧文件提升；P3.1 补转换、路径、hooks；P3.2 分开图像 MCP 补齐与选区接线；P3.3/P3.4 改为冲突继续和旧数据可达；P3.7 完成实时预览及直接导入。P2-A3 继续独立复用附件链，不吸收到图片操作中。

首个 P3.1 切片核对设计准备/采集的 `getDefaultSessionWorkdir` 与 Lody 本地项目实际 cwd：投影、草稿、素材、MCP、预览和采集必须解析到同一作品入口。现有 canonical 按作品身份隔离；该路径核对不等于已证实跨作品覆盖，也不授权新建目录管理产品。

本次只读源码审查后修改设计文档；未运行产品测试、构建、真实 Agent、图像请求或文件监听。发布平台、五种 Agent 及格式往返仍按实际验证记录支持范围。文档检查不证明运行时已满足新合同，英文翻译 pending；不存在需要用户补充才能拆分的产品范围问题。

文档验证：`corepack pnpm run docs status` / `docs check` 无错误，21 条既有规则大小警告，无注册 SHA topic；`check:public-boundary`（4554 文件、24 manifests）及 `git diff --check` 通过。根 AGENTS.md 仍小于 8 KiB；P0–P2 历史实施记录与本轮开始时字节一致。未执行产品测试、类型检查或构建，因为本轮没有运行时代码变更；未提交。
