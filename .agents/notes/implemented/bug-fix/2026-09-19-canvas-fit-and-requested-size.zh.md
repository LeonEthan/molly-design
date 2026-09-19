# 画布刷新适配窗口与自定义尺寸传递

Status: implemented
Translation: pending

## 摘要

用户授权实施后，刷新链路改为在有效新画面及布局就绪后自动适配窗口，保留原生双视图交接；同一画面仅隐藏/重开时仍保留手动缩放。首页自定义尺寸现在同时用于创建 BentoDoc 和生成首次持久任务文本，Auto 不增加固定要求，后续仍允许用户要求改变尺寸。提交与视口回归、真实 Bento 原生验收、类型检查及边界检查已通过。全量 pnpm check 被既有提交标题历史断言阻断；本轮未调用真实 Agent，自动化证明输入传递和渲染行为，不保证模型遵循指令或替代人工视觉判断。

## 修复前的证据与边界

- [Spec 的修复前版本](../../../../specs/graphic-design-platform.zh.md) 的「唯一画布与实时构建」明确要求保留缩放和画布坐标中心、不逐次自动 fit。本次目标需要修订这一行为；旧实现不能简单归类为违反旧 Spec。
- [视口适配](../../../../apps/electron/src/main/services/design-viewport.ts) 捕获并恢复屏幕 scale 和画布坐标中心；[预览发布](../../../../apps/electron/src/main/services/design-source-preview.ts) 在发布前恢复，正式当前稿的 [reload](../../../../apps/electron/src/main/services/design-service.ts) 同样捕获旧相机。画布尺寸变化时仍恢复绝对 scale，可能让新画布过大或过小。
- [Bento Canvas](../../../../packages/design-bento/bento/slides/src/editor/canvas.ts) 已有 fitScale=min((可用宽度−64)/画布宽度, (可用高度−64)/画布高度)，实际 scale=fitScale×zoom；zoomReset 将相对 zoom 设为 1 并居中。不要将 fit 误实现为屏幕比例 100%。源码是 pinned 上游，只能经[组装脚本](../../../../packages/design-bento/scripts/build.mjs)适配。
- [原生预览验收](../../../../apps/electron/src/main/services/design-source-preview-verification.ts) 当前断言连续换帧后 scale/x/y 不变。必须替换相应目标断言，同时保留奇数窗口不漂移、有效帧交接、隐藏和取消等保护。
- [首页提交](../../../../packages/components/src/components/chat/chat-landing.tsx) 校验自定义宽高并传给 designService.create；[store](../../../../apps/cli/src/design/store.ts) 将其写入 BentoDoc；[turn-input](../../../../apps/cli/src/design/turn-input.ts) 从保存基线读取宽高到 manifest.canvas。不能说“数值完全没有传到 Agent 可读输入”。
- 但 canvasDraft.mode 只在首页草稿中，首次 inputBlocks/prompt 没有尺寸要求。[派发准备](../../../../apps/cli/src/lib/message-handler.ts) 返回技能及[工作区路径提示](../../../../apps/cli/src/design/workspace.ts)，没有内联本轮宽高或说明用户选择了固定尺寸。只看初始 800×600，后续无法区分 Auto 默认与用户显式选择 800×600。
- [创作技能](../../../../packages/design-authoring/skills/graphic-design/SKILL.md) 描述尺寸合法范围和比例，但没有本次自定义选择的信息；[最终采集](../../../../apps/cli/src/design/turn-outcome.ts) 校验格式、素材和版本，不要求输出尺寸等于 manifest.canvas。现行产品允许 Agent 调整尺寸，因此不能简单增加“所有回合尺寸必须等于基线”的门禁。
- 与[显示交接修复](../../implemented/bug-fix/2026-09-19-live-canvas-handoff.zh.md)共同维护有效画面就绪后替换的语义；本任务不需要渲染器或元素缓存重构，相关讨论独立推进。

## 实现

### 1. 有效刷新后完整展示

