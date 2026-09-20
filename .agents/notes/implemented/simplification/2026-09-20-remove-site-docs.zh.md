# 移除保留的 Lody 网站源码树（site-docs）

Status: implemented
Translation: current

[English](2026-09-20-remove-site-docs.md)

## 摘要

仓库根目录此前携带 `site-docs/`——Lody 产品网站的 458 个文件的保留副本，而 Molly 的
公开源码边界是 `apps/{cli,electron}` 及其 packages，README 也早已声明 Lody 网站不是
Molly 文档。其所有消费方都只是把它当作可跳过的 CI/文档工具配置，外加一篇孤立的
说明文档。该树现已移除；内容仍可从 git 历史和上游 Lody 仓库获取，删除完全可逆。
接受的取舍：`packages/components` 中两处注释仍提及历史上的 `site-docs` 消费方，
因为它们描述的互操作约束在代码中依然存在。

## 问题

一个独立品牌仓库发布着另一个产品的营销与文档网站：磁盘占用 40MB、自带 AGENTS.md
规则、并出现在 labeler、CI 范围 glob 和 lint 忽略中。该树不参与任何构建、测试或
打包——CI 范围测试仅证明其变更可跳过——因此其存在纯粹是成本：克隆体积、贡献者对
"这个仓库到底发布什么"的困惑，以及文档工具的告警面。

## 决策

用 `git rm` 移除 `site-docs/`，并在同一变更中更新全部引用：`.oxlintrc.json`、
`.github/labeler.yml`、`select-ci-scope.mjs`（`SKIPPABLE_GLOBS`）及其测试（删除
已过时的跳过行为测试；合成工作区中"`@molly/site-docs` 不是工作区包"的断言保留）、
`README.md` / `README.zh-CN.md`、`CONTRIBUTING.md`、根 `AGENTS.md`、
`.agents/README.md` 与 `.agents/docs/AGENTS.md`。
`.agents/docs/site-landing-and-marketing.md` 仅描述被移除的树，一并删除。
提及 `site-docs` 的历史笔记属于 dated records，未改写。

## 备选方案

- 像保留的 ACP 子模块一样把 `site-docs/` 移到 `vendor/`（见
  [迁移记录](../architecture/2026-09-20-vendor-retained-acp-submodules.md)）：
  能在树内保留出处，但 `vendor/` 存放的是带独立 git 仓库的锁定子模块检出；
  网站副本不为任何构建所需，上游也保留着原始仓库，移动只会保留成本而无收益。
- 原样保留：违反"公开源码是桌面应用及其 packages"的仓库边界规则。

## 验证

- `node --test .github/scripts/select-ci-scope.test.mjs` 在删除过时测试后通过。
- `pnpm run docs check` 无失效链接，退出码 0。
- 全量 `pnpm check` 在 Lody 桌面原生环境 shell 中通过。
- 如需恢复：`git checkout <移除前提交> -- site-docs/`，或上游 LodyAI/Lody 仓库。

## 限制

- `packages/components` 的两处注释（`diff-render-worker.ts`、
  `use-session-actions.ts`）仍提及该历史消费方以解释现存互操作约束；
  简化该代码不在本次范围。
- Bento 仍是外部 org 子模块、四个 spec 仍仅中文；两者是另外的后续事项。
