import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AgentSideConnection, type AnyMessage } from '@agentclientprotocol/sdk';
import type { ACPSessionId, SessionId, WorkspaceId } from '@molly/shared';
import { HarnessSessionBindingSchema } from '@molly/shared/embedded-harness';
import { LODY_EXTENSION_METHODS } from 'acp-extension-core';
import { AgentClient } from '../src/agent/agent-client';
import { EmbeddedHarnessControl } from '../src/agent/embedded-harness-control';
import { HarnessCredentialBroker } from '../src/agent/harness-credential-broker';
import { Session } from '../src/session/session';
import type { Logger } from '../src/utils/logger';
import { RunJournal } from '@molly/harness-pi';
import { managed } from '../../../packages/harness-pi/tests/fixtures/managed';
import { deferred } from '../../../packages/harness-pi/tests/fixtures/adapter';

const logger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  debug: () => {},
  setLevel: () => {},
  child: () => logger,
  close: async () => {},
};

describe('embedded prompt cancellation across the CLI and native worker', () => {
  it('returns the completed native receipt when the caller aborts during memory extraction', async () => {
    const publishing = deferred<void>();
    const release = deferred<void>();
    const cancelled = deferred<void>();
    const stopping = deferred<void>();
    const operations: unknown[] = [];
    const f = await managed({
      initialize: false,
      config: { personalMemory: true },
      peer: {
        extMethod: async (_method, params) => {
          operations.push(params);
          return { revision: 'r1', enabled: true, entries: [] };
        },
        extNotification: async (method, params) => {
          if (
            method === LODY_EXTENSION_METHODS.sessionUsageUpdate &&
            typeof params.usage === 'object' &&
            params.usage !== null &&
            'inputTokens' in params.usage &&
            params.usage.inputTokens === 3
          ) {
            publishing.resolve();
            await release.promise;
          }
        },
      },
    });
    const cancelPreparation = f.host.cancelPreparation.bind(f.host);
    vi.spyOn(f.host, 'cancelPreparation').mockImplementation(() => {
      cancelPreparation();
      cancelled.resolve();
    });
    const close = () => {
      toWorkerController.terminate();
      toClientController.terminate();
    };
    let toWorkerController!: TransformStreamDefaultController<AnyMessage>;
    let toClientController!: TransformStreamDefaultController<AnyMessage>;
    const toWorker = new TransformStream<AnyMessage, AnyMessage>({
      start: (controller) => {
        toWorkerController = controller;
      },
    });
    const toClient = new TransformStream<AnyMessage, AnyMessage>({
      start: (controller) => {
        toClientController = controller;
      },
    });
    const wire = new AgentSideConnection(() => f.agent, {
      readable: toWorker.readable,
      writable: toClient.writable,
    });
    const broker = new HarnessCredentialBroker();
    const stops: string[] = [];
    const control = new EmbeddedHarnessControl(f.config, f.pipe, broker, async () => {
      stops.push('stopped');
      stopping.resolve();
      f.host.retire();
      await f.agent.dispose();
      close();
    });
    const session = new Session(
      {
        workspaceId: f.config.workspaceId as WorkspaceId,
        requesterUserId: 'synthetic-user',
        machineId: 'synthetic-machine',
        agentCliType: 'builtin',
        agentType: 'molly',
        sessionId: f.config.productSessionId as SessionId,
        userName: 'Synthetic',
        userEmail: 'synthetic@example.invalid',
        mcpServerIds: [],
      },
      logger,
      f.cwd
    );
    const client = new AgentClient({
      sessionId: session.sessionId,
      logger,
      terminalManager: session.terminalManager,
      agentConfig: { cliType: 'builtin', agentType: 'molly' },
      onUpdateMessage: () => {},
      onRequestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    });
    try {
      broker.exchange({ version: 1, connections: [f.config.connection], reports: [] });
      const established = await client.startSession(
        { readable: toClient.readable, writable: toWorker.writable },
        f.cwd
      );
      const binding = HarnessSessionBindingSchema.parse(established._meta?.mollyRuntime);
      control.bind(binding);
      session.agentClient = client;
      session.acpSessionId = established.sessionId as ACPSessionId;
      Reflect.set(session, 'embeddedControl', control);
      const controller = new AbortController();
      const running = session.promptEmbeddedHarness(
        'synthetic-turn',
        [{ type: 'text', text: 'I prefer serif type.' }],
        controller.signal
      );
      const [grant] = broker.exchange({
        version: 1,
        connections: [f.config.connection],
        reports: [],
      });
      if (!grant) throw new Error('Credential request missing');
      broker.exchange({
        version: 1,
        connections: [f.config.connection],
        reports: [
          {
            requestId: grant.requestId,
            runId: grant.snapshot.runId,
            runtimeEpoch: f.config.runtimeEpoch,
            connectionId: f.config.connection.id,
            connectionRevision: f.config.connection.revision,
            result: { ok: true, apiKey: 'SYNTHETIC_SECRET' },
          },
        ],
      });
      await publishing.promise;
      expect(await new RunJournal(join(f.root, 'runs')).read(grant.snapshot.runId)).toMatchObject({
        state: 'settled',
        outcome: { status: 'completed', nativeEndEntryId: expect.any(String) },
      });
      controller.abort();
      await Promise.race([cancelled.promise, stopping.promise]);
      release.resolve();
      const response = await running;
      expect(response).toMatchObject({
        stopReason: 'end_turn',
        _meta: {
          mollyPersonalMemory: 'cancelled',
          mollyRunId: grant.snapshot.runId,
          mollyNativeOutcome: { status: 'completed', nativeEndEntryId: expect.any(String) },
        },
      });
      expect(await new RunJournal(join(f.root, 'runs')).read(grant.snapshot.runId)).toMatchObject({
        state: 'settled',
        outcome: response._meta?.mollyNativeOutcome,
      });
      expect(operations).toHaveLength(1);
      expect(f.observed).toHaveLength(2);
      expect(stops).toEqual([]);
      expect(control.needsReplacement(f.config.selection)).toBe(false);
    } finally {
      release.resolve();
      await f.agent.dispose();
      broker.dispose();
      close();
      await wire.closed;
    }
  });
});
