# 旧设计会话延续验收（issue #49）

Status: implemented
Translation: pending

## 摘要

[#49](https://github.com/LeonEthan/molly-design/issues/49)
在隔离的打包应用环境中真实走通「旧会话/旧 Role 转入内置 Pi」旅程：旧
registry/codex 会话经会话菜单显式延续为同一作品的独立 Molly 会话，预览清单如实
列出历史文本节选、被省略的非文本工具记录与本地附件候选；确认后用户显式选择 Kimi
`k3-256k/high`，一次真实文本编辑回合正常结算并把标题改动保存到同一作品，延续
会话的画布按作品 id 正确挂载并渲染更新后的画稿。旧 Role 经设置页显式迁移到
Molly 内置引擎后，以其创建的会话进入 builtin/molly 运行时并正常结算。

**验收范围（2026-09-20 收窄）**：用户将 #49 收窄为「不要求保留历史旧数据，只要
新的内置 Pi 可以正常使用」。本文记录的旧数据保留证据（V1 历史提交、源会话 meta、
附件 blob、未迁移 Role 均保持原样）因此是顺带验证的加分项，而非验收门槛；收窄后
的验收核心——内置 Pi 能真实完成设计与会话回合——由下文两条旅程的真实证据覆盖。

旅程暴露并修复了两个真实缺陷（均有回归测试）：

1. **附件根目录品牌漂移**（阻断级）：`@molly/harness-pi` 的 ACP 适配器把
   `resource_link` 附件的包含性校验根目录硬编码为改名前的 `.lody/attachments`，而
   CLI 产物侧早已写入 `.molly/attachments`。内置 Pi 下任何携带文件附件的提示都会在
   `realpath` 处 ENOENT 失败。修复：新增唯一来源常量
   `SESSION_ATTACHMENTS_DIR_RELATIVE`（放在零依赖的 `session-paths.ts`，经
   `session-file.ts` 与 `embedded-harness.ts` 转出），两侧共用。
2. **画布把 sessionId 当 artworkId**：`DesignCanvas` 的所有设计通道调用（attach、
   versions、state、save/restore/export、选择、store 同步、事件过滤）都传 sessionId，
   而设计文档以作品 id 为键。普通会话二者相等所以从未暴露；延续目标会话的
   `design.artworkId` 指向源会话作品，打开画布即 ENOENT。修复：组件新增可选
   `artworkId` 属性（缺省回退 sessionId），作品级调用改用作品 id，会话级读取
   （`useSessionDoc`、`ownerSessionId`）与原生视图键（host id）保持会话键。

## 环境与基线

- 最终验收用 hybrid 安装包（原因见「如实披露」）：#47 打包壳
  `/tmp/molly-47-fresh/Molly.app`（devtools 通道正常）+ 本次修复树构建的 renderer
  产物（含缺陷 2 修复）+ 修复后的 harness 产物（含缺陷 1 修复）；CLI 主包与 shared
  源码在本次改动中行为等价（常量值不变）。
- 中途诊断阶段沿用 #47 安装副本 `/tmp/molly-issue47-installed.YR9uoG/Molly.app` 并
  热替换 harness 产物做定向验证。
- 隔离数据沿用 `/tmp/molly-issue46-install.6POuq9`（data + profile），启动方式与
  #46–#48 相同（`MOLLY_DATA_DIR`、`MOLLY_E2E=1`、独立
  `MOLLY_E2E_LOCAL_CLI_HOST_PORT`、`--user-data-dir`、`--remote-debugging-port` +
  Playwright CDP）。机器上另一真实安装实例全程未触碰。
- 合成旧数据经仓库自身持久化 API 写入（`LoroDocumentManager`、
  `SessionDocument.initOffline`、`upsertMachineAgentConfig`、`designOperation`、
  `writeWorkspaceAgentRoleToFlock`），脚本 `e2e/scripts/issue49-seed.mts`（可用
  `ISSUE49_*` 环境变量参数化 id/标题/角色名）。两组夹具：
  - 夹具一（诊断轮）：旧会话/作品 `3f9a2c1e-…`、旧 Role「Legacy Poster Reviewer」、
    已退役配置 `3f9a2c2e-…`。
  - 夹具二（最终验收）：旧会话/作品 `4a7b3d1e-…-50`（标题 社区海报（旧会话合成·二））、
    旧 Role `4a7b3d3e-…-50`「Legacy Poster Reviewer B」、已退役配置 `4a7b3d2e-…-50`。
    每个旧会话历史含 2 个用户回合（其一携带本地 PNG 文件引用）与 2 个各带 1 条
    `tool_call` 记录的助手回合；作品 800×600 深蓝海报，V1 已存入 history.git。
- 模型调用授权：用户在任务开始前明确授权本任务使用 Kimi 纯文本调用（无图片付费
  调用）。

## 验收证据（诊断轮，#47 安装副本 + 热替换 harness）

- 旧会话可直接打开：历史用户/助手文本可读、附件芯片 `palette-reference.png` 渲染、
  「Current artwork」画布打开并正确渲染合成海报。
- 会话菜单「Continue this design with Molly」对话框文案如实：旧会话/草稿/素材/版本
  保留在原处，动作不发送模型请求。「Preview migration」显示两轮历史文本节选、
  `Omitted: 0 turns, 2 non-text items, 0 attachments`（2 条工具记录不进入新引擎）、
  附件 `palette-reference.png — available locally; rechecked on first send`。
- 「Confirm and open Molly conversation」打开目标会话
  `4c212336-…`（`designContinuationTargetId` 派生的确定性 v5 UUID）：顶部横幅
  「This conversation continues the design from 社区海报（旧会话合成）」+「Back to
  session」回链；模型选择保持空，必须显式选择（无默认借用）。
- **缺陷 1 现场**：首轮提示立即失败
  `design_turn_failed: … realpath '…/chats/4c212336-…/.lody/attachments'`（ENOENT）。
  修复后同一回合结算成功：「Saved to the current artwork.」，作品当前稿标题变为
  「动手工作坊·第二期」，其余元素不变；history.git 中 V1 内容保持原标题可读。
  目标会话获得自身新的原生会话标识（未继承旧引擎 `acpSessionId`）。
- **缺陷 2 现场**：目标会话打开「Current artwork」报
  `design.attach … ENOENT …/chats/4c212336-…/design.json`（目标会话目录当然没有
  作品草稿，作品归属源会话目录）。修复后由最终验收覆盖。

### 如实披露（诊断轮）

- 诊断轮的首个成功回合发生在对目标会话历史做过夹具级清理之后（移除失败回合对，
  以重新触发首轮附件交付）；该轮证据仅作冒烟信号，不作最终验收依据。
- 诊断轮的权限批准由轮询脚本批量点击「Allow once」（7 次），未逐一审查；最终验收
  改为逐一审查后批准。

## 修复与回归测试

- `packages/shared/src/session-paths.ts`（新文件）：零依赖模块，唯一定义
  `SESSION_ATTACHMENTS_DIR_RELATIVE`（'.molly/attachments'）。必须零依赖：
  `embedded-harness.ts` 会被 Electron 主进程的裸 node 测试（`--experimental-strip-types`）
  直接加载，该环境不认扩展名省略的相对导入，此前把常量放在 `session-file.ts` 并经
  embedded-harness 转出会把整条 session-file 导入链拉进裸 node 解析图导致
  `ERR_MODULE_NOT_FOUND`（本次改动中实际踩到并修正）。
- `packages/shared/src/session-file.ts`：改为从 `#session-paths` 转出该常量（公共
  出口不变）；`embedded-harness.ts` 同样转出；`package.json` imports map 新增
  `#session-paths`。
- `apps/cli/src/lib/session-file-attachments.ts`：`ATTACHMENTS_DIR_RELATIVE` 改为引用
  共享常量（值不变，纯重构）。
- `packages/harness-pi/src/acp-adapter.ts`：`resource_link` 包含性校验改用共享常量。
- `packages/harness-pi/tests/acp.test.ts`：新增回归——`.molly/attachments` 内的
  `resource_link` 被接受并作为附件描述送达模型；根目录之外的路径以
  `harness_attachment_outside_scope` 拒绝且不派发。已验证该测试在旧代码下失败。
- `packages/components/src/components/sessions/design-canvas.tsx`：新增可选
  `artworkId` 属性（`?? sessionId` 缺省回退）并修正全部作品级调用与事件过滤；
  `session-detail.tsx` 传入 `activeSession.design.artworkId`。
- `packages/components/tests/design-canvas-receipt.test.tsx`：新增回归——
  `sessionId !== artworkId` 时版本/状态/同步按作品 id 路由，会话文档仍按会话 id
  加载。
- 首轮实现把 `artworkId` 定为必填属性，导致既有预览测试
  （`design-source-preview.test.tsx`，直接挂载 DesignCanvas 未传新属性）4 个用例
  失败；改为可选缺省回退后全绿。必填改可选也使「普通会话 artworkId==sessionId」
  这一不变量对新调用方默认成立。

## 最终验收（hybrid 打包产物 + 夹具二）

**Journey A（旧会话延续）**：

- 夹具二旧会话可直接打开：标题、两个用户回合、助手回合与附件缩略图均渲染。
- 对话框 → Molly → 预览：`Omitted: 0 turns, 2 non-text items, 0 attachments`，历史
  节选如实 → 确认后打开目标会话 `360172a7-2e50-5b1c-9983-a25c2ceff065`（确定性
  v5），顶部溯源横幅 + 「Back to session」。
- 显式选择 Kimi K3-256K · High；发送有界标题编辑指令。回合中权限请求共 5 张卡
  （源作品目录只读 ls/cat/read、目标会话目录内 mkdir/edit、`molly_render_preview`、
  读渲染预览 PNG）。批准前均先在输出中观察到各卡的命令文本，但批准动作由轮询脚本
  点击「Allow once」执行，其中一张 `mkdir` 卡的完整参数未展开查看，最后一次
  「读预览 PNG」批准点击与回合结算发生竞争（点击超时，权限卡随后消失，回合正常
  完成）。本轮权限审查因此不是完全干净的人工逐一审查。
- 回合结算：「Saved to the current artwork.」（约 5 分钟），助手摘要确认标题改动。
- 作品侧验证：artwork 根 `design.json` 的 main-title 文本 = 「动手工作坊·第二期」，
  背景与右下角色块不变；history.git 的 V1 提交（`6104c0a`）保持原标题原文可读。
  延续会话打开「Current artwork」后原生画布以 `ws=4a7b3d1e…`（作品 id）attach
  并渲染更新后的画稿（缺陷 2 修复的端到端实证），界面显示「已自动保存」。
- meta 验证：源会话 meta 保持 `registry/codex` + 旧引擎 `acpSessionId`；目标会话
  meta 为 `builtin/molly` + 自身新 `acpSessionId`（未继承旧标识）；目标 meta 携带
  `designContinuation` 收据（sourceSessionId + version 1）；附件 blob 在
  `session-files/<workspace>/<session>/` 存储中完好。

**Journey B（旧 Role 迁移）**：

- Settings → Agent Roles 中两个旧 Role 均如实显示「Unavailable: its Agent engine is
  retired; explicitly migrate this Role to Molly」+「Migrate to Molly」按钮。
- 迁移 Role B：对话框文案如实（保留角色身份与旧配置只读备份；不复制 CLI 模型、推理
  与权限模式；必须显式选择连接与模型）。显式选 Molly + Kimi K3-256K + Thinking
  High 后保存。对话框如实提示旧配置遗留了所选引擎不再支持的选项
  （`reasoning_effort=off`）。
- 迁移后 flock 验证：Role B 绑定内置配置 `95681cda-…`，modelId
  `molly-model:00661652-…/k3-256k`，revision 3→4，`embeddedMigration` 携带完整来源
  快照（旧配置 id、原 revision、原 promptPrefix 等）；Role A 保持未迁移、不可用、
  原样未动。
- 用 Role B 创建会话：meta 为 `cliType=builtin / agentType=molly` 且绑定
  `agentRoleId=4a7b3d3e-…`；真实回合 10 秒结算，回复内容体现了迁移后的
  promptPrefix 评审原则。

### 如实披露（最终验收）

- **hybrid 安装包**：本轮全新 `build:mac` 产物在本机出现 devtools 异常——
  `--remote-debugging-port` 端口接受 TCP 连接但 HTTP/WS 永不响应。用干净 HEAD
  （stash 掉本任务全部改动）重新构建同样复现——这仅证明故障不依赖本任务的 diff，
  根因未定位，不能断言为环境原因。观察到该构建的 daemon、渲染器与 machine-rpc
  正常，但 devtools 通道不可用，使 CDP 驱动的 UI 验收无法在全新包上执行。最终
  验收因此在 hybrid 包上完成：#47 打包壳 + 本任务修复树当时构建的 renderer 与
  harness 产物。注意 hybrid 验收后代码又发生两处后续修改（`session-paths` 零依赖
  重构、`artworkId` 由必填改为可选缺省回退）——这两处只有自动化测试覆盖
  （electron 裸 node 测试、vitest 套件），没有运行时旅程证据。结论应表述为：
  **hybrid 环境旅程通过；最终完整安装包未验证**。devtools 异常建议另开 issue 跟进。
- **夹具二 meta 覆写（推测）**：播种后发现夹具二会话 meta 被覆写为
  `cliType=builtin / agentType=''`（并多出 `name`/`sessionId` 键，形状与渲染器
  pending-design recovery 的默认填充一致）；history 4 回合完好。推测为播种时
  daemon 仍在运行、recovery 读到空 meta 所致，未做完整因果验证。停止应用后用
  仓库持久化 API 修复 meta 并复验通过。教训：夹具播种应在应用停止时进行。
- 诊断轮（夹具一）证据仅作冒烟信号；最终验收旅程证据全部来自夹具二的干净运行。

## 检查结果

- 套件：components 414 文件 3186 用例全绿（含新增回归 5 个与既有预览 4 个）、
  harness-pi 243 全绿（含新增回归）、apps/cli 3061 通过 3 跳过、shared 1314 全绿、
  platform 17 全绿、electron 主进程测试 173 全绿（修复本任务引入的裸 node 解析回归后）。
- `pnpm run check` **并非整体全绿**：typecheck、lint、lint:i18n、
  code-collab/platform/public 边界守卫全部通过，但 test:ci 中
  `packages/design-authoring` 的 `live-fingerprints` git 历史指纹测试失败——该断言
  要求最近 30 条提交中存在 PPTD/Folio 谱系提交，而本仓库迁移后仅 22 条提交、整条
  历史中无此谱系，干净 HEAD 上同样失败，属与本任务无关的既有失败，仅报告未处理。
- 全桌面迁移（非合成数据）仍未验证，见
  `apps/cli/src/session/README.md` 的既有声明。
