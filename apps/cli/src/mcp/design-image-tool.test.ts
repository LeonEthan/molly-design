import http from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  IMAGE_CONNECTION_VERSION,
  type ImageHttpRequest,
  type ImageHttpResponse,
  type ImageHttpTransport,
  type SessionId,
} from '@molly/shared';
import {
  EMPTY_DESIGN_GATE,
  designGateFromRpcResult,
  resolveDesignGate,
  type McpDesignGate,
} from './design-tools';
import { buildMollyMcpServer, runWithMcpSessionContext } from './molly-mcp-server';

const TOOL_NAME = 'molly_generate_image';
const SECRET_KEY = 'sk-live-super-secret-value';

/** A real, decodable PNG of the requested size. */
function pngFixture(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from('IHDR', 'ascii'),
    header,
    Buffer.alloc(4),
  ]);
}

const readyGate: McpDesignGate = {
  imageConnection: {
    v: IMAGE_CONNECTION_VERSION,
    enabled: true,
    baseUrl: 'https://images.example.com/v1',
    apiKey: SECRET_KEY,
    model: 'gpt-image-2',
    updatedAt: 1_700_000_000_000,
  },
};

const jsonResponse = (status: number, body: unknown): ImageHttpResponse => ({
  status,
  bytes: new TextEncoder().encode(JSON.stringify(body)),
});

/**
 * Bind a throwaway local control socket (a named pipe on Windows, where unix
 * socket paths do not exist) and hand back its path. Loopback-only, like the
 * daemon's own control socket.
 */
