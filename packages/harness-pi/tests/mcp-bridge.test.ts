import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { McpCredentialBindingSchema } from '@molly/shared/embedded-harness';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { connectMcpBridge, defineMcpTools, mcpToolName } from '../src/mcp-bridge';
import { ToolOperationJournal } from '../src/tool-operation-journal';

const descriptor: Tool = {
  name: 'draw',
  inputSchema: { type: 'object', properties: { prompt: { type: 'string' } } },
};
function fixture() {
  let catalog: Tool[] = [descriptor];
  let available = true;
  let result: unknown = { content: [{ type: 'text', text: 'Synthetic result' }] };
  const dispatched: string[] = [];
  const input: Parameters<typeof defineMcpTools>[0] = {
    serverName: 'synthetic',
    client: {
      listTools: async () => ({ tools: catalog }),
      callTool: async () => {
        dispatched.push('called');
        return result as Awaited<ReturnType<typeof input.client.callTool>>;
      },
      close: async () => {},
      getServerCapabilities: () => ({ resources: {} }),
      readResource: async ({ uri }) => ({ contents: [{ uri, text: 'Synthetic resource' }] }),
    },
    approve: async () => true,
    isAvailable: () => available,
    dispatch: async (_server, _id, _name, _args, invoke) => invoke(),
  };
  return {
    input,
    dispatched,
    change: (tools: Tool[]) => {
      catalog = tools;
    },
    revoke: () => {
      available = false;
    },
    result: (value: unknown) => {
      result = value;
    },
  };
}

