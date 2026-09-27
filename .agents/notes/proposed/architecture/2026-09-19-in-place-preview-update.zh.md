# 原位预览更新的可行性与边界

Status: proposed
Translation: pending

## 摘要

用户询问在已消除可见闪烁后，直接采用原位文档更新并复用素材、元素是否存在问题。该方案可行，但复用 WebContents、复用素材与复用元素 DOM 是三个不同层级；现有 Bento 文档替换仍会重建画布 DOM，并带入撤销与 dirty 语义。建议先限定为只读预览中的常驻渲染器和按内容身份复用素材，保持完整快照原子发布；元素级复用需要独立处理文档级依赖和失败恢复。当前仅分析，尚无性能基准或运行时实现授权，不将预期收益写成测量结论。

## 本地证据

- [Bento Store](../../../../packages/design-bento/bento/slides/src/store.ts) 的 `replaceDoc` 会 checkpoint、清选区、设 dirty，并触发 current/doc 等通知；不能直接视为只读预览替换接口。
- [Canvas.render](../../../../packages/design-bento/bento/slides/src/editor/canvas.ts) 调用 `renderSlide` 后 `surface.replaceWith(next)`；复用页面并不自动复用元素节点。
- [Molly 组装适配](../../../../packages/design-bento/source-manifest.json) 同时接入 kernel、Bento bridge、素材 registry 与 product-session；仅改可见 Store 会使显示与 snapshot/保存不一致。
- [Electron surface](../../../../apps/electron/src/main/services/design-service.ts) 为每个视图创建隔离 session/origin，并将资源与快照绑定。常驻更新要显式管理内容身份、资源生命周期和迟到结果，不能按文件名判断图片未变。

## 主要风险与建议

1. 分步修改可见 DOM 时，图片或字体解码失败会留下混合新旧内容。应先完整校验、准备资源，再一次发布快照；失败保留旧画面。
2. 元素 ID 只标识对象，不证明外观未变。字体、尺寸、主题、层级、分组及引用依赖变化都可能要求重新渲染同一元素。
3. 只读 Agent 预览不能标 dirty、产生可保存的新稿或污染人工撤销。首阶段只复用独立预览实例，不将人工编辑器与 Agent 草稿合并成同一可变实例。
4. 素材按内容哈希复用，替换同一路径的字节必须更新；失去引用的资源和 URL 必须释放，否则长回合累积内存。
5. 用户缩放、窗口 resize、旧回合迟到及历史切换仍需保持现有身份和显示意图检查。常驻实例不会自动解决并发与取消问题。
6. 修改 vendored Bento 需要沿现有构建适配路径，不能直接改 pinned/submodule 源码；复杂元素复用会增加后续升级维护成本。

建议分开验收：常驻只读预览和素材缓存先行；若仍有明确 DOM 重建瓶颈，再做按稳定 ID 与依赖失效规则复用节点。正常路径收益至少测端到端更新延迟、长回合峰值/稳态内存；正确性覆盖同路径换图片、字体变化、增删/重排元素、无效草稿、快速连续更新和返回人工编辑器。

## 状态

[双视图交接修复](../../implemented/bug-fix/2026-09-19-live-canvas-handoff.zh.md)已获本次用户无闪烁验收。原位更新是潜在性能优化，尚未证明必须做；本次不改运行时代码，不启动付费 Agent，也不替代完整“复刻这个设计”验收。
