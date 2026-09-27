# Geon 独立品牌首发残留修复

Status: implemented
Translation: pending
[English](../../../../.agents/notes/implemented/feature/2026-09-13-geon-independent-brand-release-residual-fixes.md)

## 摘要

Folio→Geon 改名后，若干产品面向的界面仍引用 Lody 或旧 Folio 产物名，且两个 CLI 会话标记存储在本地 Geon 构建中仍写入硬编码的 `~/.lody` 路径。本笔记记录清理决定：标记存储现在通过 CLI 其余部分使用的同一本地数据根解析器解析；当无可用主机或请求身份时，Git 回退身份与别处使用的设计历史作者对齐；`locales/en.json` 与 `locales/zh_CN.json` 中用户可见的 Lody 产品引用改写为 Geon；图像素材在存在合适替代品时改接到现有 Geon 素材。旧 `~/.lody` 路径下的短命标记文件未提供迁移；其理由与限制见下文。

## 决定

### 本地数据根路径

- `apps/cli/src/session/session-fork-operation-store.ts` 与 `apps/cli/src/session/worktree/speculative-worktree.ts` 原先硬编码 `path.join(os.homedir(), '.lody', ...)`。现在它们从 `@lody/shared/node/installation-profile` 导入 `getLodyDataDir` 并使用 `getLodyDataDir('local')`，在公开本地配置文件中返回 `~/.geon`，并尊重 CLI 其余部分使用的 `LODY_DATA_DIR` 覆盖。
- 同一修复也应用到 `apps/cli/src/lib/code-collab/code-collab-v2-diff-store.ts`（`getCodeCollabV2DiffStoreDbPath`）与 `apps/cli/src/lib/machine-lifecycle.ts`（`DAEMON_UPGRADE_INTENT_FILE`）。它们是 CLI 源码中最后两处字面 `~/.lody` 写入路径。
- 这使 CLI 所有持久化状态路径与本地安装配置以及 Electron 端 `~/.folio` → `~/.geon` 的用户数据迁移保持一致。
- 所有移动路径均不提供数据迁移：
  - fork-operation 与 speculative-worktree 标记是短命操作记录。
  - daemon-upgrade-intent 文件是一次性消费并删除的瞬态信号。
  - Code Collab diff store 是本地派生证据（turn diff 可由新 turn 重新计算/填充）。更新后旧 `~/.lody` 下的数据库不会被读取，但保留内容并非用户创作的源数据。该取舍使改动保持精简，避免为临时或可重建状态添加一次性迁移逻辑。

### Git 身份对齐

- `apps/cli/src/session/git-identity.ts` 原先在无可用主机或请求身份时回退到 `LodyAI <agent@lody.ai>`。
- 现在回退到 `Geon <geon@localhost>`，与 `apps/cli/src/design/history.ts` 中设计历史提交已使用的固定作者一致。
- `apps/cli/src/session/worktree/worktree-manager.ts` 中初始提交的同一回退也同步更新。

### 文案（locales）

- `locales/en.json` 中 26 处、对应 `locales/zh_CN.json` 中 27 处 Lody 产品身份引用全部改为 Geon，包括欢迎标题、桌面应用标签、Bug 报告团队名、硬重置描述等。
- `localProjects.add.noMachinesDescription` 按“Geon 内嵌 Agent runtime、无独立 CLI 产品”改写，不再称“Lody CLI”。
- `settings.integrations.github.missingReposHint` 改为中性的“GitHub App”表述。在 `packages/platform`、`packages/shared`、`apps/electron` 中搜索后未找到硬编码的 GitHub App 注册名、slug 或 client ID；在没有 Geon App 已注册证据的情况下，文案避免断言具体 App 名。该事项作为外部依赖项记录：在 GitHub 侧注册/重命名为 Geon App 之前，用户-facing 文案不能声称特定 App 名。
- 协议名（`lody://`）、包名（`@lody/*`）、环境变量（`LODY_*`）、`_meta.lody` 协议字段、上游署名与许可归属按父笔记的命名空间分层决定保留不变。

### 素材改接

- `packages/components/src/components/pages/desktop-checkout-return-page.tsx` 与 `packages/components/src/components/pages/email-verified-page.tsx` 改导入 `geon-icon.png`，`alt` 改为 "Geon"。
- `packages/components/src/components/settings/usage-calendar-model.ts` 仍以 raw 字符串导入 `lody.svg` 并解析单一 `d` 属性用于 3D logo 浮雕。`geon-mark.svg` 由多条独立路径组成，无法直接替换而不修改解析器，因此保留 Lody SVG 并作为遗留素材说明。

## 依据与链接

- 独立首发提案：[proposed/feature/2026-09-13-geon-independent-brand-release](../../proposed/feature/2026-09-13-geon-independent-brand-release.zh.md)。
- 父级改名决定：[implemented/feature/2026-09-13-geon-rename](2026-09-13-geon-rename.zh.md)。
- Issue：[#32](https://github.com/LeonEthan/Geon/issues/32)。
- 安装身份规则更新见 [packages/shared/AGENTS.md](../../../../packages/shared/AGENTS.md)。

## 验证和限制

- 定向测试：
  - `apps/cli/src/session/session-fork-operation-store.test.ts`、`apps/cli/tests/git-identity.test.ts`、`apps/cli/src/session/worktree/speculative-worktree.test.ts`（21 个测试通过）。
  - `apps/cli/src/lib/code-collab/code-collab-v2-diff-store.test.ts`、`apps/cli/src/lib/machine-lifecycle.test.ts`（通过）。
- 类型检查：`lody`、`@lody/components`、`@geon/design-authoring`、`@lody/shared` 均通过。
- 静态检查：`corepack pnpm lint`、`node scripts/check-i18n.mjs`、`node scripts/check-platform-boundaries.mjs`、`node scripts/check-public-boundary.mjs`、`node scripts/check-code-collab-imports.mjs` 均通过；已运行 `corepack pnpm format`。
- 工作结束时运行了 `node scripts/docs/main.mjs check`。
- 限制：`lody.svg` 仍被 usage-calendar 3D 浮雕解析器使用；替换它需要扩展解析器以组合 `geon-mark.svg` 的多条路径。移动路径的旧 `~/.lody` 目录未迁移，可能作为孤儿临时/派生状态留在磁盘上。
