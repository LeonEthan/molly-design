import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import {
  AgentBrowserCommandSchema,
  AgentBrowserScopeSchema,
  type AgentBrowserCommand,
  type AgentBrowserReply,
} from '@molly/shared/browser-agent-rpc';
import {
  buildMollyBrowserMcpServer,
  type MollyBrowserMcpServerConfig,
} from '@/mcp/molly-browser-mcp-server';
import { buildMollyMcpServer } from '@/mcp/molly-mcp-server';

const observationId = '550e8400-e29b-41d4-a716-446655440000';
const SHA = 'a'.repeat(64);

const connect = async (config: MollyBrowserMcpServerConfig) => {
  const server = buildMollyBrowserMcpServer(config);
  const client = new Client({ name: 'browser-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
};

const answering = (reply: AgentBrowserReply) => {
  const sent: AgentBrowserCommand[] = [];
  const config: MollyBrowserMcpServerConfig = {
    browserHost: true,
    requestOperation: async (command) => {
      sent.push(command);
      return { ok: true, reply };
    },
  };
  return { sent, config };
};

describe('molly_browser catalog', () => {
  it('publishes one strict tool per action with hints, typed results and mechanics in instructions', async () => {
    const client = await connect({ browserHost: true });
    const tools = (await client.listTools()).tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'back',
      'check',
      'click',
      'dialog',
      'forward',
      'frame',
      'navigate',
      'press',
      'read',
      'reload',
      'save_image',
      'screenshot',
      'scroll',
      'select',
      'snapshot',
      'type',
      'wait',
      'webmcp_cancel',
      'webmcp_invoke',
      'webmcp_list',
      'webmcp_result',
    ]);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties ?? {}).not.toHaveProperty('kind');
      expect(tool.inputSchema).toHaveProperty('additionalProperties', false);
    }
    expect(byName.get('navigate')?.inputSchema.required).toEqual(['url']);
    expect(byName.get('type')?.inputSchema.required).toEqual(['ref', 'observationId', 'text']);
    expect(byName.get('snapshot')?.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.get('screenshot')?.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.get('click')?.annotations).toMatchObject({
      destructiveHint: true,
      openWorldHint: true,
    });
    expect(byName.get('navigate')?.annotations).toMatchObject({ openWorldHint: true });
    expect(byName.get('snapshot')?.outputSchema?.properties).toHaveProperty('truncated');
    expect(byName.get('save_image')?.outputSchema?.properties).toHaveProperty('path');
    expect(byName.get('screenshot')?.outputSchema).toBeUndefined();
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toMatch(/latest snapshot/);
    expect(instructions).toMatch(/take control/);
    expect(instructions).toMatch(/untrusted/);
  });

  it('publishes no actions when no desktop browser is connected', async () => {
    const client = await connect({});
    expect((await client.listTools()).tools).toEqual([]);
    expect(client.getInstructions()).toContain('unavailable in this session');
  });

  it('no longer lives on the molly server', async () => {
    const server = buildMollyMcpServer({});
    const client = new Client({ name: 'molly-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).not.toContain('molly_browser');
    expect(names.some((name) => name.startsWith('browser_'))).toBe(false);
  });
});