describe('frozen MCP tools', () => {
  it('routes protected HTTP headers only to the bound server using injected fetch, with no host environment mutation', async () => {
    const servers = ['first', 'second'].map((name) => {
      const url = `https://${name}.invalid/mcp`;
      const binding = McpCredentialBindingSchema.parse({
        workspaceId: 'workspace',
        serverId: name,
        credentialRef: randomUUID(),
        revision: 1,
        destination: { transport: 'http', url },
        fieldNames: ['Authorization'],
      });
      return {
        type: 'http' as const,
        name,
        url,
        headers: [],
        _meta: { mollyMcpCredential: binding },
      };
    });
    const observed: string[] = [];
    const environment = { ...process.env };
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const name = new URL(request.url).hostname.split('.')[0];
      expect(request.headers.get('authorization')).toBe(`Bearer SYNTHETIC_${name}`);
      expect(request.redirect).toBe('error');
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const message = await request.json();
      observed.push(`${name}:${message.method}`);
      if (message.id === undefined) return new Response(null, { status: 202 });
      const result =
        message.method === 'initialize'
          ? {
              protocolVersion: message.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name, version: '1' },
            }
          : message.method === 'tools/list'
            ? { tools: [descriptor] }
            : { content: [{ type: 'text', text: 'ok' }] };
      return Response.json({ jsonrpc: '2.0', id: message.id, result });
    });
    let bridge: Awaited<ReturnType<typeof connectMcpBridge>> | undefined;
    try {
      bridge = await connectMcpBridge(servers, {
        cwd: process.cwd(),
        approve: async () => true,
        dispatch: async (_server, _id, _tool, _args, invoke) => invoke(),
        credentials: servers.map((server) => ({
          connection: server._meta.mollyMcpCredential,
          values: { Authorization: `Bearer SYNTHETIC_${server.name}` },
        })),
      });
      expect((await bridge.tools[0]!.execute('first-call', {}, undefined)).content).toEqual([
        { type: 'text', text: 'ok' },
      ]);
      expect((await bridge.tools[1]!.execute('second-call', {}, undefined)).content).toEqual([
        { type: 'text', text: 'ok' },
      ]);
      expect(observed).toContain('first:tools/call');
      expect(observed).toContain('second:tools/call');
      expect(process.env).toEqual(environment);
    } finally {
      await bridge?.close();
      vi.unstubAllGlobals();
    }
  });
  it('namespaces ambiguous server/tool names and collects paginated tools', async () => {
    expect(mcpToolName('a-b', 'draw')).not.toBe(mcpToolName('a_b', 'draw'));
    expect(mcpToolName('molly', 'molly_render_preview')).toBe('molly_render_preview');
    const f = fixture();
    f.input.client.listTools = async (params) =>
      params?.cursor === 'next'
        ? { tools: [{ ...descriptor, name: 'edit' }] }
        : { tools: [descriptor], nextCursor: 'next' };
    expect((await defineMcpTools(f.input)).map((tool) => tool.label)).toEqual(['draw', 'edit']);
  });

  it('rejects duplicate descriptors and cyclic pagination', async () => {
    const f = fixture();
    f.change([descriptor, descriptor]);
    await expect(defineMcpTools(f.input)).rejects.toThrow('harness_mcp_duplicate_tool');
    f.input.client.listTools = async () => ({ tools: [descriptor], nextCursor: 'same' });
    await expect(defineMcpTools(f.input)).rejects.toThrow('harness_mcp_catalog_limit');
  });

  it.each(['schema', 'revoked', 'cancelled'] as const)(
    'does not dispatch when %s changes during approval',
    async (kind) => {
      const f = fixture();
      const controller = new AbortController();
      f.input.approve = async () => {
        if (kind === 'schema') f.change([{ ...descriptor, description: 'Changed behavior' }]);
        if (kind === 'revoked') f.revoke();
        if (kind === 'cancelled') controller.abort();
        return true;
      };
      const [tool] = await defineMcpTools(f.input);
      await expect(
        tool!.execute('call', { prompt: 'Synthetic' }, controller.signal)
      ).rejects.toThrow();
      expect(f.dispatched).toEqual([]);
    }
  );

  it('preserves supported content but refuses local file links and raw server diagnostics', async () => {
    const f = fixture();
    const [tool] = await defineMcpTools(f.input);
    expect((await tool!.execute('call1', {}, undefined)).content).toEqual([
      { type: 'text', text: 'Synthetic result' },
    ]);
    f.result({
      content: [{ type: 'resource_link', uri: 'file:///private/secret', name: 'private' }],
    });
    await expect(tool!.execute('call2', {}, undefined)).rejects.toThrow(
      'harness_mcp_result_unsupported'
    );
    f.result({ isError: true, content: [{ type: 'text', text: 'SYNTHETIC_ECHOED_KEY' }] });
    await expect(tool!.execute('call3', {}, undefined)).rejects.toThrow(
      /^harness_mcp_tool_failed$/
    );
    f.input.client.callTool = async () => {
      throw new Error('SYNTHETIC_TRANSPORT_KEY');
    };
    await expect(tool!.execute('call4', {}, undefined)).rejects.toThrow(
      /^harness_mcp_tool_failed$/
    );
  });

  it('reads links only through their producing client after separate approval and dispatch', async () => {
    const f = fixture();
    const events: string[] = [];
    f.result({
      content: [
        { type: 'text', text: 'before' },
        { type: 'resource_link', uri: 'synthetic://images/one', name: 'one' },
        { type: 'text', text: 'after' },
      ],
    });
    f.input.approve = async (request) => {
      events.push(`approve:${request.name}`);
      return true;
    };
    f.input.dispatch = async (_server, _id, name, _args, invoke) => {
      events.push(`dispatch:${name}`);
      return invoke();
    };
    f.input.client.readResource = async ({ uri }) => {
      events.push(`read:${uri}`);
      return { contents: [{ uri, text: 'from original server', mimeType: 'text/plain' }] };
    };
    const [tool] = await defineMcpTools(f.input);
    const result = await tool!.execute('call', {}, undefined);
    expect(result.content).toEqual([
      { type: 'text', text: 'before' },
      {
        type: 'text',
        text: 'MCP resource: {"uri":"synthetic://images/one","mimeType":"text/plain"}',
      },
      { type: 'text', text: 'from original server' },
      { type: 'text', text: 'after' },
    ]);
    expect(events).toEqual([
      'approve:synthetic/draw',
      'dispatch:draw',
      'approve:synthetic/resources/read',
      'dispatch:resources/read',
      'read:synthetic://images/one',
    ]);
  });

  it.each(['denied', 'revoked', 'schema', 'cancelled', 'unsupported'] as const)(
    'does not read a resource when %s during its approval',
    async (reason) => {
      const f = fixture();
      const controller = new AbortController();
      const reads: string[] = [];
      f.result({ content: [{ type: 'resource_link', uri: 'synthetic://one', name: 'one' }] });
      f.input.client.readResource = async ({ uri }) => {
        reads.push(uri);
        return { contents: [{ uri, text: 'not authorized' }] };
      };
      if (reason === 'unsupported') f.input.client.getServerCapabilities = () => ({});
      f.input.approve = async ({ name }) => {
        if (name.endsWith('/resources/read')) {
          if (reason === 'denied') return false;
          if (reason === 'revoked') f.revoke();
          if (reason === 'schema') f.change([{ ...descriptor, description: 'changed' }]);
          if (reason === 'cancelled') controller.abort();
        }
        return true;
      };
      const [tool] = await defineMcpTools(f.input);
      await expect(tool!.execute('call', {}, controller.signal)).rejects.toThrow(/^harness_/);
      expect(reads).toEqual([]);
    }
  );

  it('rejects resource URI substitution and late results after revocation', async () => {
    const f = fixture();
    f.result({ content: [{ type: 'resource_link', uri: 'synthetic://one', name: 'one' }] });
    const [tool] = await defineMcpTools(f.input);
    f.input.client.readResource = async () => ({
      contents: [{ uri: 'synthetic://other', text: 'wrong identity' }],
    });
    await expect(tool!.execute('one', {}, undefined)).rejects.toThrow(
      'harness_mcp_resource_mismatch'
    );
    f.input.client.readResource = async ({ uri }) => {
      f.revoke();
      return { contents: [{ uri, text: 'late' }] };
    };
    await expect(tool!.execute('two', {}, undefined)).rejects.toThrow(
      'harness_mcp_connection_changed'
    );
  });

  it('resolves a real stdio resource with separate durable receipts and native image content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'molly-mcp-resource-'));
    let bridge: Awaited<ReturnType<typeof connectMcpBridge>> | undefined;
    try {
      const journal = new ToolOperationJournal(join(root, 'operations'));
      const operations: Array<{ id: string; toolName: string }> = [];
      bridge = await connectMcpBridge(
        [
          {
            name: 'synthetic',
            command: process.execPath,
            env: [],
            args: [
              fileURLToPath(new URL('./fixtures/image-mcp.mjs', import.meta.url)),
              '--resource',
            ],
          },
        ],
        {
          cwd: root,
          approve: async () => true,
          dispatch: async (_server, toolCallId, toolName, args, invoke) => {
            const id = journal.operationId('synthetic-run', toolCallId);
            const result = await journal.dispatch(
              {
                snapshot: { runId: 'synthetic-run', runtimeEpoch: 'synthetic-epoch' },
                connectionId: 'synthetic',
                connectionRevision: 1,
                toolCallId,
                toolName,
                arguments: args,
              },
              invoke
            );
            operations.push({ id, toolName });
            return result;
          },
        }
      );
      const result = await bridge.tools[0]!.execute('synthetic-call', {}, undefined);
      expect(result.content).toEqual([
        {
          type: 'text',
          text: 'MCP resource: {"uri":"synthetic://image/one","mimeType":"image/png"}',
        },
        {
          type: 'image',
          mimeType: 'image/png',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        },
      ]);
      const receipts = await Promise.all(
        operations.map(async ({ id, toolName }) => ({
          toolName,
          state: (await journal.read(id)).state,
        }))
      );
      expect(receipts).toEqual([
        { toolName: 'molly_generate_image', state: 'succeeded' },
        { toolName: 'resources/read', state: 'succeeded' },
      ]);
    } finally {
      await bridge?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
