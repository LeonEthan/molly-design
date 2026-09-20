# 安装包可编辑作品旅程与只读双击修复

Status: implemented
Translation: pending

## 摘要

[#47](https://github.com/LeonEthan/molly-design/issues/47) 沿用 #46 的安装副本和同一合成作品，
验证 Kimi 创作、社区问答、人工改字后的续改及版本保存。实际操作发现只读预览仍可双击
进入文字编辑，虽然保存保护没有让临时修改覆盖当前稿，画面却能出现未保存的文字变化。
修复在已有通用输入拦截中补上双击事件，不改变 BentoDoc、设计事务或 Agent 生命周期；
复用现有测试入口，仅补一条只读/解锁回归。图片步骤留给 #48，人工视觉判断仍由用户完成。

## 缺陷与最小修复

接续[安装与 Kimi 连接验收](2026-09-20-packaged-helper-startup.zh.md)和
[内置引擎实施记录](../../proposed/architecture/2026-09-19-embedded-pi-harness-implementation.zh.md)。
`product-session.ts` 已拦截 beforeinput、粘贴、剪切、拖放和编辑快捷键，
但 Bento 的 stage 在 dblclick 时直接进入文字/表格编辑，早于上述输入事件。
原生只读创作预览可复现该入口；临时文字变化没有进入当前稿或创作 YAML，正式提交后被正确结果替换。

沿用同一 capture 拦截增加 dblclick，保持正常编辑解锁、缩放和平移路径。
不修改 pinned vendor/submodule 字节，不引入运行时补丁、额外状态或创作流程要求。
现有 `design-product-session.test.ts` 通过公开只读接口和 DOM 双击检查编辑入口：
修复前出现 contentEditable=true 而失败；修复后默认只读、解锁可编辑、再次锁定均通过。

## 同一作品的证据

- #46 安装包中明确选择 Kimi `k3-256k/high`，创作 800×600 深蓝与黄色工作坊海报。
  当前稿含 3 个文字和 9 个形状元素，不含图片，也没有调用图片服务。
- 执行期间观察到两份有效画稿预览；首份可见时当前 `design.json` 的 SHA-256 仍为
  `458d5f34f77ba511ee1a93cefa904de34ecd7110cea79faa8fb15ffbe96371e9`（空白稿），
  本轮提交回执尚不存在。预览没有自行提交。
- 预装 pi-ask-question 在 Molly 显示两个配色选项；选择保留黄色并提交后模型收到答案，
  自然结束后界面显示已保存到当前作品并恢复编辑，保存为 V1。
- 人工将时间改为周日 15:30，自动保存后当前投影包含新时间，旧 Agent 草稿仍保留旧时间。
  新回合实际读取当前投影，只改主标题，正式结果保留人工时间，保存为 V2。
- 原生 PNG 导出得到 800×600 图片。首次自动化改字替换了内联样式，之后通过已有属性栏
  恢复副标题字号、粗体和黄色，保存为 V3；没有把该驱动操作当作 Agent 丢失人工内容。
- 模型曾使用错误相对路径运行可选校验脚本，随后自行改正；没有应用级自动修复或重跑。

## 修复构建与验证

源码基线 `4c56fd9739e2c357281b3354f7f7ff6663d05554` 加本记录的只读修复。
`pnpm build` 和完整 macOS arm64 DMG 打包通过，Bento、图片解码、Pi、CLI 和原生绑定探针通过。
产物 `apps/electron/dist/issue-47/MollyDesign-0.1.0-arm64.dmg` 的 SHA-256 为
`b0b354e4bfbdee08f78e8a573c2e6a9327fb2eeba312c875b9bd9f3d4fdeea36`。
包内 source 字段记录上述基线，不能把它误作无工作树差异的发布提交。
本地包未公开发布，未完成 Developer ID 签名或公证。

修复包已从只读挂载的 DMG 复制到独立安装目录，严格代码签名校验通过；旧副本正常退出后，
新副本沿用本任务隔离数据启动，日志确认窗口完成加载。但桌面控制接口持续超时，重置接口后仍不能
取得窗口状态，已请用户将窗口切到前台或解锁。修复后原生只读、重开内容和取消复验仍待完成，
不能把进程启动等同于这些验收通过，亦不能据此关闭 #47。

全仓最终类型和 lint 通过；`pnpm check` 仍被既有最近 30 条 Git 标题的 PPTD/Folio 断言阻断，未改写或删除它。
继续执行的 CLI 3061、Components 3184、Harness 242、Shared 1314、Electron 173 项通过；
CLI 检查移除宿主继承的 MOLLY_PLATFORM/LODY_PLATFORM。新增回归所在文件 5 项及组件类型检查通过。
`pnpm format`、公共边界和平台静态检查通过；Standards / Spec 双轴审查均无 P0/P1，
Spec 审查保留上述安装包验收缺口。没有提交实际会话 transcript、密钥或用户素材。
