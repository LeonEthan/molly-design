# 退役 Agent Role 产品功能

Status: implemented
Translation: pending

## 摘要

用户明确要求去掉 Role 的选项和功能；此前模型菜单仍保留 Role，旧草稿、角色管理和引用也能重新应用它。现在首页、会话、子会话草稿和设置均使用直接配置，Role 不再参与选择、提示词展开或新程序化创建。历史目录、消息标记及已接受操作的冻结记录保留，以避免功能退役变成数据删除。模型、reasoning 与权限选择继续使用现有控制器。

## 决定与边界

- 删除可达的 Role 选择、创建、编辑、迁移、`@` 分类和自动 hydration；角色设置旧链接回到 Preferences。
- 首页和子草稿不恢复 Role id，不拼接 Role 提示词；最近使用过滤 Role 记录，新消息显式冻结 `agentRoleId: null`。已保存的显式模型配置继续正常使用。
- 新 MCP 单次/批量创建的严格 schema 拒绝 Role 参数；运行参数直接来自请求。已接受操作仍使用原冻结 payload 恢复，不重新读取角色目录，既有运行时门禁仍有效。
- Renderer writer 拒绝 Role 新增、修改、迁移及删除；不清空旧目录或改写历史来源。共享历史 schema、冻结 span 渲染和未挂载的旧 helper 保留；它们不代表现行产品支持。
- 移除 Role hook 后保留 Session 文档就绪门禁，防止在 durable config 尚未到达时发送暂态默认值。

仅隐藏菜单不能满足请求，因为旧偏好、引用和 MCP 仍可应用 Role；清空历史目录则不必要地破坏用户记录。因此退役发生在可达入口及新增写入边界，兼容读取独立保留。

## 相关决策

- 本决定替代 [UI 调整记录](../feature/2026-09-22-seede-ui-style-direction.zh.md)中上一轮保留 Role 的范围，Provider/model 外观和 reasoning 交互保持。
- [设计会话继续验收](../testing/2026-09-20-design-session-continuation-acceptance.zh.md)保留其当时证据；其中 Role 迁移不再属于现行产品功能。
- [内置 Harness Spec](../../../../specs/molly-embedded-pi-harness.zh.md)因范围变化返回 draft，先前审批不延伸到此修订。

## 验证与限制

- 组件定向 116 项、CLI MCP 48 项测试通过，覆盖模型菜单、Role 写入拒绝与历史 Flock 重开、设置旧链接、引用展开、草稿和发送就绪门禁。另有 defaults hook 3 项通过。
- CLI 与 Electron 类型检查、定向 lint、路由生成、完整 `pnpm e2e:build`、公开边界检查和文档检查通过；文档检查无错误，无注册 SHA topic，保留既有体积警告。`git diff --check` 与改动文件格式检查通过。
- `pnpm e2e:smoke`：3 场景 / 18 步通过。真实 Electron `after-role-retirement-02/`：21 张截图覆盖浅深主题、模型和 reasoning 菜单、设置、`@`、窄窗口、中文及旧 Role 设置链接。
- 实际首轮请求采用 Review / Aurora 2 / High，下一轮切换到 Studio / Aurora 1 / Low，合成外部服务记录确认连接、模型与 reasoning 精确匹配；renderer、IPC、CLI 均为真实构建。未调用外部付费服务，未运行完整 P1 桌面套件。
- `e2e/artifacts/seede-workspace/role-retirement-review/index.html` 与上一轮真实截图比较；浅深汇总已目视复核，原图加载、主题及全窗口切换通过，浏览器错误为 0。构建 renderer 指纹：`e549df69bbbc67cfa4c3ab8a3ebb6e52c042a7a76d23c1a634ec4fa5d09374be`。
- 第一轮截图驱动误以为旧设置链接停留在 Preferences URL；桌面实际按既有布局转换成 Preferences 模态并回到 chat。修正驱动断言后第二轮通过，未因此更改产品行为，失败证据保留。

本次不提交、不发布、不删除历史数据；共享历史类型和未挂载旧组件尚未作独立源码清理。截图供用户判断视觉效果，自动检查不代替人工审批。

提交前全量检查补充：`agent-role-chip` 的两条旧断言仍要求实时读取 Role emoji，和已确认的功能退役不一致。更新为目录存在时也不恢复 emoji，并明确断言原始草稿文字完整保留；相关 5 项测试通过，产品运行时代码未因此改变。
