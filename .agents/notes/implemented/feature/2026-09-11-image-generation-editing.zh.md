# 内置图像工具生成与编辑

Status: implemented
Translation: pending

## 摘要

原图像工具只发送文本生成请求，设置预填模型使未选择型号的用户也能发起付费调用。T09 删除产品默认值，保留明确保存的型号，并用现有连接、传输和素材保存链路新增真实文件编辑。生成和编辑共享设计会话与连接可用性判断，编辑上传工作区原图/参考图及可选 PNG mask，结果只作为素材交给 Agent。协议与文件内容由注入 transport 测试验证；本次没有可用于已授权真实付费验证的服务配置，因此不声称任何实际服务或视觉质量已经验收。

## 决定与证据

落实 [T09](https://github.com/LeonEthan/Folio/issues/11)，承接
[范围裁定](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md)与
[T11 技能收敛](../simplification/2026-09-11-autonomous-design-skills.zh.md)。
T11 记录保留当时仅生成与默认值的历史事实；本记录取代这些运行时限制，不更改其自主创作原则。

2026-09-11 核对 [OpenAI Images 官方指南](https://developers.openai.com/api/docs/guides/image-generation)：文本生成使用 `/images/generations`；编辑使用 `/images/edits`，多图采用 multipart `image[]`，可选 mask 上传 PNG 文件。只实现这两个现有 Images API 形状，不引入 Responses、图像作业、模型路由或 mask 编辑器。具体型号、尺寸、格式及 mask 支持由用户所选服务决定；不把官方模型名推断为兼容服务通用别名。

- shared normalizer 继续拒绝缺失/空白型号；设置新连接留空，原有完整 v1 配置保留其明确型号。readiness 同时检查完整配置，RPC gate 再次归一化。没有配置迁移或新存储。
- `folio_generate_image` 保持 JSON 文本生成；`folio_edit_image` 接收 prompt、1–16 个有序 images 路径及可选 mask/size。复用 `ImageHttpTransport`，生产 fetch 用 FormData 编码文件字节与 boundary，绝不把路径字符串冒充图像内容。
- 输入限工作区内普通文件，每个 16 MiB、总计 64 MiB；拒绝越界/外部符号链接、缺失和超限文件；PNG mask 的可解析尺寸须与第一张图相同。限制是 Folio 本地资源上限，不承诺上游都接受。
- 返回内容仍走既有 PNG/JPEG/GIF 素材落地；WebP 输出受现有 Bento intake 限制，返回明确错误。编辑输入可上传 PNG/JPEG/GIF/WebP；实际模型不支持时保留其拒绝。生成/编辑不写 PPTD，不提交画稿。
- 仅调用所选 endpoint/model；服务错误、超时、无效响应直接返回，凭据从上游文本与 transport 异常脱敏；不切换到生成，不自动付费重试。返回 URL 的读取是已有结果下载，使用无认证 GET、禁止跳转并限制响应大小。
- 设置 `/models` 探测只证明该接口可达，不证明生成/编辑/多图/mask 可用。附件、看图、手工编辑、渲染及导出路径没有新增图像连接依赖。技能说明随真实 schema 同步，创作方法仍可选。

保留单独 generate/edit 工具使必需源文件能由 schema 表达；扩展既有 transport 的 multipart 载荷比另造服务更小，并保留原 JSON 调用的测试接口。付费结果没有静默修复或自动重试；上游拒绝意味着 Agent 需要根据真实错误决定下一步。

## 验证与限制

- `corepack pnpm check` 全部通过：类型、lint、整套测试、i18n、Code Collab、platform/public 边界。仅在该检查子进程中移除继承的 ANTHROPIC*/CLAUDE_CODE_USE* 变量，避免既有 Claude auth fixture 受开发者环境影响；不读取或输出值。
- 针对测试通过：image-generation 25 项（生成/多图编辑、可选 mask、真实文件字节、越界/缺失/超限/错误尺寸/空模型、失败不重试与 URL 下载约束），MCP 15 项，connection 14 项，shared normalizer 10 项，Settings 13 项，skills 12 项。生产 transport 测试用 Request.formData 解码实际 FormData，验证 multipart 字段、文件 MIME/内容和凭据仅在认证头。
- design-authoring build 校验通过；imagegen 已标 rewritten/adapted，保留 upstreamSha256 的来源含义并补 localAdaptations。技能 staging/物化测试实际读取交付文件并保留人类修改。
- `corepack pnpm format`、最终改动文件 Prettier、CLI `tsgo --noEmit`、`corepack pnpm run docs check` 与 `git diff --check` 通过；docs 无 errors，保留既有规则文件体积 warnings，无 SHA topic。撤回 formatter 对无关 updater 测试的修改。
- 独立工作区完成 frozen-lockfile install；使用既有 LODY_SKIP_ELECTRON_POSTINSTALL 跳过 Sparkle 下载，这不是打包验证。没有执行 Electron 安装包或真实 UI 验收。

没有读取或记录用户凭据，没有发起真实付费 API 请求。注入 transport 与进程内 MCP 测试证明协议、注册/拒绝与本地素材行为，不能证明任一兼容服务的权限、模型可用性或输出质量。
