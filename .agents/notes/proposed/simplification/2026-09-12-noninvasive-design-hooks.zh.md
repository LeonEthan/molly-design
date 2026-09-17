# 自动保存后的非侵入读取提醒 hook

Status: proposed
Translation: current

[English](2026-09-12-noninvasive-design-hooks.md)

## 摘要

用户确认人工编辑自动回写 PPTD，同时明确保留“修改已有文件前必须先读取”的提醒 hook。同步由 Molly Design 的普通设计保存适配完成；公开 hook/extension 负责提醒，已有原生文件工具保护继续复用，不修改 runtime 或增加逐次模型生成的读取证明。五种 Agent 的原生先读再写行为并不一致，不能把工具内部读取、文本匹配或提示词当成统一硬检查。本记录更新设计和源码调研，尚未实施新的接入或完成安装包验证。

## 已确认的边界

- [人工自动保存](../../implemented/simplification/2026-09-12-editor-owned-pptd-save.zh.md)更新当前稿 PPTD 和素材；hook 不负责同步，也不要求 Agent 调用必经同步工具。
- 保留薄提醒 hook，规则是：修改已有文件前先读取当前磁盘内容；覆盖整文件前读取完整内容；发生变化或冲突后重新读取并调整；新建文件不要求读取不存在的目标。续改已有作品时还需读取最新当前稿，不能只凭上轮记忆改遗留草稿。
- 通过实际公开、能把规则送入 Agent 上下文的事件加载提醒，参考 Ponytail 的插件形式。优先复用原生读写检查和现有扩展加载，不增加独立读取台账、generation/attempt 证明服务、Shell 解析器、模型代理或 runtime 补丁。
- “必须先读”是提醒中的行为要求；提醒本身不证明执行顺序。PreToolUse 触发时写参数通常已经生成；若事件只补上下文而继续执行，不能宣称它强制当前写入先等一次 Read。需要阻断时只能按原生接口的真实拒绝/重试语义说明，不能把提示输出当成阻断。原生支持与 Molly Design 新接入分别验收。
- 只使用静态 skill/项目说明而未实际加载 hook，不算完成本项。某接入没有合适的公开事件时记录缺口，不静默降级或补 runtime；也不因此否认它其他创作能力。
- 最终提交独立检查结构、素材、来源和当前稿版本；保留草稿、只读与来源隔离。没有提醒事件不等于产物无效，提醒成功也不提供提交授权。安全性不归因于模型遵守提醒。

## 五种 Agent 的原生能力核对

以下为 2026-09-12 静态核对。固定源码版本、滚动官方文档和实际安装包是不同证据；本次没有运行模型或工具探针。

| Agent / 核对范围 | 原生行为 | 对 Molly Design 的含义 |
| --- | --- | --- |
| Claude Code 官方当前工具文档 | Edit/Write 具有读前写规则，但按模型和版本区分；新模型在满足权限及 Read 可用等条件时可修改未读文件。Edit 自 2.1.208、Write 自 2.1.228 放宽，旧模型及特定文件仍要求先读 | 复用已有检查，不能宣称所有模型都硬性要求 Read；仍保留项目提醒 |
| Codex `rust-v0.153.4` / `3d2ee51` | 所查 apply_patch 路径校验补丁、读取磁盘并匹配内容；未见“本会话先成功调用读取工具”作为通用前置条件 | 补丁匹配不是模型读取证明；公开 hook 提醒有独立用途 |
| Pi `v0.85.1` | read 工具建议用 read 查文件，edit 匹配原内容，write 用于新文件/完整重写；所查 edit/write 执行路径没有会话读取历史门禁 | 使用公开 extension 提醒，不把工具内部读磁盘当成 Agent 已读 |
| Kimi：Molly Design 托管 `f255222661c9`；另查 Moonshot 官方当前源码 | 托管接入的 Edit 说明明确每次先 Read，Write 说明要求覆盖前读；所查实现走文件替换/写入，未见读取历史门禁。官方 WriteFile/StrReplaceFile 也不能据内部读盘/生成 diff 推断先读约束 | 优先复用现有说明及公开 hooks；托管接入与 Moonshot 官方产品不能混称同一实现 |
| Grok Build 公开源码 `37949780` | SearchReplace 的 `skip_read_before_edit` 已标注为运行时无效兼容参数；保留配置时要求存在 Read 工具，执行以匹配/写入为主，匹配失败可提示重读 | 配置中有这个名字不证明强制先读；源码结论不自动覆盖安装的 1.0.13 二进制 |

