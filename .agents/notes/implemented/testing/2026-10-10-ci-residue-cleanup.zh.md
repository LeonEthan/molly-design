# Molly CI 与验收工具残留清理

Status: implemented
Translation: pending
PR: [#123](https://github.com/LeonEthan/molly-design/pull/123)

## 摘要

桌面 smoke 的旧 `LODY-*` 编号仍对应有效的 Molly 本地场景，但测试作者工具和验收说明保留了已退休的 Lody 假设。本次将本地候选验证的源码初始化收窄到 ACP core 与 DSH，移除无法解析仓库时的上游回退值，并按实际模型请求、会话删除和项目目录保留信号修正验收说明。失败报告显示真实可用录像数，并引导查看已上传证据，不再声称每次失败都有完整 trace 和截图。现有场景、证据格式与评论识别标记继续兼容；本次不改变产品运行时或发布范围。

## 依据与复用

承接[确定性模型接口迁移](2026-09-21-e2e-deterministic-model-wire.md)和[旧 diff 场景退役](2026-10-04-diff-journey-retirement.md)。这些记录保留当时的实施证据；当前验收说明以现行 Page Object 的观测为准。

此次审计覆盖全部 13 个 GitHub workflow。PR smoke、Daily、Scout 和构建工作流已使用 Molly 包与当前桌面源码依赖，未发现应因旧品牌而删除的 workflow。截图所指[失败运行](https://github.com/LeonEthan/molly-design/actions/runs/38105940541)在 Electron 加载 Pi 模块时失败，三个场景的业务步骤没有执行；启动前失败也没有产生视频渲染所需的 trace。

直接适配现有 `validationCommandPlan`、仓库解析函数、验收描述与 `prepareDailyFailureReport`。复用工作流已有的 core 与 DSH 初始化范围，以及报告器已有的验证后录像列表；不新增依赖安装器或证据存储。直接修改稳定 ID 会破坏 PR 产物与默认分支报告器之间的读回合同，因此保留 `@lody`、`LODY-*` 和现有评论标记。

## 修改

- 本地候选验证只初始化 `packages/acp-extension-core` 与 `packages/acp-extension-dsh`，不再递归初始化所有历史 Agent 子模块。
- 作者工具从标准 GitHub HTTPS 或 SSH origin 读取真实仓库身份。无法识别的地址明确报错，不再将任务归属写成 `LodyAI/Lody`，错误消息不包含 origin 内容。
- 生命周期验收描述使用真实的模型请求取消、可编辑输入界面恢复、会话删除和项目目录保留信号。共享 harness 的进程及端点清理仍单独负责整个运行的退出检查，不将它表述成单个会话 Agent PID 的释放证明。
- 报告显示验证后可用录像的总数，仅在存在录像时显示该录像的序号。空录像列表仍生成现有 summary 评论，保留缺失原因与幂等标记。
- 报告链接到 Actions 日志与已上传证据，移除无条件的完整 trace、截图声明。PR 和 Daily 的现有录像投递方式保持兼容。

## 验证与范围

用现有合成证据夹具复现零录像却显示 `1/1` 的报告；修复前新增断言失败，修复后报告器与策略测试通过。作者工具的确定性测试覆盖 GitHub HTTPS/SSH、fork 和含点仓库名，以及不可识别 origin 的拒绝和限定源码初始化范围。

`pnpm e2e:check` 通过场景合同、TypeScript 和目录测试；全部 GitHub 脚本测试 98 项通过。`pnpm format`、改动文件的 Prettier 检查、`git diff --check`、`pnpm check:quick` 和 `pnpm run docs check` 通过，文档检查仅有既存的文件体积警告。未运行候选生成或产品模型调用，也未重新构建或运行桌面 smoke；此次清理不构成安装包或跨平台桌面验收。

完整 `pnpm check` 的类型检查与 lint 通过，测试阶段在 macOS 的既有 `public signer reseals inner native bytes before signing the root resource seal` 测试失败：夹具没有提供 signer 已要求的 `agent-browser/manifest.json`。在原始 `HEAD d0b17e0b` 的隔离源码中复现相同 `ENOENT`，确认不是本次改动引入；当时 `origin/main e233a31b` 的相关源码也完全相同。本次保留该基线问题，不扩大到打包签名修复。

Codex CLI（`gpt-6-astra`、`high`、显式只读沙箱）独立复核未发现 P0/P1；其复核范围是当前代码与文档差异，未重复桌面验收或远端产物核验。