本实现把“刷新”解释为首次展示、有效实时预览发布、回合完成后的当前稿加载，以及历史切换后的新画稿加载。有效新画面按可见画布容器适配；普通点击、选区改变和每次手工编辑不重置用户相机。窗口/面板尺寸变化的期望纳入同一 fit 验收。

1. 复用原有 fitScale/zoomReset，通过组装适配提供 window.bento.fit()；Bento 不感知 Agent 或版本生命周期。
2. Electron 负责在实际布局与字体/图片就绪后调用 fit，随后完成 compositor capture 再发布。隐藏视图等真实可见尺寸确定后再 fit，不使用零尺寸计算。
3. 移除按 host 捕获/恢复旧绝对 scale 的跨实例逻辑。用 WeakMap 记录已适配的实例及容器宽高，新实例或宽高变化时 fit；同一实例隐藏/显示自然保留自身相机。保留通用 viewport 读写能力供手动控制和诊断。
4. fit 只改变相机，不改变 BentoDoc、元素坐标、保存状态或导出尺寸。无效中间草稿保留上一有效画面及其视口，不触发 fit。
5. 已同步修订中英文 Spec、Electron/design-bento 最近的 AGENTS.md 和 README 中“跨刷新保留相机”的合同；Spec 保持 draft，历史笔记保留原决策语境。

### 2. 自定义尺寸成为明确用户请求

1. 自定义模式在首次提交的规范输入文本中追加清晰要求，例如“画布尺寸为 1200×628 px；请按此宽高设计”。在 inputBlocks 规范化/派发之前完成，并保留用户文本、附件、引用和正常命名；不只修改可能被另一条输入路径替代的 prompt 字符串。
2. 创建初始画布与追加要求使用同一次提交捕获的尺寸。尺寸要求进入既有持久首条消息/输入合同，使重试和恢复可追溯；不增加第二份持久画布尺寸真相。
3. Auto 不追加固定尺寸要求，仍允许 Agent 决定尺寸。即使自定义恰好为默认 800×600，也应明确表达用户选择，不能根据数值推断模式。
4. 不将首页设置强行永久锁定整个作品：后续用户明确要求改尺寸仍可执行，也不在每轮重新注入过时的初始尺寸。本轮没有增加技能流程约束。
5. 不用自动缩放/裁切产物、自动重试 Agent 或全局尺寸相等校验掩盖问题。先验证真实派发内容和产物；若仍不遵循，检查实际 provider 收到的输入与行为，再决定是否需要其他机制。

## 修复前后的验证方案

| 层次 | 用例 | 明确通过条件 |
| --- | --- | --- |
| 提交集成 | Custom 1200×628、628×1200、800×600；Auto；Enter/点击发送 | create 参数正确；实际 provider 输入含自定义要求且仅一次；Auto 无固定要求；原始文本与附件完整 |
| 失败与恢复 | 创建失败、发送失败后重试、同回合恢复 | 尺寸要求不丢失、不重复、不串到其他草稿；冻结基线不重算 |
| 尺寸边界 | 0、4097、小数、空字段，以及合法 1/4096 | 非法输入在创建/发送前被拒绝；合法整数准确落盘；不静默改值 |
| 原生 fit | 横版、竖版、方形、285×2000 长图、小画布和 4096 边界；预先放大/缩小后刷新 | 新画布四边落在可用视口内，中心对齐，scale 接近真实容器的 fit 值；小画布也放大到 fit |
| 尺寸变化 | 800×600→285×2000→方形、奇数视口、侧栏/窗口 resize | 重新计算 fit，不沿用旧绝对 scale，不累计漂移 |
| 生命周期 | 连续有效帧、无效 YAML、缺图、隐藏时加载/刷新、重新显示、取消/迟到结果、版本切换 | 有效新帧按策略 fit；无效帧保留旧画面；隐藏视图不露出；无旧结果覆盖新画稿；无新增闪白 |
| 文档不变性 | fit 前后 snapshot、dirty、导出 | 文档/素材和 dirty 不因 fit 改变；PNG/JPEG 像素尺寸仍为实际画布尺寸 |
| 真实 Agent | 不在正文重复尺寸，仅用选择器指定横版/竖版；随后明确要求改尺寸 | 检查实际收到的请求、最终 design.yaml.size、BentoDoc.canvas 和导出像素全部符合本次指令；后续改尺寸仍有效 |

