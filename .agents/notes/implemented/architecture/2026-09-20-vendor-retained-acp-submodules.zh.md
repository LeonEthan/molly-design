# 保留上游 ACP 子模块迁入 vendor/，ignore 包归属 Molly 命名空间

Status: implemented
Translation: current

[English](2026-09-20-vendor-retained-acp-submodules.md)

## 摘要

四个保留的上游 ACP 子模块检出（Claude、Codex、Grok、Kimi）原本位于 `packages/` 内，
尽管工作区已将其排除——这使自有包目录夸大了实际维护范围，容易让贡献者把历史材料
当作在维护代码。同时，vendored 的文件监听包以 `@loro-dev/ignore` 为名，借用了 Molly
无权控制的命名空间。现在四个子模块迁入不匹配任何工作区 glob 的 `vendor/`，监听包
更名为 `@molly/ignore`。全量 `pnpm check` 通过；唯一有意保留的痕迹是 `.gitmodules`
中的子模块*名称*——`git mv` 保持其不变，且不影响全新克隆。

## 问题

`packages/` 混合了两类内容：CI 构建和测试的 Molly 自有包，以及根 pnpm 显式排除的
保留上游检出。混淆成本有据可查：仅 Kimi 检出就是一个 84MB 的第三方 monorepo，其
根包名仍是 `@moonshot-ai/monorepo`；工作区还需要四行 `!packages/acp-extension-*`
排除才能让 pnpm 避开这些仅为留存出处而存在的目录。另一方面，`packages/ignore`
以 `@loro-dev/ignore` 为名、`version 0.0.0`、没有 `private` 标记；其源码、头部注释
和 NOTICE 文件均无 loro-dev 出处迹象，该名字属于命名空间占用，一次误发布就可能
构成冒名。

## 决策

- 用 `git mv` 将 `packages/acp-extension-{claude,codex,grok,kimi}` 迁至
  `vendor/acp-extension-{claude,codex,grok,kimi}`，保留各自锁定的提交。
  构建必需的子模块（`packages/acp-extension-core`、`packages/acp-extension-dsh`、
  `packages/design-bento/bento`）保持原位。
- 从 `pnpm-workspace.yaml` 删除四行工作区排除；`vendor/` 不匹配任何工作区 glob，
  排除已无必要。
- `@loro-dev/ignore` 更名为 `@molly/ignore`（清单、`apps/electron` 中唯一的
  导入方、electron-vite 的 `externalizeDeps` 排除项以及 lockfile）。

## 迁移所需的引用更新

对历史笔记以外的全仓库 grep 找到了所有消费方，并在同一变更中逐一更新：
`.oxlintrc.json` 忽略模式、根 `lint` 的 ignore-pattern、
`scripts/package-kimi-runtime.mjs`（`kimiRoot`）、
`apps/cli/scripts/probe-grok-design-hooks.mjs`（适配器路径）、
`.github/scripts/select-ci-scope.mjs`（`ALWAYS_FULL_GLOBS` 的 Kimi 路径）及其
测试夹具、`.github/labeler.yml`（`scope: agent-runtime` 现同时覆盖
`packages/acp-extension-*` 与 `vendor/acp-extension-*`），以及 `README.md`、
`README.zh-CN.md`、`CONTRIBUTING.md` 和根 `AGENTS.md` 的措辞。历史
`.agents/notes` 条目未改写。

## 备选方案

- 保留四个子模块在 `packages/` 并维持排除行：零改动，但被修复的正是这个
  误导性布局。
- 直接删除保留检出：会丢失锁定出处以及 `package-kimi-runtime.mjs` 打包所用的
  历史 Kimi 运行时源码。
- 把 `.gitmodules` 节名改为新路径：纯美观；名称只是内部键（路径才是权威），
  改名将要求每个既有克隆移动 `.git/modules/*`，无行为收益。
- 仅给 `@loro-dev/ignore` 加 `"private": true`：能阻止误发布，但外部命名空间会
  永久留在导入和构建配置中。

## 验证

- `git submodule status` 在新路径报告相同的锁定提交；
  `git -C vendor/acp-extension-kimi rev-parse HEAD` 可解析。
- `node --test .github/scripts/select-ci-scope.test.mjs
.github/scripts/run-ci-typecheck.test.mjs`：46/46 通过，包括基于真实仓库的
  `loadWorkspace` 断言（四个名字保持排除）。
- 全量 `pnpm check`（typecheck、oxlint、全部测试、i18n、边界守卫）在 Lody
  桌面原生环境shell中通过。

## 限制

- 既有克隆仅在需要操作保留检出时才要 `git submodule sync` / 重新初始化；
  常规桌面开发从不初始化它们。
- `site-docs/` 仍在仓库根目录，Bento 仍属外部 org 子模块；两者是另外的
  后续事项，不在本次范围内。
