# 画布 UI 的 Lovart 化：顶条收敛、选区操作胶囊带与选中即挂 chip

Status: implemented
Date: 2026-09-15
Translation: pending

## 摘要

设计会话画布上方的 React shell 工具栏原本最多堆叠 15 个文字按钮，与整体风格不一致。按用户拍板的"照搬 Lovart"方向，本次把顶条收敛为分段控件（当前作品/未提交预览）+ 4 个图标按钮（历史/导出/更多/聚焦），在画布上方新增 48px 浅色带：选中元素时带内出现 Lovart 式胶囊 pill（计数 chip + 5 个纯图标动作，悬停 tooltip 显示文字，组件自包 TooltipProvider），同时把选区状态经真实事件通道（画布 worker POST → Electron main 转发 → renderer IPC）同步给 shell，实现"选中即自动给 composer 挂 @Selected elements chip"（无 prompt 的引用动作遇镜像 chip 刻意为 no-op）。画布内 chrome 同步收敛：原 `.ed-topbar` 与 Bento 内建 Edit tools 属性面板（`.c2a-surface`）全部隐藏——后者逻辑上被新 UI 取代，其开关按钮与专用样式一并清除——恢复创作工具 dock（选择/撤销/重做/文本/形状/图片），缩放控件移到左下，自动保存状态为右下 pill。真实应用（Playwright 启动 OSS 桌面、合成 design.yaml 会话）验收全部实测通过；pill 纯图标化后自然宽度 263px，密度问题消除，超窄时仍内部横向滚动并以边缘渐隐指示。限制：dock 的撤销/重做/形状弹出层点击链路未逐项实测；事件通道只携带选中计数；被动镜像在画布 attach 竞态窗口内会静默失败一次（下一次选中变化自愈）。

## 背景与问题

画布区（`packages/components/src/components/sessions/design-canvas.tsx` 的 shell 与 `packages/design-bento` 的内嵌编辑器 chrome）是本项目相对 Lody 的新增面。原 shell 顶条把所有动作平铺为文字按钮，调研笔记（[AIGC 图像生成产品界面调研](../../proposed/feature/2026-09-15-aigc-image-product-ui-research.zh.md)）确认"选中驱动 + 收敛入口"才是行业惯例：Lovart 选中图片后画布顶部出现上下文工具栏，Canva 顶层工具栏内容随选中对象整体切换，导出入口均为"一个入口 + 格式二级选择"。

用户审阅 HTML mock 后拍板：照搬 Lovart 画布 UI；选中操作不放顶条而放画布顶部 48px 浅色带内的胶囊 pill（顶条保持干净）；Lovart 式选中即自动挂 chip；保留 composer 预填 prompt 方案；选区同步用真事件通道而非轮询；dock 恢复创作工具；两步（shell 重构 → 事件通道与自动 chip）连续做完。后续两轮复审补充：pill 动作改纯图标 + 悬停 tooltip（文字过密）；Bento 内建 Edit tools 属性面板被新 UI 取代而清除；分段控件文案收敛为"画稿/预览"（en: Artwork/Preview）；聚焦按钮图标从 PanelRight 改为 Maximize2/Minimize2——窗口顶栏右侧的侧栏开关（PanelRight，隐藏画布面板）与聚焦按钮（隐藏聊天面板）方向相反、并不重复，但同图标堆叠易混，故换图标区分。

## 实现地图

- Shell 顶条与 48px 带：`packages/components/src/components/sessions/design-canvas.tsx`——分段控件（画稿/预览，en: Artwork/Preview）+ 4 图标（局部 TooltipProvider），48px 带 `bg-[#f5f7fa] dark:bg-[#1b1f26]`，`selectionCount > 0` 时渲染 pill 并 `onSyncSelection`（300ms trailing 自动捕获）。聚焦按钮用 Maximize2/Minimize2 图标，与窗口顶栏的侧栏开关（PanelRight，隐藏画布面板）区分：二者方向相反（聚焦隐藏聊天面板），不是重复。
- 选区 pill：`design-selection-pill.tsx`（新）+ `src/stories/DesignSelectionPill.stories.tsx`（新）。动作为纯图标按钮 + 悬停 tooltip（组件自包 TooltipProvider，文字仍在 i18n 键与 aria-label 中）；pill 根 `max-w-full overflow-x-auto`、子项 `flex-none`，带容器 `flex h-12 px-3`、pill 外包 `m-auto max-w-full`；内容超宽时内部横向滚动，ResizeObserver + scroll 监听计算左右可滚动状态，用 `mask-image` 线性渐变做边缘渐隐指示（20px 过渡区）。
- i18n：`locales/en.json` / `zh_CN.json` 新增 `design.export`、`design.more`、`design.selectionCount`（pill 动作复用既有键）。
- 事件通道：`packages/shared/src/electron-ipc-channels.ts` 新增 `'design.selection'`；`packages/design-bento/src/product-session.ts` 在非 embedded 场景对 selection 变化做 trailing 150ms `POST /ws/:id/selection {count}`；`apps/electron/src/main/services/design-service.ts` protocol handler 新增 POST selection 分支，转发 `record.owner.webContents.send('design.selection', …)`。
- 自动挂 chip：`combined-mention-textarea.tsx` 的 MentionActionsBridge 新增 `syncDesignElementMention(reference|null, label)` 与 `commitDesignElementRequest`；`session-chat-input-area.tsx`、`session-chat-interface.tsx` 透传；`session-detail.tsx` 接 `onSyncSelection`。关键语义（实测确认）：无 prompt 的 reference 动作遇镜像 chip 是刻意 no-op（`alreadyPresent && !prompt → return false`，镜像 chip 本身就是可发送的真 mention）；带 prompt 动作消费镜像 chip + 预填 prompt，取消选中后保留。
- 画布内 chrome（`product-session.ts`）：`.ed-topbar` 与 Bento 内建 Edit tools 属性面板（`.c2a-surface`）一并隐藏——面板被新 UI 取代而清除，其 dock 开关按钮、`molly-properties-hidden` 切换与 c2a 控件样式规则同步删除；`.molly-dock` 为选择/撤销/重做｜T/形状▾/图片；`#autosave-status` 重构为 dot + statusText（保留 id 与 data-state）；缩放控件以 `.ed-corner-br { inset-inline-end:auto!important; left:14px!important }` 移到左下。面板的原有手工能力（画布尺寸/背景、图层排序等）不再有人工入口，由 Agent 编辑与画布直接操作覆盖。
- 文档：`packages/components/src/components/sessions/README.md` 补自动镜像 chip 段落。

