import { describe, expect, it } from 'vitest';
import { Flock } from '@loro-dev/flock-wasm';
import {
  listWorkspaceAgentRoles,
  readWorkspaceFlockRowsFromFlock,
  type AgentConfigId,
  type AgentRole,
  type AgentRoleId,
  type MachineId,
} from '@molly/shared';
import { createDirectWorkspaceWriter } from '../src/providers/workspace-writer-impl';

const source: AgentRole = {
  v: 1,
  id: 'synthetic-role' as AgentRoleId,
  ownerUserId: 'synthetic-user',
  visibility: 'private',
  name: 'Synthetic legacy role',
  machineId: 'machine-1' as MachineId,
  agentConfigId: 'legacy-config' as AgentConfigId,
  runConfig: { modelId: 'legacy-model', modeId: 'skip-permissions' },
  promptPrefix: 'Synthetic instructions',
  revision: 2,
  createdAt: 1,
  updatedAt: 2,
};
const key = ['agentRole', source.id];
const workspace = 'synthetic-workspace:wf:workspace';

function fixture() {
  const flock = new Flock('synthetic-workspace');
  flock.set(key, source);
  flock.commit();
  const writer = createDirectWorkspaceWriter({
    repo: { openFlockDoc: async () => ({ flock }) } as never,
    acquireSessionStore: async () => {
      throw new Error('must not open a session');
    },
    releaseSessionStoreRef: () => {},
    acquirePreviewVisualCommentStore: async () => {
      throw new Error('must not touch canvas');
    },
    releasePreviewVisualCommentStoreRef: () => {},
  });
  return { flock, writer };
}

describe('retired Role writes', () => {
  it('rejects new rows, updates, migration and deletion without changing the stored catalog', async () => {
    const { flock, writer } = fixture();
    for (const operation of [
      () => writer.flockRowPut(workspace, ['agentRole', 'new-role'], { ...source, id: 'new-role' }),
      () => writer.flockRowPut(workspace, key, { ...source, name: 'Changed', revision: 3 }),
      () => writer.flockRowPutIfAbsent(workspace, key, source),
      () => writer.flockRowDelete(workspace, key),
    ]) {
      await expect(operation()).rejects.toThrow('agent_roles_retired');
      expect(flock.get(key)).toEqual(source);
      expect(flock.get(['agentRole', 'new-role'])).toBeUndefined();
    }
  });

  it('preserves historical Role rows across a real Flock export and reopen', () => {
    const { flock } = fixture();
    const reopened = new Flock('synthetic-reopened');
    reopened.importFile(flock.exportFile());
    expect(reopened.get(key)).toEqual(source);
    expect(listWorkspaceAgentRoles(readWorkspaceFlockRowsFromFlock(reopened))).toEqual([source]);
  });
});
