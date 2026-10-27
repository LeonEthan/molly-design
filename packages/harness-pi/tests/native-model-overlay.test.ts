import { afterEach, describe, expect, it, vi } from 'vitest';
import { PI_ENGINE_VERSION } from '@molly/shared/embedded-harness';
import {
  createNativeModelRuntime,
  parseNativeModelOverlay,
  resolveNativeModelOverlay,
  verifyNativeModelOverlay,
} from '../src/native-model-overlay';
import {
  syntheticKimiProModel,
  syntheticNativeModelOverlay,
  syntheticOverlayManifest,
} from './fixtures/native-model-overlay';

afterEach(() => vi.restoreAllMocks());

describe('native model overlay', () => {
  it('refreshes through the native SDK and restores only K3.1 Pro offline', async () => {
    const requests: { url: string; authorization: string | null }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      requests.push({
        url,
        authorization: new Headers(input instanceof Request ? input.headers : init?.headers).get(
          'authorization'
        ),
      });
      if (new URL(url).hostname !== 'pi.dev') throw new Error('unexpected_catalog_destination');
      return new Response(
        JSON.stringify([
          syntheticKimiProModel(),
          { ...syntheticKimiProModel(), id: 'k3.1-pro-highspeed' },
          { ...syntheticKimiProModel(), id: 'k3', name: 'Remote override must not ship' },
        ]),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'last-modified': 'Wed, 01 Jan 2031 00:00:00 GMT',
            etag: 'synthetic-catalog',
          },
        }
      );
    });

    const resolved = await resolveNativeModelOverlay();
    expect(resolved.source).toBe('refreshed');
    if (!resolved.overlay) throw new Error('expected_refreshed_overlay');
    const overlay = resolved.overlay;
    expect(overlay.entry.models.map((model) => model.id)).toEqual(['k3.1-pro']);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      url: 'https://pi.dev/api/models/providers/kimi-coding?types=chat%2Cimage%2Cclassifier',
      authorization: null,
    });
    expect(JSON.stringify(resolved.overlay)).not.toContain('molly-build-time-catalog-only');

    const baseline = await createNativeModelRuntime();
    const restored = await createNativeModelRuntime(overlay);
    const before = baseline.getModels('kimi-coding');
    const after = restored.getModels('kimi-coding');
    expect(after).toEqual([...before, overlay.entry.models[0]]);
    expect(after.some((model) => model.id === 'k3.1-pro-highspeed')).toBe(false);
    expect(restored.getProvider('kimi-coding')?.auth).toMatchObject({
      apiKey: expect.anything(),
      oauth: expect.anything(),
    });
    expect(requests).toHaveLength(1);
  });

  it('reuses only a verified previous overlay when refresh fails', async () => {
    const fallback = syntheticNativeModelOverlay();
    const resolved = await resolveNativeModelOverlay({
      fallback,
      refresh: async () => {
        throw new Error('synthetic_offline');
      },
    });
    expect(resolved).toEqual({ overlay: fallback, source: 'cached' });
    await expect(verifyNativeModelOverlay(fallback)).resolves.toEqual(fallback);
  });

  it('fails rather than silently shipping without the required model', async () => {
    await expect(
      resolveNativeModelOverlay({
        refresh: async () => {
          throw new Error('synthetic_offline');
        },
      })
    ).rejects.toThrow('harness_native_model_overlay_refresh_failed');
  });

  it('verifies the sealed checksum and exact engine', () => {
    const overlay = syntheticNativeModelOverlay();
    const bytes = JSON.stringify(overlay);
    const manifest = syntheticOverlayManifest(bytes);
    expect(parseNativeModelOverlay(bytes, manifest)).toEqual(overlay);
    expect(() => parseNativeModelOverlay(`${bytes} `, manifest)).toThrow(
      'harness_native_model_overlay_checksum_mismatch'
    );
    const wrongEngine = JSON.stringify({ ...overlay, engineVersion: '0.0.0' });
    expect(() =>
      parseNativeModelOverlay(wrongEngine, syntheticOverlayManifest(wrongEngine))
    ).toThrow('harness_native_model_overlay_invalid');
    expect(PI_ENGINE_VERSION).toBe(overlay.engineVersion);
  });

  it.each([
    ['endpoint', 'https://api.kimi.com/coding/v1', 'https://attacker.invalid/v1'],
    ['protocol', 'openai-completions', 'anthropic-messages'],
    ['engine', PI_ENGINE_VERSION, '0.0.0'],
  ])('rejects a changed %s', (_name, before, after) => {
    const bytes = JSON.stringify(syntheticNativeModelOverlay()).replaceAll(before, after);
    expect(() => parseNativeModelOverlay(bytes, syntheticOverlayManifest(bytes))).toThrow(
      'harness_native_model_overlay_invalid'
    );
  });

  it('rejects extra models and credential-bearing fields', () => {
    const mutations: ((value: {
      entry: { models: [Record<string, unknown>, ...Record<string, unknown>[]] };
    }) => void)[] = [
      (value) => value.entry.models.push({ ...value.entry.models[0], id: 'k3.1-pro-highspeed' }),
      (value) => (value.entry.models[0].headers = { Authorization: 'secret' }),
      (value) => (value.entry.models[0].apiKey = 'secret'),
    ];
    for (const mutate of mutations) {
      const value = JSON.parse(JSON.stringify(syntheticNativeModelOverlay()));
      mutate(value);
      const bytes = JSON.stringify(value);
      expect(() => parseNativeModelOverlay(bytes, syntheticOverlayManifest(bytes))).toThrow(
        'harness_native_model_overlay_invalid'
      );
    }
  });
});
