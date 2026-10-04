import { Flock } from '@loro-dev/flock-wasm';
import { describe, expect, it } from 'vitest';
import {
  getWorkspaceMcpCatalog,
  readWorkspaceFlockRowsFromFlock,
  toPiToolExposure,
  workspaceFlockKeys,
  type McpServerId,
  type WorkspaceMcpServerMeta,
} from '@molly/shared';

describe('MCP tool exposure persistence', () => {
  it('keeps overlapping pattern priority through Flock, where object keys are reordered', async () => {
    const id = 'synthetic' as McpServerId;
    const entry: WorkspaceMcpServerMeta = {
      id,
      name: 'Synthetic',
      transport: 'http',
      revision: 1,
      exposure: 'codemode',
      toolExposure: [
        { pattern: 'delete_*', exposure: 'hidden' },
        { pattern: '*', exposure: 'direct' },
      ],
      createdAt: 1,
      updatedAt: 1,
    };
    const flock = new Flock();
    flock.put(workspaceFlockKeys.mcpServer(id), entry);
    const stored = getWorkspaceMcpCatalog(readWorkspaceFlockRowsFromFlock(flock))[id];
    expect(Object.entries(toPiToolExposure(stored!.toolExposure!))).toEqual([
      ['delete_*', 'hidden'],
      ['*', 'direct'],
    ]);
  });
});
