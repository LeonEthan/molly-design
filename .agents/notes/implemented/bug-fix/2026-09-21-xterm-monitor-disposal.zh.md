# xterm 终端缩放监视器释放

Status: implemented
Translation: pending

## 摘要

修复会话画布释放后，Work Scout 的 renderer 已稳定，但每轮仍多出约两个事件监听器。原生最小测试证明 xterm 5.5.0 的公开 `dispose()` 没有释放缩放监视器的窗口 resize 与媒体查询监听器；旧的 33 轮快照恰好保留了 33 个此类监视器。采用标准 pnpm 补丁回补上游的注册释放修复，同时保持 xterm 和 fit 插件版本，避免连带改变终端滚动及键盘行为。修复后的原生最小测试每轮两类监听器均归零；Work 三十轮复验监听器恒定，但仍存在未定位的内存增长候选。

## 复现与根因

这是 [#45](https://github.com/LeonEthan/molly-design/issues/45) 中独立于[保留画布](2026-09-21-deleted-session-canvas-resources.zh.md)的第二条路径。

- 仅含画布修复的 Work 轮次 `2026-09-21T14-05-33-626Z-e530369e`：四轮操作通过，renderer 恒为 1，总进程恒为 9，DOM 节点恒为 787；监听器依次 412、414、416、427。末轮额外波动未据此归因。短轮次 `suspectedTrends` 为空不证明没有残留。
- 旧 CI 轮次 `35601811935` 的 Work renderer heap 有 33 个具备 `_resolutionMediaMatchList` 和 `_windowResizeListener` 的监视器对象，数量与预热 3 + 测量 30 对应；已不存在持有 `_screenDprMonitor` 字段的终端服务实例。
- 当前依赖的 `CoreBrowserService` 直接创建 `new ScreenDprMonitor`，没有注册到 Disposable。监视器本身已经能正确移除两类监听，但所属服务销毁时从未调用其 dispose。
- 隔离 Electron blank window 加载实际安装的 xterm 浏览器 bundle，连续三次公开 `open` → `dispose`。通过事件注册/移除账目检查仍存活的窗口和媒体查询监听，不依赖 GC、睡眠或内存阈值。原版本 resize/change 各残留 1、2、3 个，断言失败；补丁版本各为 0、0、0，断言通过。

## 决定与替代方案

[上游 6.0.0 源码](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/services/CoreBrowserService.ts)已将监视器注册到释放链。[发行说明](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0)同时列出 viewport/滚动条及 Alt 键等行为变化，因此本次不升级大版本。也不在 React 组件里访问 xterm 私有字段或拦截产品全局事件来代替依赖修复。

`patches/@xterm__xterm@5.5.0.patch` 同步修改包内 TypeScript 源码及实际消费的 `lib/xterm.js`，仅将监视器构造包进 `this.register(...)`。发布包的 JS 是单行压缩文件，因此补丁文件约 566 KiB，语义差异仍只有这一处注册；没有修改终端选项、CSS、协议或插件版本。`pnpm-workspace.yaml` 是补丁登记的唯一来源，lock 固定补丁摘要；安装器顺带重算的无关 peer 版本变化已撤回，冻结安装通过。

## 验证与限制

- 持久回归：`pnpm --filter @molly/e2e terminal:resources`。使用已有隔离 Electron harness 和独立隐藏窗口，不创建模型连接、不使用用户凭据；测量钩子仅存在于该窗口，退出时销毁。
- 原依赖下最小探针失败，补丁安装后及冻结安装后各通过一次；`pnpm e2e:check`、`pnpm check`、`pnpm format`、`pnpm e2e:build`、`pnpm run docs check`、`git diff --check` 均通过。构建仅有既有 chunk/外部化警告，文档仅有既有规则文件大小警告。
- 用户终端执行 `pnpm e2e:scout --journey work --iterations 30 --warmup 3 --checkpoint-every 5`，轮次 `2026-09-21T14-19-40-469Z-7522c083` 操作全部通过，耗时 145647 ms。第 5、10、15、20、25、30 轮 post-GC 检查点监听器均为 410、renderer 均为 1、总进程均为 9、DOM 节点均为 787，未再复现这两类逐轮资源累积。
- 同次长测仍报告三项 post-GC 增长候选：主进程 privateBytes 从 174572544 到 286623744（增加约 106.86 MiB）；residentSetBytes 从 346161152 到 446644224（增加约 95.83 MiB）；renderer jsHeapUsedBytes 从 66574528 到 70989936（增加约 4.21 MiB）。这些是第 5 至第 30 轮检查点的差值，不是整次启动以来的增量；主进程两项指标不能相加当作独立泄漏量。
- 最小测试验证实际 xterm bundle 的监听器释放，Work 长测补充真实旅程证据，但均不证明所有内存已释放。上述内存趋势根因尚未定位，不能仅凭趋势区分持续泄漏与缓存/分配器保留；#45 保持未关闭。

后续定位：主进程堆中发现 33 份被已关闭画布的 Session 回调保留的 HTML Buffer，独立修复与证据见 [Session 回调释放](2026-09-21-design-session-callback-retention.zh.md)。这一发现没有自动解释 renderer 的 JS 堆增长，也不改写本次长测结果。
