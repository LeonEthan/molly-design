import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import {
  PersonalMemoryEntrySchema as EntrySchema,
  PersonalMemoryChangesSchema,
  PERSONAL_MEMORY_LIMIT,
  type PersonalMemorySnapshot,
} from '@molly/shared/personal-memory';
import { getMollyDataDir } from '@molly/shared/node/installation-profile';
import {
  callMollyCoreIpc,
  getMollyCoreIpcSocketPath,
  getMollyCoreIpcToken,
} from '@/mcp/molly-core-ipc';
import {
  getMollyCoreConfiguredEndpoint,
  onMollyCorePermanentFailure,
  waitForMollyCoreEndpoint,
  type MollyCoreEndpoint,
} from '@/mcp/molly-core-supervisor';

const LEGACY_MEM0_MIGRATION_NAME = 'mem0_vectors_v1';

type PreferenceRow = { id: string; text: string };
type MetaRow = { enabled: number; revision_nonce: string };
type LegacyVectorRow = { id: string; payload: string };

function computeRevision(entries: PreferenceRow[], enabled: boolean, nonce: string): string {
  return createHash('sha256').update(JSON.stringify({ entries, enabled, nonce })).digest('hex');
}

function initMemorySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS personal_preferences (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL CHECK(length(text) >= 1 AND length(text) <= 300),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS personal_memory_meta (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      revision_nonce TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS personal_memory_migrations (
      name TEXT PRIMARY KEY,
      imported_count INTEGER NOT NULL,
      migrated_at INTEGER NOT NULL
    );
  `);
  db.prepare(
    `INSERT OR IGNORE INTO personal_memory_meta (id, enabled, revision_nonce, updated_at) VALUES (1, 1, 'initial', ?)`
  ).run(Date.now());
  importLegacyMem0VectorsIfNeeded(db);
}

function importLegacyMem0VectorsIfNeeded(db: Database.Database): void {
  const migrate = db.transaction(() => {
    const already = db
      .prepare(`SELECT COUNT(1) AS count FROM personal_memory_migrations WHERE name = ?`)
      .get(LEGACY_MEM0_MIGRATION_NAME) as { count: number } | undefined;
    if ((already?.count ?? 0) > 0) return;

    const hasVectors = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vectors'`)
      .get() as { name: string } | undefined;
    if (!hasVectors) return;

    const legacyRows = db
      .prepare(`SELECT id, payload FROM vectors ORDER BY id ASC`)
      .all() as LegacyVectorRow[];
    const existing = new Set(
      (db.prepare(`SELECT id FROM personal_preferences`).all() as { id: string }[]).map((r) => r.id)
    );
    const now = Date.now();
    const insertPref = db.prepare(
      `INSERT INTO personal_preferences (id, text, created_at, updated_at) VALUES (?, ?, ?, ?)`
    );
    let imported = 0;
    let importedEnabled: boolean | undefined;

    for (const row of legacyRows) {
      let parsed: { kind?: unknown; text?: unknown; enabled?: unknown };
      try {
        parsed = JSON.parse(row.payload) as { kind?: unknown; text?: unknown; enabled?: unknown };
      } catch {
        continue;
      }
      if (row.id === 'settings' || parsed.kind === 'settings') {
        if (typeof parsed.enabled === 'boolean') importedEnabled = parsed.enabled;
        continue;
      }
      if (parsed.kind !== 'preference') continue;
      const entry = EntrySchema.safeParse({ id: row.id, text: parsed.text });
      if (!entry.success) continue;
      if (existing.has(entry.data.id) || existing.size >= PERSONAL_MEMORY_LIMIT) continue;
      insertPref.run(entry.data.id, entry.data.text, now, now);
      existing.add(entry.data.id);
      imported++;
    }

    if (importedEnabled !== undefined) {
      db.prepare(
        `UPDATE personal_memory_meta SET enabled = ?, revision_nonce = ?, updated_at = ? WHERE id = 1`
      ).run(importedEnabled ? 1 : 0, randomUUID(), now);
    } else if (imported > 0) {
      db.prepare(
        `UPDATE personal_memory_meta SET revision_nonce = ?, updated_at = ? WHERE id = 1`
      ).run(randomUUID(), now);
    }
    db.prepare(
      `INSERT INTO personal_memory_migrations (name, imported_count, migrated_at) VALUES (?, ?, ?)`
    ).run(LEGACY_MEM0_MIGRATION_NAME, imported, now);
  });
  migrate.immediate();
}

