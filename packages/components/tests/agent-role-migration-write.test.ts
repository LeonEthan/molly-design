import { describe, expect, it } from 'vitest';
import { Flock } from '@loro-dev/flock-wasm';
import type { AgentConfigId, AgentRole, AgentRoleId, MachineId } from '@molly/shared';
import { encodeMollyModelOption } from '@molly/shared/embedded-harness';
import { createDirectWorkspaceWriter } from '../src/providers/workspace-writer-impl';
import {
  buildAgentRoleMigrationFormValue,
  buildMigratedAgentRole,
} from '../src/lib/agent-role-form';

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
const target = buildMigratedAgentRole(
  source,
  {
    ...buildAgentRoleMigrationFormValue(source),
    agentConfigId: 'molly-config' as AgentConfigId,
    modelId: encodeMollyModelOption('synthetic-connection', 'synthetic-model'),
  },
  3
);
const key = ['agentRole', source.id];
const workspace = 'synthetic-workspace:wf:workspace';

function fixture(beforeMachineRead?: (flock: Flock) => void) {
  const flock = new Flock('synthetic-workspace');
  flock.set(key, source);
  flock.commit();
  const machine = new Flock('synthetic-machine');
  machine.set(['agentConfig', target.agentConfigId], {
    id: target.agentConfigId,
    machineId: source.machineId,
    name: 'Molly',
    cliType: 'builtin',
    agentType: 'molly',
    env: {},
  });
  machine.commit();
  const writer = createDirectWorkspaceWriter({
    repo: {
      openFlockDoc: async (id: string) => {
        if (id === workspace) return { flock };
        if (id !== 'synthetic-workspace:mf:machine-1') throw new Error('unexpected document');
        beforeMachineRead?.(flock);
        return { flock: machine };
      },
    } as never,
    acquireSessionStore: async () => {
      throw new Error('must not open a session');
    },
    releaseSessionStoreRef: () => {},
    acquirePreviewVisualCommentStore: async () => {
      throw new Error('must not touch canvas');
    },
    releasePreviewVisualCommentStoreRef: () => {},
  });
  return { flock, machine, writer };
}

