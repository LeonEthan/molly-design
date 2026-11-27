import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { getLogger } from '@/utils/logger';
import { mcpToolAuthToken } from '../lib/local-supervisor-control';
import {
  getMollyMcpHttpEndpoint,
  startMollyMcpHttpServer,
  stopMollyMcpHttpServer,
} from './molly-mcp-http-server';
import {
  acceptMcpHostHello,
  getMcpToolAuthToken,
  getMollyCoreIpcSocketPath,
  getMollyCoreIpcToken,
} from './molly-core-ipc';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));
vi.mock('./molly-core-supervisor', () => ({
  getMollyCoreConfiguredEndpoint: () => ({
    socketPath: 'synthetic-core',
    authToken: 'b'.repeat(64),
  }),
  onMollyCorePermanentFailure: () => () => {},
}));

afterEach(() => vi.unstubAllEnvs());
it('sends private credentials on stdin and waits for readiness on fd 3', async () => {
  vi.stubEnv('MOLLY_SUPERVISOR_TRANSPORT', 'stdin');
  vi.stubEnv('MOLLY_CORE_IPC_TOKEN', 'inherited-secret');
  const stdin = new PassThrough();
  const ready = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdio: [stdin, null, null, ready],
    exitCode: null,
    signalCode: null,
    kill: () => {
      queueMicrotask(() => child.emit('exit', 0));
      return true;
    },
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  const start = startMollyMcpHttpServer({ logger: getLogger('test') });
  try {
    const frame = JSON.parse(stdin.read().toString());
    expect(frame).toEqual({
      type: 'molly/mcp-host-hello',
      mcpToolAuthToken,
      mollyCore: { socketPath: 'synthetic-core', authToken: 'b'.repeat(64) },
    });
    const [, argv, options] = vi.mocked(spawn).mock.calls[0]!;
    for (const secret of ['inherited-secret', mcpToolAuthToken, frame.mollyCore.authToken])
      expect(JSON.stringify([argv, options])).not.toContain(secret);
    acceptMcpHostHello(frame);
    expect(getMcpToolAuthToken()).toBe(mcpToolAuthToken);
    expect(getMollyCoreIpcSocketPath()).toBe('synthetic-core');
    expect(getMollyCoreIpcToken()).toBe(frame.mollyCore.authToken);
    expect(getMollyMcpHttpEndpoint()).toBeNull();
    ready.write(JSON.stringify({ type: 'lody-mcp-http-listening', port: 17800 }) + '\n');
    await start;
    expect(getMollyMcpHttpEndpoint()?.url).toBe('http://127.0.0.1:17800/mcp');
  } finally {
    await stopMollyMcpHttpServer();
  }
});

it('starts core with a private root and token in the stdin frame', async () => {
  vi.stubEnv('MOLLY_SUPERVISOR_TRANSPORT', 'stdin');
  vi.stubEnv('MOLLY_CORE_IPC_TOKEN', 'old-secret');
  const root = process.cwd();
  vi.stubEnv('MOLLY_DATA_DIR', root);
  const { spawnMollyCore } =
    await vi.importActual<typeof import('./molly-core-supervisor')>('./molly-core-supervisor');
  const stdin = new PassThrough();
  vi.mocked(spawn).mockReturnValue({ stdin } as unknown as ChildProcess);
  const endpoint = { authToken: 'c'.repeat(64), socketPath: 'synthetic-core' };
  spawnMollyCore('core', endpoint);
  const [, argv, options] = vi.mocked(spawn).mock.lastCall!;
  expect(argv).toEqual(['--serve-ipc', endpoint.socketPath, '--stdin-handshake']);
  expect(options?.env).not.toHaveProperty('MOLLY_CORE_IPC_TOKEN');
  expect(options?.env).not.toHaveProperty('MOLLY_DATA_DIR');
  expect(JSON.stringify([argv, options])).not.toContain(endpoint.authToken);
  expect(JSON.parse(stdin.read().toString())).toEqual({
    authToken: endpoint.authToken,
    allowedDataRoot: root,
  });
});