describe('molly_browser results', () => {
  it('returns a snapshot as structured content scripts can filter without parsing headers', async () => {
    const reply = {
      kind: 'snapshot',
      url: 'https://example.com/gallery',
      title: 'Gallery',
      observationId,
      snapshot: '- img "poster" [ref=e5]',
      truncated: false,
    } as const;
    const { sent, config } = answering(reply);
    const result = await (await connect(config)).callTool({ name: 'snapshot', arguments: {} });
    expect(sent).toEqual([{ kind: 'snapshot' }]);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      url: 'https://example.com/gallery',
      title: 'Gallery',
      observationId,
      snapshot: '- img "poster" [ref=e5]',
      truncated: false,
    });
  });

  it('returns the page URL and title after an action', async () => {
    const { sent, config } = answering({
      kind: 'page',
      url: 'https://example.com/',
      title: 'Home',
    });
    const result = await (
      await connect(config)
    ).callTool({
      name: 'type',
      arguments: { ref: 'e2', observationId, text: 'poster' },
    });
    expect(sent).toEqual([{ kind: 'type', ref: 'e2', observationId, text: 'poster' }]);
    expect(result.structuredContent).toEqual({ url: 'https://example.com/', title: 'Home' });
  });

  it('returns a saved image as a structured media asset', async () => {
    const saved = {
      pageUrl: 'https://example.com/',
      imageUrl: 'https://cdn.example.com/a.png',
      path: 'media/a.png',
      sha256: SHA,
      mimeType: 'image/png',
      width: 10,
      height: 20,
      bytes: 300,
    };
    const { config } = answering({ kind: 'saved_image', ...saved });
    const result = await (
      await connect(config)
    ).callTool({
      name: 'save_image',
      arguments: { ref: 'e9', observationId },
    });
    expect(result.structuredContent).toEqual(saved);
  });

  it('keeps a screenshot as an inline image block', async () => {
    const { config } = answering({
      kind: 'image',
      mimeType: 'image/jpeg',
      base64: '/9j/AA==',
      pageUrl: 'https://example.com/',
    });
    const result = await (await connect(config)).callTool({ name: 'screenshot', arguments: {} });
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('https://example.com/') },
      { type: 'image', mimeType: 'image/jpeg', data: '/9j/AA==' },
    ]);
    expect(result.structuredContent).toBeUndefined();
  });

  it('refuses without dispatch when the desktop disconnected after registration', async () => {
    const { sent, config } = answering({ kind: 'page', url: 'https://example.com/', title: '' });
    const client = await connect({ ...config, resolveBrowserHost: async () => false });
    const result = await client.callTool({
      name: 'click',
      arguments: { ref: 'e1', observationId },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'The Molly desktop browser is not connected.' },
    ]);
    expect(sent).toEqual([]);
  });

  it('passes a host failure through as a tool error', async () => {
    const client = await connect({
      browserHost: true,
      requestOperation: async () => ({ ok: false, error: 'Browser element changed.' }),
    });
    const result = await client.callTool({
      name: 'click',
      arguments: { ref: 'e1', observationId },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'Browser element changed.' }]);
  });
});

describe('embedded browser command boundary', () => {
  it('binds page ownership without a website allowlist', () => {
    expect(
      AgentBrowserScopeSchema.safeParse({
        sessionId: 'session-1',
        browserId: 'session-browser-session-1',
        runId: 'run-1',
      }).success
    ).toBe(true);
  });

  it('accepts browser destinations without applying public-network policy in the tool schema', () => {
    for (const url of ['http://localhost:3000', 'http://192.168.0.1', 'file:///tmp/reference.html'])
      expect(AgentBrowserCommandSchema.safeParse({ kind: 'navigate', url }).success).toBe(true);
  });

  it('accepts upstream references but rejects selectors, scripts and file output', () => {
    expect(
      AgentBrowserCommandSchema.safeParse({ kind: 'click', ref: 'e5', observationId }).success
    ).toBe(true);
    expect(
      AgentBrowserCommandSchema.safeParse({ kind: 'save_image', ref: 'e9', observationId }).success
    ).toBe(true);
    for (const command of [
      { kind: 'click', ref: 'button' },
      { kind: 'click', ref: 1, snapshotId: 'old' },
      { kind: 'click', ref: 'e5', observationId, function: 'arbitrary()' },
      { kind: 'screenshot', filename: '/tmp/output.png' },
      { kind: 'browser_run_code_unsafe', code: 'arbitrary()' },
      { kind: 'scroll', deltaY: '0); arbitrary()' },
    ])
      expect(AgentBrowserCommandSchema.safeParse(command).success).toBe(false);
  });
});
