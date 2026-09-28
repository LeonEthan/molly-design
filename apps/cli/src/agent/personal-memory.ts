import { createHash, randomUUID } from 'node:crypto';
import type { MemoryVectorStore } from 'mem0ai/oss';
import {
  PersonalMemoryEntrySchema as EntrySchema,
  PersonalMemoryChangesSchema,
  PERSONAL_MEMORY_LIMIT,
} from '@molly/shared/personal-memory';
import { getMollyDataDir } from '@molly/shared/node/installation-profile';
import { join } from 'node:path';

export class PersonalMemoryService {
  private pending: Promise<unknown> = Promise.resolve();

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }

  private constructor(private readonly store: MemoryVectorStore) {}

  static async open(dbPath: string): Promise<PersonalMemoryService> {
    process.env.MEM0_TELEMETRY = 'false';
    const { MemoryVectorStore } = await import('mem0ai/oss');
    return new PersonalMemoryService(
      new MemoryVectorStore({ dbPath, dimension: 1, collectionName: 'personal_preferences' })
    );
  }

  async read() {
    const [records] = await this.store.list({ kind: 'preference' }, 32);
    const entries = records
      .map((record) => EntrySchema.parse({ id: record.id, text: record.payload.text }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const settings = await this.store.get('settings');
    const enabled = settings?.payload.enabled !== false;
    return {
      revision: createHash('sha256')
        .update(JSON.stringify([entries, settings?.payload]))
        .digest('hex'),
      enabled,
      entries,
    };
  }

  async setEnabled(enabled: boolean, revision: string): Promise<void> {
    return this.serialize(async () => {
      if ((await this.read()).revision !== revision) throw new Error('memory_stale');
      await this.store.insert(
        [[1]],
        ['settings'],
        [{ kind: 'settings', enabled, revision: randomUUID() }]
      );
    });
  }

  async edit(id: string, text: string, revision: string): Promise<void> {
    const entry = EntrySchema.parse({ id, text });
    return this.serialize(async () => {
      const snapshot = await this.read();
      if (snapshot.revision !== revision) throw new Error('memory_stale');
      if (!snapshot.entries.some((item) => item.id === id)) throw new Error('memory_missing');
      await this.store.insert(
        [[1], [1]],
        [id, 'settings'],
        [
          { ...entry, kind: 'preference' },
          { kind: 'settings', enabled: snapshot.enabled, revision: randomUUID() },
        ]
      );
    });
  }

  async remove(id: string, revision: string): Promise<void> {
    return this.serialize(async () => {
      const snapshot = await this.read();
      if (snapshot.revision !== revision) throw new Error('memory_stale');
      if (!snapshot.entries.some((entry) => entry.id === id)) throw new Error('memory_missing');
      await this.store.insert(
        [[1]],
        ['settings'],
        [{ kind: 'settings', enabled: snapshot.enabled, revision: randomUUID() }]
      );
      await this.store.delete(id);
    });
  }

  async capture(revision: string, rawChanges: unknown, signal: AbortSignal): Promise<void> {
    return this.serialize(async () => {
      const changes = PersonalMemoryChangesSchema.parse(rawChanges);
      const snapshot = await this.read();
      signal.throwIfAborted();
      if (snapshot.revision !== revision) throw new Error('memory_stale');
      if (!snapshot.enabled) throw new Error('memory_disabled');
      if (
        changes.some(
          (change) => change.id && !snapshot.entries.some((entry) => entry.id === change.id)
        )
      )
        throw new Error('memory_missing');
      if (
        snapshot.entries.length + changes.filter((change) => !change.id).length >
        PERSONAL_MEMORY_LIMIT
      )
        throw new Error('memory_full');
      if (changes.length === 0) return;
      const records = changes.map((change) => ({
        id: change.id ?? randomUUID(),
        text: change.text,
        kind: 'preference',
      }));
      signal.throwIfAborted();
      await this.store.insert(
        [...records.map(() => [1]), [1]],
        [...records.map((entry) => entry.id), 'settings'],
        [...records, { kind: 'settings', enabled: snapshot.enabled, revision: randomUUID() }]
      );
    });
  }
}

let service: Promise<PersonalMemoryService> | undefined;
export function getPersonalMemory(): Promise<PersonalMemoryService> {
  return (service ??= PersonalMemoryService.open(
    join(getMollyDataDir(), 'memory', 'preferences.sqlite')
  ).catch((error) => {
    service = undefined;
    throw error;
  }));
}
