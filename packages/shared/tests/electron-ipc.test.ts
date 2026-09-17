import { describe, expect, it } from 'vitest';
import {
  CliRuntimeStateSchema,
  isDevEmailPasswordLoginEnabled,
} from '../src/electron-ipc';

describe('isDevEmailPasswordLoginEnabled', () => {
  it('enables direct email/password login for every unpackaged Electron build', () => {
    expect(isDevEmailPasswordLoginEnabled({ isPackaged: false })).toBe(true);
  });

  it('keeps direct email/password login disabled in packaged Electron builds', () => {
    expect(isDevEmailPasswordLoginEnabled({ isPackaged: true })).toBe(false);
  });
});
describe('CliRuntimeStateSchema', () => {
  it('accepts backend connection ages and workspace details', () => {
    const payload = {
      schemaVersion: 1,
      phase: 'running',
      startupStage: 'ready',
      connectivity: 'online',
      backend: {
        authorization: 'authorized',
        connection: 'connecting',
      },
      connectionAges: {
        backendNotConnectedSinceMs: 1_000,
        workspaceNotConnectedSinceMs: { 'workspace-1': 2_000 },
      },
      connectedWorkspaces: [
        {
          id: 'workspace-1',
          name: 'Alpha',
          slug: 'alpha',
          role: 'owner',
          backendConnection: 'reconnecting',
        },
      ],
      pid: 123,
      updatedAtMs: 1,
      issues: [],
    } as const;
    const result = CliRuntimeStateSchema.safeParse(payload);

    expect(result.success).toBe(true);

    // The previous v1 shape accepted unknown top-level keys but rejected
    // unknown keys inside backend/workspace strict objects. Keeping the new
    // extension at the top level preserves that version-skew behavior.
    const legacyV1Schema = CliRuntimeStateSchema.omit({ connectionAges: true });
    expect(legacyV1Schema.safeParse(payload).success).toBe(true);
  });

  it('keeps backend details optional for older daemon runtime payloads', () => {
    expect(
      CliRuntimeStateSchema.safeParse({
        schemaVersion: 1,
        phase: 'running',
        pid: 123,
        updatedAtMs: 1,
        issues: [],
      }).success
    ).toBe(true);
  });
});
