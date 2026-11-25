import { z } from 'zod';
import net from 'node:net';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const MAX_IPC_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_IPC_RESPONSE_BYTES = 96 * 1024 * 1024;
const CHALLENGE_METHOD = 'ipc.challenge';
const HANDSHAKE_METHOD = 'ipc.hello';
const HANDSHAKE_TIMEOUT_MS = 5_000;

type IpcErrorPayload = {
  code?: string;
  message?: string;
};

type IpcResponseEnvelope<T> = {
  id?: string;
  ok: boolean;
  result?: T;
  error?: IpcErrorPayload;
};

export class CoreIpcRpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CoreIpcRpcError';
    this.code = code;
  }
}

export class MollyCorePreConnectError extends Error {
  readonly code = 'MOLLY_CORE_UNREACHABLE';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MollyCorePreConnectError';
  }
}

export function isMollyCorePreConnectError(error: unknown): error is MollyCorePreConnectError {
  return error instanceof MollyCorePreConnectError;
}

const hostHelloSchema = z.object({
  type: z.literal('molly/mcp-host-hello'),
  mcpToolAuthToken: z.string().regex(/^[0-9a-f]{64}$/),
  mollyCore: z
    .object({ socketPath: z.string().min(1), authToken: z.string().regex(/^[0-9a-f]{64}$/) })
    .nullable(),
});
let hostHello: z.infer<typeof hostHelloSchema> | undefined;
export function acceptMcpHostHello(value: unknown) {
  hostHello = hostHelloSchema.parse(value);
}
export const getMcpToolAuthToken = () => hostHello?.mcpToolAuthToken;
export function getMollyCoreIpcSocketPath(): string | undefined {
  if (hostHello || process.env.MOLLY_SUPERVISOR_TRANSPORT === 'stdin')
    return hostHello?.mollyCore?.socketPath;
  const value = process.env.MOLLY_CORE_IPC_SOCKET?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function getMollyCoreIpcToken(): string | undefined {
  if (hostHello || process.env.MOLLY_SUPERVISOR_TRANSPORT === 'stdin')
    return hostHello?.mollyCore?.authToken;
  const value = process.env.MOLLY_CORE_IPC_TOKEN?.trim();
  return value && value.length > 0 ? value : undefined;
}

function computeHandshakeMac(token: string, message: string): string {
  return createHmac('sha256', token).update(message).digest('hex');
}

function equalHexMac(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

function safeErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return fallback;
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) {
      return code;
    }
  }
  return fallback;
}

export type CallMollyCoreIpcOptions = {
  authToken?: string;
  requireMutualAuth?: boolean;
};

