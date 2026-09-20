import { describe, expect, it } from 'vitest';
import { isMcpConnectionSpec, type WorkspaceMcpServerMeta } from '@molly/shared';
import { McpCredentialBindingSchema } from '@molly/shared/embedded-harness';
import { protectMcpEntry } from '../src/components/settings/mcp-credential-save';

const reference = { credentialRef: '00000000-0000-4000-8000-000000000001', revision: 1 };
const entry: WorkspaceMcpServerMeta = {
  id: 'synthetic-server' as WorkspaceMcpServerMeta['id'],
  name: 'Synthetic MCP',
  transport: 'http',
  createdAt: 1,
  updatedAt: 1,
  connection: {
    transport: 'http',
    url: 'https://mcp.invalid/mcp',
    bearerToken: 'synthetic-secret',
  },
};

function fixture() {
  const events: unknown[] = [];
  const writer: NonNullable<Parameters<typeof protectMcpEntry>[2]> = {
    async saveMcp(input) {
      events.push(input);
      return McpCredentialBindingSchema.parse({
        workspaceId: 'workspace',
        serverId: input.serverId,
        ...reference,
        revision: (input.expectedRevision ?? 0) + 1,
        destination: input.destination,
        fieldNames: Object.keys(input.values ?? { Authorization: 'stored' }).sort(),
      });
    },
    async deleteMcp(input) {
      events.push({ deleted: input });
    },
  };
  return { writer, events };
}

describe('protected MCP settings handoff', () => {
  it('saves the exact credential to main and returns only a workspace-safe reference', async () => {
    const { writer, events } = fixture();
    const saved = await protectMcpEntry(entry, undefined, writer);
    expect(events).toEqual([
      {
        serverId: entry.id,
        destination: { transport: 'http', url: 'https://mcp.invalid/mcp' },
        expectedRevision: undefined,
        values: { Authorization: 'Bearer synthetic-secret' },
      },
    ]);
    expect(saved.connection).toEqual({
      transport: 'http',
      url: 'https://mcp.invalid/mcp',
      protectedCredentials: reference,
    });
    expect(isMcpConnectionSpec(saved.connection)).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('synthetic-secret');
    expect(entry.connection).toHaveProperty('bearerToken', 'synthetic-secret');
    // A retry after Flock failure preserves the saved reference without a second vault write.
    expect(await protectMcpEntry(saved, saved, null)).toEqual(saved);
  });
  it('uses the stored revision on replacement and checks destination changes through main', async () => {
    const { writer, events } = fixture();
    const previous = await protectMcpEntry(entry, undefined, writer);
    const changed = {
      ...previous,
      connection: {
        transport: 'http' as const,
        url: 'https://other.invalid/mcp',
        protectedCredentials: reference,
      },
    };
    await expect(protectMcpEntry(changed, previous, null)).rejects.toThrow('storage_unavailable');
    await protectMcpEntry(changed, previous, writer);
    expect(events.at(-1)).toEqual({
      serverId: entry.id,
      expectedRevision: 1,
      destination: { transport: 'http', url: 'https://other.invalid/mcp' },
    });
    const replaced = await protectMcpEntry(
      { ...changed, connection: { ...changed.connection, headers: { 'X-Key': 'new-secret' } } },
      previous,
      writer
    );
    expect(replaced.connection?.protectedCredentials?.revision).toBe(2);
    expect(events.at(-1)).toHaveProperty('values', { 'X-Key': 'new-secret' });
  });
  it('removes the protected secret only on explicit clearing and returns no dangling reference', async () => {
    const { writer, events } = fixture();
    const previous = await protectMcpEntry(entry, undefined, writer);
    const clear = {
      ...entry,
      connection: { transport: 'http' as const, url: 'https://mcp.invalid/mcp' },
    };
    expect((await protectMcpEntry(clear, previous, writer)).connection).not.toHaveProperty(
      'protectedCredentials'
    );
    expect(events.at(-1)).toEqual({ deleted: { serverId: entry.id, expectedRevision: 1 } });
  });
  it('protects stdio env independently and rejects ambient expansion', async () => {
    const { writer, events } = fixture();
    const stdio = {
      ...entry,
      transport: 'stdio' as const,
      connection: {
        transport: 'stdio' as const,
        command: '/synthetic/server',
        args: ['--stdio'],
        env: { SERVICE_TOKEN: 'env-secret' },
      },
    };
    const saved = await protectMcpEntry(stdio, undefined, writer);
    expect(saved.connection).not.toHaveProperty('env');
    expect(events.at(-1)).toHaveProperty('values', { SERVICE_TOKEN: 'env-secret' });
    await expect(
      protectMcpEntry(
        { ...stdio, connection: { ...stdio.connection, envPassthrough: ['TOKEN'] } },
        undefined,
        writer
      )
    ).rejects.toThrow('passthrough_unsupported');
    await expect(
      protectMcpEntry(
        { ...stdio, connection: { ...stdio.connection, env: { TOKEN: '${PRIVATE_TOKEN}' } } },
        undefined,
        writer
      )
    ).rejects.toThrow('passthrough_unsupported');
  });
  it('does not return a catalog entry if encryption fails or main returns another server', async () => {
    const { writer } = fixture();
    await expect(
      protectMcpEntry(entry, undefined, {
        ...writer,
        async saveMcp() {
          throw new Error('credential_storage_unavailable');
        },
      })
    ).rejects.toThrow('storage_unavailable');
    await expect(
      protectMcpEntry(entry, undefined, {
        ...writer,
        async saveMcp(input) {
          return { ...(await writer.saveMcp(input)), serverId: 'another-server' };
        },
      })
    ).rejects.toThrow('identity_mismatch');
    await expect(protectMcpEntry(entry, undefined, null)).rejects.toThrow('storage_unavailable');
  });
});
