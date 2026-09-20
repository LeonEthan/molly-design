import { describe, expect, it } from 'vitest';
import { LegacyImageMigration } from './legacy-image-migration';

const initial = {
  v: 1 as const,
  enabled: true,
  baseUrl: 'https://images.invalid/v1',
  model: 'explicit',
  apiKey: 'synthetic',
  updatedAt: 1,
};
describe('legacy image vault handoff', () => {
  it('retains the row until the exact encryption acknowledgement and tolerates redelivery', async () => {
    const migration = new LegacyImageMigration();
    let row: typeof initial | undefined = initial;
    const ports = {
      read: async () => row,
      clearIfEqual: async (expected: unknown) => {
        if (JSON.stringify(row) === JSON.stringify(expected)) row = undefined;
      },
    };
    const request = await migration.exchange(undefined, ports);
    expect(await migration.exchange(undefined, ports)).toEqual(request);
    expect(await migration.exchange('00000000-0000-4000-8000-000000000001', ports)).toEqual(
      request
    );
    expect(row).toEqual(initial);
    expect(await migration.exchange(request?.requestId, ports)).toBeUndefined();
    expect(row).toBeUndefined();
  });
  it('does not remove a concurrently changed credential and restarts safely without a pending request', async () => {
    const migration = new LegacyImageMigration();
    let row: typeof initial | undefined = initial;
    const ports = {
      read: async () => row,
      clearIfEqual: async (expected: unknown) => {
        if (JSON.stringify(row) === JSON.stringify(expected)) row = undefined;
      },
    };
    const request = await migration.exchange(undefined, ports);
    row = { ...initial, apiKey: 'synthetic-replacement', updatedAt: 2 };
    const next = await migration.exchange(request?.requestId, ports);
    expect(next?.connection).toEqual(row);
    expect(next?.requestId).not.toBe(request?.requestId);
    const restarted = new LegacyImageMigration();
    expect((await restarted.exchange(next?.requestId, ports))?.connection).toEqual(row);
  });
  it('keeps a failed durable removal retryable without treating it as success', async () => {
    const migration = new LegacyImageMigration();
    const ports = {
      read: async () => initial,
      clearIfEqual: async () => {
        throw Error('synthetic flush failure');
      },
    };
    const request = await migration.exchange(undefined, ports);
    await expect(migration.exchange(request?.requestId, ports)).rejects.toThrow(
      'synthetic flush failure'
    );
    expect(await migration.exchange(undefined, ports)).toEqual(request);
  });
});
