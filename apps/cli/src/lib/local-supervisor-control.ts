import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import {
  isLocalCliSupervisorShutdownMessage,
  LOCAL_CLI_SUPERVISOR_CONTRACT_VERSION,
  MOLLY_SUPERVISOR_CONTRACT_ENV,
  MOLLY_SUPERVISOR_INSTANCE_ID_ENV,
  MOLLY_SUPERVISOR_PID_ENV,
  MOLLY_SUPERVISOR_TOKEN_ENV,
} from '@molly/shared/node/local-cli-supervisor';
import type { CliRuntimeState } from '@molly/shared';
import type { Logger } from '@/utils/logger';

const SupervisorIdentitySchema = z
  .object({
    instanceId: z.string().trim().min(1),
    pid: z.coerce.number().int().positive(),
    token: z.string().trim().min(32),
    launchMode: z.enum(['daemon', 'electron']),
  })
  .strict();

export type LocalSupervisorIdentity = z.infer<typeof SupervisorIdentitySchema>;

export type LocalSupervisorIdentityResolution =
  | { status: 'unsupervised' }
  | { status: 'supervised'; identity: LocalSupervisorIdentity }
  | { status: 'invalid'; reason: string };

/**
 * A launch marker without a complete, contract-matched identity means the
 * supervising host and this worker come from incompatible releases. Callers
 * must fail closed with `CLI_EXIT_CODE_SUPERVISOR_CONTRACT_MISMATCH`; guessing
 * a launch mode here would grant or drop lifecycle capability incorrectly.
 */
export function resolveLocalSupervisorIdentity(
  env: NodeJS.ProcessEnv = process.env
): LocalSupervisorIdentityResolution {
  const daemonSupervised = (env.MOLLY_DAEMON_SUPERVISED ?? env.LODY_DAEMON_SUPERVISED) === '1';
  const electronSupervised = (env.MOLLY_ELECTRON_BOOTSTRAP ?? env.LODY_ELECTRON_BOOTSTRAP) === '1';
  if (daemonSupervised && electronSupervised) {
    return {
      status: 'invalid',
      reason: 'Conflicting daemon and Electron supervisor launch markers',
    };
  }
  const launchMode = daemonSupervised ? 'daemon' : electronSupervised ? 'electron' : null;
  if (!launchMode) return { status: 'unsupervised' };

  const contractVersion = env[MOLLY_SUPERVISOR_CONTRACT_ENV] ?? env.LODY_SUPERVISOR_CONTRACT;
  if (contractVersion !== LOCAL_CLI_SUPERVISOR_CONTRACT_VERSION) {
    return {
      status: 'invalid',
      reason: `The ${launchMode} supervisor speaks contract version ${contractVersion ?? '(none)'}, but this worker requires version ${LOCAL_CLI_SUPERVISOR_CONTRACT_VERSION}`,
    };
  }

  const parsed = SupervisorIdentitySchema.safeParse({
    instanceId: env[MOLLY_SUPERVISOR_INSTANCE_ID_ENV] ?? env.LODY_SUPERVISOR_INSTANCE_ID,
    pid: env[MOLLY_SUPERVISOR_PID_ENV] ?? env.LODY_SUPERVISOR_PID,
    token: env[MOLLY_SUPERVISOR_TOKEN_ENV] ?? env.LODY_SUPERVISOR_TOKEN,
    launchMode,
  });
  if (!parsed.success) {
    return { status: 'invalid', reason: `Invalid ${launchMode} supervisor identity` };
  }
  return { status: 'supervised', identity: parsed.data };
}

const helloSchema = z
  .object({
    type: z.literal('lody/supervisor-hello'),
    token: z.string().min(32),
    coordinatorToken: z.string().min(32),
    supervisorPid: z.number().int().positive(),
    supervisorInstanceId: z
      .string()
      .min(1)
      .regex(/^[^\r\n]+$/),
  })
  .refine((value) => value.token !== value.coordinatorToken);
let stdinHello: z.infer<typeof helloSchema> | undefined;
let shutdownCallback: ((reason: string) => void) | undefined;
let stopReason: string | undefined;
export const getSupervisorHello = () => stdinHello;
export const mcpToolAuthToken = randomBytes(32).toString('hex');

export function readPrivateHello(
  input: Readable,
  onMessage?: (value: unknown) => void,
  onClose?: () => void
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let pending = true;
    let buffer = Buffer.alloc(0);
    const finish = () => {
      clearTimeout(timer);
      input.off('data', data);
      input.off('end', finish);
      input.off('close', finish);
      input.off('error', finish);
      if (pending) reject(Error('private_handshake_failed'));
      else onClose?.();
    };
    const data = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const newline = buffer.indexOf(10);
        if (newline > 8192 || (newline < 0 && buffer.length > 8192)) return finish();
        if (newline < 0) return;
        try {
          const value: unknown = JSON.parse(buffer.subarray(0, newline).toString());
          buffer = buffer.subarray(newline + 1);
          if (pending) {
            pending = false;
            clearTimeout(timer);
            resolve(value);
            if (!onMessage) {
              finish();
              return;
            }
          } else onMessage?.(value);
        } catch {
          finish();
          return;
        }
      }
    };
    const timer = setTimeout(finish, 5000);
    input.on('data', data).once('end', finish).once('close', finish).once('error', finish);
  });
}

