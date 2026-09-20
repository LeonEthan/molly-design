import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { Logger } from '../src/utils/logger';
import { createLocalCloudPort } from '@molly/platform';
import { Molly } from '../src/lib/molly';

const state = vi.hoisted(() => ({ events: [] as string[], fail: false }));
vi.mock('@/lib/machine-runtime', () => ({
  MachineRuntime: class {
    async initialize() {
      state.events.push('initialize');
      if (state.fail) throw new Error('runtime unavailable');
    }
    async cleanup() {
      state.events.push('cleanup');
    }
  },
}));
vi.mock('@/agent/login-shell-env', () => ({ getLoginShellEnv: async () => ({}) }));

const logger: Logger = {
  info() {},
  warn() {},
  error() {},
  success() {},
  debug() {},
  setLevel() {},
  child() {
    return logger;
  },
  async close() {},
};
function createRuntime() {
  const documents = {
    ensureMachineFlockDocJoined() {
      state.events.push('join');
    },
    createAgentConfig() {
      throw new Error('startup must not register legacy configs');
    },
    syncMachineFlockDoc() {
      throw new Error('no registration sync or deferred retry');
    },
    onMetaRoomSynced() {
      throw new Error('no deferred registration subscription');
    },
  } as unknown as LoroDocumentManager;
  return new Molly(
    {
      logger,
      workspaceId: 'workspace-1',
      token: '',
      userId: 'user-1',
      machineId: 'machine-1',
      machineName: 'test',
      cloudPort: createLocalCloudPort({ identity: { userId: 'user-1' }, workspaces: [] }),
    } as ConstructorParameters<typeof Molly>[0],
    documents
  );
}

describe('Molly startup without legacy registration', () => {
  beforeEach(() => {
    state.events.length = 0;
    state.fail = false;
  });
  it('initializes and joins the machine without creating or refreshing old configs', async () => {
    vi.useFakeTimers();
    try {
      const runtime = createRuntime();
      await runtime.start();
      await vi.runAllTimersAsync();
      expect(state.events).toEqual(['initialize', 'join']);
      await runtime.cleanup();
      expect(state.events).toEqual(['initialize', 'join', 'cleanup']);
      expect('registerAgent' in runtime).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it('propagates initialization failures without joining or scheduling registration', async () => {
    state.fail = true;
    await expect(createRuntime().start()).rejects.toThrow('runtime unavailable');
    expect(state.events).toEqual(['initialize']);
  });
});
