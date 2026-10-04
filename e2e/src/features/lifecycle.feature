# language: zh-CN

功能: 桌面资源生命周期

  @lody @P0 @essence @runtime-simulator @LODY-SESSION-001
  场景: 用户停止并关闭一个真实 ACP Session
    假如 已配置确定性 Agent 的隔离桌面
    当 用户创建一个持续运行的 Session
    并且 用户停止当前 Agent
    那么 关闭 Session 后 Agent 进程被释放

  @lody @P0 @essence @runtime-simulator @LODY-SESSION-002
  场景: 用户删除带 Agent 的 Session 且项目目录保留
    假如 已配置确定性 Agent 的隔离桌面
    并且 已添加干净的合成 Git 项目
    当 用户在 Session 中完成回复
    那么 永久删除后 Session 资源被释放且项目目录保留
