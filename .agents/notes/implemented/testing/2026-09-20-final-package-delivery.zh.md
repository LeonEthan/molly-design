# 最终安装包交付与使用说明（issue #50）

Status: implemented
Translation: pending

## 摘要

[#50](https://github.com/LeonEthan/molly-design/issues/50)
在干净 HEAD（`adfdc3e4`）构建最终 macOS arm64 本地安装包，显式禁用发布、签名身份
发现与公证，打包探针全部通过。从该 DMG 全新安装到独立目录后，复用 #46–#49 的隔离
合成数据完成验收：应用启动、含图片作品渲染、旧会话延续画布按作品 id 挂载（补上
#49 hybrid 验收留下的运行时缺口）、手工编辑自动保存、退出重开后修改保持、原生 PNG
导出。同时定位了 #49 记录的「devtools 异常」根因：新构建的 ad-hoc 签名触发钥匙串
授权弹窗，浏览器进程在弹窗未决期间阻塞，DevTools 端口接受连接但不应答——回应弹窗
即恢复，不是产品缺陷。README（中英）新增安装与故障说明，支持状态如实更新，六项
延期明确列出。本任务无产品代码改动、无新增测试（未发现新缺陷）、无付费调用。

## 交付物与身份

- 产物：`apps/electron/dist/issue-50/MollyDesign-0.1.0-arm64.dmg`，188,430,834 字节，
  SHA-256 `3440883daa29fcf180de73dbdce6d2d226485b1f6ab2c0423972c68856e8bbe6`。
- 源码基线：HEAD `adfdc3e431c3ffdaf9429626e1eaf6acbdc40240`；渲染器包内嵌
  `adfdc3e4`（`git rev-parse HEAD`，electron.vite.config.ts 注入），可在包内检索核对。
  构建时工作树仅有与本任务无关的未跟踪辅助脚本，无已跟踪文件改动。
- 引擎身份：包内 `resources/cli/harness/runtime-manifest.json` 记录 Pi 0.85.1、协议 1、
  212 个锁定依赖、13,751 个封装资源及 lockSha256/buildId（构建期输出一致：
  「Embedded Pi 0.85.1: 212 locked packages, 13751 resources」）。
- 打包命令：`pnpm run build` 后经 `scripts/package-electron.mjs`（强制
  `--publish never`）执行 `--mac -c.directories.output=dist/issue-50
  -c.mac.notarize=false`，并以 `CSC_IDENTITY_AUTO_DISCOVERY=false` 显式关闭签名身份
  发现；构建日志确认「skipped macOS application code signing」。仅 ad-hoc 签名
  （`codesign --verify --deep --strict` 通过，Signature=adhoc），未公证、未发布、
  未触碰 Sparkle 推送。
- 打包探针：Bento 资源字节校验、图片解码器（sharp 0.35.4 darwin-arm64）、内嵌 CLI
  启动与原生绑定（better-sqlite3 / node-pty）冒烟全部通过。

## 验收环境

- 安装：只读挂载上述 DMG，复制 `Molly.app` 到独立目录
  `/tmp/molly-issue50-installed.H793VL/`（不在 `/Applications`，不替换任何应用），
  卸载磁盘镜像后启动。
- 数据：将 #46–#49 使用的隔离数据 `/tmp/molly-issue46-install.6POuq9`（全部为合成
  夹具）整体复制到 `/tmp/molly-issue50-data/` 后使用，原目录保持不动；套接字未被
  复制，由新实例重建。启动参数与前几期相同：`MOLLY_DATA_DIR`、`MOLLY_E2E=1`、独立
  `MOLLY_E2E_LOCAL_CLI_HOST_PORT=17941`、`--user-data-dir`、
  `--remote-debugging-port=9223`。机器上另一真实安装实例全程未触碰。
- 凭据：首次启动的钥匙串弹窗选择「拒绝」——本验收不需要也不使用已存加密连接；
  拒绝后输入框如实回到「Select a connection and model」，无静默借用。
- 本任务没有任何模型或图片付费调用；#48/#49 的授权不延续到本任务。

## 验收证据（最终完整安装包）

1. **启动与会话数据**：窗口正常加载（日志 `main window finished load`），本地运行时
   与 Loro 数据面正常服务（daemon 日志心跳与 machine-rpc 记录），会话列表与历史
   完整呈现。
2. **含图片作品渲染**：打开 #47/#48 作品会话（`5f493c93-…`）→ Current artwork，
   画布渲染 V4：深蓝底、「一起创造」主标题、人工修改的「周日 15:30 · 创意工作坊」
   副标题、#48 薄荷绿编辑插图（`media/cc71a3a8…`）位置与描边保持。
3. **旧会话延续（作品 id 路由的运行时实证）**：打开延续目标会话
   `360172a7-…`，顶部横幅「This conversation continues the design from
   社区海报（旧会话合成·二）」与「Back to session」回链均在；打开 Current artwork
   后新画布目标以 `ws=4a7b3d1e-…`（**作品 id**，非会话 id）挂载并渲染
   「动手工作坊·第二期」。这补上 #49 如实披露的缺口——当时 hybrid 验收后的
   `artworkId` 可选化改动只有自动化测试、没有打包运行时证据。附件投递链路
   （`.molly/attachments` 共享常量）本次未在运行时重复演练，其覆盖来自
   harness-pi 回归测试与 #49 hybrid 旅程，如实说明。
4. **手工编辑与自动保存**：在延续作品画布双击标题进入文字编辑，改为
   「动手工作坊·第三期」，点击空白处提交；界面显示「已自动保存」，作品
   `design.json` 落盘新文本。（教训：Escape 会放弃编辑，点击空白处才提交——
   前两轮合成编辑被 Escape 回退，非产品缺陷。）
5. **退出重开持久化**：退出应用（日志出现一次退出竞态
   `design.attach: Design service is shutting down`，渲染器在退出中发起 attach，
   不影响数据）后重新启动，延续会话画布直接渲染「动手工作坊·第三期」。
6. **原生 PNG 导出**：延续作品导出 800×600 PNG，内容与画布一致。

## #49 devtools 异常的根因

#49 记录本机全新构建「`--remote-debugging-port` 接受 TCP 但 HTTP/WS 永不应答」，
干净 HEAD 同样复现，根因未定位。本次在同一机器的全新构建上复现后定位：新构建的
ad-hoc CDHash 触发 macOS 钥匙串授权弹窗（「Molly Safe Storage」），浏览器进程在
弹窗未决期间阻塞，DevTools 端点接受连接但不应答，界面「Reconnecting…」持续；
点击「拒绝」后日志立即出现 `keychain_password_mac.mm … userCanceledErr (-128)`，
CDP 同时恢复应答。#47 构建未遇此问题，因为用户已对该二进制点过「始终允许」；
#49 hybrid 使用同一 #47 壳，同样不触发。结论：这是 ad-hoc 本地构建的预期系统行为，
不是产品缺陷；#49 建议的跟进事项以此根因结案，README 故障说明已覆盖
（弹窗可能在窗口后面、弹窗未决期间自动化接口不响应）。

## 文档改动

- `README.md` / `README.zh-CN.md` 新增「Install the macOS package / 安装 macOS
  安装包」：DMG 安装、右键打开（不建议关闭 Gatekeeper 或移除隔离属性）、钥匙串
  弹窗三种选择的结果、新构建会再次询问。
- 新增「Troubleshooting / 故障说明」：首次启动无响应（钥匙串弹窗未决）、连接无法
  读取（重新填写）、图片调用超时结果未知（保留回执、不自动重试、明示重试可能再次
  计费）、画布只读/保存冲突、回执与日志位置。
- 「Release status and support limits / 发布状态与支持限制」：Kimi
  `k3-256k/high` 行更新为安装包上已验证的范围（真实文本回合、设计创建/修改、取消、
  旧会话延续、重启持久化），仍不宣称完整厂商覆盖；图片服务行更新为同一作品内的
  真实生成/编辑验证；macOS arm64 从「安装包旅程仍需验收」更新为「已从 DMG 安装副本
  完成验证」；六项延期（Google 及其他 SDK 升级、插件斜杠命令体系、复杂图片组合、
  跨平台专项验收、长期性能测试、内置 Pi 升级/卸载演练）明确列出。

## 范围与如实披露

- 复用 #46–#49 证据，仅重验受影响部分：hybrid 之后的两处行为保持型改动中，
  `artworkId` 路由已在本包运行时实证；`.molly/attachments` 共享常量值未变，
  运行时未重复演练（覆盖：harness-pi 回归 + #49 hybrid 旅程）。
- 本任务无付费调用；钥匙串选择「拒绝」使已存连接在本轮不可读，连接编辑界面未在
  本包重复验证（#46 证据仍适用）。
- 方法学记录：画布是独立 WebContentsView（`molly-design://canvas-…/editor.html`），
  Playwright 对主页面截图不包含它（曾误判为空白画布）；OS 级 `screencapture` 与
  CDP 目标级读取才是有效观察手段。
- 首次启动曾被钥匙串弹窗阻塞约两分钟，期间渲染器报过一次
  `repo meta room initial sync` 超时；回应弹窗后全部恢复，未再复现。
- 界面辅助脚本 `e2e/scripts/issue50-*.mjs` 保留为本机未跟踪文件，未提交会话
  transcript、密钥或用户素材；`apps/electron/dist/issue-50/` 产物被 .gitignore
  排除，仓库只记录其哈希。
- 无未解决的核心功能、安全或数据损坏问题。已知非阻断项：退出时序的
  `design.attach` 关闭竞态日志；kimi 以外的服务组合仍处未验证状态（见 README 表）。

## 检查结果

- `pnpm run build`（含 typecheck）与完整 macOS 打包通过；打包探针见上。
- `pnpm format`、`pnpm lint`（oxlint type-aware 0 错误）、`pnpm run docs check`、
  `lint:i18n`、`check:code-collab-imports`、`check:platform-boundaries`、
  `check:public-boundary` 均通过。
- `pnpm check` 并非整体全绿：typecheck 与 lint 通过后，`test:ci` 在
  `packages/design-authoring` 的 `live-fingerprints` git 历史断言处中断——该断言
  要求最近 30 条提交含 PPTD/Folio 谱系，干净 HEAD 同样失败（#46 起即有），属与本
  任务无关的既有失败，不删除、不改写，仅列明。
- 被中断的其余套件随后单独执行，全部通过：shared 1314、components 414 文件
  3186、apps/cli 3061 通过 3 跳过、harness-pi 243、platform 17、loro-streams-rpc
  112 通过 3 跳过、cli-supervisor 49、code-review-helper 34、acp-extension-core 3、
  acp-extension-grok 33、acp-extension-dsh 11、ignore 23、turn-diff-store 4、
  design-authoring 其余 137，electron 主进程 173。
- Standards / Spec 双轴审查：Standards 无阻断项；Spec 指出的三处证据归属表述
  （Kimi 行、图片行、验收范围句）已修正为本期交付包与历史安装构建分别如实表述。
