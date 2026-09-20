import { describe, expect, it } from 'vitest';

import { AGENT_ROLE_VERSION, normalizeAgentRole, type AgentRole } from '../src/agent-role';
import { encodeMollyModelOption } from '../src/embedded-harness';
import type { AgentConfigId, AgentRoleId, MachineId, McpServerId, WorkspaceId } from '../src/ids';
import {
  applyWorkspaceFlockRowEvents,
  deleteWorkspaceAgentRoleFromFlock,
  deleteWorkspaceMcpServerFromFlock,
  listWorkspaceAgentRoles,
  writeWorkspaceAgentRoleToFlock,
  getWorkspaceFlockDocId,
  listWorkspaceMcpServers,
  parseWorkspaceFlockRow,
  readWorkspaceFlockRowsFromFlock,
  serializeWorkspaceFlockKey,
  workspaceFlockKeys,
  writeWorkspaceMcpServerToFlock,
  type WorkspaceFlockKey,
  type WorkspaceFlockWritableFlock,
} from '../src/workspace-flock';
import type { WorkspaceMcpServerMeta } from '../src/workspace-mcp';

const id = (value: string): McpServerId => value as McpServerId;
const agentRole = (roleId: string, overrides: Partial<AgentRole> = {}): AgentRole => ({
  v: AGENT_ROLE_VERSION,
  id: roleId as AgentRoleId,
  ownerUserId: 'user-1',
  visibility: 'private',
  name: roleId,
  machineId: 'machine-1' as MachineId,
  agentConfigId: 'config-1' as AgentConfigId,
  runConfig: {},
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const entry = (serverId: string, name = serverId): WorkspaceMcpServerMeta => ({
  id: id(serverId),
  name,
  transport: 'stdio',
  connection: { transport: 'stdio', command: 'node' },
  createdAt: 1,
  updatedAt: 1,
});

class FakeWorkspaceFlock implements WorkspaceFlockWritableFlock {
  readonly rows = new Map<string, { key: WorkspaceFlockKey; value: unknown }>();
  readonly scanOptions: Array<{ prefix?: readonly unknown[] } | undefined> = [];
  commits = 0;

  scan(options?: { prefix?: readonly unknown[] }) {
    this.scanOptions.push(options);
    return [...this.rows.values()].filter(
      ({ key }) => options?.prefix?.every((part, index) => key[index] === part) ?? true
    );
  }

  set(key: WorkspaceFlockKey, value: unknown): void {
    this.rows.set(JSON.stringify(key), { key: [...key] as WorkspaceFlockKey, value });
  }

  delete(key: WorkspaceFlockKey): void {
    this.rows.delete(JSON.stringify(key));
  }

  commit(): void {
    this.commits += 1;
  }
}

describe('workspace Flock helpers', () => {
  const migrated = (source: AgentRole): AgentRole => ({
    ...source,
    agentConfigId: 'molly-config' as AgentConfigId,
    runConfig: {
      modelId: encodeMollyModelOption('connection-1', 'synthetic-model'),
      configOptionValues: { reasoning_effort: 'high' },
    },
    revision: source.revision + 1,
    updatedAt: 20,
    embeddedMigration: { v: 1, migratedAt: 20, source },
  });

  it('persists a versioned backup and target together, and retries without another migration', () => {
    const flock = new FakeWorkspaceFlock();
    const source = agentRole('legacy', {
      runConfig: { modelId: 'old-model', modeId: 'danger-full-access' },
    });
    writeWorkspaceAgentRoleToFlock(flock, source);
    const target = migrated(source);
    expect(writeWorkspaceAgentRoleToFlock(flock, target)).toBe(true);
    // Simulate reopening only the durable rows, not a process-local migration cache.
    const reopened = new FakeWorkspaceFlock();
    for (const { key, value } of flock.scan()) reopened.set(key, structuredClone(value));
    expect(writeWorkspaceAgentRoleToFlock(reopened, target)).toBe(false);
    expect(listWorkspaceAgentRoles(readWorkspaceFlockRowsFromFlock(reopened))).toEqual([target]);
    expect(target.embeddedMigration?.source).toEqual(source);
    expect(target.runConfig.modeId).toBeUndefined();
  });

  it.each(['edited', 'deleted', 'same-revision-edit'] as const)(
    'refuses migration over a %s source without recreating or overwriting it',
    (change) => {
      const flock = new FakeWorkspaceFlock();
      const source = agentRole('legacy');
      writeWorkspaceAgentRoleToFlock(flock, source);
      if (change === 'deleted') deleteWorkspaceAgentRoleFromFlock(flock, source.id);
      else
        writeWorkspaceAgentRoleToFlock(flock, {
          ...source,
          name: 'Changed',
          revision: change === 'edited' ? 2 : 1,
        });
      const before = readWorkspaceFlockRowsFromFlock(flock);
      expect(() => writeWorkspaceAgentRoleToFlock(flock, migrated(source))).toThrow(
        'agent_role_migration_source_changed'
      );
      expect(readWorkspaceFlockRowsFromFlock(flock)).toEqual(before);
    }
  );

  it('retains the original backup across ordinary edits and refuses stale migration retries', () => {
    const flock = new FakeWorkspaceFlock();
    const source = agentRole('legacy');
    writeWorkspaceAgentRoleToFlock(flock, source);
    const target = migrated(source);
    writeWorkspaceAgentRoleToFlock(flock, target);
    const edited = { ...target, name: 'Molly role', revision: 3, updatedAt: 30 };
    writeWorkspaceAgentRoleToFlock(flock, edited);
    expect(writeWorkspaceAgentRoleToFlock(flock, { ...edited, revision: 1, updatedAt: 1 })).toBe(
      false
    );
    expect(() => writeWorkspaceAgentRoleToFlock(flock, target)).toThrow(
      'agent_role_migration_source_changed'
    );
    expect(() =>
      writeWorkspaceAgentRoleToFlock(flock, { ...edited, embeddedMigration: undefined })
    ).toThrow('agent_role_migration_backup_immutable');
    expect(() =>
      writeWorkspaceAgentRoleToFlock(flock, {
        ...edited,
        embeddedMigration: { v: 1, migratedAt: 20, source: { ...source, name: 'Forged' } },
      })
    ).toThrow('agent_role_migration_backup_immutable');
    expect(listWorkspaceAgentRoles(readWorkspaceFlockRowsFromFlock(flock))).toEqual([edited]);
  });

  it('normalizes backup secrets and rejects nested, foreign and unsupported migration records', () => {
    const source = agentRole('legacy', {
      runConfig: {
        configOptionValues: { api_key: 'synthetic-do-not-copy', thought_level: 'high' },
      },
    });
    const target = migrated(source);
    expect(JSON.stringify(normalizeAgentRole(target))).not.toContain('synthetic-do-not-copy');
    expect(
      normalizeAgentRole({ ...target, embeddedMigration: { ...target.embeddedMigration, v: 2 } })
    ).toBeUndefined();
    expect(
      normalizeAgentRole({
        ...target,
        embeddedMigration: { ...target.embeddedMigration, source: target },
      })
    ).toBeUndefined();
    expect(
      normalizeAgentRole({
        ...target,
        embeddedMigration: {
          ...target.embeddedMigration,
          source: { ...source, id: 'another-role' },
        },
      })
    ).toBeUndefined();
    expect(
      normalizeAgentRole({
        ...target,
        embeddedMigration: {
          ...target.embeddedMigration,
          source: { ...source, ownerUserId: 'another-owner' },
        },
      })
    ).toBeUndefined();
  });

  it.each([
    {},
    { modelId: 'old-model' },
    { modelId: encodeMollyModelOption('connection-1', 'synthetic-model'), modeId: 'full-access' },
  ])('rejects an implicit or legacy executable configuration: %j', (runConfig) => {
    const flock = new FakeWorkspaceFlock();
    const source = agentRole('legacy');
    writeWorkspaceAgentRoleToFlock(flock, source);
    expect(() =>
      writeWorkspaceAgentRoleToFlock(flock, { ...migrated(source), runConfig })
    ).toThrow();
    expect(listWorkspaceAgentRoles(readWorkspaceFlockRowsFromFlock(flock))).toEqual([source]);
  });
  it('owns monotonic MCP generations even with identical clocks or caller revisions', () => {
    const flock = new FakeWorkspaceFlock();
    const server = entry('versioned');
    flock.set(workspaceFlockKeys.mcpServer(server.id), server);
    expect(writeWorkspaceMcpServerToFlock(flock, server)).toBe(true);
    expect(listWorkspaceMcpServers(readWorkspaceFlockRowsFromFlock(flock))[0]?.revision).toBe(1);
    expect(writeWorkspaceMcpServerToFlock(flock, { ...server, revision: 999 })).toBe(false);
    expect(
      writeWorkspaceMcpServerToFlock(flock, { ...server, revision: 999, name: 'Changed' })
    ).toBe(true);
    expect(listWorkspaceMcpServers(readWorkspaceFlockRowsFromFlock(flock))[0]?.revision).toBe(2);
  });
  it('builds the workspace-scoped document id', () => {
    expect(getWorkspaceFlockDocId('workspace-1' as WorkspaceId)).toBe('workspace-1:wf:workspace');
  });

  it('round-trips valid rows and drops mismatched or malformed foreign rows', () => {
    const valid = entry('server-1');
    const key = workspaceFlockKeys.mcpServer(valid.id);
    expect(parseWorkspaceFlockRow(key, valid)).toEqual({ key, value: valid });
    expect(parseWorkspaceFlockRow(key, { ...valid, id: id('other') })).toBeUndefined();
    expect(parseWorkspaceFlockRow(key, { ...valid, transport: 'sse' })).toBeUndefined();

    const flock = new FakeWorkspaceFlock();
    flock.set(key, valid);
    flock.rows.set('malformed', { key: ['mcpServer', 'bad'], value: { id: 'bad' } });
    const rows = readWorkspaceFlockRowsFromFlock(flock);
    expect(rows[serializeWorkspaceFlockKey(key)]).toEqual({ key, value: valid });
    expect(Object.keys(rows)).toHaveLength(1);
    // One prefixed scan per family, never an unprefixed full-document scan.
    expect(flock.scanOptions).toEqual([{ prefix: ['mcpServer'] }, { prefix: ['agentRole'] }]);
  });

  it('does not commit unchanged writes and deletes only once', () => {
    const flock = new FakeWorkspaceFlock();
    const server = entry('server-1');
    expect(writeWorkspaceMcpServerToFlock(flock, server)).toBe(true);
    expect(writeWorkspaceMcpServerToFlock(flock, server)).toBe(false);
    expect(flock.commits).toBe(1);
    expect(deleteWorkspaceMcpServerFromFlock(flock, server.id)).toBe(true);
    expect(deleteWorkspaceMcpServerFromFlock(flock, server.id)).toBe(false);
    expect(flock.commits).toBe(2);
  });

  it('applies add, update, delete, and no-op events with referential stability', () => {
    const first = entry('first', 'Zulu');
    const second = entry('second', 'Alpha');
    const firstKey = workspaceFlockKeys.mcpServer(first.id);
    const secondKey = workspaceFlockKeys.mcpServer(second.id);
    const initial = applyWorkspaceFlockRowEvents({}, [
      { key: firstKey, value: first },
      { key: secondKey, value: second },
    ]);
    expect(listWorkspaceMcpServers(initial).map(({ name }) => name)).toEqual(['Alpha', 'Zulu']);
    expect(applyWorkspaceFlockRowEvents(initial, [{ key: firstKey, value: first }])).toBe(initial);

    const updatedFirst = { ...first, description: 'updated', updatedAt: 2 };
    const updated = applyWorkspaceFlockRowEvents(initial, [{ key: firstKey, value: updatedFirst }]);
    expect(updated).not.toBe(initial);
    expect(updated[serializeWorkspaceFlockKey(firstKey)]?.value).toEqual(updatedFirst);

    const deleted = applyWorkspaceFlockRowEvents(updated, [{ key: secondKey }]);
    expect(deleted[serializeWorkspaceFlockKey(secondKey)]).toBeUndefined();
    expect(applyWorkspaceFlockRowEvents(deleted, [{ key: ['unknown'] }])).toBe(deleted);
  });

  it('keeps agent roles and MCP servers in one document without either reading the other', () => {
    const flock = new FakeWorkspaceFlock();
    const server = entry('server-1');
    const role = agentRole('role-1', { name: 'Reviewer' });
    expect(writeWorkspaceMcpServerToFlock(flock, server)).toBe(true);
    expect(writeWorkspaceAgentRoleToFlock(flock, role)).toBe(true);

    const rows = readWorkspaceFlockRowsFromFlock(flock);
    expect(listWorkspaceMcpServers(rows)).toEqual([{ ...server, revision: 1 }]);
    expect(listWorkspaceAgentRoles(rows)).toEqual([role]);
  });

  it('shares a role by updating its own row rather than moving it', () => {
    const flock = new FakeWorkspaceFlock();
    const role = agentRole('role-1');
    writeWorkspaceAgentRoleToFlock(flock, role);
    const shared = { ...role, visibility: 'workspace' as const, revision: 2, updatedAt: 2 };
    expect(writeWorkspaceAgentRoleToFlock(flock, shared)).toBe(true);

    const rows = readWorkspaceFlockRowsFromFlock(flock);
    expect(Object.keys(rows)).toHaveLength(1);
    expect(listWorkspaceAgentRoles(rows)).toEqual([shared]);
    expect(writeWorkspaceAgentRoleToFlock(flock, shared)).toBe(false);
    expect(deleteWorkspaceAgentRoleFromFlock(flock, role.id)).toBe(true);
    expect(deleteWorkspaceAgentRoleFromFlock(flock, role.id)).toBe(false);
  });

  it('drops a role row whose stored value no longer validates', () => {
    const flock = new FakeWorkspaceFlock();
    const role = agentRole('role-1');
    flock.set(workspaceFlockKeys.agentRole(role.id), { ...role, name: '   ' });
    expect(listWorkspaceAgentRoles(readWorkspaceFlockRowsFromFlock(flock))).toEqual([]);
  });

  it('normalizes a secret-shaped option out of a stored role row', () => {
    const flock = new FakeWorkspaceFlock();
    const role = agentRole('role-1');
    flock.set(workspaceFlockKeys.agentRole(role.id), {
      ...role,
      runConfig: { modelId: 'gpt-5.6', configOptionValues: { api_key: 'sk-live', fast: true } },
    });
    expect(listWorkspaceAgentRoles(readWorkspaceFlockRowsFromFlock(flock))[0]?.runConfig).toEqual({
      modelId: 'gpt-5.6',
      configOptionValues: { fast: true },
    });
  });
});
