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
3. **触发语入口。** Skill 分支识别"先排版""先出布局""layout first"等说法；首页第五个示例填入这样的提示词。模式状态存在画稿里（`layout-` 元素 id），不另设标志。
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

"## MOSS 对齐

2026-10-26 owner 要求画布布局对齐 MOSS-Image 的布局输入，便于后续接入 MOSS。
依据为官方 [USERGUIDE](https://github.com/OpenMOSS/MOSS-Image/blob/main/USERGUIDE.md)：
`{summary: {caption}, items: [{label, caption, text?, bbox}], bbox_format: "yxyx",
bbox_coord_space: "abs_centralized"}`，绝对像素坐标，原点在画布中心，x 向右、y 向下；
JSON 作为文生图的 prompt 字符串传入。

- `graphic-design/scripts/layout-json.mjs` 通过随包的 `validate()` 从 `design.yaml`
  现算该 JSON；它是派生视图，不另行保存。
- `layout-summary` 文本 → `summary.caption`（必需）；`layout-` 形状 → `object` 条目，
  caption 取同一 `groupId` 中的标签；其他 `text` → `text` 条目，caption 为字体、粗细、
  颜色摘要，text 为原文；其他元素列为 skipped；旋转元素按未旋转的 bounds 输出并警告。
- 尺寸默认按画布比例缩放到约 1,048,576 像素，两边为 16 的倍数，或用 `--size WxH`；
  `bbox = round([y·s − H/2, x·s − W/2, (y+h)·s − H/2, (x+w)·s − W/2])`。
- Agent 可以改写 `caption`；`text` 和 `bbox` 不得修改。
- 未确认：`label` 的完整取值（文档只出现 `text` 与 `object`）、条目与文字上限，以及
  platform.mosi.cn 的托管 API。MOSS-Image 图片连接属于后续工作。

## 局限

未验证：尚无 Agent 运行走过该路径，仍需端到端运行。一次完整运行大约需要四到六次图片调用（一次生成加上底图和物体分离），可能超过默认的五次额度，需要负责人批准。首页一行能否放下五个示例需要目视检查。
