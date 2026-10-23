import { describe, expect, it } from 'vitest';

import { describeToolTitle, shortenWorkFolderPaths } from '../src/lib/tool-activity-title';

const t = (_key: string, fallback: string, options?: Record<string, unknown>) =>
  Object.entries(options ?? {}).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
    fallback
  );

const WORK_FOLDER = '/Users/someone/.molly-preview/chats/5958271a-1111-2222-3333-444455556666';

describe('describeToolTitle', () => {
  it('labels known Molly tools for designers', () => {
    expect(describeToolTitle('mcp__molly__molly_render_preview', t)).toBe('Render preview');
    expect(describeToolTitle('molly_view_image', t)).toBe('View image');
    expect(describeToolTitle('mcp__molly_image__generate', t)).toBe('Generate image');
  });

  it('humanizes unknown MCP tools without the server prefix', () => {
    expect(describeToolTitle('mcp__acme__fetch_page_title', t)).toBe('Fetch page title');
    expect(describeToolTitle('mcp__molly__molly_future_tool', t)).toBe('Future tool');
    expect(describeToolTitle('mcp__acme__constructor', t)).toBe('Constructor');
  });

  it('shortens work-folder paths in commands and drops the no-op cd', () => {
    expect(describeToolTitle(`bash: cd ${WORK_FOLDER} && python3 scripts/render.py`, t)).toBe(
      'Command: python3 scripts/render.py'
    );
    expect(describeToolTitle(`bash: cat ${WORK_FOLDER}/design.yaml`, t)).toBe(
      'Command: cat design.yaml'
    );
  });

  it('leaves unrelated titles and paths alone', () => {
    expect(describeToolTitle('Find usages', t)).toBe('Find usages');
    expect(shortenWorkFolderPaths('/usr/local/bin/node')).toBe('/usr/local/bin/node');
  });

  it('turns the bare work folder into a dot', () => {
    expect(shortenWorkFolderPaths(`ls ${WORK_FOLDER}`)).toBe('ls .');
    expect(shortenWorkFolderPaths(`ls ${WORK_FOLDER}/ -la`)).toBe('ls . -la');
  });
});
