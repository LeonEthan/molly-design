import { describe, expect, it } from 'vitest';
import { parseMcpJsonImport } from '../src/mcp-json-import';
import { isWorkspaceMcpServerMeta } from '../src/workspace-mcp';

describe('parseMcpJsonImport', () => {
  it('reads one Pi/Claude/Cursor mcpServers entry with Pi presentation fields', () => {
    expect(
      parseMcpJsonImport(
        JSON.stringify({
          mcpServers: {
            github: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
              env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
              description: '  GitHub issues and pull requests  ',
              exposure: 'codemode-deferred',
              toolExposure: { search_issues: 'direct', ' delete_*': 'hidden' },
              cwd: '/repo',
              timeout: 30,
            },
          },
        })
      )
    ).toEqual({
      ok: true,
      server: {
        name: 'github',
        description: 'GitHub issues and pull requests',
        exposure: 'codemode',
        toolExposure: { search_issues: 'direct', 'delete_*': 'hidden' },
        connection: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
        },
      },
      ignoredFields: ['cwd', 'timeout'],
      referenceFields: ['GITHUB_TOKEN'],
    });
  });

  it('accepts a bare HTTP entry and moves a bearer Authorization header to the token field', () => {
    expect(
      parseMcpJsonImport(
        JSON.stringify({
          type: 'http',
          url: 'https://mcp.example.com/mcp',
          headers: { authorization: 'Bearer secret', 'X-Team': 'design' },
          oauth: { clientId: 'synthetic' },
        })
      )
    ).toEqual({
      ok: true,
      server: {
        connection: {
          transport: 'http',
          url: 'https://mcp.example.com/mcp',
          bearerToken: 'secret',
          headers: { 'X-Team': 'design' },
        },
      },
      ignoredFields: ['oauth'],
      referenceFields: [],
    });
  });

  it('reads a VS Code style servers map and a name-keyed map', () => {
    for (const root of [
      { servers: { figma: { url: 'https://mcp.figma.com/mcp' } } },
      { figma: { url: 'https://mcp.figma.com/mcp' } },
    ]) {
      const result = parseMcpJsonImport(JSON.stringify(root));
      expect(result.ok && result.server.name).toBe('figma');
    }
  });

  it('refuses input it cannot represent without guessing', () => {
    expect(parseMcpJsonImport('{')).toEqual({ ok: false, reason: 'invalid_json' });
    expect(parseMcpJsonImport('{"mcpServers":{}}')).toEqual({ ok: false, reason: 'no_server' });
    expect(
      parseMcpJsonImport(JSON.stringify({ mcpServers: { a: { url: 'x' }, b: { url: 'y' } } }))
    ).toEqual({ ok: false, reason: 'multiple_servers', names: ['a', 'b'] });
    expect(parseMcpJsonImport(JSON.stringify({ type: 'sse', url: 'https://x/sse' }))).toEqual({
      ok: false,
      reason: 'unsupported_transport',
    });
    expect(parseMcpJsonImport(JSON.stringify({ command: 'x', args: 'not-a-list' }))).toEqual({
      ok: false,
      reason: 'invalid_field',
      field: 'args',
    });
    expect(parseMcpJsonImport(JSON.stringify({ url: 'x', exposure: 'visible' }))).toEqual({
      ok: false,
      reason: 'invalid_field',
      field: 'exposure',
    });
  });
});

describe('catalog exposure fields', () => {
  const row = { id: 'server', name: 'Synthetic', transport: 'http', createdAt: 1, updatedAt: 1 };

  it('accepts Pi exposure names and rejects anything Pi would not accept', () => {
    expect(
      isWorkspaceMcpServerMeta({
        ...row,
        exposure: 'hidden',
        toolExposure: { search: 'direct', 'read_*': 'deferred' },
      })
    ).toBe(true);
    for (const invalid of [
      { exposure: 'visible' },
      { toolExposure: { search: 'visible' } },
      { toolExposure: { '': 'direct' } },
      { toolExposure: JSON.parse('{"__proto__":"direct"}') },
      { toolExposure: ['direct'] },
      {
        toolExposure: Object.fromEntries(
          Array.from({ length: 65 }, (_, index) => [`tool_${index}`, 'direct'])
        ),
      },
    ])
      expect(isWorkspaceMcpServerMeta({ ...row, ...invalid }), JSON.stringify(invalid)).toBe(false);
  });
});
