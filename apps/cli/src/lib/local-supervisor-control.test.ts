import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  registerLocalSupervisorControl,
  receiveSupervisorIdentity,
  readPrivateHello,
  resolveLocalSupervisorIdentity,
  scrubLocalSupervisorCapabilityEnv,
  toRuntimeSupervisorIdentity,
} from './local-supervisor-control';

const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});

describe('local supervisor control', () => {
  it('requires a complete contract-matched supervisor identity', () => {
    expect(
      resolveLocalSupervisorIdentity({
        MOLLY_DAEMON_SUPERVISED: '1',
        MOLLY_SUPERVISOR_CONTRACT: '1',
      })
    ).toEqual({ status: 'invalid', reason: 'Invalid daemon supervisor identity' });
    expect(
      resolveLocalSupervisorIdentity({
        MOLLY_DAEMON_SUPERVISED: '1',
        MOLLY_ELECTRON_BOOTSTRAP: '1',
      })
    ).toEqual({
      status: 'invalid',
      reason: 'Conflicting daemon and Electron supervisor launch markers',
    });
    expect(resolveLocalSupervisorIdentity({})).toEqual({ status: 'unsupervised' });

    const resolution = resolveLocalSupervisorIdentity({
      MOLLY_DAEMON_SUPERVISED: '1',
      MOLLY_SUPERVISOR_CONTRACT: '1',
      MOLLY_SUPERVISOR_PID: '123',
      MOLLY_SUPERVISOR_INSTANCE_ID: 'instance-a',
      MOLLY_SUPERVISOR_TOKEN: 'x'.repeat(32),
    });

    expect(resolution).toEqual({
      status: 'supervised',
      identity: {
        launchMode: 'daemon',
        pid: 123,
        instanceId: 'instance-a',
        token: 'x'.repeat(32),
      },
    });
    const identity = resolution.status === 'supervised' ? resolution.identity : null;
    expect(toRuntimeSupervisorIdentity(identity)).toEqual({
      launchMode: 'daemon',
      pid: 123,
      instanceId: 'instance-a',
    });
  });

  it('rejects a supervisor speaking a different contract version', () => {
    const mismatched = resolveLocalSupervisorIdentity({
      MOLLY_DAEMON_SUPERVISED: '1',
      MOLLY_SUPERVISOR_CONTRACT: '0',
      MOLLY_SUPERVISOR_PID: '123',
      MOLLY_SUPERVISOR_INSTANCE_ID: 'instance-a',
      MOLLY_SUPERVISOR_TOKEN: 'x'.repeat(32),
    });
    expect(mismatched.status).toBe('invalid');
    expect(mismatched.status === 'invalid' && mismatched.reason).toContain('contract version 0');

    const missing = resolveLocalSupervisorIdentity({ MOLLY_DAEMON_SUPERVISED: '1' });
    expect(missing.status).toBe('invalid');
    expect(missing.status === 'invalid' && missing.reason).toContain('contract version (none)');
  });

  it('scrubs the private supervisor capability after validation', () => {
    const env: NodeJS.ProcessEnv = {
      MOLLY_DAEMON_SUPERVISED: '1',
      MOLLY_SUPERVISOR_CONTRACT: '1',
      MOLLY_SUPERVISOR_PID: '123',
      MOLLY_SUPERVISOR_INSTANCE_ID: 'instance-a',
      MOLLY_SUPERVISOR_TOKEN: 'x'.repeat(32),
      KEEP_ME: 'yes',
    };

    scrubLocalSupervisorCapabilityEnv(env);

    expect(env).toEqual({ KEEP_ME: 'yes' });
  });

  it('accepts shutdown only for the matching private IPC capability', () => {
    const shutdown = vi.fn();
    const messageSource = new EventEmitter();
    Object.assign(messageSource, { send: vi.fn(), connected: true });
    const dispose = registerLocalSupervisorControl({
      identity: {
        launchMode: 'electron',
        pid: 321,
        instanceId: 'instance-b',
        token: 'secret'.repeat(6),
      },
      logger: { info: vi.fn() } as never,
      shutdown,
      messageSource,
    });
    cleanup.push(dispose);

    messageSource.emit('message', {
      type: 'lody/supervisor-shutdown',
      instanceId: 'instance-b',
      token: 'wrong'.repeat(7),
    });
    expect(shutdown).not.toHaveBeenCalled();

    messageSource.emit('message', {
      type: 'lody/supervisor-shutdown',
      instanceId: 'instance-b',
      token: 'secret'.repeat(6),
    });
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('shuts down once when the supervisor IPC channel disconnects', () => {
    const shutdown = vi.fn();
    const messageSource = new EventEmitter();
    Object.assign(messageSource, { send: vi.fn(), connected: true });
    const dispose = registerLocalSupervisorControl({
      identity: {
        launchMode: 'electron',
        pid: 321,
        instanceId: 'instance-c',
        token: 'private'.repeat(5),
      },
      logger: { info: vi.fn() } as never,
      shutdown,
      messageSource,
    });
    cleanup.push(dispose);

    messageSource.emit('disconnect');
    messageSource.emit('disconnect');

    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('fails closed when a supervised worker has no live IPC parent', async () => {
    const shutdown = vi.fn();
    const messageSource = new EventEmitter();
    const dispose = registerLocalSupervisorControl({
      identity: {
        launchMode: 'daemon',
        pid: 321,
        instanceId: 'instance-d',
        token: 'private'.repeat(5),
      },
      logger: { info: vi.fn() } as never,
      shutdown,
      messageSource,
    });
    cleanup.push(dispose);

    await Promise.resolve();

    expect(shutdown).toHaveBeenCalledOnce();
  });
});

it('hands framed stdin shutdown over to the active callback without another hello', async () => {
  const input = new PassThrough();
  vi.stubEnv('MOLLY_SUPERVISOR_TRANSPORT', 'stdin');
  try {
    const hello = {
      type: 'lody/supervisor-hello',
      supervisorInstanceId: 'instance',
      supervisorPid: process.pid,
      token: 'a'.repeat(64),
      coordinatorToken: 'b'.repeat(64),
    };
    const pending = receiveSupervisorIdentity(input);
    const encoded = JSON.stringify(hello);
    input.write(encoded.slice(0, 14));
    input.write(encoded.slice(14) + '\n');
    const resolved = await pending;
    if (resolved.status !== 'supervised') throw Error('missing identity');
    const events: string[] = [];
    const options = { identity: resolved.identity, logger: { info: vi.fn() } as never };
    const release = registerLocalSupervisorControl({
      ...options,
      shutdown: () => events.push('startup'),
    });
    const dispose = registerLocalSupervisorControl({
      ...options,
      shutdown: () => events.push('active'),
    });
    release();
    input.write(
      JSON.stringify({
        type: 'lody/supervisor-shutdown',
        instanceId: 'instance',
        token: hello.token,
      }) + '\n'
    );
    expect(events).toEqual(['active']);
    dispose();
  } finally {
    input.destroy();
    vi.unstubAllEnvs();
  }
});

it('rejects an incomplete hello at five seconds', async () => {
  vi.useFakeTimers();
  const input = new PassThrough();
  try {
    const result = expect(readPrivateHello(input)).rejects.toThrow('private_handshake_failed');
    await vi.advanceTimersByTimeAsync(5000);
    await result;
  } finally {
    input.destroy();
    vi.useRealTimers();
  }
});