export class PersonalMemoryService {
  private pending: Promise<unknown> = Promise.resolve();

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }

  private constructor(
    private readonly dbPath: string,
    private readonly db: Database.Database | null,
    private readonly coreEndpoint: MollyCoreEndpoint | undefined
  ) {}

  static async open(
    dbPath: string,
    options?: { coreEndpoint?: MollyCoreEndpoint | null }
  ): Promise<PersonalMemoryService> {
    let coreEndpoint: MollyCoreEndpoint | undefined;
    if (dbPath !== ':memory:') {
      if (options?.coreEndpoint !== undefined) {
        coreEndpoint = options.coreEndpoint ?? undefined;
      } else {
        const configured = getMollyCoreConfiguredEndpoint();
        if (configured) {
          const ready = await waitForMollyCoreEndpoint(1_500);
          if (!ready) {
            if (getMollyCoreConfiguredEndpoint()) {
              throw new Error('molly_core_starting');
            }
          } else {
            coreEndpoint = ready;
          }
        } else {
          const envSocket = getMollyCoreIpcSocketPath();
          if (envSocket) {
            coreEndpoint = {
              socketPath: envSocket,
              authToken: getMollyCoreIpcToken() ?? '',
            };
          }
        }
      }
    }
    if (coreEndpoint) {
      await callMollyCoreIpc<PersonalMemorySnapshot>(
        coreEndpoint.socketPath,
        'memory.read',
        { dbPath },
        undefined,
        coreEndpoint.authToken ? { authToken: coreEndpoint.authToken, requireMutualAuth: true } : {}
      );
      return new PersonalMemoryService(dbPath, null, coreEndpoint);
    }
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    const db = new Database(dbPath);
    if (dbPath !== ':memory:') {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
    }
    db.pragma('busy_timeout = 5000');
    initMemorySchema(db);
    return new PersonalMemoryService(dbPath, db, undefined);
  }

  private callCore<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    if (!this.coreEndpoint) {
      throw new Error('memory store is not delegated to molly-core');
    }
    return callMollyCoreIpc<T>(
      this.coreEndpoint.socketPath,
      method,
      params,
      signal,
      this.coreEndpoint.authToken
        ? { authToken: this.coreEndpoint.authToken, requireMutualAuth: true }
        : {}
    );
  }

  private readLocal(): PersonalMemorySnapshot {
    if (!this.db) throw new Error('memory store is delegated to molly-core');
    const entries = (
      this.db
        .prepare(`SELECT id, text FROM personal_preferences ORDER BY id ASC LIMIT ?`)
        .all(PERSONAL_MEMORY_LIMIT) as PreferenceRow[]
    ).map((row) => EntrySchema.parse(row));
    const meta = this.db
      .prepare(`SELECT enabled, revision_nonce FROM personal_memory_meta WHERE id = 1`)
      .get() as MetaRow;
    const enabled = meta.enabled !== 0;
    return {
      revision: computeRevision(entries, enabled, meta.revision_nonce),
      enabled,
      entries,
    };
  }

  async read(): Promise<PersonalMemorySnapshot> {
    if (this.coreEndpoint) {
      return await this.callCore<PersonalMemorySnapshot>('memory.read', {
        dbPath: this.dbPath,
      });
    }
    return this.readLocal();
  }

  async setEnabled(enabled: boolean, revision: string): Promise<void> {
    if (this.coreEndpoint) {
      await this.callCore('memory.set_enabled', {
        dbPath: this.dbPath,
        enabled,
        revision,
      });
      return;
    }
    return this.serialize(async () => {
      if (!this.db) throw new Error('memory store unavailable');
      const tx = this.db.transaction(() => {
        if (this.readLocal().revision !== revision) throw new Error('memory_stale');
        this.db!.prepare(
          `UPDATE personal_memory_meta SET enabled = ?, revision_nonce = ?, updated_at = ? WHERE id = 1`
        ).run(enabled ? 1 : 0, randomUUID(), Date.now());
      });
      tx.immediate();
    });
  }

  async edit(id: string, text: string, revision: string): Promise<void> {
    const entry = EntrySchema.parse({ id, text });
    if (this.coreEndpoint) {
      await this.callCore('memory.edit', {
        dbPath: this.dbPath,
        id: entry.id,
        text: entry.text,
        revision,
      });
      return;
    }
    return this.serialize(async () => {
      if (!this.db) throw new Error('memory store unavailable');
      const tx = this.db.transaction(() => {
        const snapshot = this.readLocal();
        if (snapshot.revision !== revision) throw new Error('memory_stale');
        if (!snapshot.entries.some((item) => item.id === entry.id))
          throw new Error('memory_missing');
        const now = Date.now();
        this.db!.prepare(
          `UPDATE personal_preferences SET text = ?, updated_at = ? WHERE id = ?`
        ).run(entry.text, now, entry.id);
        this.db!.prepare(
          `UPDATE personal_memory_meta SET revision_nonce = ?, updated_at = ? WHERE id = 1`
        ).run(randomUUID(), now);
      });
      tx.immediate();
    });
  }

  async remove(id: string, revision: string): Promise<void> {
    if (this.coreEndpoint) {
      await this.callCore('memory.remove', {
        dbPath: this.dbPath,
        id,
        revision,
      });
      return;
    }
    return this.serialize(async () => {
      if (!this.db) throw new Error('memory store unavailable');
      const tx = this.db.transaction(() => {
        const snapshot = this.readLocal();
        if (snapshot.revision !== revision) throw new Error('memory_stale');
        if (!snapshot.entries.some((entry) => entry.id === id)) throw new Error('memory_missing');
        const now = Date.now();
        this.db!.prepare(`DELETE FROM personal_preferences WHERE id = ?`).run(id);
        this.db!.prepare(
          `UPDATE personal_memory_meta SET revision_nonce = ?, updated_at = ? WHERE id = 1`
        ).run(randomUUID(), now);
      });
      tx.immediate();
    });
  }

  async capture(revision: string, rawChanges: unknown, signal: AbortSignal): Promise<void> {
    const changes = PersonalMemoryChangesSchema.parse(rawChanges);
    if (this.coreEndpoint) {
      await this.callCore('memory.capture', { dbPath: this.dbPath, revision, changes }, signal);
      return;
    }
    return this.serialize(async () => {
      if (!this.db) throw new Error('memory store unavailable');
      signal.throwIfAborted();
      const tx = this.db.transaction(() => {
        signal.throwIfAborted();
        const snapshot = this.readLocal();
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
        signal.throwIfAborted();
        const now = Date.now();
        const insertPref = this.db!.prepare(
          `INSERT INTO personal_preferences (id, text, created_at, updated_at) VALUES (?, ?, ?, ?)`
        );
        const updatePref = this.db!.prepare(
          `UPDATE personal_preferences SET text = ?, updated_at = ? WHERE id = ?`
        );
        for (const change of changes) {
          if (change.id) {
            updatePref.run(change.text, now, change.id);
          } else {
            insertPref.run(randomUUID(), change.text, now, now);
          }
        }
        this.db!.prepare(
          `UPDATE personal_memory_meta SET revision_nonce = ?, updated_at = ? WHERE id = 1`
        ).run(randomUUID(), now);
      });
      tx.immediate();
    });
  }
}

let service: Promise<PersonalMemoryService> | undefined;
onMollyCorePermanentFailure(() => {
  service = undefined;
});
export function getPersonalMemory(): Promise<PersonalMemoryService> {
  return (service ??= PersonalMemoryService.open(
    join(getMollyDataDir(), 'memory', 'preferences.sqlite')
  ).catch((error) => {
    service = undefined;
    throw error;
  }));
}