export async function receiveSupervisorIdentity(
  input: Readable = process.stdin
): Promise<LocalSupervisorIdentityResolution> {
  const stop = (reason: string) => {
    if (stopReason) return;
    stopReason = reason;
    shutdownCallback?.(stopReason);
  };
  const earlyMessages: unknown[] = [];
  const message = (value: unknown) => {
    if (!stdinHello) {
      if (earlyMessages.length < 4) earlyMessages.push(value);
      else stop('invalid supervisor stream');
    } else if (
      isLocalCliSupervisorShutdownMessage(value) &&
      value.instanceId === stdinHello.supervisorInstanceId &&
      value.token === stdinHello.token
    )
      stop('Supervisor requested shutdown');
  };
  const parsed = helloSchema.safeParse(
    await readPrivateHello(input, message, () => stop('Supervisor stdin closed'))
  );
  if (!parsed.success) throw Error('invalid_supervisor_hello');
  stdinHello = parsed.data;
  earlyMessages.forEach(message);
  return {
    status: 'supervised',
    identity: {
      instanceId: stdinHello.supervisorInstanceId,
      pid: stdinHello.supervisorPid,
      token: stdinHello.token,
      launchMode: 'electron',
    },
  };
}

export function scrubLocalSupervisorCapabilityEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.MOLLY_SUPERVISOR_TRANSPORT === 'stdin') delete env.MOLLY_CORE_IPC_TOKEN;
  delete env[MOLLY_SUPERVISOR_INSTANCE_ID_ENV];
  delete env.LODY_SUPERVISOR_INSTANCE_ID;
  delete env[MOLLY_SUPERVISOR_PID_ENV];
  delete env.LODY_SUPERVISOR_PID;
  delete env[MOLLY_SUPERVISOR_TOKEN_ENV];
  delete env.LODY_SUPERVISOR_TOKEN;
  delete env[MOLLY_SUPERVISOR_CONTRACT_ENV];
  delete env.LODY_SUPERVISOR_CONTRACT;
  delete env.MOLLY_DAEMON_SUPERVISED;
  delete env.LODY_DAEMON_SUPERVISED;
}

export function toRuntimeSupervisorIdentity(
  identity: LocalSupervisorIdentity | null
): CliRuntimeState['supervisor'] {
  if (!identity) return undefined;
  return {
    instanceId: identity.instanceId,
    pid: identity.pid,
    launchMode: identity.launchMode,
  };
}

export function registerLocalSupervisorControl(options: {
  identity: LocalSupervisorIdentity | null;
  logger: Logger;
  shutdown: (reason: string) => void;
  messageSource?: {
    on: (event: 'message' | 'disconnect', listener: (message?: unknown) => void) => unknown;
    off: (event: 'message' | 'disconnect', listener: (message?: unknown) => void) => unknown;
    send?: unknown;
    connected?: boolean;
  };
}): () => void {
  const identity = options.identity;
  if (!identity) return () => {};
  if (stdinHello && process.env.MOLLY_SUPERVISOR_TRANSPORT === 'stdin') {
    shutdownCallback = options.shutdown;
    if (stopReason) shutdownCallback(stopReason);
    return () => {
      if (shutdownCallback === options.shutdown) shutdownCallback = undefined;
    };
  }
  const messageSource =
    options.messageSource ??
    ({
      on: (event, listener) => {
        if (event === 'message') process.on('message', listener);
        else process.on('disconnect', listener);
      },
      off: (event, listener) => {
        if (event === 'message') process.off('message', listener);
        else process.off('disconnect', listener);
      },
      send: process.send,
      connected: process.connected,
    } satisfies NonNullable<(typeof options)['messageSource']>);

  let shutdownRequested = false;
  const requestShutdown = (reason: string) => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    options.logger.info(reason);
    options.shutdown(reason);
  };
  const onMessage = (message: unknown) => {
    if (!isLocalCliSupervisorShutdownMessage(message)) return;
    if (message.instanceId !== identity.instanceId || message.token !== identity.token) return;
    requestShutdown('Supervisor requested graceful shutdown over the private IPC channel.');
  };
  const onDisconnect = () => {
    requestShutdown('Supervisor IPC channel disconnected; stopping orphaned worker.');
  };

  messageSource.on('message', onMessage);
  messageSource.on('disconnect', onDisconnect);
  if (typeof messageSource.send !== 'function' || messageSource.connected !== true) {
    queueMicrotask(onDisconnect);
  }

  return () => {
    messageSource.off('message', onMessage);
    messageSource.off('disconnect', onDisconnect);
  };
}
