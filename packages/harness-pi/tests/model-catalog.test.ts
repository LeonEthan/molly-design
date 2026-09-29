import { VERSION } from '@earendil-works/pi-coding-agent';
import { registerSyntheticModels } from './fixtures/synthetic-models';
import { afterEach, expect, it, vi } from 'vitest';
import { createBundledModelCatalog } from '../src/model-catalog';

registerSyntheticModels();
afterEach(() => vi.restoreAllMocks());

it('projects the pinned SDK catalog without network, credentials or an implicit model', async () => {
  const requests: unknown[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    requests.push(input);
    throw new Error('catalog_must_be_offline');
  });
  const catalog = await createBundledModelCatalog();
  expect(catalog.engineVersion).toBe(VERSION);
  expect(
    catalog.models.find(
      (model) => model.providerPresetId === 'kimi-coding' && model.modelId === 'k3-256k'
    )
  ).toEqual(
    expect.objectContaining({
      thinking: expect.arrayContaining(['high']),
      input: expect.arrayContaining(['image']),
    })
  );
  expect(catalog.models.some((model) => model.providerPresetId === 'openai')).toBe(true);
  expect(requests).toEqual([]);
  expect(Object.keys(catalog).sort()).toEqual(['engineVersion', 'models', 'version']);
  expect(catalog.models.every((model) => !('apiKey' in model) && !('baseUrl' in model))).toBe(true);
});
