import { describe, expect, it, vi } from 'vitest';
import type { LoroRepo } from 'loro-repo';
import {
  IMAGE_CONNECTION_VERSION,
  getMachineFlockDocId,
  machineFlockKeys,
  type ImageConnectionSettings,
  type ImageHttpRequest,
  type ImageHttpResponse,
  type ImageHttpTransport,
  type MachineFlockKey,
  type MachineId,
  type WorkspaceId,
} from '@molly/shared';
import {
  IMAGE_CONNECTION_PROBE_MAX_BYTES,
  IMAGE_CONNECTION_PROBE_TIMEOUT_MS,
  buildImageModelsRequest,
  fetchImageHttpTransport,
  probeImageConnection,
  readMachineImageConnection,
} from './image-connection';

const workspaceId = 'workspace-1' as WorkspaceId;
const machineId = 'machine-1' as MachineId;
const SECRET_KEY = 'sk-live-super-secret-value';

/** Minimal in-memory flock: plain key -> value storage (see agent-config-machine-flock.test.ts). */
class FakeFlock {
  readonly rows = new Map<string, { key: MachineFlockKey; value: unknown }>();

  scan(options?: { prefix?: readonly unknown[] }) {
    return [...this.rows.values()].filter((row) => {
      const prefix = options?.prefix;
      return !prefix || prefix.every((part, index) => row.key[index] === part);
    });
  }

  set(key: MachineFlockKey, value: unknown): void {
    this.rows.set(JSON.stringify(key), { key: [...key] as MachineFlockKey, value });
  }

  delete(key: MachineFlockKey): void {
    this.rows.delete(JSON.stringify(key));
  }

  commit(): void {}
}

function createFakeRepo() {
  const flock = new FakeFlock();
  const openFlockDoc = vi.fn(async () => ({ flock, syncOnce: vi.fn(async () => {}) }));
  return { repo: { openFlockDoc } as unknown as LoroRepo, flock, openFlockDoc };
}

const stored: ImageConnectionSettings = {
  v: IMAGE_CONNECTION_VERSION,
  enabled: true,
  baseUrl: 'https://images.example.com/v1',
  apiKey: SECRET_KEY,
  model: 'gpt-image-2',
  updatedAt: 1_700_000_000_000,
};

const jsonResponse = (status: number, body: unknown): ImageHttpResponse => ({
  status,
  bytes: new TextEncoder().encode(JSON.stringify(body)),
});

function recordedTransport(handler: (request: ImageHttpRequest) => ImageHttpResponse): {
  calls: ImageHttpRequest[];
  transport: ImageHttpTransport;
} {
  const calls: ImageHttpRequest[] = [];
  return {
    calls,
    transport: async (request) => {
      calls.push(request);
      return handler(request);
    },
  };
}

describe('readMachineImageConnection', () => {
  it('reads the row out of this machine flock doc', async () => {
    const { repo, flock, openFlockDoc } = createFakeRepo();
    flock.set(machineFlockKeys.imageConnection(), stored);

    await expect(readMachineImageConnection(repo, workspaceId, machineId)).resolves.toEqual(stored);
    expect(openFlockDoc).toHaveBeenCalledWith(getMachineFlockDocId(workspaceId, machineId));
  });

  it('answers undefined when nothing is stored', async () => {
    const { repo } = createFakeRepo();
    await expect(readMachineImageConnection(repo, workspaceId, machineId)).resolves.toBeUndefined();
  });

  it('answers undefined for a stored row this build cannot use', async () => {
    const { repo, flock } = createFakeRepo();
    flock.set(machineFlockKeys.imageConnection(), { ...stored, v: 99 });
    await expect(readMachineImageConnection(repo, workspaceId, machineId)).resolves.toBeUndefined();
  });
});

