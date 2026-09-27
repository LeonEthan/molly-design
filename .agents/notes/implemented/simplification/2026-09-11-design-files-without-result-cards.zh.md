# 用普通文件读取承接旧设计内容

Status: implemented
Translation: pending

## 摘要

逐轮结果卡退役前，必须保留旧候选、未提交草稿及素材的实际读取入口。旧候选 JSON 已包含完整 BentoDoc 与内嵌素材，因此本次直接定位经校验的原文件，并复用 Lody 的普通文件预览与 Electron 受控文件资源，不生成额外 PPTD 副本、候选列表或恢复存储。提交事实与必要诊断以简短文字留在对话，当前稿通过既有画布入口定位；继续处理使用普通输入。真实模型读取图片与最终发布验收仍属于独立任务，本次不把组件测试或素材字节读取当成模型已看图。

## 决定与复用证据

本记录落实[范围复核](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md)的卡片退役部分。原实现的历史说明保留，已删除源文件的链接改为原提交链接，不批量改变会话历史。

- `design/store.ts` 的候选 JSON 持有完整 `content.doc` 与 `content.assets`。`readDesignCandidate` 校验内容摘要，并核对文件身份与所属作品；只读 `candidate-file` 替换候选状态/采用/丢弃操作。它返回原文件路径，字节仍由普通文件链路读取。
- Electron 既有 `file/resolve-local`、`LocalFileResources` 负责不含路径的资源 URL、只读内容、分段读取和资源失效；没有扩大文件授权根或增加导出目录。大文件按既有页大小读取，用户可检查原文，Agent 可通过普通文件操作提取内嵌图片/字体。
- `DesignFileReceipt` 仅保留提交事实、未提交诊断和原文件入口。取消/运行/无产物状态继续由会话显示；移除 live 卡、缩略图 UI、专用修复与采用/丢弃按钮及其接口和测试。当前稿定位放入既有会话工具区，成功提交沿用 `design.syncFromStore` 与既有未保存修改保护。
- 新候选生产与专用缩略图生产在各自任务退役；本次不删除原目录、素材、提交回执或旧 outcome，也不改变渲染预览和 Agent 读图能力。

## 验证与限制

独立读回测试使用合成文件：重新打开候选后，普通文件预览返回与磁盘原文件逐字节一致的 JSON，文档内容一致，提取素材的 SHA-256 与键一致，原稿和原文件不变。Electron 测试覆盖超过编辑器全量预算的 JSON：旧资源随 owner 释放失效，重开通过不泄漏路径的资源 URL 分段获得完整字节和素材。组件测试覆盖文件打开/错误、提交事实、脱敏诊断、不重复执行状态；既有画布同步测试保留。

`design/source-path` 复用 T04 的 `resolveDesignContext`；未加载会话从既有项目/工作树元数据解析，普通聊天由所属会话 ID 映射旧目录。历史项目回合缺少有效冻结输入或目录变化时明确不可用，不能改指当前目录。归档只读文件入口单独放行，已删除会话和其他 Code Collab 的归档限制保持；不启动 Agent、不创建会话或另建路径注册表。工作文件标明可能在该回合之后发生变化。

实际 MessageHandler 测试覆盖未加载的旧聊天、旧项目、新项目及归档项目/聊天，核对 PPTD、页面和 PNG 原字节，拒绝已删除会话、缺文件、变更目录及缺失新项目冻结输入；普通 Code Collab 仍拒绝归档请求。真实 composer 接受普通文件处理文本且清空已提交输入。

`corepack pnpm check` 通过，包括 CLI 2839、组件 3309、Electron 121 项测试，以及类型、静态、i18n、平台与公开仓库边界检查。既有跳过项保留：CLI 4 项、loro-streams-rpc 3 项。`corepack pnpm format`、`corepack pnpm run docs check` 和 `git diff --check` 通过；排除与本票无关的原有格式差异。检查子进程过滤无关的 ANTHROPIC/CLAUDE_CODE_USE 环境键，未修改用户环境。未以真实付费模型或本票专属安装包进行端到端验收；无模型调用、PR 或远程发布。
