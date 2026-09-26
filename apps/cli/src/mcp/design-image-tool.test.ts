import http from 'node:http';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
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
import {
  HARNESS_INLINE_IMAGE_RESULT_META,
  HarnessImageImportRequestSchema,
} from '@molly/shared/embedded-harness';
import { importHarnessImages } from '@/design/harness-image-import';
import { recoverHarnessImages } from '@/design/harness-image-recovery';
import { resolveDesignWorkspace } from '@/design/workspace';
import { createHash, randomUUID } from 'node:crypto';

const TOOL_NAME = 'molly_generate_image';

it.each(['molly_generate_image', 'molly_edit_image'] as const)(
  'defers %s publication to the owning import service and recovers it by operation identity',
  async (name) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'molly-managed-image-'));
    const sessionId = randomUUID();
    const artworkId = randomUUID();
    const workspace = resolveDesignWorkspace({
      workspaceRoot: root,
      sessionId,
      artworkId,
      legacyWorkdir: path.join(root, 'input'),
    });
    await mkdir(workspace.artifactWorkdir, { recursive: true });
    const png = pngFixture(2, 3);
    const source = path.join(root, 'source.png');
    await writeFile(source, png);
    const args = {
      prompt: 'synthetic image',
      ...(name === 'molly_edit_image' ? { images: [source] } : {}),
    };
    try {
      await withServer(
        {
          workdir: root,
          designGate: {
            ...readyGate,
            artworkWorkdir: workspace.artifactWorkdir,
            workspaceRoot: root,
          },
          imageTransport: async (request) => {
            if (name === 'molly_edit_image')
              expect(JSON.parse(request.body ?? '').images).toEqual([
                { image_url: `data:image/png;base64,${png.toString('base64')}` },
              ]);
            return jsonResponse(200, { data: [{ b64_json: png.toString('base64') }] });
          },
        },
        async (client) => {
          const result = (await client.callTool({
            name,
            arguments: args,
            _meta: { [HARNESS_INLINE_IMAGE_RESULT_META]: 1 },
          })) as CallToolResult;
          expect(result.isError).not.toBe(true);
          expect(result._meta?.mollyImageOperation).toEqual({
            version: 1,
            state: 'succeeded',
            dispatched: true,
            assetDigests: [],
          });
          expect(await readdir(workspace.artifactWorkdir)).toEqual([]);
          const image = result.content.find((content) => content.type === 'image');
          if (!image || image.type !== 'image') throw new Error('expected inline image');
          const request = HarnessImageImportRequestSchema.parse({
            version: 1,
            runId: 'a'.repeat(64),
            runtimeEpoch: randomUUID(),
            productSessionId: sessionId,
            turnId: 'source-turn',
            toolCallId: 'paid-call',
            requestDigest: createHash('sha256').update(JSON.stringify(args)).digest('hex'),
            connectionId: 'image-connection',
            connectionRevision: 7,
            serverName: 'molly',
            toolName: name,
            images: [{ mimeType: image.mimeType, data: image.data }],
          });
          const operationDirectory = path.join(root, 'operations');
          const imported = await importHarnessImages({
            request,
            workspace,
            artworkId,
            operationDirectory,
            signal: new AbortController().signal,
          });
          const recovery = {
            sessionId,
            artworkId,
            operationDirectory,
            signal: new AbortController().signal,
            resolveWorkspace: async (turnId: string) => {
              expect(turnId).toBe('source-turn');
              return workspace;
            },
          };
          const listed = await recoverHarnessImages({ ...recovery, query: {} });
          if (listed.kind !== 'listed') throw new Error('expected recovery list');
          expect(listed.operations).toEqual([
            expect.objectContaining({
              connectionId: 'image-connection',
              connectionRevision: 7,
              toolName: name,
              expectedAssets: 1,
            }),
          ]);
          const verified = await recoverHarnessImages({
            ...recovery,
            query: { operationId: listed.operations[0].operationId },
          });
          expect(verified).toMatchObject({
            kind: 'verified',
            unavailable: [],
            assets: [
              expect.objectContaining({ sha256: imported.assets[0].sha256, width: 2, height: 3 }),
            ],
          });
          await expect(readFile(imported.assets[0].absolutePath)).resolves.toEqual(png);
          expect(await readdir(workspace.artifactWorkdir)).toEqual(['media']);
        }
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
const SECRET_KEY = 'sk-live-super-secret-value';

/** Synthetic PNG header for transport/metadata tests, not pixel-decoding evidence. */
function pngFixture(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height))),
    chunk('IEND', Buffer.alloc(0)),
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

  it('advertises a public catalog without acquiring a key, but refuses execution without a live grant', async () => {
    const gate = designGateFromRpcResult({
      type: 'design/image-connection',
      available: true,
      ready: false,
      connection: {
        enabled: true,
        baseUrl: 'https://images.example.com/v1',
        model: 'gpt-image-2',
        hasApiKey: true,
        updatedAt: 0,
      },
      credential: null,
      artworkWorkdir: '/tmp/workspace',
      workspaceRoot: '/tmp/workspace',
    });
    expect(gate.imageConnection).toBeNull();
    expect(gate.imageAvailable).toBe(true);
    expect(await listToolNames(gate)).toContain(TOOL_NAME);
    const { calls, transport } = recordedTransport(() => jsonResponse(500, {}));
    const result = await callGenerate({
      designGate: gate,
      resolveGate: async () => EMPTY_DESIGN_GATE,
      imageTransport: transport,
    });
    expect(result.isError).toBe(true);
    expect(calls).toEqual([]);
    expect(JSON.stringify(gate)).not.toContain(SECRET_KEY);
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
    expect(result._meta?.mollyImageOperation).toEqual({
      version: 1,
      state: 'succeeded',
      dispatched: true,
      assetDigests: [payload.sha256],
    });
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
    expect(result._meta?.mollyImageOperation).toEqual({
      version: 1,
      state: 'failed',
      dispatched: true,
      assetDigests: [],
    });
    expect(textOf(result)).not.toContain(SECRET_KEY);
  });

  it('reports lost upstream delivery as unknown rather than a safely retryable failure', async () => {
    const result = await callGenerate({
      designGate: readyGate,
      imageTransport: async () => {
        throw new Error('synthetic connection lost');
      },
    });
    expect(result.isError).toBe(true);
    expect(result._meta?.mollyImageOperation).toEqual({
      version: 1,
      state: 'outcome_unknown',
      dispatched: true,
      assetDigests: [],
    });
    expect(JSON.stringify(result)).not.toContain(SECRET_KEY);
  });

  it('keeps paid dispatch unknown when a valid-looking image header has no decodable pixels', async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'molly-invalid-image-'));
    const requests: string[] = [];
    try {
      const result = await callGenerate({
        designGate: readyGate,
        workdir,
        imageTransport: async (request) => {
          requests.push(`${request.method} ${request.url}`);
          return jsonResponse(200, {
            data: [{ b64_json: pngFixture(2, 2).subarray(0, 33).toString('base64') }],
          });
        },
      });
      expect(result.isError).toBe(true);
      expect(result._meta?.mollyImageOperation).toEqual({
        version: 1,
        state: 'outcome_unknown',
        dispatched: true,
        assetDigests: [],
      });
      expect(requests).toEqual(['POST https://images.example.com/v1/images/generations']);
      expect(await readdir(workdir)).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(SECRET_KEY);
    } finally {
      await rm(workdir, { recursive: true });
    }
  });

  it('preserves dispatched-unknown when safe asset publication refuses a symlinked directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'molly-image-import-refused-'));
    const workdir = path.join(root, 'work');
    const outside = path.join(root, 'outside');
    await mkdir(workdir);
    await mkdir(outside);
    await symlink(outside, path.join(workdir, 'media'));
    const requests: string[] = [];
    try {
      const result = await callGenerate({
        designGate: readyGate,
        workdir,
        imageTransport: async (request) => {
          requests.push(`${request.method} ${request.url}`);
          return jsonResponse(200, { data: [{ b64_json: pngFixture(1, 1).toString('base64') }] });
        },
      });
      expect(result.isError).toBe(true);
      expect(result._meta?.mollyImageOperation).toEqual({
        version: 1,
        state: 'outcome_unknown',
        dispatched: true,
        assetDigests: [],
      });
      expect(requests).toEqual(['POST https://images.example.com/v1/images/generations']);
      await expect(readdir(outside)).resolves.toEqual([]);
    } finally {
      await rm(root, { recursive: true });
    }
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

  it('forwards a transparent PNG request and refuses transparent JPEG before dispatch', async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'molly-design-image-'));
    const png = pngFixture(8, 8);
    const { calls, transport } = recordedTransport(() =>
      jsonResponse(200, { data: [{ b64_json: png.toString('base64') }] })
    );
    const config = { designGate: readyGate, imageTransport: transport, workdir };

    const layer = await callGenerate(config, {
      prompt: 'isolated teapot',
      background: 'transparent',
      output_format: 'png',
    });
    expect(layer.isError).toBeFalsy();
    expect(JSON.parse(calls[0]!.body ?? '{}')).toMatchObject({
      background: 'transparent',
      output_format: 'png',
    });

    const refused = await callGenerate(config, {
      prompt: 'isolated teapot',
      background: 'transparent',
      output_format: 'jpeg',
    });
    expect(refused.isError).toBe(true);
    expect(refused._meta?.mollyImageOperation).toMatchObject({
      state: 'failed',
      dispatched: false,
    });
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
      expect(JSON.parse(request.body ?? '').images).toEqual([
        { image_url: `data:image/png;base64,${png.toString('base64')}` },
      ]);
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