先写能在旧实现上失败的提交集成测试与原生 fit 断言，再修改运行时；测试等待真实发布/ready 信号，不使用固定 sleep，不以 mock 调用次数证明行为。真实 Agent 验收可用文字和形状的合成任务，不需要付费生图。视觉完整展示与无闪烁仍需人工观察。

## 实施验证与限制

- 修复前回归：旧视口实现的 2 项断言失败，实际保留 scale=4；旧尺寸提交逻辑的 4 项自定义用例失败，任务文本仅含 “Make a poster”。Auto 与非法尺寸检查通过。初次测试图片夹具不符合 schema 的失败已纠正后重跑，不作为缺陷证据。
- 修复后前端定向测试：6 个文件、34 项通过，覆盖尺寸要求进入 shared inputConfig/持久历史、附件保持、重试从原稿重建、Auto/非桌面不加要求，以及既有保存、交接和草稿回归。Electron Node 测试 149/149 通过。
- `pnpm --dir apps/electron build:app`、嵌入式 CLI build/sync 均通过；后续仅修改原生验收测量时，使用既有 electron-vite OSS main 配置重建主进程，没有另建运行时入口。
- 隔离 Playwright Electron 原生 P1 探针：`e2e/artifacts/acceptance/canvas-fit-1789784748920/` 下 result.json、source-preview-result.json、version-result.json 全部 passed，进程退出 0。main SHA256 为 `4d8836e8d74e9be70b49f7d368a8c1e2ac534838c1717bf5bf8921aa81e9af60`。
- 实测 1200×628、628×1200、128×128、285×2000、4096×1 均 fit 且居中；小画布比例为 5.75，长图比例为 0.368。奇数窗口、连续替换、隐藏/重开、容器缩放、版本恢复、snapshot/dirty 不变及旧画面保留到新帧准备完成均通过；原生既有 PNG/JPEG 导出尺寸验收也通过。
- 原生测量前两轮失败保留：第一轮错误选中了隐藏缩略图；第二轮漏计 classic scrollbar 的 clientLeft gutter。改为实际舞台选择器和 client box 坐标后重跑，未放宽 fit/边界断言。
- `pnpm check` 的类型检查和 lint 通过，测试阶段止于未修改的 `packages/design-authoring/tests/live-fingerprints.test.ts:121`，它要求最近 30 条 Git 提交标题含 PPTD 或 Folio。该问题在[此前交接修复](../../implemented/bug-fix/2026-09-19-live-canvas-handoff.zh.md)已有记录。本轮没有改历史或弱化断言来绕过。
- 单独完成 `pnpm lint:i18n`、`pnpm check:code-collab-imports`、`pnpm check:platform-boundaries`、`pnpm check:public-boundary`，均通过；变更代码的 Prettier 检查通过。docs status/check 均无错误，仅有既有大小预警与翻译待办。
- 隔离桌面明暗主题合成截图：`e2e/artifacts/canvas-fit-visual/1789784957344/`，报告 passed。两张原生窗口合成图包含 text/shape/image/line/icon/table/chart 七种元素，已逐图检查画布四边完整且未裁切；不是原始用户作品的视觉验收。
- 本轮未发起真实付费 Agent/生图调用，未声称复现用户原始回合；模型是否遵循尺寸需真实创作验收。本轮没有新增全局尺寸锁定、自动裁切、自动重试或二份尺寸权威。

- 人工验收：用户于 2026-09-19 确认本次修复人工测试通过并授权提交。未提供逐项测试记录，不将此确认扩展为所有 Agent/provider 的遵循保证。
