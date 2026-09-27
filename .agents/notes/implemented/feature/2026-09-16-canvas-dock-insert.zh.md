# 画布 dock 插入按钮接真：add-element 元素创建通道

Status: implemented
Date: 2026-09-16
Translation: pending

## 摘要

Lovart 化画布留下的底 dock 有三个插入按钮（文本/形状/图片），审计发现它们转发到被原生变更封印（`a1a2-native-mutation-seal.patch`）禁用的上游隐藏 Insert 按钮，实测一个元素也建不出来。按用户选定的"接真"方向，本次把创建纳入既有 zod 校验命令通道：共享契约新增第七个动词 `add-element`，画布侧复用上游自带的 closed-world 缺省元素工厂（`createElementCommand`/`imageCreateElementCommand`）构造元素并经 `bridge.dispatch` 落一个 kernel 批次（= 一步撤销），dock 三按钮改为直接调用该通道，图片插入复用项目侧 `pickImageFile`（内容寻址注册 + 真实文件选择器）。真实应用探测 20/20 通过，撤销可字节级还原画稿。Electron 主进程零改动——命令通道保持动词无关，元素语义仍只在共享 zod 契约里。

## 背景与问题

画布按钮全量审计（2026-09-16，Playwright CDP 实测）的结论：dock 的"选择"是 `() => {}` 空按钮（有意的模式指示器）；文本/形状/图片转发到 `.ed-insert` 隐藏按钮，但 `SlideCanvas.insert()` 在 bridge 模式下直接 return（且 `store.sealNativeMutations()`），全部建不出元素；其余按钮（撤销/重做/缩放/顶条/pill）均有真实承载。两个候选方向：1) 接真——新增 add-element 命令动词；2) 砍掉三个按钮。用户选 1，并批准实施要点：一命令一撤销批次；图片经 registerAsset 注册；形状弹板精简为 kernel 已建模的预设子集；插入后选中新元素。

## 实现地图

- 共享契约（`packages/shared/src/design-selection-commands.ts`）：`DesignCanvasCommandSchema` 新增第七动词 `add-element`——`kind: text/shape/line/image`；`shapeName` 为静态词表六预设（rect/roundRect/ellipse/oval/triangle/arrow）；`src` 限 `asset:<sha256hex>`；`naturalWidth/naturalHeight` 可选正数。icon/table/chart 不在词表（dock 无入口，工厂虽支持）。测试补齐接受/拒绝用例。（2026-09-16 更正：`kind:'image'` 缺 `src` 现由 union 级 `superRefine` 在 schema 层拒绝——原先只限 `src` 格式，缺 `src` 的命令能通过校验、直到画布侧才报误导性的 "No matching elements"。）
- 画布侧（`packages/design-bento/patches/web-product-session.patch`）：boot.ts 引入上游 GD-4c 缺省元素工厂——`createElementCommand`/`imageCreateElementCommand`（`ui/create-delete.ts`）与 `nextElementId`（`ui/defaults.ts`），不手写元素字面量（工厂已满足词表面、kernel createElement 校验、projector 编译三重约束，且 createElement 携带完整元素使 delete 的 inverse 永远合法）。`applyCommands` 顶部新增 add-element 分支（创建不向选中集 fan out）：text/line 直建；shape 在工厂 rect 缺省上覆盖 `shapeName`；image 要求 `src`，带自然尺寸时按 ≤60% 画布等比缩放居中（好于工厂 300×240 固定盒，避免 contain 留白）；dispatch 成功 `store.select([新id])` + `pushSelection()`（pill 即时切换为新元素类型控件）。`attachStore` 的 store 类型加 `select(ids: string[])`（Store 本有此方法）。
- dock（`packages/design-bento/src/product-session.ts`，构建期覆盖 vendor 同位文件的本仓库源文件）：三按钮弃用 `clickHidden`；新增 `addElement` helper（readonly 拒绝 + `commitPending` + `options.applyCommands`，与 `window.molly.applyCommands` 包装同语义，CSS `button.create` 置灰为第二层）。形状弹板不再镜像隐藏菜单，自渲染 5 项（矩形/椭圆/三角形/箭头→shapeName，直线→line），弹板 svg 补描边样式。图片按钮经新增的 `options.pickImageFile` 回调（boot.ts 从 `ui/dom/image.ts` 导入后注入；sha256 内容寻址 + `hostRegisterAsset` + 16 MiB/16 MP/PNG-JPEG-GIF 校验），`Image` 探针读自然尺寸后随命令上送。**product-session.ts 必须保持零 import**：`packages/components/tests/design-product-session.test.ts` 在仓库布局直接加载它，任何相对 vendor 的 import 只在拼装树里才存在（首版直接 import 即被该测试抓住），因此跨模块能力一律走 options 注入。
- 补丁再生成流程（首次记录）：`web-product-session.patch` 依赖序列中前两个补丁，不能手改 hunk——用 `git worktree` 按序应用前置补丁并 `git add -A` 提交基线（补丁会新建 `slides/src/a1a2/`，漏 add 会导致再生成补丁把既有文件当新文件），再应用本补丁、编辑、`git diff` 整体覆盖。`source-manifest.json` 哈希已更新。
- 主进程零改动：`applyDesignCommand`（`design-service.ts`）zod parse 后即转发，新动词自动放行。`apps/electron/src/main/services/AGENTS.md` 的 "selection property commands" 改为 "selection property and element-creation commands"。

