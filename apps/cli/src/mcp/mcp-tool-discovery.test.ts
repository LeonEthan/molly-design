import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MCP_TOOL_DISCOVERY_LIMITS } from '@molly/shared/embedded-harness';
import {
  buildDiscoveryTransport,
  discoverMcpTools,
  secretFragments,
} from '@/mcp/mcp-tool-discovery';

const sdkUrl = (path: string) =>
  pathToFileURL(createRequire(import.meta.url).resolve(`@modelcontextprotocol/sdk/${path}`)).href;

const linked = async (server: McpServer | Server) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  return clientTransport;
};

const pagedServer = (pages: Array<{ names: string[]; nextCursor?: string }>) => {
  const server = new Server({ name: 'paged', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, (request) => {
    const page = pages[Number(request.params?.cursor ?? 0)] ?? { names: [] };
    return {
      tools: page.names.map((name) => ({ name, inputSchema: { type: 'object' as const } })),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  });
  return server;
};

describe('Settings MCP tool discovery', () => {
  it('returns names, descriptions and only the hints a server declares', async () => {
    const server = new McpServer({ name: 'synthetic', version: '1.0.0' });
    server.registerTool(
      'search_issues',
      {
        description: 'Search issues.',
        inputSchema: { query: z.string() },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      () => ({ content: [] })
    );
    server.registerTool(
      'delete_repo',
      { title: 'Delete a repository', annotations: { destructiveHint: true } },
      () => ({ content: [] })
    );
    server.registerTool('ping', {}, () => ({ content: [] }));
    expect(await discoverMcpTools(await linked(server))).toEqual({
      ok: true,
      truncated: false,
      tools: [
        {
          name: 'search_issues',
          description: 'Search issues.',
          readOnlyHint: true,
          openWorldHint: true,
        },
        { name: 'delete_repo', title: 'Delete a repository', destructiveHint: true },
        { name: 'ping' },
      ],
    });
  });

  it('follows pagination and stops on a repeated cursor instead of looping', async () => {
    expect(
      await discoverMcpTools(
        await linked(pagedServer([{ names: ['a'], nextCursor: '1' }, { names: ['b'] }]))
      )
    ).toEqual({ ok: true, truncated: false, tools: [{ name: 'a' }, { name: 'b' }] });
    expect(
      await discoverMcpTools(
        await linked(
          pagedServer([
            { names: ['a'], nextCursor: '1' },
            { names: ['b'], nextCursor: '1' },
          ])
        )
      )
    ).toEqual({ ok: false, reason: 'invalid_response' });
  });

  it('marks a list past the tool limit as truncated rather than complete', async () => {
    const names = Array.from({ length: MCP_TOOL_DISCOVERY_LIMITS.tools + 5 }, (_, i) => `t${i}`);
    const result = await discoverMcpTools(await linked(pagedServer([{ names }])));
    expect(result.ok && result.truncated).toBe(true);
    expect(result.ok && result.tools).toHaveLength(MCP_TOOL_DISCOVERY_LIMITS.tools);
  });

  it('redacts credential values a server echoes back in tool text', async () => {
    const server = new McpServer({ name: 'echo', version: '1.0.0' });
    server.registerTool(
      'whoami',
      { description: 'Uses token synthetic-secret-123 for calls.' },
      () => ({ content: [] })
    );
    expect(await discoverMcpTools(await linked(server), ['synthetic-secret-123'])).toEqual({
      ok: true,
      truncated: false,
      tools: [{ name: 'whoami', description: 'Uses token ••• for calls.' }],
    });
  });

  it('redacts the bare bearer token, not only the stored header value', async () => {
    const server = new McpServer({ name: 'echo', version: '1.0.0' });
    server.registerTool(
      'whoami',
      { title: 'Token tok7 inside', description: 'Signed in with abcd1234token.' },
      () => ({ content: [] })
    );
    server.registerTool('abcd1234token_probe', {}, () => ({ content: [] }));
    const secrets = secretFragments({
      Authorization: 'Bearer abcd1234token',
      SHORT_KEY: 'tok7',
      LOG_LEVEL: 'on',
    });
    expect(secrets).toEqual(['Bearer abcd1234token', 'abcd1234token', 'tok7']);
    expect(await discoverMcpTools(await linked(server), secrets)).toEqual({
      ok: true,
      truncated: false,
      tools: [{ name: 'whoami', title: 'Token ••• inside', description: 'Signed in with •••.' }],
    });
  });

  it('reports a server that fails to start as unreachable, never as an empty list', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await serverTransport.close();
    expect(await discoverMcpTools(clientTransport)).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('starts a stdio server with saved values but without unrelated parent secrets', async () => {
    const script = `
      const { McpServer } = await import(${JSON.stringify(sdkUrl('server/mcp.js'))});
      const { StdioServerTransport } = await import(${JSON.stringify(sdkUrl('server/stdio.js'))});
      const server = new McpServer({ name: 'stdio-fixture', version: '1.0.0' });
      server.registerTool('token_' + Boolean(process.env.SYNTHETIC_TOKEN), {}, () => ({ content: [] }));
      server.registerTool('parent_' + Boolean(process.env.UNRELATED_PARENT_SECRET), {}, () => ({ content: [] }));
      await server.connect(new StdioServerTransport());
    `;
    process.env.UNRELATED_PARENT_SECRET = 'synthetic-parent-value';
    try {
      const transport = buildDiscoveryTransport({
        destination: {
          transport: 'stdio',
          command: process.execPath,
          args: ['--input-type=module', '-e', script],
        },
        values: { SYNTHETIC_TOKEN: 'synthetic-token-value' },
      });
      expect(await discoverMcpTools(transport)).toEqual({
        ok: true,
        truncated: false,
        tools: [{ name: 'token_true' }, { name: 'parent_false' }],
      });
    } finally {
      delete process.env.UNRELATED_PARENT_SECRET;
    }
  });
});
