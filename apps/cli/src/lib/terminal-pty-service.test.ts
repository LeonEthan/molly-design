import { describe, expect, it, vi } from 'vitest';
import type { TerminalServerEvent } from '@molly/shared';
import type { Logger } from '@/utils/logger';
import { makeTerminalPtyService } from './terminal-pty-service';

const native = vi.hoisted(() => ({
  closing: false,
  rejectClose: false,
  duplicateClose: false,
  exit: (_event: { exitCode: number }) => {},
}));
vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return Object.assign({}, actual, {
    createRequire: (...requireArgs: Parameters<typeof actual.createRequire>) =>
      new Proxy(actual.createRequire(...requireArgs), {
        apply(target, receiver, args) {
          if (args[0] !== '@lydell/node-pty') return Reflect.apply(target, receiver, args);
          return {
            spawn: () => ({
              onData: () => {},
              onExit: (listener: typeof native.exit) => {
                native.exit = listener;
              },
              kill: () => {
                if (native.rejectClose) throw new Error('native close rejected');
                if (native.closing) {
                  native.duplicateClose = true;
                  throw new Error('native handle already closing');
                }
                native.closing = true;
              },
            }),
          };
        },
      }),
  });
});
vi.mock('@/agent/login-shell-env', () => ({ getCachedLoginShellEnvSync: () => ({}) }));
vi.mock('@/agent/setting', () => ({
  mergeLoginShellEnv: (env: object) => env,
  withDefaultAcpPathEntries: (env: object) => env,
}));

const logger: Logger = {
  info() {},
  warn() {},
  error() {},
  success() {},
  debug() {},
  setLevel() {},
  setDebug() {},
  child: () => logger,
  close: async () => {},
};

describe('terminal close ownership', () => {
  it('retains the closing terminal until native exit across archive and termination cleanup', async () => {
    native.closing = false;
    native.duplicateClose = false;
    const events: TerminalServerEvent[] = [];
    const service = makeTerminalPtyService({
      logger,
      resolveSessionWorkdir: async () => '/synthetic/worktree',
    });
    service.onEvent((event) => events.push(event));
    const opened = await service.open({ sessionId: 'synthetic-session', cols: 80, rows: 24 });
    const live = service.list('synthetic-session');
    service.closeSession('synthetic-session');
    service.closeSession('synthetic-session');
    service.closeAll();
    expect(native.duplicateClose).toBe(false);
    expect(service.list('synthetic-session')).toEqual(live);
    native.exit({ exitCode: 0 });
    expect(service.list('synthetic-session')).toEqual([]);
    expect(events).toContainEqual({ type: 'exit', terminalId: opened.terminalId, exitCode: 0 });
  });
  it('keeps a terminal visible when native close fails and allows an explicit retry', async () => {
    native.closing = false;
    native.rejectClose = true;
    const service = makeTerminalPtyService({
      logger,
      resolveSessionWorkdir: async () => '/synthetic/worktree',
    });
    const opened = await service.open({ sessionId: 'retry-session', cols: 80, rows: 24 });
    const live = service.list('retry-session');
    service.closeSession('retry-session');
    expect(service.list('retry-session')).toEqual(live);
    native.rejectClose = false;
    service.close(opened.terminalId);
    expect(native.closing).toBe(true);
    expect(service.list('retry-session')).toEqual(live);
    native.exit({ exitCode: 0 });
    expect(service.list('retry-session')).toEqual([]);
  });
});
