# 艺术字图层 textCopy：可改字的图片文字层

Status: implemented
Translation: current

[English](2026-10-10-lettering-text-copy.md)

## 摘要

艺术字图层（字体无法还原的文字图片）现在携带 `textCopy` 字段，记录图片
所示文字的精确内容。画布选区工具栏对这类图层提供"编辑文字"入口，把新
文字作为普通再生成 prompt 交给 Agent；图片不会变成文本元素。Skill 要求
必须写该字段、禁止把多段文案合并进同一图层，并在报告时将艺术字描述为
可改字而非死图。

## 问题与证据

2026-10-10 的诺贝尔奖海报测试中，三行大字标题（诺贝尔文学奖 / 安妮·卡森 /
ANNE CARSON）被从选定方案抠成图片层。艺术字图层规则保住了还原度，但用户
看到的是文字"粘"在图片里：图层能移动缩放却改不了字，画布上也看不出这些
图片里装的是文字。Skill 此前只要求在回复中说明该限制，但回复不会跟随
图层——过几天没人能分清一张艺术字 PNG 和一张照片，除非重新读像素。

## 决策

图片元素新增可选字段 `textCopy`，承载图片中文字的精确内容。字段存在即
标记该图片为文字渲染层；普通照片与纹理不写此字段。

- **规范格式。** `BentoImageElementV4.textCopy?: string`（1–2000 字符），
  进入 v4 closed-world 字段表并由 kernel 的 `createElement` 载荷校验。
  冻结能力矩阵保留其哈希门禁；`textCopy` 作为 Molly 扩展记录于此，而非
  回填矩阵行——矩阵是证据档案，不是活 schema。
- **YAML 投影。** `design.yaml` 的 image 元素准入 `textCopy`；往返与其余
  canonical 字段一样精确保留。
- **选区。** 画布选区摘要为图片元素携带 `textCopy`，shell 与工具栏无需
  新增文档 IPC 即可读取。
- **编辑器。** 选中单个带 `textCopy` 的图片时，选区工具栏出现"编辑文字"
  入口。弹层预填当前文字；提交后以 `edit-wording` 选区动作把新文字送入
  普通 composer，prompt 要求 Agent 只重新生成该图层、替换图片素材并更新
  `textCopy`。图片不会变成文本元素；改字是 Agent 执行的再生成，串行回合
  契约不变。
- **Skill。** 第 6 步与 lettering 参考要求每个艺术字图层写 `textCopy`，
  禁止把多行或不相关文案合并进同一图层，并在报告时将艺术字描述为可改字
  而非死图。

## 已否方案

- **只加 ALT 文本、不加编辑器动作：** 无障碍式元数据没有改字路径，原投诉
  依旧——文字仍粘死。
- **按需把艺术字转回原生文本：** 艺术字图层的存在意义就是字体无法还原；
  转换会毁掉该字段要保护的设计。
- **单独的 `editable` 布尔位：** 冗余。`textCopy` 存在即标记；布尔位只会
  多出一种两者互相矛盾的状态。

## 边界

- 改字质量受图片模型限制：即使文字正确，再生成笔形也可能与原版有差异。
  prompt 会要求保持风格，评审阶段照常适用。
- `textCopy` 是创作期事实。手动换图后没有任何机制验证像素仍匹配该字符串；
  替换图片会保留 `textCopy`，直到 Agent 或用户更新它。
- 冻结能力矩阵不含 `image.textCopy` 行；补行需要重跑矩阵哈希流程，属另一
  决策。

## 证据

- `pnpm check`（类型、lint、i18n、边界门禁）通过。
- design-authoring：156 个测试通过，含新增 intake 用例（准入 `textCopy`、
  拒绝非字符串与空值）与 `image-lettering` fixture 元素的往返覆盖。
- design-shared 选区 schema 测试覆盖 `textCopy` 边界与 `edit-wording`
  工具栏请求形态。
- `pnpm --dir packages/design-bento build` 带工具栏改动组装编辑器包通过。
- Codex CLI 复审（`gpt-6-astra`，high）发现 IME 组合态下 Enter 会提前提交
  改字弹层；处理器现已忽略组合态 Enter（`isComposing` / keyCode 229），
  工具栏测试携带确定性回归用例。
