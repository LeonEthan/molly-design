import { describe, expect, it } from 'vitest';
import { resolveMcpContent } from '../src/mcp-content';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const noRead = async () => {
  throw new Error('unexpected read');
};

describe('MCP content boundary', () => {
  it('maps embedded images and text without host reads, preserving order and resource identity', async () => {
    expect(
      await resolveMcpContent(
        {
          content: [
            {
              type: 'resource',
              resource: { uri: 'asset://one', blob: png, mimeType: 'image/png' },
            },
            { type: 'resource', resource: { uri: 'asset://two', text: 'Synthetic text' } },
          ],
        },
        noRead
      )
    ).toEqual([
      { type: 'text', text: 'MCP resource: {"uri":"asset://one","mimeType":"image/png"}' },
      { type: 'image', data: png, mimeType: 'image/png' },
      { type: 'text', text: 'MCP resource: {"uri":"asset://two"}' },
      { type: 'text', text: 'Synthetic text' },
    ]);
  });

  it.each([
    'file:///private/secret',
    'data:text/plain,secret',
    'javascript:alert(1)',
    'blob:https://example.test/one',
    '../local',
    'https://user:secret@example.test/asset',
  ])('rejects unsafe URI %s before resource dispatch', async (uri) => {
    await expect(
      resolveMcpContent({ content: [{ type: 'resource_link', uri, name: 'one' }] }, noRead)
    ).rejects.toThrow('harness_mcp_result_unsupported');
  });

  it('reuses a duplicate link within one result only', async () => {
    const reads: string[] = [];
    const link = { type: 'resource_link', uri: 'https://example.test/one', name: 'one' };
    const result = await resolveMcpContent({ content: [link, link] }, async (uri) => {
      reads.push(uri);
      return { contents: [{ uri, text: 'Synthetic' }] };
    });
    expect(reads).toEqual(['https://example.test/one']);
    expect(result.filter((part) => part.type === 'text' && part.text === 'Synthetic')).toHaveLength(
      2
    );
  });

  it.each(['a', 'abcd=', 'AB==', '', 'not base64'])(
    'rejects malformed image base64 %s',
    async (data) => {
      await expect(
        resolveMcpContent({ content: [{ type: 'image', mimeType: 'image/png', data }] }, noRead)
      ).rejects.toThrow('harness_mcp_result_unsupported');
    }
  );

  it('bounds the aggregate payload before extra reads, including UTF-8 byte length', async () => {
    await expect(
      resolveMcpContent(
        {
          content: [
            { type: 'resource_link', uri: 'asset://one', name: 'one' },
            ...Array.from({ length: 6 }, () => ({ type: 'text', text: '测'.repeat(1_300_000) })),
          ],
        },
        noRead
      )
    ).rejects.toThrow('harness_mcp_result_limit');
  });

  it('carries a complete 16 MiB inline image without dropping its encoded tail', async () => {
    const data = Buffer.alloc(16 * 1024 * 1024).toString('base64');
    const content = [{ type: 'image' as const, mimeType: 'image/png', data }];
    expect(await resolveMcpContent({ content }, noRead)).toEqual(content);
  });

  it('rejects nested links and unrecognized binary resources without recursively fetching', async () => {
    for (const content of [
      { uri: 'asset://one', type: 'resource_link', name: 'nested' },
      { uri: 'asset://one', blob: 'YWJj', mimeType: 'application/octet-stream' },
    ]) {
      await expect(
        resolveMcpContent(
          { content: [{ type: 'resource_link', uri: 'asset://one', name: 'one' }] },
          async () => ({ contents: [content] })
        )
      ).rejects.toThrow('harness_mcp_resource_mismatch');
    }
  });
});