## 验证证据

真实应用验证环境：`e2e/scripts/ui-verify-launch.mjs`（Playwright `_electron` 启动 `apps/electron` 目录、`LODY_ELECTRON_USE_BUNDLED_CLI=1`、窗口 1680×1000），dev 数据目录 `~/.molly`，合成 800×1000 海报 design.yaml 经"Import as current artwork"导入会话；画布截图走 CDP `Page.captureScreenshot`，shell 截图走 OS 级窗口截图。以下全部实测通过（有截图与 DOM 测量存档于会话记录）：

1. 顶条分段控件 + 4 图标渲染正确。
2. 选中元素 → 48px 带出现 pill（计数 chip + 5 动作）；取消选中 → pill 消失。
3. 选中 → composer 自动挂 `@Selected elements (1)` chip；取消选中自动移除；再点 reference 为 no-op（符合设计）；点"调风格"→ chip + 预填 prompt，取消选中后保留。
4. 画布内：`.ed-topbar` 与 `.c2a-surface`（Edit tools 面板）均 display:none；dock 6 按钮齐全（DOM 实测 aria-label：选择/撤销/重做/文本/形状/图片，无属性按钮）；缩放 pill 左下（x=14）；`已自动保存` 状态 pill 右下。
5. 选中框蓝色手柄、画布内选择/拖拽联动正常。
6. pill 纯图标（补验）：5 个动作按钮可见文字长度均为 0、aria-label 完整、计数 chip 显示 `1 item`，自然宽度 263px；悬停首个按钮出现 tooltip `Reference selected elements`（DOM 实测 + 截图）。
7. pill 溢出（补验，文字版 pill 时期）：1680pt 窗口英文 UI 下 band 898pt、pill 内容 988pt，pill 被 `max-w-full` 截在 874pt 并内部滚动（clientWidth 872 < scrollWidth 988，DOM 实测）；右缘渐隐（截图放大确认文字溶出而非硬切），滚动到底后"Regenerate selection"完整可见且左缘出现渐隐。纯图标化后正常窗口不再触发溢出，滚动+渐隐逻辑保留作超窄兜底。

静态检查：`pnpm typecheck`、`pnpm lint`、`pnpm lint:i18n`、各 boundary 检查均绿；全量 `pnpm test:ci` 通过。`pnpm run docs status` 无 error（存量 warning 未变）。

## 限制与未验证项

- dock 的撤销/重做/形状下拉弹出层点击链路未逐项实测（dock 按 aria-label 枚举核对过存在性）。
- 事件通道单向只携带选中计数；shell 不知道选中元素的类型/内容，pill 动作因此是通用五动作而非按选中类型切换（与 Lovart 按对象类型切换工具栏内容不同，属有意简化）。（2026-09-16 更正：此限制已由 [选中即改](2026-09-16-canvas-typed-selection-bar.zh.md) 移除——完整选区摘要与属性命令通道已落地，pill 按类型分化。）
- 被动镜像 chip 在画布刚打开后短时间内首次选中时，可能因 main 侧 `Current artwork is not visible`（attach/hide 生命周期竞态）静默失败一次；下一次选中变化自愈。这是被动路径"永不上浮错误"的既有设计，未加重试。
- pill 溢出渐隐在深色/浅色两主题均用同一 mask（遮罩与主题无关），但深色主题下只实测了深色。
- e2e 辅助脚本（`e2e/scripts/ui-verify-*.mjs`）是人工验证工具，不是注册 journey，不进入回归套件。