describe('explicit Role migration through the real Flock writer', () => {
  const newRole: AgentRole = {
    ...source,
    id: 'new-role' as AgentRoleId,
    agentConfigId: target.agentConfigId,
    runConfig: target.runConfig,
    revision: 1,
  };
  const newKey = ['agentRole', newRole.id];

  it('creates and updates an ordinary Molly Role through the same validated writer', async () => {
    const { writer, flock } = fixture();
    await writer.flockRowPut(workspace, newKey, newRole);
    expect(flock.get(newKey)).toEqual(newRole);
    const updated = { ...newRole, name: 'Explicitly edited', revision: 2, updatedAt: 3 };
    await writer.flockRowPut(workspace, newKey, updated);
    expect(flock.get(newKey)).toEqual(updated);
    expect(flock.get(key)).toEqual(source);
  });

  it.each(['missing', 'legacy', 'registry', 'custom', 'override'])(
    'does not insert a new Role with a %s target',
    async (kind) => {
      const { writer, flock, machine } = fixture();
      const configKey = ['agentConfig', target.agentConfigId];
      if (kind === 'missing') machine.delete(configKey);
      else
        machine.set(configKey, {
          id: target.agentConfigId,
          machineId: source.machineId,
          name: 'Synthetic target',
          cliType: kind === 'registry' || kind === 'custom' ? kind : 'builtin',
          agentType: kind === 'legacy' ? 'kimi' : 'molly',
          env: {},
          ...(kind === 'override' ? { runtimeOverrides: {} } : {}),
          ...(kind === 'custom' ? { customAcp: { command: 'synthetic-agent', args: [] } } : {}),
        });
      machine.commit();
      await expect(writer.flockRowPut(workspace, newKey, newRole)).rejects.toThrow(
        'agent_role_target_unavailable'
      );
      expect(flock.get(newKey)).toBeUndefined();
      expect(flock.get(key)).toEqual(source);
    }
  );

  it('requires a migration backup instead of rebinding an old Role with a normal save', async () => {
    const { writer, flock } = fixture();
    await expect(
      writer.flockRowPut(workspace, key, {
        ...source,
        agentConfigId: target.agentConfigId,
        runConfig: target.runConfig,
        revision: 3,
      })
    ).rejects.toThrow('agent_role_migration_required');
    expect(flock.get(key)).toEqual(source);
  });

  it.each([{}, { modelId: 'old-model' }, { ...target.runConfig, modeId: 'skip-permissions' }])(
    'rejects missing or legacy run preferences before creating a Role: %j',
    async (runConfig) => {
      const { writer, flock } = fixture();
      await expect(
        writer.flockRowPut(workspace, newKey, { ...newRole, runConfig })
      ).rejects.toThrow();
      expect(flock.get(newKey)).toBeUndefined();
    }
  );

  it('does not bypass target validation through generic insert-if-absent', async () => {
    const { writer, flock } = fixture();
    await expect(writer.flockRowPutIfAbsent(workspace, newKey, newRole)).rejects.toThrow(
      'agent_role_insert_requires_validated_write'
    );
    expect(flock.get(newKey)).toBeUndefined();
  });

  it.each(['edit', 'delete'])(
    'preserves a concurrent ordinary Role %s during catalog lookup',
    async (action) => {
      let mutate = false;
      const changed = { ...newRole, name: 'Concurrent edit', revision: 2, updatedAt: 4 };
      const { writer, flock } = fixture((live) => {
        if (!mutate) return;
        if (action === 'delete') live.delete(newKey);
        else live.set(newKey, changed);
        live.commit();
      });
      await writer.flockRowPut(workspace, newKey, newRole);
      mutate = true;
      await expect(
        writer.flockRowPut(workspace, newKey, { ...newRole, name: 'Stale edit', revision: 2 })
      ).rejects.toThrow('agent_role_source_changed');
      expect(flock.get(newKey)).toEqual(action === 'delete' ? undefined : changed);
    }
  );

  it('stores backup and target as one Role and concurrent retries keep the same result', async () => {
    const { writer, flock } = fixture();
    await Promise.all([
      writer.flockRowPut(workspace, key, target),
      writer.flockRowPut(workspace, key, target),
    ]);
    expect(flock.get(key)).toEqual(target);
    expect([...flock.scan({ prefix: ['agentRole'] })].map((row) => row.value)).toEqual([target]);
    const reopened = new Flock('synthetic-reopened');
    reopened.importFile(flock.exportFile());
    expect(reopened.get(key)).toEqual(target);
    await expect(writer.flockRowPut(workspace, key, source)).rejects.toThrow(
      'agent_role_migration_backup_immutable'
    );
    expect(flock.get(key)).toEqual(target);
  });

  it.each(['edit', 'delete'] as const)(
    'rechecks a source %s during target lookup',
    async (action) => {
      const { writer, flock } = fixture((live) => {
        if (action === 'delete') live.delete(key);
        else live.set(key, { ...source, name: 'Changed after opening editor' });
        live.commit();
      });
      await expect(writer.flockRowPut(workspace, key, target)).rejects.toThrow(
        'agent_role_migration_source_changed'
      );
      expect(flock.get(key)).toEqual(
        action === 'delete' ? undefined : { ...source, name: 'Changed after opening editor' }
      );
    }
  );

  it.each(['legacy', 'foreign-machine', 'missing'] as const)(
    'refuses a %s target before changing the source',
    async (kind) => {
      const { writer, flock, machine } = fixture();
      const configKey = ['agentConfig', target.agentConfigId];
      if (kind === 'missing') machine.delete(configKey);
      else
        machine.set(configKey, {
          id: target.agentConfigId,
          name: 'Not the selected Molly engine',
          machineId: kind === 'foreign-machine' ? 'other-machine' : source.machineId,
          cliType: 'builtin',
          agentType: kind === 'legacy' ? 'codex' : 'molly',
          env: {},
        });
      machine.commit();
      await expect(writer.flockRowPut(workspace, key, target)).rejects.toThrow(
        'agent_role_migration_target_unavailable'
      );
      expect(flock.get(key)).toEqual(source);
    }
  );

  it('does not insert a migrated Role through the unrelated insert-if-absent route', async () => {
    const { writer, flock } = fixture();
    flock.delete(key);
    flock.commit();
    await expect(writer.flockRowPutIfAbsent(workspace, key, target)).rejects.toThrow(
      'agent_role_migration_source_changed'
    );
    expect(flock.get(key)).toBeUndefined();
  });

  it('a failed target read leaves the only source untouched and explicit retry succeeds', async () => {
    let failRead = true;
    const { writer, flock } = fixture(() => {
      if (failRead) throw new Error('synthetic read failure');
    });
    await expect(writer.flockRowPut(workspace, key, target)).rejects.toThrow(
      'synthetic read failure'
    );
    expect(flock.get(key)).toEqual(source);
    failRead = false;
    await writer.flockRowPut(workspace, key, target);
    expect(flock.get(key)).toEqual(target);
  });
});