## 验证证据

- `packages/shared/tests/design-selection-commands.test.ts`：新动词接受（text/shape+shapeName/image+src+自然尺寸）与拒绝（icon kind、http src、custom shapeName、image 缺 src）——7 测试绿。
- `packages/components/tests/design-product-session.test.ts` 2 测试绿（product-session 零 import 约束的回归看守）。
- `corepack pnpm --dir packages/design-bento build` 绿（补丁按序应用、slides tsc、vite），`apps/electron` 应用构建绿。
- 真实应用探测（2026-09-16，Playwright CDP 直连构建产物，验证画稿 6 元素）：首版 20/20；改为 `options.pickImageFile` 注入后全量重跑 19/20，唯一失败项是探针自身的竞态——探针手动 `setReadonly(true)` 后 300ms 内 shell 的访问闸门把画布可写态重新断言回来（readonly 归属 shell，手动覆盖必被冲掉），插入因而放行；隔离复测（设完立即点）守卫正确阻断。关键证据：文本插入（居中 200×64，占位 "Text"）并自动选中（`window.molly.selection()` 含新 id）；形状弹板 5 项渲染，三角形 `shapeName=triangle`；直线 `points=0,40 200,40`；图片经真实文件选择器拦截上送 40×30 PNG，`src` 为 `asset:<sha256>` 且 bounds 40×30（宽高比 1.333）；dock 撤销 ×4 回到 6 元素（一命令一步）；自动保存收敛后 revisionId 与插入前内容寻址相同——撤销实现字节级还原。文件级复核 `design.json`：6 元素、headline runs 样式、badge 220×140 全部未变。
- 截图：`/tmp/popup-cdp.png`（弹板 5 项，CDP 页面合成器）、`/tmp/insert-selected-pill.jpg`（插入三角形选中态 + 类型化 pill + composer 引用 chip）。

## 限制与未验证项

- 曲线/连接线/手绘/多边形不开放（交互复杂）；形状弹板仅 kernel 静态词表中 dock 暴露的 4 预设 + 直线。
- 插入默认样式由上游工厂决定（文本占位 "Text"、形状 `#E8442E` 填充、直线 `#1A1D24` 2px）；插入后是选中态而非文本编辑态（Lovart 双击进编辑）。
- icon/table/chart 工厂支持但 dock 无入口（词表未放行）；未来开放只需加词表与弹板项。
- verb→命令映射仍在 patch 内无单元测试设施，覆盖靠共享 schema 测试 + 真实探测（同 09-16 pill Note 的既有口径）。
- kimi-cu 原生窗口截图偶发不合成画布内 fixed 弹板层（dock 正常）；CDP 页面合成器截图与真实点击实测均证明弹板渲染与功能正常，判定为截图路径假象而非产品缺陷，未深究。
