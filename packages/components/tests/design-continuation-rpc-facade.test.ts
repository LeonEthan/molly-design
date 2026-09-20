import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_MACHINE_PROTOCOL_CAPABILITIES,
  DesignContinuationPreparationResultSchema,
  type MachineId,
  type WorkspaceId,
} from '@molly/shared';
import { createWorkspaceMachineRpcFacade } from '../src/providers/workspace-machine-rpc-facade';

const result = () =>
  DesignContinuationPreparationResultSchema.parse({
    type: 'session/design-continuation-prepare',
    record: {
      version: 1,
      workspaceId: 'workspace-1',
      source: {
        id: 'source',
        machineId: 'machine-1',
        userId: 'local:user',
        cliType: 'builtin',
        agentType: 'codex',
        design: { artworkId: 'artwork', path: 'design.json' },
      },
      target: {
        sessionId: '00000000-0000-4000-8000-000000000001',
        agentConfigId: 'molly-config',
        createdAt: '2026-09-20T00:00:00.000Z',
      },
      reference: {
        version: 1,
        source: { sessionId: 'source', artworkId: 'artwork', machineId: 'machine-1' },
        messages: [],
        attachmentCandidates: [],
        omitted: { turns: 0, items: 0, attachments: 0 },
      },
    },
    attachments: [],
  });
const params = {
  version: 1 as const,
  sourceSessionId: 'source',
  targetAgentConfigId: 'molly-config',
  requestedByUserId: 'local:user',
};
const machineId = 'machine-1' as MachineId;
afterEach(() => vi.unstubAllGlobals());
function fixture(
  response: unknown = { ok: true, result: result() },
  capability = true,
  local = true
) {
  const sent: unknown[] = [];
  vi.stubGlobal('window', {
    __MOLLY_ELECTRON__: true,
    ipc: {
      invoke: async (...args: unknown[]) => {
        sent.push(args);
        return response;
      },
    },
  });
  const facade = createWorkspaceMachineRpcFacade({
    workspaceId: 'workspace-1' as WorkspaceId,
    getMachineProtocolCapabilities: async () =>
      capability ? CURRENT_MACHINE_PROTOCOL_CAPABILITIES : undefined,
    targetRouter: {
      getPlaneForMachine: () => (local ? 'local' : null),
      resolvePlaneForMachine: async () => (local ? 'local' : null),
    },
  });
  return { sent, prepare: () => facade.requestDesignContinuationPreparation(machineId, params) };
}
describe('design continuation local RPC facade', () => {
  it('sends preparation through the existing local bridge only', async () => {
    const f = fixture();
    await expect(f.prepare()).resolves.toEqual(result());
    expect(f.sent).toEqual([
      [
        'machineRpc.send',
        {
          machineId,
          workspaceId: 'workspace-1',
          method: 'session/design-continuation-prepare',
          params,
          timeoutMs: 120_000,
        },
      ],
    ]);
  });
  it.each(['capability', 'route'] as const)('does not send without %s', async (missing) => {
    const f = fixture(undefined, missing !== 'capability', missing !== 'route');
    await expect(f.prepare()).rejects.toThrow(
      missing === 'capability'
        ? 'design_continuation_unsupported'
        : 'design_continuation_local_machine_unavailable'
    );
    expect(f.sent).toEqual([]);
  });
  it.each(['workspace', 'machine', 'source', 'owner', 'config', 'extra'] as const)(
    'rejects a returned %s mismatch',
    async (field) => {
      const value = result();
      if (field === 'workspace') value.record.workspaceId = 'other';
      if (field === 'machine')
        value.record.source.machineId = value.record.reference.source.machineId = 'other';
      if (field === 'source')
        value.record.source.id = value.record.reference.source.sessionId = 'other';
      if (field === 'owner') value.record.source.userId = 'other';
      if (field === 'config') value.record.target.agentConfigId = 'other';
      const f = fixture({
        ok: true,
        result: field === 'extra' ? { ...value, secret: 'synthetic-private' } : value,
      });
      await expect(f.prepare()).rejects.toThrow('design_continuation_binding_mismatch');
    }
  );
  it('surfaces a preparation refusal without an execution fallback', async () => {
    const f = fixture({ ok: false, error: 'design_continuation_source_busy' });
    await expect(f.prepare()).rejects.toThrow('design_continuation_source_busy');
    expect(f.sent).toEqual([
      [
        'machineRpc.send',
        expect.objectContaining({ method: 'session/design-continuation-prepare' }),
      ],
    ]);
  });
});
