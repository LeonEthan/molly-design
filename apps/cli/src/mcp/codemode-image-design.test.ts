import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LoroDoc } from 'loro-crdt';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CallToolResultSchema,
  JSONRPCMessageSchema,
  type JSONRPCMessage,
  type RequestId,
} from '@modelcontextprotocol/sdk/types.js';
import {
  IMAGE_CONNECTION_VERSION,
  MachineIdSchema,
  SessionIdSchema,
  applyNotificationOnHistory,
  buildMessageContentFromNotification,
  createHistoryWriter,
  type SessionMeta,
} from '@molly/shared';
import { createLoroSessionData } from '@molly/shared/session-data';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  deferred,
  fauxAssistantMessage,
  fauxToolCall,
  fixture,
} from '../../../../packages/harness-pi/tests/fixtures/adapter';
import { DESIGN_ARTIFACT_ENTRY } from '../design/artifact';
import { designOperation } from '../design/store';
import { materializeDesignTurnInput } from '../design/turn-input';
import { collectDesignTurnOutcome } from '../design/turn-outcome';
import { runWithMcpSessionContext } from './molly-mcp-server';
import { buildMollyImageMcpServer } from './molly-image-mcp-server';

const imageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);
const imageKey = 'SYNTHETIC_IMAGE_CONNECTION_KEY';
const timestamp = '2026-10-01T00:00:00.000Z';
const assetReceipt = z.object({
  path: z.string(),
  absolutePath: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.literal('image/png'),
  width: z.literal(1),
  height: z.literal(1),
});

function artwork(imagePath: string): string {
  return `format: molly-canvas/1
title: Synthetic Codemode artwork
size: [320, 200]
background:
  type: solid
  color: "#FFFFFF"
elements:
  - id: generated-image
    kind: image
    bounds: [20, 20, 100, 100]
    src: ${imagePath}
    fit: cover
`;
}

const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' });

