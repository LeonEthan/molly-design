# 本地参考图附件接线（T10）

Status: implemented
Translation: pending

## 摘要

Folio 的既有附件入口受云认证前置和 Session 创建前校验阻断，本地文件图片也未进入设计参考快照或真正图片输入。本次复用图片草稿、文件 sender/blob 和受控文件资源，按首页预留 Session ID 存储附件；发送时将支持格式的相同字节提供给 ACP image 与设计参考快照。读取已发送本地图片不经过产品云，图片生成 MCP 不参与附图可用性判断。真实 Codex ACP 图片输入已做一次合成图验证；安装包及其余四种 Agent 组合仍由后续矩阵验证。

## 决定与边界

本票落实 [#12](https://github.com/LeonEthan/Folio/issues/12)，依据[范围复核](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md)。不创建素材库、第二套上传控件、图片存储或查看器。图片草稿可持有既有本地 file payload，保留原预览和失败草稿；无云 token 时本地传输仍可用。首页预留 ID 在实际创建之前拥有 blob，只有 local 派发来源可使用未创建的 Session；删除过的 Session 仍拒绝预上传。

新增 `localSessionAttachments` 协商能力，同时覆盖首页预上传与 `file/resolve-local` 附件身份参数。读回仅匹配本会话历史内的 fileId/hash/机器，解析 storageSessionId 后读取原 blob，校验长度和内容 hash，再由 Electron 已有资源服务签发不带本地路径的 URL。没有该能力不向旧 daemon 发送新参数。

PNG/JPEG/WebP/GIF 复用既有允许 MIME 集合：保留资源链接，同时追加包含真实 base64 字节的 ACP image 块，并将相同字节冻结进本轮参考图清单。其他文件（包括 SVG）保持普通文件资源读取，不假定 Agent 支持将其作为内联图片。参考图缺失或校验失败阻断输入，不用路径替代看图，也不触发付费重试。未配置图片生成 MCP 不影响这些路径；可选 reference-pack 对非 PNG 的分析限制未扩大为附件限制。

## 验证

- 确定性 CLI 测试覆盖 reserved Session 首次本地入库、写入历史后用新的 handler 重开读回、错误 hash 拒绝；不使用网络或真实等待。
- 设计输入测试覆盖本地 JPEG 及同一张真实实验合成 PNG 的同字节的 ACP image、参考文件和 SHA-256，并保留既有图片/文件资源链接测试。合成字节用于接线断言，不被当成真实模型视觉证据。
- 渲染端测试覆盖无产品认证的 JPEG 本地发送、失败不回退云、原有图片草稿跨路由恢复。
- 真实验证使用已构建公开 `acp-extension-codex` 1.10.0、`codex-cli` 0.153.4 与 `gpt-6-astra[medium]`。独立临时目录和临时 Codex 配置，无 MCP；仅复用已有登录进行一次推理。ACP 宣告 image 能力，输入 765 字节合成 PNG（SHA-256 `df56c9888e52083ca6b223a1ad93941886070c79a1ee04b5fe9798a6a05491dd`）及要求描述图形的文字，未提供图形答案或路径。模型正确识别绿色背景、左侧粉色方形、右侧蓝色圆形，`end_turn`，未调用工具。首次设置裸 modelId 被适配器在推理前拒绝，修正为其要求的 modelId[effort] 后才进行唯一一次推理；无付费重试。不提交转录或凭据。
- 渲染组件测试覆盖已发送图呈现、点击打开既有查看器、卸载重挂后的受控读回、缺失 blob 报错和旧 daemon 不发新参数。该测试模拟 IPC 资源答复，真实资源签发/字节校验使用既有 Electron 文件资源测试。
- `corepack pnpm check` 的类型检查和 lint 通过；组件 448 文件/3345 测试通过，CLI 唯一失败为机器注册穷举能力期望漏列新能力（其余 2803 测试通过）。补齐期望后该文件 3 测试定向复验通过；再完成被短路的 Electron 113 测试、i18n、Code Collab 导入、平台边界与公开边界检查，均通过。仅在检查子进程中过滤继承的 `ANTHROPIC_*` / `CLAUDE_CODE_USE_*`，未改用户环境或运行时认证。
- `corepack pnpm format` 已执行并撤回无关格式变更；`corepack pnpm run docs check` 和 `git diff --check` 通过。未运行安装包或人工桌面验收。

## 限制

此证据将真实 ACP 图片能力与确定性的完整上传/快照/读回接线分别验证，没有声称在已安装桌面中完成五种 Agent 的端到端矩阵。未做人工桌面视觉验收、JPEG 的真实模型识别或其他四种 Agent 的能力认证。没有修改工作目录布局、hook、图像 MCP 配置、生成工具、回合 outcome 或总 Spec。

## 安装包跟进：首条附件与历史同步竞态

T28 在源提交 `9ef3b5048a9a3d5efb331b887914fe4c0bd90ebf` 的本地安装包中发现：原始参考图字节已进入真实 Claude/Pi 输入，但聊天中的已发送图片可能保持“本会话没有此附件”的初次读取错误。一次原始日志中，`file/resolve-local` 请求比用户历史同步完成早 36 毫秒；既有测试先写历史再预览，遗漏了这个顺序。该安装包的原始失败证据保留在外部验收目录，不将完整转录提交到仓库。

修复只复用 `MessageHandler` 已有的 `TurnHistoryGate`：先查历史，找不到匹配身份时等待本轮已有的有界同步门，再读取并执行原有身份、机器、传输类型、长度及 SHA-256 校验。已有历史中的图片不等待新一轮；同步超时或门被释放不等于允许读取未发送的 blob。不在组件中新增轮询，也不放宽文件资源授权。此跟进恢复原附件能力，不改变产品范围或 Agent 生命周期。

新增回归测试通过实际 SessionDocument 与现有同步门控制“先请求、后同步”的顺序；修复前该成功场景确定性失败。另覆盖同步后仍缺失、错误 hash、错误机器、远程传输、超时未同步，以及有新回合时立即读取旧附件。所有时间推进由假时钟控制，历史读取完成使用显式信号。修复后两个定向文件共 14 项测试及完整 `corepack pnpm check`、`corepack pnpm format`、`corepack pnpm run docs check` 通过；检查子进程沿用上述认证环境隔离。

修复提交 `897d026232f39f673a83f409ec54daaf598848a8` 随源提交 `b86a1c92aa529511c4390dc057649bbb00a53f50` 打入新的 macOS arm64 安装包。T28 的真实 Claude 轮次确认已发送附件可见，图片元素 `complete=true`、`naturalWidth=1`，并验证原始参考图字节、原生技能读取、手动权限确认、过期写入拒绝、有效提交及同字节显式重提交；完整轮次含清理退出 0。首轮精确文件名选择器未适配上传后的名称，修正为已知后缀后复验，未放宽图片加载断言。证据为外部 `folio-t17-desktop-TT1Oyc` 目录及该安装包轮次的 `claude-native-2.log`，安装包身份与完整矩阵见 [T28 记录](../../implemented/testing/2026-09-11-installed-five-agent-matrix.md)。这证明该组合中的修复，不将其扩展成五种 Agent 均通过或人工视觉验收通过。
