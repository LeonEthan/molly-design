# 关闭画布后释放 Session 回调持有的资源

Status: implemented
Translation: pending
PR: [#54](../process/2026-09-24-github-repository-rebuild.md#pr-54)

## 摘要

修复画布进程与 xterm 监听器释放后，Work 长测主进程私有内存仍增加约 107 MiB。最小原生复现与堆快照确认：关闭画布只注销协议处理器，三个仍由 Electron 持有的请求/权限回调通过共享闭包保留每份约 3.88 MB 的编辑器 HTML 和画稿。关闭时统一将这些回调替换为独立作用域的拒绝处理器，保留隔离与禁止网络/权限的边界；不共享 Session、不清空用户数据。原生回归与完整 Work 长测均确认 HTML Buffer 残留归零，主进程私有内存增量降至约 18 MiB；剩余原生分区累积与 renderer 代码增长单独跟进，不能宣布全部内存问题解决。

## 证据与责任

- 接续 [#45](https://github.com/LeonEthan/molly-design/issues/45)、[会话画布释放](2026-09-21-deleted-session-canvas-resources.zh.md)和 [xterm 监视器释放](2026-09-21-xterm-monitor-disposal.zh.md)。Work 轮次 `2026-09-21T14-19-40-469Z-7522c083` 的主进程堆保留了 33 份大小均为 3879591 字节的 `system / JSArrayBufferData`，与预热 3 + 测量 30 一致。
- 独立临时目录中的真实 `design.create` → `design.attach` → `design.close`，无需模型和钥匙串。八次创建不同画稿、或反复重开同一画稿，都复现逐轮保留；同稿八次约由 126241 KiB 增至 157201 KiB 私有内存。
- 反向引用为 backing store ← ArrayBuffer ← Buffer ← `shell` 所在 Context ← 三个匿名回调 ← native Global handles。画布 WebContents 已关闭，不能只靠进程数量证明资源释放。
- 在仅用于诊断的隔离宿主中，关闭后把请求和权限回调换为无画稿引用的拒绝处理器，八次结束后 HTML backing store 数由 8 降为 0；主进程私有内存首末差约 3.6 MiB，仍有原生开销。该对照不改产品凭据、网络许可或个人配置。

## 修复与取舍

`design-session-disposal.ts` 统一注销 `molly-design` 协议并替换三个回调。替换函数在独立作用域创建，不能捕获 `surface` 的 HTML、payload 或资源。普通编辑器、只读预览和导出沿用已有 surface disposal；固定样稿窗口的相同遗漏一起修复。未改变保存确认、编辑状态、普通隐藏保留、作品文件或会话隔离。

Electron [WebRequest 文档](https://www.electronjs.org/docs/latest/api/web-request)说明设置新回调会替换原回调，也可用 null 取消订阅。本次采用无状态拒绝回调而不是恢复默认行为：尚在退休过程中的 Session 继续拒绝全部请求和权限。没有通过共享分区、Session 池或缓存整份 HTML 掩盖生命周期缺口。

## 验证与限制

- `pnpm --filter @molly/e2e canvas:resources` 使用真实构建与三次同稿 attach/close，堆快照断言已关闭画布的 HTML Buffer backing store 为零；旧构建实测失败（3 ≠ 0）。只读快照诊断保留在本机临时目录，不提交仓库。
- `design-session-disposal.test.mjs` 两项确定性测试通过：三个原回调均被替换；原画布 URL、外部 URL、data/blob 和权限均拒绝；重复关闭不影响存活的另一个 Session。它们不使用时间或内存阈值。
- 修复后及完整 `pnpm e2e:build` 重建后原生探针各通过一次，均为零份 HTML Buffer；最终本地证据目录 `molly-canvas-resources-ue26Dl`。xterm 原生三轮仍无 resize/change 监听器残留；Electron 包 165 项测试和会话删除钩子 52 项测试通过。
- `pnpm check`、`pnpm e2e:check`、`pnpm format`、`pnpm install --frozen-lockfile`、`pnpm run docs check`、`git diff --check` 通过。全仓检查的沙箱运行被本地 IPC socket 的 EPERM 阻塞，正常权限重跑通过，平台/公共边界检查分别扫描 1504/4267 个文件；构建仅有既有 chunk/外部化警告，文档仅有既有规则文件大小警告。
- 用户终端最终构建 Work 三十轮（预热 3、每 5 轮检查）`2026-09-21T14-42-07-557Z-e304f4b2` 全部操作通过，耗时 168281 ms。最终主堆的 HTML backing store 从修复前 33 份降为 0。六个检查点 renderer 均为 1、总进程均为 9、DOM 节点均为 787；监听器前五个为 410，末个为 419，末次波动尚未归因。
- 第 5 至第 30 轮主进程私有内存增量由上一轮 112051200 字节降为 18367488 字节（约 106.86 → 17.52 MiB）；主进程 RSS 增加 24788992 字节（约 23.64 MiB），renderer JS 堆增加 4845984 字节（约 4.62 MiB），三项仍被标为候选。不同运行的差值不是每字节严格归因，但零份 HTML 与最小复现共同证明这条泄漏已消除。
- 第二次标准 Work 三十轮 `2026-09-21T14-48-12-949Z-ef2e4c5d` 全部操作通过，主进程私有内存增加 19268608 字节（18.38 MiB）；renderer JS 堆增加约 3.99 MiB，略低于候选阈值不是修复证明。renderer 数量与监听器六点分别恒为 1 和 410，未改变 Scout 阈值。
- 增加可选 `--heap-baseline`，首个测量检查点捕获基线，并保证末尾快照。用户运行的 `2026-09-21T14-54-13-947Z-ec243b4b` 完成 30 轮。renderer JS 堆检查点增量 4293652 字节（4.10 MiB）；首尾快照按类型聚合的 `self_size` 差值中，`code` 增加 3833284 字节（3.66 MiB），普通 `object` 仅增加 74752 字节（73 KiB）。代码类还包括字节码、反馈与编译结构，不能直接称作业务画稿泄漏，也尚未证明长时间后达到平台。元数据与导航对象有小幅增加，未据此更改持久数据保留语义。
- 基线与最终 renderer 快照来自不同 CDP 会话，不能以节点 id 识别同一个对象；以上使用聚合类型、名称和属性形状比较。快照采集明显扰动 RSS，诊断轮的 RSS 跳变不能拿来与无基线快照的标准轮作性能验收比较。
- 诊断轮最终主堆仍为零份 HTML Buffer；主堆首尾新增 25 个原生 `Electron / Session`，恰对应第 5 至第 30 轮。后续源码与无凭据对照确认原生分区终身持有，见[隔离分区回收](2026-09-21-design-session-reuse.zh.md)。这与本次已修复的回调保留是两条不同责任链；后续回收机制于 2026-09-22 获确认并实施，本记录保留此前只替换回调、不复用分区的修复边界。
- 放开命令审批后自动化 Work 短测仍在 `modelConnections.save` 报 `credential_storage_unavailable`（轮次 `2026-09-21T15-01-35-833Z-dbcb0dbc`，尚无检查点）。没有关闭加密或绕过 vault；原生无模型诊断可由自动化正常执行，完整旅程仍受宿主 Keychain 环境限制。#45 保持开放。