describe('buildImageModelsRequest', () => {
  it('is the non-billable discovery endpoint with the stored credential', () => {
    const request = buildImageModelsRequest(stored);
    expect(request.url).toBe('https://images.example.com/v1/models');
    expect(request.method).toBe('GET');
    expect(request.headers.authorization).toBe(`Bearer ${SECRET_KEY}`);
    expect(request.timeoutMs).toBe(IMAGE_CONNECTION_PROBE_TIMEOUT_MS);
    expect(request.maxBytes).toBe(IMAGE_CONNECTION_PROBE_MAX_BYTES);
    // A probe must never be able to ask for a generation.
    expect(request.body).toBeUndefined();
    expect(request.url).not.toContain('/images/generations');
  });
});

describe('probeImageConnection', () => {
  it('refuses an incomplete connection before building any request', async () => {
    const calls: ImageHttpRequest[] = [];
    const transport: ImageHttpTransport = async (request) => {
      calls.push(request);
      return jsonResponse(200, { data: [] });
    };

    for (const settings of [
      undefined,
      { ...stored, enabled: false },
      { ...stored, apiKey: '' },
    ] as (ImageConnectionSettings | undefined)[]) {
      await expect(probeImageConnection(settings, transport)).resolves.toEqual({
        ok: false,
        error: 'image_connection_incomplete',
      });
    }
    // An "enabled but keyless" row must not become an unauthenticated call out.
    expect(calls).toEqual([]);
  });

  it('reports success with the model count on a 2xx', async () => {
    const { calls, transport } = recordedTransport(() =>
      jsonResponse(200, { data: [{ id: 'gpt-image-2' }, { id: 'gpt-image-1' }] })
    );

    await expect(probeImageConnection(stored, transport)).resolves.toEqual({
      ok: true,
      modelCount: 2,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://images.example.com/v1/models');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${SECRET_KEY}`);
  });

  it('still reports reachable when the body is not the shape it expected', async () => {
    const transport: ImageHttpTransport = async () => ({
      status: 200,
      bytes: new TextEncoder().encode('<html>kiwi gateway</html>'),
    });
    await expect(probeImageConnection(stored, transport)).resolves.toEqual({
      ok: true,
      modelCount: 0,
    });
  });

  it('surfaces the upstream message on an HTTP error', async () => {
    const { transport } = recordedTransport(() =>
      jsonResponse(401, { error: { message: 'invalid API key provided' } })
    );
    await expect(probeImageConnection(stored, transport)).resolves.toEqual({
      ok: false,
      error: 'HTTP 401: invalid API key provided',
    });
  });

  it('falls back to the raw body when the error is not JSON', async () => {
    const transport: ImageHttpTransport = async () => ({
      status: 502,
      bytes: new TextEncoder().encode('  bad gateway  '),
    });
    await expect(probeImageConnection(stored, transport)).resolves.toEqual({
      ok: false,
      error: 'HTTP 502: bad gateway',
    });
  });

  it('reports a transport failure as a failure, not as a success', async () => {
    const transport: ImageHttpTransport = async () => {
      throw new Error('request timed out after 15000ms');
    };
    await expect(probeImageConnection(stored, transport)).resolves.toEqual({
      ok: false,
      error: 'request timed out after 15000ms',
    });
  });

  it('never puts the credential in the result it returns', async () => {
    const failure = recordedTransport(() => jsonResponse(403, { error: { message: 'forbidden' } }));
    const result = await probeImageConnection(stored, failure.transport);
    expect(JSON.stringify(result)).not.toContain(SECRET_KEY);
    // The request did carry the key — the assertion above is about the result.
    expect(failure.calls[0]!.headers.authorization).toContain(SECRET_KEY);

    const thrown: ImageHttpTransport = async () => {
      throw new Error('socket hang up');
    };
    expect(JSON.stringify(await probeImageConnection(stored, thrown))).not.toContain(SECRET_KEY);
  });

  /* The base URL is user-typed, so the endpoint may echo whatever it was sent. */
  it('redacts the credential when the upstream echoes it back', async () => {
    const { transport } = recordedTransport(() =>
      jsonResponse(401, {
        error: { message: `gateway: bad header authorization Bearer ${SECRET_KEY}` },
      })
    );

    const result = await probeImageConnection(stored, transport);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toContain('[redacted]');
    expect(result.error).toContain('gateway: bad header authorization');
    expect(result.error).toContain('HTTP 401');
    expect(result.error).not.toContain(SECRET_KEY);
  });
});

describe('fetchImageHttpTransport', () => {
  it('bounds the response while reading, and cancels a body past the cap', async () => {
    const cancel = vi.fn(async () => undefined);
    const streamed = (chunks: Uint8Array[]): Response =>
      ({
        status: 200,
        body: {
          getReader: () => {
            let index = 0;
            return {
              read: async () =>
                index < chunks.length
                  ? { done: false, value: chunks[index++]! }
                  : { done: true, value: undefined },
              cancel,
            };
          },
        },
      }) as unknown as Response;

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => streamed([new Uint8Array([1, 2, 3])])) as typeof fetch;
      await expect(
        fetchImageHttpTransport({
          url: 'https://images.example.com/v1/models',
          method: 'GET',
          headers: {},
          timeoutMs: 1_000,
          maxBytes: 8,
        })
      ).resolves.toEqual({ status: 200, bytes: new Uint8Array([1, 2, 3]) });

      globalThis.fetch = (async () =>
        streamed([new Uint8Array(6), new Uint8Array(6)])) as typeof fetch;
      await expect(
        fetchImageHttpTransport({
          url: 'https://images.example.com/v1/models',
          method: 'GET',
          headers: {},
          timeoutMs: 1_000,
          maxBytes: 8,
        })
      ).rejects.toThrow(/exceeds 8 bytes/);
      expect(cancel).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps caller cancellation distinct from the request deadline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let fetchStarted = (_signal: AbortSignal) => {};
    let markFetchAborted = () => {};
    let rejectFetch = (_reason: unknown) => {};
    const started = new Promise<AbortSignal>((resolve) => {
      fetchStarted = resolve;
    });
    const fetchAborted = new Promise<void>((resolve) => {
      markFetchAborted = resolve;
    });
    vi.stubGlobal(
      'fetch',
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!(signal instanceof AbortSignal)) throw new Error('missing fetch signal');
          fetchStarted(signal);
          rejectFetch = reject;
          signal.addEventListener('abort', markFetchAborted, { once: true });
        })
    );
    try {
      const request = fetchImageHttpTransport({
        url: 'https://images.example.com/v1/models',
        method: 'GET',
        headers: {},
        timeoutMs: 1_000,
        signal: controller.signal,
        maxBytes: 8,
      });
      const combined = await started;
      const cancelled = expect(request).rejects.toThrow('synthetic native cancellation');
      controller.abort(new Error('synthetic native cancellation'));
      await fetchAborted;
      await vi.advanceTimersByTimeAsync(1_000);
      rejectFetch(combined.reason);
      await cancelled;
      expect(combined.aborted).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('still reports the deadline when its timer cancels fetch', async () => {
    vi.useFakeTimers();
    let fetchStarted = (_signal: AbortSignal) => {};
    const started = new Promise<AbortSignal>((resolve) => {
      fetchStarted = resolve;
    });
    vi.stubGlobal(
      'fetch',
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!(signal instanceof AbortSignal)) throw new Error('missing fetch signal');
          fetchStarted(signal);
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })
    );
    try {
      const request = fetchImageHttpTransport({
        url: 'https://images.example.com/v1/models',
        method: 'GET',
        headers: {},
        timeoutMs: 1_000,
        maxBytes: 8,
      });
      await started;
      const timedOut = expect(request).rejects.toThrow('request timed out after 1000ms');
      await vi.advanceTimersByTimeAsync(1_000);
      await timedOut;
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
