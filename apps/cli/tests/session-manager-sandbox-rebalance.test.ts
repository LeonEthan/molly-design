import os from 'os';

import { describe, expect, it, vi, afterEach } from 'vitest';
import type { SessionId, WorkspaceId } from '@molly/shared';

import { SessionManager, type ISession } from '../src/session/session-manager';
import type { SessionConfig } from '../src/session/types';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { Logger } from '../src/utils/logger';
import type { SessionSandbox, SessionSandboxLimits } from '../src/session/session-sandbox';
import { createTestCloudPort } from './test-cloud-port';

const GIB = 1024 * 1024 * 1024;

// Mock getEffectiveMemoryLimitBytes to return the same value as the mocked os.totalmem()
// so the test controls the memory budget deterministically.
vi.mock('../src/utils/memory', () => ({
  getEffectiveMemoryLimitBytes: vi.fn(() => 16 * GIB),
  getAvailableMemoryBytes: vi.fn(() => 8 * GIB),
}));

const createSilentLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  debug: () => {},
  setLevel: () => {},
  child: () => createSilentLogger(),
  close: async () => {},
});

const createWorkspaceDocument = (): LoroDocumentManager =>
  ({
    getOrCreateSessionDoc: vi.fn(async () => ({
      setRepoFullName: vi.fn(async () => {}),
    })),
    cleanUp: vi.fn(async () => {}),
  }) as unknown as LoroDocumentManager;

const createSandbox = (): SessionSandbox & {
  applyLimits: ReturnType<typeof vi.fn>;
} => ({
  enabled: true,
  description: 'test-sandbox',
  applyLimits: vi.fn(async (_limits: SessionSandboxLimits) => {}),
  spawn: vi.fn(async () => {
    throw new Error('Not implemented in this test');
  }),
  terminate: vi.fn(async () => {}),
  cleanup: vi.fn(async () => {}),
});

const createConfig = (sessionId: string): SessionConfig => ({
  workspaceId: 'workspace-1' as WorkspaceId,
  requesterUserId: 'user-1',
  machineId: 'machine-1',
  agentCliType: 'builtin',
  agentType: 'codex',
  sessionId: sessionId as SessionId,
  userName: 'test-user',
  userEmail: 'test@example.com',
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SessionManager sandbox rebalance', () => {
  it('rebalances execution-plane limits when sessions are added and removed', async () => {
    vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
    vi.spyOn(os, 'cpus').mockReturnValue(
      Array.from({ length: 8 }, () => ({ model: 'test', speed: 1, times: {} })) as os.CpuInfo[]
    );

    const sandboxes = new Map<string, ReturnType<typeof createSandbox>>();
    const manager = new SessionManager(
      createSilentLogger(),
      'token',
      'machine-1',
      'workspace-1',
      createWorkspaceDocument(),
      {
        cloudPort: createTestCloudPort(),
        sessionSandboxFactory: async (sessionId) => {
          const sandbox = createSandbox();
          sandboxes.set(sessionId, sandbox);
          return sandbox;
        },
      }
    );

    const managerInternals = manager as unknown as {
      createSessionInner(config: SessionConfig): Promise<ISession>;
    };

    const sessionOne = await managerInternals.createSessionInner(createConfig('session-1'));
    const sandboxOne = sandboxes.get('session-1');
    expect(sandboxOne?.applyLimits).toHaveBeenCalledWith({
      memoryMaxBytes: Math.floor(16 * GIB * 0.75),
      cpuMax: '600000 100000',
      pidsMax: 1024,
    });

    const sessionTwo = await managerInternals.createSessionInner(createConfig('session-2'));
    const sandboxTwo = sandboxes.get('session-2');
    const sharedLimits = {
      memoryMaxBytes: Math.floor((16 * GIB * 0.75) / 2),
      cpuMax: '300000 100000',
      pidsMax: 1024,
    };
    expect(sandboxOne?.applyLimits).toHaveBeenLastCalledWith(sharedLimits);
    expect(sandboxTwo?.applyLimits).toHaveBeenCalledWith(sharedLimits);

    (
      sessionOne as unknown as {
        emit(event: 'terminated', payload: { sessionId: SessionId; exitCode: number }): void;
      }
    ).emit('terminated', {
      sessionId: 'session-1' as SessionId,
      exitCode: 0,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(sandboxTwo?.applyLimits).toHaveBeenLastCalledWith({
      memoryMaxBytes: Math.floor(16 * GIB * 0.75),
      cpuMax: '600000 100000',
      pidsMax: 1024,
    });
    expect(manager.getSession('session-1' as SessionId)).toBeNull();
    expect(manager.getSession('session-2' as SessionId)).toBe(sessionTwo);
  });
});