一手依据：

- [Claude 工具行为](https://code.claude.com/docs/en/tools-reference#edit-tool-behavior)及同页 Write 章节。检查文件内容与检查用户读取权限也不是同一条件。
- Codex [apply_patch handler](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/handlers/apply_patch.rs)和[文件应用实现](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/apply-patch/src/lib.rs)。结论限所查标准路径，不断言所有自定义工具都没有保护。
- Pi [read](https://github.com/badlogic/pi-mono/blob/v0.85.1/packages/coding-agent/src/core/tools/read.ts)、[edit](https://github.com/badlogic/pi-mono/blob/v0.85.1/packages/coding-agent/src/core/tools/edit.ts)、[write](https://github.com/badlogic/pi-mono/blob/v0.85.1/packages/coding-agent/src/core/tools/write.ts)。自定义 system prompt 或替换工具可改变行为，不沿用旧版本提示词印象。
- Kimi 托管 [Edit 说明](https://github.com/LodyAI/acp-extension-kimi/blob/f255222661c9cc2842901858fd28e554d7796a51/packages/agent-core-v2/src/agent/tools/edit/edit.md)、[Write 说明](https://github.com/LodyAI/acp-extension-kimi/blob/f255222661c9cc2842901858fd28e554d7796a51/packages/agent-core-v2/src/agent/tools/os/write/write.md)；Moonshot 官方 [write.py](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/tools/file/write.py)、[replace.py](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/tools/file/replace.py)。后两项为滚动 main，本次结论不作为托管包版本证据。
- Grok [SearchReplace](https://github.com/xai-org/grok-build/blob/37949780c144e37df692e3d669051a21fec24f20/crates/codegen/xai-grok-tools/src/implementations/grok_build/search_replace/mod.rs#L96)。未将公开源码与已安装分发包宣称为可复现的同一构建。

所有这些检查都不能统一覆盖 Shell、脚本和任意 MCP 写文件。保留自然文件工作范式，不为了宣称全覆盖另造执行沙箱。

## Ponytail 复用及待验证项

静态核对 `356918eba965ee1eac64bd3a7f0dd02108350de5`，没有安装或执行：

- [Claude/Codex 配置](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/hooks/claude-codex-hooks.json)注册 SessionStart、SubagentStart、UserPromptSubmit；[脚本](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/hooks/ponytail-activate.js)输出规则上下文。
- [Pi extension](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/pi-extension/index.js)利用 before_agent_start 增加规则。
- [Grok 说明](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/README.md#L265)采用 skills，未用生命周期 hooks；没有发现 Kimi 专用适配。因此不能复制一个配置便宣称五种全部接好。

后续按实际托管版本与 ACP 启动方式验证：扩展加载、模型实际收到提醒、新文件例外、已有文件续改、恢复/切换 Agent 后提醒保留、用户配置共存、失败反馈。原生硬检查若存在，另测拒绝后重读再改；仅有提醒的路径诚实记录，不把一次模型遵守当成硬保证。

## 被替代的方案与迁移状态

先前建议把同步放在派发前，用户否定；随后恢复读取 hook 同步，并尝试在工具事件上建立读取基线。最新确认改为独立的编辑器自动保存，但明确否定“删除所有 hook”。因此读取同步 hook 和逐次 generation 证明退出目标，先读文件的提醒保留；派发只等待已有保存队列，不新设设计准备流程。

[旧按需同步记录](../../rejected/architecture/2026-09-10-design-sync-hooks.zh.md)、[Codex](../../rejected/architecture/2026-09-11-codex-design-hook-boundary.md)、[Kimi](../../rejected/architecture/2026-09-11-kimi-design-hook-boundary.md)、[Grok](../../rejected/architecture/2026-09-11-grok-design-hook-runtime-gap.md)保留旧合同与实测失败的历史事实。T18–T20 的新范围需按上述提醒合同重新验收，不能直接把旧阻塞改成完成。既有采集对 generation 证明的依赖也需一起收敛，不能只删写入检查导致最终采集仍永久拒绝。

本次仅更新方案、阶段计划与规则；未修改运行时代码、发布票据、启用新 hook 或调用真实模型。PPTD 同版本保存、取消/恢复、正式提交与真实图片验收仍需要各自证据。
