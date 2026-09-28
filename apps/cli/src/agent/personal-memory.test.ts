import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { PersonalMemoryService } from './personal-memory';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

it('recalls automatically saved personal preferences after reopening the store', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'molly-preferences-'));
  directories.push(directory);
  const dbPath = path.join(directory, 'memory.sqlite');
  const memory = await PersonalMemoryService.open(dbPath);
  const snapshot = await memory.read();
  await memory.capture(
    snapshot.revision,
    [{ text: 'Prefers concise explanations.' }],
    new AbortController().signal
  );
  const reopened = await PersonalMemoryService.open(dbPath);
  expect((await reopened.read()).entries.map((entry) => entry.text)).toEqual([
    'Prefers concise explanations.',
  ]);
});

it('does not restore a deleted preference from a pending extraction', async () => {
  const memory = await PersonalMemoryService.open(':memory:');
  const signal = new AbortController().signal;
  await memory.capture((await memory.read()).revision, [{ text: 'Prefers blue.' }], signal);
  const pending = await memory.read();
  const entry = pending.entries[0];
  if (!entry) throw new Error('missing preference');
  await memory.remove(entry.id, pending.revision);
  await expect(
    memory.capture(pending.revision, [{ id: entry.id, text: 'Prefers dark blue.' }], signal)
  ).rejects.toThrow('memory_stale');
  expect((await memory.read()).entries).toEqual([]);
});

it('rejects simultaneous changes based on the same snapshot', async () => {
  const memory = await PersonalMemoryService.open(':memory:');
  const snapshot = await memory.read();
  const results = await Promise.allSettled([
    memory.capture(snapshot.revision, [{ text: 'Prefers blue.' }], new AbortController().signal),
    memory.capture(snapshot.revision, [{ text: 'Prefers red.' }], new AbortController().signal),
  ]);
  expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
  expect((await memory.read()).entries.map((entry) => entry.text)).toEqual(['Prefers blue.']);
});

it('invalidates pending capture even after memory is disabled and re-enabled', async () => {
  const memory = await PersonalMemoryService.open(':memory:');
  const pending = await memory.read();
  await memory.setEnabled(false, pending.revision);
  const disabled = await memory.read();
  expect(disabled.enabled).toBe(false);
  await expect(
    memory.capture(disabled.revision, [{ text: 'Prefers blue.' }], new AbortController().signal)
  ).rejects.toThrow('memory_disabled');
  await memory.setEnabled(true, disabled.revision);
  await expect(
    memory.capture(pending.revision, [{ text: 'Prefers blue.' }], new AbortController().signal)
  ).rejects.toThrow('memory_stale');
  expect((await memory.read()).entries).toEqual([]);
});

it('allows editing while disabled without accepting an older empty snapshot', async () => {
  const memory = await PersonalMemoryService.open(':memory:');
  const initial = await memory.read();
  await memory.capture(initial.revision, [{ text: 'Prefers blue.' }], new AbortController().signal);
  const saved = await memory.read();
  const entry = saved.entries[0];
  if (!entry) throw new Error('missing preference');
  await memory.setEnabled(false, saved.revision);
  await memory.edit(entry.id, 'Prefers green.', (await memory.read()).revision);
  expect((await memory.read()).entries.map((item) => item.text)).toEqual(['Prefers green.']);
  await memory.remove(entry.id, (await memory.read()).revision);
  await memory.setEnabled(true, (await memory.read()).revision);
  await expect(
    memory.capture(initial.revision, [{ text: 'Prefers blue.' }], new AbortController().signal)
  ).rejects.toThrow('memory_stale');
});

it('rejects updates to unknown entries and cancelled saves without changing memory', async () => {
  const memory = await PersonalMemoryService.open(':memory:');
  const initial = await memory.read();
  await expect(
    memory.capture(
      initial.revision,
      [{ id: 'unknown', text: 'Prefers blue.' }],
      new AbortController().signal
    )
  ).rejects.toThrow('memory_missing');
  const controller = new AbortController();
  const saving = memory.capture(initial.revision, [{ text: 'Prefers blue.' }], controller.signal);
  controller.abort();
  await expect(saving).rejects.toThrow();
  expect(await memory.read()).toEqual(initial);
});

it('keeps the recalled preference set bounded without dropping existing memories', async () => {
  const memory = await PersonalMemoryService.open(':memory:');
  for (let batch = 0; batch < 4; batch++) {
    await memory.capture(
      (await memory.read()).revision,
      Array.from({ length: 8 }, (_, item) => ({ text: `Preference ${batch * 8 + item}` })),
      new AbortController().signal
    );
  }
  const full = await memory.read();
  await expect(
    memory.capture(full.revision, [{ text: 'One more preference' }], new AbortController().signal)
  ).rejects.toThrow('memory_full');
  expect(await memory.read()).toEqual(full);
});
