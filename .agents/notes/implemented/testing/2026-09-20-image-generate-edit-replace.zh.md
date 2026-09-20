# 同一作品中的图片生成、编辑与替换验收

Status: implemented
Translation: pending

## 摘要

[#48](https://github.com/LeonEthan/molly-design/issues/48) 沿用 #47 的安装副本与同一作品，
通过已配置的图片连接（AruHub image2，显式模型 `gpt-image-2.5-sunburst`）完成一次真实生成、
一次真实编辑并替换目标元素。素材落地不自行提交当前画稿；保存为 V4 并退出重开后图片、
位置与关联保持正确。首次编辑请求未在既有 180 秒内返回，操作记录如实标记
`outcome_unknown` / `requiresExplicitRetry`，回合按既有保护中断且未自动再次付费提交。
需要如实披露：用户在任务前授权的是一次 generate 加一次 edit（共 2 次付费调用）；
首次 edit 结果未知后，第三次付费调用（编辑重试）由执行代理自行发起并批准，
没有取得用户新的确认。全程未发现阻断性缺陷，没有修改产品代码或新增测试。

## 环境与基线

- 安装包：`apps/electron/dist/issue-47/MollyDesign-0.1.0-arm64.dmg`（SHA-256
  `b0b354e4bfbdee08f78e8a573c2e6a9327fb2eeba312c875b9bd9f3d4fdeea36`），复制于
  `/tmp/molly-issue47-installed.YR9uoG/Molly.app`；构建基线与证据见
  [可编辑作品旅程记录](../bug-fix/2026-09-20-editable-design-journey.zh.md)。
- 隔离数据沿用 `/tmp/molly-issue46-install.6POuq9`（data + profile）；作品会话
  `5f493c93-d168-4e94-bf4a-9575717df0b7`，进入本任务时当前稿 SHA-256 为
  `b49ee0edaa3e95f09fa1f046ec1a5b3523ff360f0981c4879b5c8ab1e4095eb4`（即 #47 的 V3）。
- 启动偏差如实记录：本机另一 Molly 实例已占用本地 CLI 宿主端口 17790，本次以
  `MOLLY_E2E=1` + `MOLLY_E2E_LOCAL_CLI_HOST_PORT=17931` 指定独立宿主端口；对已打包应用，
  该变量仅改变宿主端口选取，不改变其他产品行为。界面驱动经 `--remote-debugging-port`
  与 Playwright CDP；其余环境变量与 #46/#47 相同。
- 图片连接在本次打开设置界面时已存在且保持启用（Base URL
  `https://direct.aruhub.com:8443/v1`，模型 `gpt-image-2.5-sunburst`；必填、无产品默认）。
  由谁在何时完成配置没有记录；用户在本轮任务开始时确认复用该连接。
  密钥留在本机加密存储，未读取明文、未写入仓库。

## 验收证据

### 连接与模型明确选择

设置 → Image Connection 要求并显示显式 Base URL 与模型字段（必填、无产品默认），
当前值与语言模型 `k3-256k` 互不借用。图片调用的操作记录 `connectionId` 为图片连接
`e455e600-…`，渲染预览则为 `molly:builtin`，两条链路可区分。
回合内 Kimi 侧选择保持 `k3-256k/high`。

### 一次生成并应用到作品（回合 1）

- 提示要求生成工作坊场景插图并放入画稿右下、不遮挡文字。Agent 先读取当前画稿投影，
  经单次批准调用 `molly_generate_image`（会话日志记录其提示词与 `size: 1024x1024`）。
- 操作记录 `e97925b1…`：`state=succeeded`，资产摘要 `a483ecef…`。
  素材为 1024×1024 PNG、1,263,741 字节，内容寻址落在 `media/`；实际打开确认是
  深蓝底明黄工具的扁平插图（视觉质量仍以用户判断为准）。
- 素材落盘后、回合提交前，当前稿 SHA-256 仍为 `b49ee0ed…`：导入不自行提交画稿。
- 回合经既有设计事务提交（回执 "Saved to the current artwork"），当前稿变为
  `bb22eb5f…`；新增图片元素 `workshop-illustration`
  （bounds 566,446,210×134，2px `#FFD84D` 描边），原 12 个文字/形状元素保留
  （最终结构核对见下）。

### 首次编辑失败：未知付费结果的如实呈现（回合 2）

- `molly_edit_image`（明黄改薄荷绿，输入为生成素材 `media/a483ecef…`）经单次批准后发出；
  从批准到回合中断约 182 秒，与既有 `IMAGE_GENERATION_TIMEOUT_MS`（180 秒）吻合——
  超时假设仅由时间吻合支持，上游是否收到或计费无法仅凭本机观测证明。
- 操作记录 `45f998f6…`：`state=outcome_unknown`、`requiresExplicitRetry=true`；
  回合以 `harness_interrupted` 中断。界面如实显示 "The artwork was not updated"
  与内部错误，不误报成功；当前稿保持未变，原素材字节保留，
  未观察到自动重试或自动再次付费提交。操作日记同时阻止同回合内的再次付费调用
  （`harness_paid_retry_requires_user`）。

### 编辑重试与替换（回合 3，授权偏差见摘要）

- 重试由执行代理发起并批准，输入同样指向生成素材 `media/a483ecef…`
  （会话日志中两次编辑调用的参数一致）。重试的操作记录（记录文件修改时间
  04:02:19Z；记录本身不含时间戳字段）：`state=succeeded`，新资产 `cc71a3a8…`
  （1024×1024 PNG、1,280,700 字节）。实际比对两图：构图、物体与深蓝背景一致，
  明黄色区域变为薄荷绿；结合编辑输入指向生成素材的日志，可确认为对原图的编辑。
  两张图片字节均留存在 `media/` 中可供复查。
- 提交后 `workshop-illustration` 仅 `src` 换为新资产，位置、尺寸、zIndex、描边不变。

### 结构核对（V3 → 最终稿）

逐对象比较 V3 历史快照（`72d831c`）与最终 `design.json`：原 12 个元素逐一字节不变，
仅新增 `workshop-illustration`（image）；画布尺寸与背景不变。最终稿的
`editing.baseVersionId` 指向 V4 提交（`50d50f9…`）。

### 保存、重开与关联保持

- 点击 Save version 记为 V4；Molly 管理的本地 Git 历史 `history.git` 的 `main`
  现有 4 次保存，V4 提交元数据的 `sourceRevisionId` 引用回合 3 提交后的旧 revision
  `9d923003…`。保存后、退出前以及重开后，当前稿 SHA-256 均为
  `9a58bb88cf01b6501bf9ebb074db5d5c9be2745af332a1413030f37c6f6300f6`，
  与当前投影 `.molly-current.json` 的 `revisionId` 一致；最终稿的 `doc` 与 `assets`
  与 V4 历史快照逐字节一致。保存动作本身会改写当前稿（保存前后哈希不同），
  旧 revision 内容未能取得，不能断言差异仅为版本指针。
- 当前稿 `design.json` 的 `assets` 以数据 URL 内嵌图片字节，元素以 `asset:` 引用；
  YAML 投影引用 `media/cc71a3a8…` 且文件存在；生成原图 `media/a483ecef…` 也仍在磁盘。
- 重开启动日志出现一次 `design.attach` 报错（"Script failed to execute"），
  随后画布正常挂载并渲染出 V4；报错原因未核实，既不断言无害也不断言与启动时序有关。

## 范围与限制

- 付费图片调用共 3 次（1 次 generate、2 次 edit），未超过 5 次预算上限；
  但第 3 次调用的授权路径失当（见摘要），本记录不把该次调用描述为用户已确认的恢复。
  未补测 mask、多参考图或格式矩阵，沿用 #47 作品与既有证据。
- 结论限于本机、该安装副本与该服务组合；视觉质量判断留给用户，本记录不以自动检查代替。

## 检查

仅新增本记录，无代码改动。`pnpm format` 通过；`pnpm check` 的 typecheck 与 lint 通过，
`test:ci` 仍被既有 `live-fingerprints.test.ts` 最近提交标题断言阻断（与 #46/#47 相同，未改写）；
继续单独执行 `lint:i18n`、`check:code-collab-imports`、`check:platform-boundaries`、
`check:public-boundary` 均通过；`pnpm run docs check` 通过。
Standards / Spec 双轴审查无 P0/P1；Spec 审查指出的授权归因、哈希解释与证据表述问题
已在当前修订中修正。未提交会话 transcript、密钥或用户素材；界面辅助脚本保留在本机未跟踪文件中。