async function listenOnFreshSocket(server: http.Server): Promise<string> {
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\lody-design-gate-${process.pid}-${Date.now()}`
      : path.join(await mkdtemp(path.join(os.tmpdir(), 'lody-design-gate-')), 'control.sock');
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  return socketPath;
}

function recordedTransport(handler: (request: ImageHttpRequest) => ImageHttpResponse): {
  calls: ImageHttpRequest[];
  transport: ImageHttpTransport;
} {
  const calls: ImageHttpRequest[] = [];
  return {
    calls,
    transport: async (request) => {
      calls.push(request);
      return handler(request);
    },
  };
}

async function withServer(
  options: {
    designGate?: McpDesignGate;
    resolveGate?: () => Promise<McpDesignGate>;
    imageTransport?: ImageHttpTransport;
    workdir?: string;
  },
  run: (client: Client) => Promise<void>
): Promise<void> {
  const server = buildMollyMcpServer({
    ...(options.designGate === undefined
      ? {}
      : {
          designGate: {
            artworkWorkdir: options.workdir ?? '/tmp/workspace',
            workspaceRoot: options.workdir ?? '/tmp/workspace',
            ...options.designGate,
          },
        }),
    ...(options.resolveGate === undefined ? {} : { resolveGate: options.resolveGate }),
    ...(options.imageTransport === undefined ? {} : { imageTransport: options.imageTransport }),
  });
  const client = new Client({ name: 'design-image-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const context = {
    machineId: 'machine-id',
    workspaceId: 'workspace-id',
    sessionId: 'current-session-id' as SessionId,
    localControlSocketPath: '/tmp/lody-control.sock',
    workdir: options.workdir ?? '/tmp/workspace',
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

const listToolNames = async (designGate?: McpDesignGate): Promise<string[]> => {
  let names: string[] = [];
  await withServer({ ...(designGate === undefined ? {} : { designGate }) }, async (client) => {
    names = (await client.listTools()).tools.map((tool) => tool.name);
  });
  return names;
};

const callGenerate = async (
  options: Parameters<typeof withServer>[0],
  args: Record<string, unknown> = { prompt: 'a red kite' }
): Promise<CallToolResult> => {
  let result: CallToolResult | undefined;
  await withServer(options, async (client) => {
    result = (await client.callTool({ name: TOOL_NAME, arguments: args })) as CallToolResult;
  });
  return result!;
};

const textOf = (result: CallToolResult): string =>
  result.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');

describe('molly_generate_image gate', () => {
  it('publishes autonomous image guidance while preserving paid-call disclosure', async () => {
    await withServer({ designGate: readyGate }, async (client) => {
      const tool = (await client.listTools()).tools.find((entry) => entry.name === TOOL_NAME);
      expect(tool?.description).toContain('actual image-reading tool');
      expect(tool?.description).toContain('only this generation tool is unavailable');
      expect(tool?.description).toContain('never retried automatically');
      expect(tool?.description).not.toContain('make one targeted change per call');
    });
  });

  it('is absent from the published tool list when no connection is configured', async () => {
    const names = await listToolNames();
    expect(names).not.toContain(TOOL_NAME);
    expect(names).toContain('molly_session_list');
  });

  it('is absent for an explicitly empty gate, a disabled connection, and a keyless one', async () => {
    expect(await listToolNames(EMPTY_DESIGN_GATE)).not.toContain(TOOL_NAME);
    expect(
      await listToolNames({ imageConnection: { ...readyGate.imageConnection!, enabled: false } })
    ).not.toContain(TOOL_NAME);
    expect(
      await listToolNames({ imageConnection: { ...readyGate.imageConnection!, apiKey: '' } })
    ).not.toContain(TOOL_NAME);
    expect(await listToolNames({ imageConnection: null })).not.toContain(TOOL_NAME);
  });

  it('is published exactly when the connection is complete and enabled', async () => {
    expect(await listToolNames(readyGate)).toContain(TOOL_NAME);
  });

  it('is not callable while it is absent from the list', async () => {
    let result: CallToolResult | undefined;
    await withServer({ designGate: EMPTY_DESIGN_GATE }, async (client) => {
      result = (await client.callTool({
        name: TOOL_NAME,
        arguments: { prompt: 'x' },
      })) as CallToolResult;
    });
    // Disabled means gone, not advertised-then-refused.
    expect(result!.isError).toBe(true);
  });
});

describe('resolveDesignGate', () => {
  it('answers "no capability" when the socket is unknown or unreachable, and never throws', async () => {
    const base = {
      machineId: 'machine-id',
      workspaceId: 'workspace-id',
      sessionId: 'current-session-id' as SessionId,
    };
    await expect(
      resolveDesignGate({ ...base, localControlSocketPath: undefined })
    ).resolves.toEqual(EMPTY_DESIGN_GATE);
    await expect(
      resolveDesignGate({
        ...base,
        localControlSocketPath: path.join(os.tmpdir(), `lody-absent-${process.pid}.sock`),
      })
    ).resolves.toEqual(EMPTY_DESIGN_GATE);
  });

  it('asks as the current session, so the daemon can apply the design-session rule', async () => {
    const bodies: string[] = [];
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        bodies.push(Buffer.concat(chunks).toString('utf8'));
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            ok: true,
            result: {
              type: 'design/image-connection',
              connection: {
                enabled: true,
                baseUrl: 'https://images.example.com/v1',
                model: 'gpt-image-2',
                hasApiKey: true,
                updatedAt: 1_700_000_000_000,
              },
              artworkWorkdir: '/tmp/workspace',
              workspaceRoot: '/tmp/workspace',
              ready: true,
              credential: { apiKey: SECRET_KEY },
            },
          })
        );
      });
    });
    const socketPath = await listenOnFreshSocket(server);

    try {
      const gate = await resolveDesignGate({
        machineId: 'machine-id',
        workspaceId: 'workspace-id',
        sessionId: 'design-session-id' as SessionId,
        localControlSocketPath: socketPath,
      });
      expect(gate.imageConnection?.apiKey).toBe(SECRET_KEY);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // The request names the asking session: without it the daemon answers
    // "no capability" (a coding session must never get the tool), so this field
    // is the whole design-session rule travelling with the question.
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0]!)).toMatchObject({
      method: 'design/image-connection',
      machineId: 'machine-id',
      workspaceId: 'workspace-id',
      ownerSessionId: 'design-session-id',
    });
  });
});

describe('the daemon answer decides registration', () => {
  /**
   * The daemon's own answers for one machine with a ready connection: the only
   * difference is the asking session's identity, which it folds into `ready`
   * and the credential. The daemon-side tests live in
   * `tests/message-handler-image-connection-rpc.test.ts`; here we pin what the
   * MCP server does with each answer.
   */
  const daemonAnswer = (
    overrides: {
      ready: boolean;
      credential: { apiKey: string } | null;
    },
    workspaceRoot = '/tmp/workspace'
  ): unknown => ({
    artworkWorkdir: workspaceRoot,
    workspaceRoot,
    type: 'design/image-connection',
    connection: {
      enabled: true,
      baseUrl: 'https://images.example.com/v1',
      model: 'gpt-image-2',
      hasApiKey: true,
      updatedAt: 1_700_000_000_000,
    },
    ...overrides,
  });

  it('publishes and calls the tool for a design session the daemon answered ready for', async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'molly-design-image-'));
    const png = pngFixture(4, 4);
    const { calls, transport } = recordedTransport(() =>
      jsonResponse(200, { data: [{ b64_json: png.toString('base64') }] })
    );
    const designGate = designGateFromRpcResult(
      daemonAnswer({ ready: true, credential: { apiKey: SECRET_KEY } }, workdir)
    );

    expect(await listToolNames(designGate)).toContain(TOOL_NAME);
    const result = await callGenerate({ designGate, imageTransport: transport, workdir });
    expect(result.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
  });

  it('leaves the tool absent and spends nothing for a coding session on a ready machine', async () => {
    const { calls, transport } = recordedTransport(() => jsonResponse(200, {}));
    const designGate = designGateFromRpcResult(daemonAnswer({ ready: false, credential: null }));

    // Identity is the whole difference: same machine, same ready row, and the
    // gate is still empty because the asking session is not a design session.
    expect(designGate).toEqual(EMPTY_DESIGN_GATE);
    expect(await listToolNames(designGate)).not.toContain(TOOL_NAME);

    const result = await callGenerate({ designGate, imageTransport: transport });
    expect(result.isError).toBe(true);
    // Absent means absent: the refusal happens before any paid call is built.
    expect(calls).toEqual([]);
  });
});

describe('molly_generate_image call', () => {
  it('generates through the configured upstream and returns the landed asset', async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'molly-design-image-'));
    const png = pngFixture(64, 48);
    const { calls, transport } = recordedTransport(() =>
      jsonResponse(200, { data: [{ b64_json: png.toString('base64') }] })
    );

    const result = await callGenerate(
      { designGate: readyGate, imageTransport: transport, workdir },
      { prompt: 'a red kite on white', size: '1024x1024' }
    );

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result)) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.path).toMatch(/^media\/[a-f0-9]{64}\.png$/);
    expect(payload.width).toBe(64);
    expect(payload.height).toBe(48);
    expect(textOf(result)).not.toContain(SECRET_KEY);

    // The request went to the configured endpoint under the configured model,
    // with the key present as a header only.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://images.example.com/v1/images/generations');
    expect(JSON.parse(calls[0]!.body ?? '{}')).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'a red kite on white',
      size: '1024x1024',
      n: 1,
    });
    await expect(readFile(path.join(workdir, String(payload.path)))).resolves.toEqual(png);
  });

  it('surfaces an upstream failure as a tool error, with no secret in it', async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'molly-design-image-'));
    const { transport } = recordedTransport(() =>
      jsonResponse(400, { error: { message: 'prompt violates content policy' } })
    );

    const result = await callGenerate({
      designGate: readyGate,
      imageTransport: transport,
      workdir,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('prompt violates content policy');
    expect(textOf(result)).not.toContain(SECRET_KEY);
  });

  it('re-checks the gate before spending, and refuses a connection revoked mid-session', async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'molly-design-image-'));
    const { calls, transport } = recordedTransport(() =>
      jsonResponse(200, { data: [{ b64_json: pngFixture(2, 2).toString('base64') }] })
    );
    // Built while the connection was live, then the user turns it off: the tool
    // is still listed (the snapshot said so) but the paid call is not made.
    const resolveGate = vi.fn(async () => EMPTY_DESIGN_GATE);

    let listed = false;
    let result: CallToolResult | undefined;
    await withServer(
      { designGate: readyGate, resolveGate, imageTransport: transport, workdir },
      async (client) => {
        listed = (await client.listTools()).tools.some((tool) => tool.name === TOOL_NAME);
        result = (await client.callTool({
          name: TOOL_NAME,
          arguments: { prompt: 'a red kite' },
        })) as CallToolResult;
      }
    );

    expect(listed).toBe(true);
    expect(resolveGate).toHaveBeenCalled();
    expect(result!.isError).toBe(true);
    expect(textOf(result!)).toMatch(/unavailable/i);
    expect(calls).toEqual([]);
  });

  it.each([
    { name: 'molly_generate_image', args: { prompt: 'synthetic generation' } },
    {
      name: 'molly_edit_image',
      args: { prompt: 'synthetic edit', images: ['source.png'] },
    },
  ])('propagates SDK cancellation into a pending $name request', async ({ name, args }) => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'molly-image-cancel-'));
    const png = pngFixture(4, 4);
    await writeFile(path.join(workdir, 'source.png'), png);
    let markStarted = () => {};
    let markCancelled = () => {};
    let release = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const cancelled = new Promise<void>((resolve) => {
      markCancelled = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport: ImageHttpTransport = async (request) => {
      if (!request.signal) throw new Error('missing MCP cancellation signal');
      request.signal.addEventListener('abort', markCancelled, { once: true });
      markStarted();
      await held;
      return jsonResponse(200, { data: [{ b64_json: png.toString('base64') }] });
    };
    try {
      await withServer(
        { designGate: readyGate, imageTransport: transport, workdir },
        async (client) => {
          const controller = new AbortController();
          const call = client.callTool({ name, arguments: args }, undefined, {
            signal: controller.signal,
          });
          await started;
          controller.abort(new Error('synthetic native cancellation'));
          await expect(call).rejects.toBeInstanceOf(Error);
          await cancelled;
          release();
        }
      );
      await expect(readdir(path.join(workdir, 'media'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      release();
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it('refuses an empty prompt and unknown arguments', async () => {
    const empty = await callGenerate(
      { designGate: readyGate, imageTransport: async () => jsonResponse(200, {}) },
      { prompt: '   ' }
    );
    expect(empty.isError).toBe(true);

    const extra = await callGenerate(
      { designGate: readyGate, imageTransport: async () => jsonResponse(200, {}) },
      { prompt: 'ok', apiKey: SECRET_KEY }
    );
    expect(extra.isError).toBe(true);
    expect(textOf(extra)).not.toContain(SECRET_KEY);
  });
});

describe('molly_edit_image', () => {
  it('shares the generation gate including an explicitly empty model', async () => {
    expect(await listToolNames()).not.toContain('molly_edit_image');
    expect(await listToolNames(readyGate)).toContain('molly_edit_image');
    const connection = readyGate.imageConnection;
    if (!connection) throw new Error('missing fixture connection');
    const gate = { imageConnection: { ...connection, model: '' } };
    const names = await listToolNames(gate);
    expect(names).not.toContain('molly_generate_image');
    expect(names).not.toContain('molly_edit_image');
  });

  it('validates edit inputs and returns a workspace asset from actual uploaded files', async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'molly-edit-mcp-'));
    const png = pngFixture(4, 3);
    await writeFile(path.join(workdir, 'source.png'), png);
    const uploaded: string[] = [];
    const transport: ImageHttpTransport = async (request) => {
      uploaded.push(request.url);
      expect(Buffer.from(request.multipart?.files[0]?.bytes ?? [])).toEqual(png);
      return jsonResponse(200, { data: [{ b64_json: png.toString('base64') }] });
    };
    await withServer(
      { designGate: readyGate, imageTransport: transport, workdir },
      async (client) => {
        const invalid = await client.callTool({
          name: 'molly_edit_image',
          arguments: { prompt: 'edit', images: [] },
        });
        expect(invalid.isError).toBe(true);
        const result = (await client.callTool({
          name: 'molly_edit_image',
          arguments: { prompt: 'edit', images: ['source.png'] },
        })) as CallToolResult;
        expect(result.isError).toBeFalsy();
        const payload = JSON.parse(textOf(result));
        expect(await readFile(path.join(workdir, payload.path))).toEqual(png);
        expect(textOf(result)).not.toContain(SECRET_KEY);
      }
    );
    expect(uploaded).toEqual(['https://images.example.com/v1/images/edits']);
  });
});

describe('resolved artwork asset directory', () => {
  it('uses the daemon artwork directory for generation and accepts workspace attachments for edits', async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'molly-artwork-image-'));
    const artworkWorkdir = path.join(workdir, '.geon', 'artworks', 'synthetic');
    const png = pngFixture(4, 4);
    const { transport } = recordedTransport(() =>
      jsonResponse(200, { data: [{ b64_json: png.toString('base64') }] })
    );
    const designGate = { ...readyGate, artworkWorkdir, workspaceRoot: workdir };
    try {
      const generated = await callGenerate({ workdir, designGate, imageTransport: transport });
      expect(generated.isError).toBeFalsy();
      const asset = JSON.parse(textOf(generated));
      expect(asset.absolutePath).toBe(path.join(artworkWorkdir, asset.path));
      const attachment = path.join(workdir, 'reference.png');
      await writeFile(attachment, png);
      await withServer({ workdir, designGate, imageTransport: transport }, async (client) => {
        const edited = (await client.callTool({
          name: 'molly_edit_image',
          arguments: { prompt: 'Synthetic edit', images: [attachment] },
        })) as CallToolResult;
        expect(edited.isError).toBeFalsy();
        expect(JSON.parse(textOf(edited)).absolutePath).toBe(asset.absolutePath);
      });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });
});
