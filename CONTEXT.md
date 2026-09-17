# Molly

Molly 是以自身品牌独立发行、通过设计会话创作和查找平面设计产出的本地桌面工作台。

## Language

**作品**：
具有名称和尺寸的单画布设计产出，首期默认关联一个主设计会话。
_Avoid_：会话、回合版本

**设计会话**：
围绕作品的交流与执行记录，随既有 Session 提交流程初始化空白作品；创建沿用 Agent 配置要求，打开后的手工编辑独立于 Agent 执行。
_Avoid_：作品、Agent 进程

**项目**：
组织多个作品的可选分组，不是开始创作的前置条件。
_Avoid_：必选 Git 仓库、作品目录

**会话历史**：
设计会话的交流与执行记录，是查找设计产出的入口，不是画稿版本历史。
_Avoid_：设计版本库、画稿历史

**当前画稿**：
本地 workspace 中以 BentoDoc 保存的最新权威状态；从会话历史进入时打开这一状态。
_Avoid_：历史快照、回合版本

**画稿投影（已实现，指向 specs/graphic-design-platform.zh.md「当前画稿读取与文件一致性」）**：
从当前画稿的一致快照按需生成的 YAML 文件（`design.yaml`、`pages/canvas.yaml`）及素材，供 Agent 读取；不是 Agent 新产物。不使用 PPTD。
_Avoid_：第二份权威画稿、Agent 草稿、PPTD

**Agent 创作草稿（已实现，指向 specs/graphic-design-platform.zh.md「当前画稿读取与文件一致性」）**：
Agent 正在修改的创作文件，关联其成功读取的作品和版本基线；再次同步当前稿不覆盖草稿或静默改变其基线。
_Avoid_：当前画稿、历史版本库

**冲突草稿（已实现，指向 specs/graphic-design-platform.zh.md「编辑和 Agent 回合」及「当前画稿读取与文件一致性」）**：
因版本检查未能提交、仍保留在工作区的创作文件；Agent 重读最新当前稿后自行处理差异，不是需要用户采用/拒绝的独立候选作品。
_Avoid_：候选审批、应用自动合并

**创作预览（已实现，指向 specs/graphic-design-platform.zh.md「创作文件实时预览」）**：
根据 YAML 画稿投影变化更新的只读、未提交视图；可停留在上一份有效结果，不改变当前画稿或 Agent 草稿基线。Agent 执行及产物处理期间，当前画稿也只读；运行中观看进展，提交完成后再引用当前稿元素继续修改。
_Avoid_：当前画稿、已完成产物、读取 hook 生成的画稿投影

**显式导入（已实现，指向 specs/graphic-design-platform.zh.md「创作文件实时预览」）**：
空闲时将用户已预览的 YAML 画稿投影与素材快照，经校验和版本检查直接保存为当前稿；不先创建待采用候选。不导入遗留 `.pptd`。
_Avoid_：作品目录导入、候选审批、PPTD 互通

**工作区（workspace）**：
会话使用的本地文件空间，保留设计文件与素材，不是新增的作品目录管理功能。
_Avoid_：作品库、可迁移作品目录

**Agent**：
用户选择的创作执行工具；Pi 与其他 coding agent 属于同一类选择，Molly 不绑定其中某一种。
_Avoid_：Molly 内置必选 Agent
