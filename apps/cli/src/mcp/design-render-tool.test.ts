/**
 * `molly_render_preview` (P2.4b): the tool exists exactly while a Molly desktop
 * is polling the daemon, and every answer it gives is the daemon's own.
 *
 * The capability here is not a credential, so the gate is not a setting: it is
 * "is a window open right now". That is why the tool is registered disabled
 * rather than advertised-then-refused — an agent that cannot render should not
 * see the tool at all, and should be told to ask the user to open Molly.
 *
 * The socket servers below are real unix sockets (a named pipe on Windows)
 * speaking the same envelope the daemon does; nothing here reaches the network.
 */

import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { SessionId } from '@molly/shared';
import { defineMcpTools } from '../../../../packages/harness-pi/src/mcp-bridge';
import { renderHostFromRpcResult, resolveRenderHost } from './design-tools';
import { buildMollyMcpServer, runWithMcpSessionContext } from './molly-mcp-server';

const TOOL_NAME = 'molly_render_preview';
const SESSION_ID = 'design-session-id' as SessionId;

/**
 * Bind a throwaway local control socket and hand back its path. Loopback-only,
 * like the daemon's own control socket.
 */
async function listenOnFreshSocket(server: http.Server): Promise<string> {
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\lody-render-tool-${process.pid}-${Date.now()}`
      : path.join(await mkdtemp(path.join(os.tmpdir(), 'lody-render-tool-')), 'control.sock');
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  return socketPath;
}

/** What the daemon answered after `design/render-host-status`. */
const hostStatusAnswer = (connected: boolean): unknown => ({
  type: 'design/render-host-status',
  connected,
});

/** What the daemon answered after `design/render-preview`. */
const renderAnswer = (
  result:
    | { ok: true; path: string; width: number; height: number; bytes: number }
    | { ok: false; error: string }
): unknown => ({ type: 'design/render-preview', ...result });

/** A socket that answers everything with one fixed result and records bodies. */
async function withAnsweringSocket(
  result: unknown,
  run: (socketPath: string, bodies: string[]) => Promise<void>
): Promise<void> {
  const bodies: string[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, result }));
    });
  });
  const socketPath = await listenOnFreshSocket(server);
  try {
    await run(socketPath, bodies);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function withServer(
  options: {
    renderHost?: boolean;
    resolveRenderHost?: () => Promise<boolean>;
    localControlSocketPath?: string;
  },
  run: (client: Client) => Promise<void>
): Promise<void> {
  const server = buildMollyMcpServer({
    ...(options.renderHost === undefined ? {} : { renderHost: options.renderHost }),
    ...(options.resolveRenderHost === undefined
      ? {}
      : { resolveRenderHost: options.resolveRenderHost }),
  });
  const client = new Client({ name: 'design-render-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const context = {
    machineId: 'machine-id',
    workspaceId: 'workspace-id',
    sessionId: SESSION_ID,
    localControlSocketPath: options.localControlSocketPath ?? '/tmp/lody-control.sock',
    workdir: '/tmp/workspace',
    taskToolsEnabled: false,
  };
  await runWithMcpSessionContext(context, async () => {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      await run(client);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
}

const listToolNames = async (options: Parameters<typeof withServer>[0] = {}): Promise<string[]> => {
  let names: string[] = [];
  await withServer(options, async (client) => {
    names = (await client.listTools()).tools.map((tool) => tool.name);
  });
  return names;
};

const callRender = async (options: Parameters<typeof withServer>[0] = {}) => {
  let result: CallToolResult | undefined;
  await withServer(options, async (client) => {
    result = (await client.callTool({ name: TOOL_NAME, arguments: {} })) as CallToolResult;
  });
  return result!;
};

const textOf = (result: CallToolResult): string =>
  result.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');

describe('molly_render_preview gate', () => {
  it('publishes image-reading guidance without imposing a creative gate', async () => {
    await withServer({ renderHost: true }, async (client) => {
      const tool = (await client.listTools()).tools.find((entry) => entry.name === TOOL_NAME);
      expect(tool?.description).toContain('actual image-reading tool');
      expect(tool?.description).toContain('Choose review depth and iterations');
      expect(tool?.description).toContain('other Agent image capabilities may still be available');
      expect(tool?.description).toContain('not completion or commit gates');
    });
  });

  it('is absent from the published tool list while no desktop is polling', async () => {
    const names = await listToolNames();
    expect(names).not.toContain(TOOL_NAME);
    // The rest of the server is unaffected: a missing preview renderer must not
    // quietly disable anything else.
    expect(names).toContain('molly_session_list');
  });

  it('is absent for an explicit false and present for a running desktop', async () => {
    expect(await listToolNames({ renderHost: false })).not.toContain(TOOL_NAME);
    expect(await listToolNames({ renderHost: true })).toContain(TOOL_NAME);
  });

  it('is not callable while it is absent from the list', async () => {
    // Disabled means gone, not advertised-then-refused.
    const result = await callRender({ renderHost: false });
    expect(result.isError).toBe(true);
  });

  it('never asks the daemon for a render while the tool is absent', async () => {
    await withAnsweringSocket(
      renderAnswer({ ok: true, path: 'p', width: 1, height: 1, bytes: 1 }),
      async (socketPath, bodies) => {
        await callRender({ renderHost: false, localControlSocketPath: socketPath });
        expect(bodies).toEqual([]);
      }
    );
  });
});

describe('resolveRenderHost', () => {
  const context = (localControlSocketPath: string | undefined) => ({
    machineId: 'machine-id',
    workspaceId: 'workspace-id',
    sessionId: SESSION_ID,
    localControlSocketPath,
  });

  it('answers "no desktop" for a missing or unreachable socket, and never throws', async () => {
    await expect(resolveRenderHost(context(undefined))).resolves.toBe(false);
    await expect(
      resolveRenderHost(context(path.join(os.tmpdir(), `lody-absent-${process.pid}.sock`)))
    ).resolves.toBe(false);
  });

  it('asks as the current session and reads the daemon’s own answer', async () => {
    await withAnsweringSocket(hostStatusAnswer(true), async (socketPath, bodies) => {
      await expect(resolveRenderHost(context(socketPath))).resolves.toBe(true);

      // The asking session travels with the question: only the daemon can apply
      // the design-session half of the rule, so the request must name it.
      expect(bodies).toHaveLength(1);
      expect(JSON.parse(bodies[0]!)).toMatchObject({
        method: 'design/render-host-status',
        machineId: 'machine-id',
        workspaceId: 'workspace-id',
        ownerSessionId: SESSION_ID,
        params: {},
      });
    });
  });

  it('reads a disconnected host and an unexpected answer as "no desktop"', async () => {
    await withAnsweringSocket(hostStatusAnswer(false), async (socketPath) => {
      await expect(resolveRenderHost(context(socketPath))).resolves.toBe(false);
    });
    // A daemon that answers the preview method here is answering a question
    // nobody asked: the only answer that means "yes" is the status one.
    await withAnsweringSocket(
      renderAnswer({ ok: true, path: 'p', width: 1, height: 1, bytes: 1 }),
      async (socketPath) => {
        await expect(resolveRenderHost(context(socketPath))).resolves.toBe(false);
      }
    );
    expect(renderHostFromRpcResult({ type: 'design/render-image', connected: true })).toBe(false);
    expect(renderHostFromRpcResult(hostStatusAnswer(true))).toBe(true);
  });
});

describe('molly_render_preview call', () => {
  it.each([
    ['Font failed to load', 'harness_render_font_failed'],
    ['Canvas capture did not settle on the saved artwork', 'harness_render_failed'],
    ['SYNTHETIC_RENDER_SECRET', 'harness_mcp_tool_failed'],
  ])('delivers only a safe Agent failure for the native refusal %s', async (error, code) => {
    await withAnsweringSocket(renderAnswer({ ok: false, error }), async (socketPath) => {
      await withServer({ renderHost: true, localControlSocketPath: socketPath }, async (client) => {
        const tools = await defineMcpTools({
          serverName: 'molly',
          client,
          approve: async () => true,
          isAvailable: () => true,
          dispatch: async (_server, _id, _name, _args, invoke) => invoke(),
        });
        const tool = tools.find((entry) => entry.name === TOOL_NAME);
        expect(tool).toBeDefined();
        await expect(tool!.execute('preview', {}, undefined)).rejects.toThrow(
          new RegExp(`^${code}$`)
        );
      });
    });
  });

  it('renders through the daemon and returns the landed preview', async () => {
    await withAnsweringSocket(
      renderAnswer({
        ok: true,
        path: '/workspace/artwork/design-preview/1789041600000-abcd1234.png',
        width: 320,
        height: 200,
        bytes: 4096,
      }),
      async (socketPath, bodies) => {
        const result = await callRender({ renderHost: true, localControlSocketPath: socketPath });

        expect(result.isError).toBeFalsy();
        expect(JSON.parse(textOf(result))).toMatchObject({
          ok: true,
          path: '/workspace/artwork/design-preview/1789041600000-abcd1234.png',
          width: 320,
          height: 200,
          bytes: 4096,
        });

        // The daemon owns the workdir, the intake, and the queue, so the request
        // carries nothing but the asking session.
        expect(bodies).toHaveLength(1);
        expect(JSON.parse(bodies[0]!)).toMatchObject({
          method: 'design/render-preview',
          machineId: 'machine-id',
          workspaceId: 'workspace-id',
          ownerSessionId: SESSION_ID,
          params: {},
        });
      }
    );
  });

  it('surfaces the daemon’s refusal — including a desktop that went away mid-render', async () => {
    await withAnsweringSocket(
      renderAnswer({
        ok: false,
        error: 'the Molly desktop restarted before the preview was rendered',
      }),
      async (socketPath) => {
        const result = await callRender({ renderHost: true, localControlSocketPath: socketPath });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('restarted before the preview was rendered');
      }
    );
  });

  it('refuses an unreachable daemon rather than reporting a render', async () => {
    const result = await callRender({
      renderHost: true,
      localControlSocketPath: path.join(os.tmpdir(), `lody-absent-${process.pid}.sock`),
    });
    expect(result.isError).toBe(true);
  });

  it('re-checks the host before rendering, and refuses one that quit mid-session', async () => {
    await withAnsweringSocket(
      renderAnswer({ ok: true, path: 'p', width: 1, height: 1, bytes: 1 }),
      async (socketPath, bodies) => {
        // Built while a desktop was polling, then the window closed: the tool is
        // still listed (the snapshot said so) but nothing is rendered.
        const recheck = vi.fn(async () => false);
        const result = await callRender({
          renderHost: true,
          resolveRenderHost: recheck,
          localControlSocketPath: socketPath,
        });

        expect(recheck).toHaveBeenCalled();
        expect(result.isError).toBe(true);
        expect(textOf(result)).toMatch(/not running/i);
        // Absent means absent: no render was ever asked for.
        expect(bodies).toEqual([]);
      }
    );
  });
});
