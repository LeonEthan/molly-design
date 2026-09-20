import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MollyOperationItemResult, StoredMollyOperation } from '@molly/shared';
import * as commands from '../src/commands/session';
import { MessageHandler } from '../src/lib/message-handler';

type ActiveItem = Extract<MollyOperationItemResult, { status: 'active' }>;
const item: ActiveItem = {
  status: 'active',
  target: { sessionId: 'synthetic-target', userTurnId: 'synthetic-fixed-turn' },
  inputDurable: false,
};
const frozen = {
  agentConfigId: 'synthetic-exact-target',
  modelId: 'synthetic-frozen-model',
  configOptionValues: { reasoning_effort: 'high' },
  taskToolsEnabled: false,
  mcpServerIds: ['synthetic-frozen-mcp'],
  inheritSessionDefaults: false as const,
};

// Invoke the recovery boundary without starting a Worker, subscribing to real
// documents or contacting a daemon. The downstream command remains the owner
// of model validation and durable turn dispatch, tested separately.
const recover = MessageHandler.prototype as unknown as {
  materializeOperationTarget(
    operation: StoredMollyOperation,
    item: ActiveItem,
    index: number
  ): Promise<void>;
};
const host = {
  token: 'synthetic-unused',
  userId: 'synthetic-operator',
  machineId: 'synthetic-machine',
  machineName: 'Synthetic',
  workspaceId: 'synthetic-workspace',
  workspaceDocument: {
    repo: {
      getDocMeta: async () => ({ meta: { userId: 'synthetic-owner' } }),
    },
    getOrCreateSessionDoc: async () => {
      throw new Error('Recovery must not reread history defaults');
    },
  },
};

function operation(kind: 'session_chat' | 'session_chat_many'): StoredMollyOperation {
  const command = { sessionId: item.target.sessionId, prompt: 'Synthetic follow-up' };
  return {
    workspaceId: 'synthetic-workspace',
    ownerMachineId: 'synthetic-machine',
    requesterSessionId: 'synthetic-requester',
    requesterUserId: 'synthetic-human',
    operationId: 'synthetic-operation',
    kind,
    fingerprint: 'synthetic-fingerprint',
    canonicalCommand: kind === 'session_chat' ? command : { items: [command] },
    frozenContinuationConfig: {
      inputConfig: { cliType: 'builtin', agentType: 'molly', taskToolsEnabled: true },
      sourceTurnId: 'synthetic-source-turn',
      targetDispatchConfigs: [frozen],
    },
    initiatorChainDepth: 2,
    createdAt: '2026-09-20T00:00:00.000Z',
    deadlineAt: '2026-09-20T01:00:00.000Z',
    state: 'active',
    items: [item],
  };
}

afterEach(() => vi.restoreAllMocks());

describe.each(['session_chat', 'session_chat_many'] as const)(
  '%s materialization recovery',
  (kind) => {
    it('passes the frozen target config, fixed turn and original requester to dispatch', async () => {
      let observed: Parameters<typeof commands.sendSessionChatResult> | undefined;
      vi.spyOn(commands, 'sendSessionChatResult').mockImplementation(async (...args) => {
        observed = args;
        return {
          sessionId: item.target.sessionId,
          machineId: 'synthetic-machine',
          workspaceId: 'synthetic-workspace',
          userTurnId: item.target.userTurnId,
        };
      });
      await recover.materializeOperationTarget.call(host, operation(kind), item, 0);
      expect(observed?.slice(3)).toEqual([
        item.target.sessionId,
        'Synthetic follow-up',
        frozen,
        undefined,
        undefined,
        {
          userTurnId: item.target.userTurnId,
          chainDepth: 3,
          bypassSessionQuota: kind.endsWith('_many'),
        },
        { userId: 'synthetic-human' },
      ]);
    });

    it.each([undefined, [null]])(
      'refuses missing frozen target config %# without dispatch',
      async (configs) => {
        vi.spyOn(commands, 'sendSessionChatResult').mockRejectedValue(
          new Error('must not dispatch')
        );
        const stored = operation(kind);
        stored.frozenContinuationConfig.targetDispatchConfigs = configs;
        await expect(
          recover.materializeOperationTarget.call(host, stored, item, 0)
        ).rejects.toThrow('harness_frozen_chat_config_unavailable');
      }
    );
  }
);
