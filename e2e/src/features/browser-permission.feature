# language: zh-CN

功能: 内置浏览器的任务许可与私网边界

  @lody @P1 @essence @runtime-simulator @LODY-BROWSER-001
  场景: 用户拒绝 Agent 浏览本机地址
    假如 已配置确定性 Agent 的隔离桌面
    当 Agent 请求浏览本机地址
    并且 用户拒绝该浏览请求
    那么 浏览工具返回用户拒绝且没有暴露页面

  @lody @P1 @essence @runtime-simulator @LODY-BROWSER-002
  场景: 一次性批准不能突破本机地址边界
    假如 已配置确定性 Agent 的隔离桌面
    当 Agent 请求浏览本机地址
    并且 用户仅批准这次浏览请求
    那么 浏览工具拒绝本机地址且没有暴露页面