export async function callMollyCoreIpc<T>(
  socketPath: string,
  method: string,
  params: unknown,
  signal?: AbortSignal,
  options: CallMollyCoreIpcOptions = {}
): Promise<T> {
  signal?.throwIfAborted();
  const authToken = options.authToken ?? getMollyCoreIpcToken();
  if ((options.requireMutualAuth || method.startsWith('image_mcp.')) && !authToken) {
    throw new Error(
      'molly-core IPC mutual authentication token (MOLLY_CORE_IPC_TOKEN) is required'
    );
  }

  const requestId = randomUUID();
  const requestFrame = Buffer.from(
    `${JSON.stringify({ id: requestId, method, params })}\n`,
    'utf8'
  );
  if (requestFrame.byteLength > MAX_IPC_REQUEST_BYTES) {
    throw new Error(`molly-core IPC request exceeds ${MAX_IPC_REQUEST_BYTES} bytes`);
  }

  return await new Promise<T>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = Buffer.alloc(0);
    let settled = false;
    let connected = false;
    let stage: 'challenge' | 'handshake' | 'request' = authToken ? 'challenge' : 'request';
    const clientNonce = authToken ? randomBytes(16).toString('hex') : '';
    let serverNonce = '';
    let handshakeId = '';
    let handshakeTimer: ReturnType<typeof setTimeout> | undefined;

    const clearHandshakeTimer = () => {
      if (handshakeTimer !== undefined) {
        clearTimeout(handshakeTimer);
        handshakeTimer = undefined;
      }
    };

    const finish = (err: Error | null, value?: T) => {
      if (settled) return;
      settled = true;
      clearHandshakeTimer();
      signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      if (err) reject(err);
      else resolve(value as T);
    };

    const onAbort = () => {
      const reason = signal?.reason;
      finish(reason instanceof Error ? reason : new Error('molly-core IPC request aborted'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    if (authToken) {
      handshakeTimer = setTimeout(() => {
        finish(new Error('molly-core IPC handshake timed out'));
      }, HANDSHAKE_TIMEOUT_MS);
      handshakeTimer.unref();
    }

    socket.once('connect', () => {
      connected = true;
      if (stage === 'request') {
        socket.write(requestFrame);
      }
    });

    socket.on('data', (chunk: Buffer) => {
      if (buffer.byteLength + chunk.byteLength > MAX_IPC_RESPONSE_BYTES) {
        finish(new Error(`molly-core IPC response exceeds ${MAX_IPC_RESPONSE_BYTES} bytes`));
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);

      for (;;) {
        const nlIndex = buffer.indexOf(0x0a);
        if (nlIndex === -1) return;
        const line = buffer.subarray(0, nlIndex).toString('utf8').trim();
        buffer = buffer.subarray(nlIndex + 1);
        if (!line) continue;

        let envelope: IpcResponseEnvelope<unknown>;
        try {
          const parsed: unknown = JSON.parse(line);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            finish(new Error('molly-core IPC returned non-object JSON'));
            return;
          }
          envelope = parsed as IpcResponseEnvelope<unknown>;
        } catch {
          finish(new Error('molly-core IPC returned invalid JSON'));
          return;
        }

        if (stage === 'challenge' && authToken) {
          if (!envelope.ok || envelope.id !== CHALLENGE_METHOD) {
            finish(new Error(safeErrorMessage(envelope.error, 'molly-core IPC challenge failed')));
            return;
          }
          const result = envelope.result as { serverNonce?: unknown } | undefined;
          const nonce = typeof result?.serverNonce === 'string' ? result.serverNonce : '';
          if (nonce.length < 16) {
            finish(new Error('molly-core IPC returned invalid server challenge nonce'));
            return;
          }
          serverNonce = nonce;
          handshakeId = randomUUID();
          stage = 'handshake';
          const hello = Buffer.from(
            `${JSON.stringify({
              id: handshakeId,
              method: HANDSHAKE_METHOD,
              params: {
                clientNonce,
                clientMac: computeHandshakeMac(authToken, `client:${serverNonce}:${clientNonce}`),
              },
            })}\n`,
            'utf8'
          );
          socket.write(hello);
          continue;
        }

        if (stage === 'handshake' && authToken) {
          if (envelope.id !== handshakeId) {
            finish(new Error('molly-core IPC handshake response id mismatch'));
            return;
          }
          if (!envelope.ok) {
            finish(new Error(safeErrorMessage(envelope.error, 'molly-core IPC handshake failed')));
            return;
          }
          const result = envelope.result as { serverMac?: unknown } | undefined;
          const serverMac = typeof result?.serverMac === 'string' ? result.serverMac : '';
          const expectedServerMac = computeHandshakeMac(
            authToken,
            `server:${clientNonce}:${serverNonce}`
          );
          if (!equalHexMac(serverMac, expectedServerMac)) {
            finish(new Error('molly-core IPC server identity verification failed'));
            return;
          }
          clearHandshakeTimer();
          stage = 'request';
          socket.write(requestFrame);
          continue;
        }

        if (envelope.id !== requestId) {
          finish(new Error('molly-core IPC response id mismatch'));
          return;
        }
        if (!envelope.ok) {
          finish(
            new CoreIpcRpcError(
              safeErrorCode(envelope.error, 'rpc_error'),
              safeErrorMessage(envelope.error, 'molly-core IPC request failed')
            )
          );
          return;
        }
        finish(null, envelope.result as T);
        return;
      }
    });

    socket.once('error', (error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      if (!connected) {
        finish(new MollyCorePreConnectError(err.message, { cause: err }));
        return;
      }
      finish(err);
    });

    socket.once('end', () => {
      if (!settled) {
        finish(new Error('molly-core IPC closed before sending a response'));
      }
    });
  });
}
