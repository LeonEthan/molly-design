import net from 'node:net';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as hostLease from '@molly/shared/node/local-cli-host-lease';
import type { LocalCliHostRecord } from '@molly/shared/node/local-cli-host-lease';
import { stopDaemonProcess } from './daemon-stop';

const { readPidFileRecord } = vi.hoisted(() => ({ readPidFileRecord: vi.fn() }));
vi.mock('./daemon-shared', () => ({ readPidFileRecord }));

const daemon = {
  version: 1,
  pid: 101,
  instanceId: 'synthetic-molly-daemon',
  mode: 'daemon',
  startedAtMs: 0,
} satisfies LocalCliHostRecord;
const token = 'synthetic-control-token';

function createHosts(entries: [number, LocalCliHostRecord][]) {
  const records = new Map(entries);
  const requests: { port: number; instanceId: string; token: string }[] = [];
  let accepted: () => void = () => {};
  const shutdownAccepted = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  let rejectShutdown = false;
  let drainImmediately = true;
  let replacement: LocalCliHostRecord | null = null;

  class Socket extends EventEmitter {
    constructor(readonly port: number) {
      super();
    }
    setTimeout() {
      return this;
    }
    destroy() {
      return this;
    }
    write(data: string) {
      const request = JSON.parse(data) as { instanceId: string; token: string };
      requests.push({ port: this.port, instanceId: request.instanceId, token: request.token });
      const record = records.get(this.port);
      const ok =
        !rejectShutdown && record?.instanceId === request.instanceId && request.token === token;
      queueMicrotask(() => {
        this.emit('data', Buffer.from(`${JSON.stringify({ ok, error: 'unauthorized' })}\n`));
        if (ok) {
          if (drainImmediately) records.delete(this.port);
          accepted();
        }
      });
      return true;
    }
  }
  vi.spyOn(net, 'createConnection').mockImplementation((...args: unknown[]) => {
    const options = args[0] as net.TcpNetConnectOpts;
    const socket = new Socket(options.port);
    queueMicrotask(() => {
      const record = records.get(options.port);
      if (record) {
        socket.emit('data', Buffer.from(`${JSON.stringify(record)}\n`));
        if (replacement) {
          records.set(options.port, replacement);
          replacement = null;
        }
      } else socket.emit('end');
    });
    return socket as unknown as net.Socket;
  });
  return {
    records,
    requests,
    shutdownAccepted,
    reject: () => {
      rejectShutdown = true;
    },
    holdDrain: () => {
      drainImmediately = false;
    },
    replaceAfterInspection: (record: LocalCliHostRecord) => {
      replacement = record;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubEnv('MOLLY_PLATFORM', 'local');
  vi.stubEnv('MOLLY_E2E', '0');
  vi.spyOn(hostLease, 'getLocalCliHostEndpoint').mockReturnValue({
    kind: 'tcp',
    host: '127.0.0.1',
    port: 17792,
  });
  readPidFileRecord.mockReturnValue({ ...daemon, controlToken: token });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('daemon stop across the Molly host port migration', () => {
  it.each([false, true])(
    'stops the legacy daemon even with a new Electron host: %s',
    async (electronRunning) => {
      const entries: [number, LocalCliHostRecord][] = [[17790, daemon]];
      if (electronRunning)
        entries.push([
          17792,
          { ...daemon, pid: 202, instanceId: 'new-electron', mode: 'electron' },
        ]);
      const hosts = createHosts(entries);
      const result = stopDaemonProcess();
      await vi.advanceTimersByTimeAsync(500);
      expect(await result).toEqual({ status: 'stopped', pid: daemon.pid, attempts: 1 });
      await hosts.shutdownAccepted;
      expect(hosts.requests).toEqual([{ port: 17790, instanceId: daemon.instanceId, token }]);
      expect(hosts.records.has(17790)).toBe(false);
      expect(hosts.records.has(17792)).toBe(electronRunning);
    }
  );

  it.each([
    { ...daemon, pid: 303 },
    { ...daemon, instanceId: 'foreign-lody' },
    { ...daemon, mode: 'electron' as const },
  ])('does not send credentials to a mismatched legacy owner: %j', async (foreign) => {
    const hosts = createHosts([[17790, foreign]]);
    await stopDaemonProcess();
    expect(hosts.requests).toEqual([]);
    expect(hosts.records.get(17790)).toEqual(foreign);
  });

  it('keeps authentication failure observable and the legacy daemon alive', async () => {
    const hosts = createHosts([[17790, daemon]]);
    hosts.reject();
    expect(await stopDaemonProcess()).toEqual({
      status: 'control_error',
      pid: daemon.pid,
      errorMessage: 'unauthorized',
    });
    expect(hosts.records.get(17790)).toEqual(daemon);
  });

  it('keeps stopping the current host on its own endpoint', async () => {
    const hosts = createHosts([[17792, daemon]]);
    const result = stopDaemonProcess();
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toEqual({ status: 'stopped', pid: daemon.pid, attempts: 1 });
    expect(hosts.requests).toEqual([{ port: 17792, instanceId: daemon.instanceId, token }]);
  });

  it('waits for the selected legacy host to drain while the new Electron host stays live', async () => {
    const electron = { ...daemon, pid: 202, instanceId: 'new-electron', mode: 'electron' as const };
    const hosts = createHosts([
      [17790, daemon],
      [17792, electron],
    ]);
    hosts.holdDrain();
    let stopped = false;
    const result = stopDaemonProcess().then((value) => {
      stopped = true;
      return value;
    });
    await hosts.shutdownAccepted;
    await vi.advanceTimersByTimeAsync(500);
    expect(stopped).toBe(false);
    hosts.records.delete(17790);
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toEqual({ status: 'stopped', pid: daemon.pid, attempts: 2 });
    expect(hosts.records.get(17792)).toEqual(electron);
  });

  it('revalidates the legacy owner before transmitting credentials', async () => {
    const foreign = { ...daemon, instanceId: 'replacement-lody', pid: 303 };
    const hosts = createHosts([[17790, daemon]]);
    hosts.replaceAfterInspection(foreign);
    expect(await stopDaemonProcess()).toEqual({
      status: 'control_error',
      pid: daemon.pid,
      errorMessage: 'owner_mismatch',
    });
    expect(hosts.requests).toEqual([]);
    expect(hosts.records.get(17790)).toEqual(foreign);
  });

  it('reports a bounded timeout instead of killing an authenticated host that does not drain', async () => {
    const hosts = createHosts([[17790, daemon]]);
    hosts.holdDrain();
    const result = stopDaemonProcess();
    await hosts.shutdownAccepted;
    await vi.advanceTimersByTimeAsync(40000);
    expect(await result).toEqual({ status: 'timeout', pid: daemon.pid, attempts: 80 });
    expect(hosts.records.get(17790)).toEqual(daemon);
  });

  it.each(['cloud', 'e2e', 'pipe'])(
    'does not discover legacy hosts in the %s endpoint scope',
    async (scope) => {
      if (scope === 'cloud') {
        vi.stubEnv('MOLLY_PLATFORM', 'cloud');
        vi.mocked(hostLease.getLocalCliHostEndpoint).mockReturnValue({
          kind: 'tcp',
          host: '127.0.0.1',
          port: 17788,
        });
      }
      if (scope === 'e2e') {
        vi.stubEnv('MOLLY_E2E', '1');
        vi.stubEnv('MOLLY_E2E_LOCAL_CLI_HOST_PORT', '19001');
        vi.mocked(hostLease.getLocalCliHostEndpoint).mockReturnValue({
          kind: 'tcp',
          host: '127.0.0.1',
          port: 19001,
        });
      }
      if (scope === 'pipe')
        vi.mocked(hostLease.getLocalCliHostEndpoint).mockReturnValue({
          kind: 'pipe',
          path: '\\\\.\\pipe\\synthetic-molly',
        });
      const hosts = createHosts([[17790, daemon]]);
      expect(await stopDaemonProcess()).toEqual({ status: 'stale_pid_file', pid: daemon.pid });
      expect(hosts.requests).toEqual([]);
      expect(hosts.records.get(17790)).toEqual(daemon);
    }
  );
});