it.each(['generate', 'edit'] as const)(
  'collects a real Molly %s receipt through native Codemode, image read and design CAS',
  async (operation) => {
    const toolName = operation;
    const args = {
      prompt: 'Synthetic red square',
      size: '1x1',
      background: 'opaque',
      output_format: 'png',
      ...(operation === 'edit' ? { images: ['reference.png'] } : {}),
    };
    const f = await fixture({
      responses: [
        call('codemode', {
          code: `text(await tools.mcp__molly_image__${toolName}(${JSON.stringify(args)}));`,
        }),
      ],
    });
    const sessionId = SessionIdSchema.parse(randomUUID());
    const machineId = MachineIdSchema.parse('synthetic-machine');
    const turnId = 'synthetic-image-turn';
    const created = await designOperation(f.root, {
      operation: 'create',
      association: {
        sessionId,
        name: 'Synthetic image design',
        userId: 'local:synthetic',
        machineId,
        createdAt: timestamp,
      },
      width: 320,
      height: 200,
    });
    const manifest = await materializeDesignTurnInput({
      workdir: f.cwd,
      turnId,
      artworkId: sessionId,
      prompt: 'Synthetic red square',
      skillSourceIdentity: 'synthetic-codemode',
      dataRoot: f.root,
    });
    expect(manifest.baselineRevisionId).toBe(created.revisionId);
    await writeFile(path.join(f.cwd, 'reference.png'), imageBytes);
    const doc = new LoroDoc();
    const writer = createHistoryWriter(doc);
    writer.append({
      id: turnId,
      role: 'user',
      items: [{ type: 'text', text: 'Synthetic red square' }],
      timestamp,
      status: 'handled',
      fileDiff: [],
    });
    const meta: SessionMeta = {
      id: sessionId,
      machineId,
      userId: 'local:synthetic',
      createdAt: timestamp,
      cliType: 'builtin',
      agentType: 'molly',
      design: { artworkId: sessionId, path: 'design.json' },
    };
    const sessionDoc = {
      sessionData: createLoroSessionData({ sessionId, doc, writer }),
      getMetaState: async () => meta,
    };
    const server = buildMollyImageMcpServer({
      designGate: {
        artworkWorkdir: f.cwd,
        workspaceRoot: f.cwd,
        imageConnection: {
          v: IMAGE_CONNECTION_VERSION,
          enabled: true,
          baseUrl: 'https://synthetic-images.invalid/v1',
          apiKey: imageKey,
          model: 'synthetic-selected-image-model',
          updatedAt: 0,
        },
      },
      imageTransport: async (request) => {
        expect(request.url).toBe(
          `https://synthetic-images.invalid/v1/images/${operation === 'generate' ? 'generations' : 'edits'}`
        );
        expect(request.method).toBe('POST');
        expect(request.headers.authorization).toBe(`Bearer ${imageKey}`);
        expect(JSON.parse(request.body ?? '')).toMatchObject({
          model: 'synthetic-selected-image-model',
          prompt: args.prompt,
          n: 1,
          size: args.size,
          background: args.background,
          output_format: args.output_format,
          ...(operation === 'edit'
            ? { images: [{ image_url: `data:image/png;base64,${imageBytes.toString('base64')}` }] }
            : {}),
        });
        return {
          status: 200,
          bytes: new TextEncoder().encode(
            JSON.stringify({ data: [{ b64_json: imageBytes.toString('base64') }] })
          ),
        };
      },
    });
    const context = {
      machineId,
      workspaceId: 'synthetic-workspace',
      sessionId,
      localControlSocketPath: undefined,
      workdir: f.cwd,
    };
    const [bridge, serverTransport] = InMemoryTransport.createLinkedPair();
    const pending = new Map<RequestId, ReturnType<typeof deferred<JSONRPCMessage>>>();
    const receipts: z.infer<typeof assetReceipt>[] = [];
    bridge.onmessage = (message) => {
      if ('id' in message && !('method' in message)) {
        pending.get(message.id)?.resolve(message);
        pending.delete(message.id);
      }
    };
    await runWithMcpSessionContext(context, () => server.connect(serverTransport));
    await bridge.start();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe('https://synthetic-mcp.invalid/mcp/molly_image');
      if (request.method === 'GET') return new Response(null, { status: 405 });
      if (request.method === 'DELETE') return new Response(null, { status: 200 });
      const message = JSONRPCMessageSchema.parse(await request.json());
      if (!('id' in message)) {
        await runWithMcpSessionContext(context, () => bridge.send(message));
        return new Response(null, { status: 202 });
      }
      const completed = deferred<JSONRPCMessage>();
      pending.set(message.id, completed);
      await runWithMcpSessionContext(context, () => bridge.send(message));
      const result = await completed.promise;
      if ('method' in message && message.method === 'tools/call' && 'result' in result) {
        const toolResult = CallToolResultSchema.parse(result.result);
        expect(toolResult.isError).toBeFalsy();
        const text = toolResult.content.find((block) => block.type === 'text');
        if (!text || text.type !== 'text') throw new Error('Image receipt missing');
        const receipt = assetReceipt.parse(toolResult.structuredContent);
        expect(JSON.parse(text.text)).toEqual(toolResult.structuredContent);
        receipts.push(receipt);
        expect(await readFile(receipt.absolutePath)).toEqual(imageBytes);
        expect(await designOperation(f.root, { operation: 'read', sessionId })).toEqual(created);
        f.responses.push(
          call('read', { path: receipt.absolutePath }),
          call('write', { path: DESIGN_ARTIFACT_ENTRY, content: artwork(receipt.path) }),
          fauxAssistantMessage('Synthetic image reviewed and artwork authored.')
        );
      }
      return Response.json(result);
    });
    try {
      await f.initialize();
      const session = await f.agent.newSession({
        cwd: f.cwd,
        mcpServers: [
          {
            name: 'molly_image',
            type: 'http',
            url: 'https://synthetic-mcp.invalid/mcp/molly_image',
            headers: [],
          },
        ],
      });
      const completed = await f.agent.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Synthetic red square' }],
      });
      expect(completed.stopReason).toBe('end_turn');
      const receipt = receipts.at(0);
      if (!receipt) throw new Error('Native Codemode did not return a Molly image receipt');
      expect(receipt.sha256).toBe(createHash('sha256').update(imageBytes).digest('hex'));
      expect(receipt.absolutePath).toBe(path.join(f.cwd, receipt.path));
      expect(f.prompts).toContainEqual(
        expect.stringContaining(`"data":"${imageBytes.toString('base64')}"`)
      );
      expect(JSON.stringify(f.prompts)).not.toContain(imageKey);
      expect(JSON.stringify(f.updates)).not.toContain(imageKey);
      const toolMessages = f.updates.flatMap(buildMessageContentFromNotification);
      const parent = toolMessages.find(
        (item) => item.type === 'tool_call' && item.toolName === 'codemode'
      );
      const nested = toolMessages.find(
        (item) =>
          item.type === 'tool_call' &&
          item.toolName === `mcp__molly_image__${toolName}` &&
          item.status === 'completed'
      );
      if (!parent || parent.type !== 'tool_call' || !nested || nested.type !== 'tool_call')
        throw new Error('Native image tool trace missing');
      expect(nested.parentToolCallId).toBe(parent.toolCallId);
      expect(JSON.stringify(nested.content)).toContain(receipt.path);
      writer.update((history) =>
        applyNotificationOnHistory(history, f.updates, undefined, {
          targetAssistantEntryId: 'synthetic-image-result',
          now: () => timestamp,
        })
      );
      const reopened = new LoroDoc();
      reopened.import(doc.export({ mode: 'snapshot' }));
      const storedResult = createHistoryWriter(reopened).read('synthetic-image-result');
      const storedImageCall = storedResult?.items.find(
        (item) => item.type === 'tool_call' && item.toolCallId === nested.toolCallId
      );
      expect(storedImageCall).toMatchObject({
        type: 'tool_call',
        toolName: `mcp__molly_image__${toolName}`,
        parentToolCallId: parent.toolCallId,
        status: 'completed',
      });
      expect(JSON.stringify(storedImageCall)).toContain(receipt.path);
      expect(JSON.stringify(storedResult)).not.toContain(imageKey);
      expect(await readFile(path.join(f.cwd, DESIGN_ARTIFACT_ENTRY), 'utf8')).toBe(
        artwork(receipt.path)
      );
      expect(await designOperation(f.root, { operation: 'read', sessionId })).toEqual(created);
      const outcome = await collectDesignTurnOutcome({
        sessionId,
        sessionDoc,
        turnId,
        workdir: f.cwd,
        dataRoot: f.root,
        designNativeTerminal: completed.stopReason === 'end_turn' ? 'end_turn' : 'failed',
        now: () => new Date(timestamp),
      });
      expect(outcome.status).toBe('recorded');
      if (outcome.status !== 'recorded') throw new Error('Design outcome was not recorded');
      expect(outcome.outcome.status).toBe('committed');
      if (outcome.outcome.status !== 'committed') throw new Error('Design was not committed');
      const current = await designOperation(f.root, { operation: 'read', sessionId });
      expect(current.revisionId).not.toBe(created.revisionId);
      expect(current.revisionId).toBe(outcome.outcome.revisionId);
      expect(current.assets[receipt.sha256]).toBe(
        `data:image/png;base64,${imageBytes.toString('base64')}`
      );
      expect(current.doc.elements).toContainEqual(
        expect.objectContaining({
          id: 'generated-image',
          kind: 'image',
          src: `asset:${receipt.sha256}`,
        })
      );
      expect(writer.readStored().find((entry) => entry.id === turnId)?.designOutcome).toEqual(
        outcome.outcome
      );
    } finally {
      await f.agent.dispose();
      await server.close();
      await bridge.close();
      vi.unstubAllGlobals();
    }
  }
);
