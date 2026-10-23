type Translate = (key: string, fallback: string, options?: Record<string, unknown>) => string;

const MCP_TOOL_NAME = /^mcp__(.+?)__(.+)$/;
const MOLLY_SERVER_IDS = new Set(['molly']);
const MOLLY_IMAGE_SERVER_ID = 'molly_image';
const WORK_FOLDER_PATH = /[^\s'"`]*\/\.(?:molly|molly-preview|lody)\/chats\/[^/\s'"`]+\/?/g;
const LEADING_WORK_FOLDER_CD = /^cd\s+\.\s*(?:&&|;)\s*/;
const PATH_BOUNDARY = /[\s'"`),\]}:;&|]/;
const BASH_PREFIX = /^bash:\s*/;

const MOLLY_TOOL_LABELS: Record<string, (t: Translate) => string> = {
  molly_render_preview: (t) => t('sessions.toolActivity.tool.renderPreview', 'Render preview'),
  molly_view_image: (t) => t('sessions.toolActivity.tool.viewImage', 'View image'),
  molly_resubmit_draft: (t) => t('sessions.toolActivity.tool.resubmitDraft', 'Resubmit draft'),
  molly_upload_files: (t) => t('sessions.toolActivity.tool.uploadFiles', 'Upload files'),
  molly_upload_images: (t) => t('sessions.toolActivity.tool.uploadImages', 'Upload images'),
  molly_report_preview_candidate: (t) =>
    t('sessions.toolActivity.tool.reportPreview', 'Report preview'),
  molly_mcp_configure: (t) => t('sessions.toolActivity.tool.configureTools', 'Configure tools'),
  molly_operation_get: (t) => t('sessions.toolActivity.tool.checkOperation', 'Check operation'),
  molly_operation_cancel: (t) =>
    t('sessions.toolActivity.tool.cancelOperation', 'Cancel operation'),
  molly_session_create: (t) => t('sessions.toolActivity.tool.createDesign', 'Create design'),
  molly_session_create_many: (t) => t('sessions.toolActivity.tool.createDesigns', 'Create designs'),
  molly_session_create_options: (t) =>
    t('sessions.toolActivity.tool.designOptions', 'Design options'),
  molly_session_chat: (t) => t('sessions.toolActivity.tool.messageDesign', 'Message design'),
  molly_session_chat_many: (t) => t('sessions.toolActivity.tool.messageDesigns', 'Message designs'),
  molly_session_history: (t) =>
    t('sessions.toolActivity.tool.designHistory', 'Read design history'),
  molly_session_list: (t) => t('sessions.toolActivity.tool.listDesigns', 'List designs'),
  molly_session_rename: (t) => t('sessions.toolActivity.tool.renameDesign', 'Rename design'),
  molly_session_rename_many: (t) => t('sessions.toolActivity.tool.renameDesigns', 'Rename designs'),
  molly_session_archive: (t) => t('sessions.toolActivity.tool.archiveDesign', 'Archive design'),
  molly_session_cancel: (t) => t('sessions.toolActivity.tool.cancelDesignRun', 'Cancel design run'),
  molly_session_status_many: (t) =>
    t('sessions.toolActivity.tool.designStatuses', 'Check design status'),
};

const MOLLY_IMAGE_TOOL_LABELS: Record<string, (t: Translate) => string> = {
  generate: (t) => t('sessions.toolActivity.tool.generateImage', 'Generate image'),
  edit: (t) => t('sessions.toolActivity.tool.editImage', 'Edit image'),
};

function ownLabel(
  labels: Record<string, (t: Translate) => string>,
  tool: string
): ((t: Translate) => string) | undefined {
  return Object.hasOwn(labels, tool) ? labels[tool] : undefined;
}

function humanizeToolName(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function describeMcpTool(server: string | null, tool: string, t: Translate): string {
  if (server === null || MOLLY_SERVER_IDS.has(server)) {
    const label = ownLabel(MOLLY_TOOL_LABELS, tool);
    if (label) return label(t);
  }
  if (server === MOLLY_IMAGE_SERVER_ID) {
    const label = ownLabel(MOLLY_IMAGE_TOOL_LABELS, tool);
    if (label) return label(t);
  }
  return humanizeToolName(tool.replace(/^molly_/, ''));
}

export function shortenWorkFolderPaths(text: string): string {
  return text.replace(WORK_FOLDER_PATH, (match, offset: number, input: string) => {
    const next = input[offset + match.length] ?? '';
    return next.length > 0 && !PATH_BOUNDARY.test(next) ? '' : '.';
  });
}

function describeBashCommand(command: string, t: Translate): string {
  const shortened = shortenWorkFolderPaths(command).replace(LEADING_WORK_FOLDER_CD, '');
  return t('sessions.toolActivity.runCommand', 'Command: {{command}}', { command: shortened });
}

export function describeToolTitle(rawTitle: string, t: Translate): string {
  const title = rawTitle.trim();
  const mcpMatch = MCP_TOOL_NAME.exec(title);
  if (mcpMatch) return describeMcpTool(mcpMatch[1]!, mcpMatch[2]!, t);
  if (/^molly_[a-z_]+$/.test(title)) return describeMcpTool(null, title, t);
  if (BASH_PREFIX.test(title)) return describeBashCommand(title.replace(BASH_PREFIX, ''), t);
  return shortenWorkFolderPaths(title);
}
