# 先布局设计

Status: implemented
Translation: current

[English](2026-10-26-layout-first-design.md)

## 摘要

有些用户希望在为图片付费之前先决定元素的位置，就像 MOSS-Image 这类布局条件模型那样，但此前每个新设计都从三个完整的图片模型方案开始。负责人在 2026-10-26 决定在现有 Skill 中增加先布局路径：先问风格并调研，Agent 再在画布上画出由带标签的区域框和最终文案组成的可编辑布局并停下；用户调整并确认后，Agent 以布局渲染图生成一张设计并还原为可编辑图层，位置和尺寸以布局为准，外观以生成图为准。由于 Molly 没有可用的 slash 命令，入口是触发语，以首页第五个示例提供。工作流 Spec 退回 draft，该路径尚无 Agent 运行验证。

## 问题

- 本决定扩展了[用户选择设计](2026-10-09-user-chosen-designs.zh.md)和[整张图交付](2026-10-26-whole-image-delivery.zh.md)的决定；开放需求仍默认提供三个方案。
- 方案把构图固定在图片模型的输出里，想先决定摆放位置的用户只能否定方案、再付费重生。
- 通用图片模型（GPT Image、Qwen Image）只把布局当作引导图，会产生偏移，因此还原时必须确定以布局还是生成图为准。

## 决定

1. **几何取布局，外观取生成图。** 文字元素保留布局中的位置、尺寸和文案；分离出的物体缩放放入各自的区域框；底图取自生成图。物体移动后背景光影可能对不上，接受这一代价。
2. **确认后只生成一张。** 本路径不提供方案；"再生成一张"复用保存的布局引导图，再调用一次 edit。
3. **触发语入口。** Skill 分支识别"先排版""先出布局""layout first"等说法；首页第五个示例填入这样的提示词。模式状态存在画稿里（`layout-` 元素分组），不另设标志。
4. **先问风格，画布局前先调研。** 本路径总是先就风格方向提问，再按不变的调研规则调研，然后画布局；保留的灵感图用于生成回合。
5. **交付。** 除非需求要求整张图，否则交付可编辑图层，且不询问交付形式。`layout-` 框和标签在交付前删除，确认过的布局保留在设计历史中。

## 复用

- 复用：`design-research/references/design-options.md` 中的原生草模渲染（改为留在画布上，而不是恢复原状）、普通 `shape`/`text` 元素、`molly_image` `edit`、`design-replication`，以及现有 `HomeIdeaChips` 组件。
- 不新增画稿格式、存储、协议或运行配置状态。

## 备选方案

- **Slash 命令 `/layout`。** 暂不采用，属于更大的基础设施工作：内置目录发布写入 `availableCommands: []`（`apps/cli/src/agent/embedded-harness-catalog.ts`），因此 Molly 的输入框 `/` 菜单不会出现；Pi 的 `available_commands_update` 被丢弃（`packages/shared/src/acp/history-apply.ts`）；Molly 会在用户消息前加入内部说明，很可能使 Pi 的提示词模板展开不生效（根据代码推断，未实测）。真正的 slash 支持另作基础设施问题处理。
- **持久的模式开关。** 需要新增每回合传递的运行配置状态；布局元素本身已能标识状态，因此不采用。

## 修改范围

工作流 Spec（中英文）、`graphic-design`、`design-research` 和 `design-replication` 的 SKILL.md、新增的 `design-research/references/layout-first.md`、`chat-landing.tsx` 以及 `en`/`zh_CN` 语言文件。

## MOSS 对齐

2026-10-26 owner 要求画布布局对齐 MOSS-Image 的布局输入，便于后续接入 MOSS。
依据为官方 [USERGUIDE](https://github.com/OpenMOSS/MOSS-Image/blob/main/USERGUIDE.md)：
`{summary: {caption}, items: [{label, caption, text?, bbox}], bbox_format: "yxyx",
bbox_coord_space: "abs_centralized"}`，绝对像素坐标，原点在画布中心，x 向右、y 向下；
JSON 作为文生图的 prompt 字符串传入。

- `graphic-design/scripts/layout-json.mjs` 通过随包的 `validate()` 从 `design.yaml`
  现算该 JSON；它是派生视图，不另行保存。
- `layout-summary` 文本 → `summary.caption`（必需）；属于 `layout-` 分组（或 id 以
  `layout-` 开头）的形状 → `object` 条目，caption 取位于其框内的布局标签（多个框包含时取最小的框）。
  按 `groupId` 判断，是因为 Bento 复制粘贴和复制元素会给新 id 但保留分组
  （`editor/clipboard.ts:171`、`editor/canvas.ts:945`）；其他 `text` → `text` 条目，caption 为字体、粗细、
  颜色摘要，text 为原文；其他元素列为 skipped；旋转元素按未旋转的 bounds 输出并警告。
- 尺寸默认按画布比例缩放到约 1,048,576 像素，两边为 16 的倍数，或用 `--size WxH`；
  `bbox = round([y·s − H/2, x·s − W/2, (y+h)·s − H/2, (x+w)·s − W/2])`。
- Agent 可以改写 `caption`；`text` 和 `bbox` 不得修改。
- 未确认：`label` 的完整取值（文档只出现 `text` 与 `object`）、条目与文字上限，以及
  platform.mosi.cn 的托管 API。MOSS-Image 图片连接属于后续工作。

## 灵感图

2026-10-26 owner 要求：展示灵感图是通用的汇报规则。只要调研保留了灵感图，结束该回合的回复
就从 `media/` 嵌入每张图，并写明它贡献的特质和来源页；适用于设计方案、布局回复和 Agent
自行决定的路径。布局生图时像生成设计方案一样传入灵感图（布局渲染图、交付素材，再加布局
回复中展示的灵感图），写明每张图的特质并禁止照搬其物体、文字和标志。连接的图片数量受限时，
保留布局渲染图、全部交付素材和至少一张灵感图，并在回复中说明省略了什么。MOSS-Image 文档
没有图片输入，以后接入 MOSS 时需要把灵感图的特质写进 `summary.caption`，具体到接入时再定。

## 版式参考

2026-10-26 owner 案例：需求为"设计一个长沙为背景的万圣节海报，先出布局"，Agent 把保留的
参考标为"配色与光感参考"，布局则是自己构想的，没有借鉴参考的版式结构。根因：Spec 第 3 阶段
和 `design-research` 要求每张参考只贡献一种特质，"而非其物体或版式"，并禁止照搬成品版式；
先布局第一回合也没有把布局和调研联系起来。修改：版式结构（网格、信息层级、标题与主体的位置和
比例、留白）是平面设计调研最需要借鉴的特质；至少一张保留的参考为版式结构而选，先布局路径以它
的结构为基础画区域，并在回复中说明借鉴了哪张参考。防照搬规则只针对物体、文字和标志，以及整张
照搬某一张参考。这一改动适用于所有新设计，包括三个方案的常规路径。

## 局限

未验证：尚无 Agent 运行走过该路径，仍需端到端运行。一次完整运行大约需要四到六次图片调用（一次生成加上底图和物体分离），可能超过默认的五次额度，需要负责人批准。首页一行能否放下五个示例需要目视检查。
