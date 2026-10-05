import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  TurnDiffStore,
  type TurnDiffStoreOptions,
  type TurnDiffStoreStats,
} from '@molly/turn-diff-store';
import { getServerNow, type FileDiff, type SessionId, type WorkspaceId } from '@molly/shared';
import { getMollyDataDir } from '@molly/shared/node/installation-profile';

import { getLogger } from '@/utils/logger';


const DEFAULT_RETENTION_DAYS = 100;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKER_FILENAME = path.join(MODULE_DIR, 'turn-diff-store-worker.js');
const SOURCE_WORKER_FILENAME = path.join(MODULE_DIR, 'turn-diff-store-worker-entry.mjs');

export type CodeCollabV2DiffStoreSnapshot =
  | { readonly status: 'ready'; readonly text: string | null }
  | { readonly status: 'too_large'; readonly rawBytes: number }
  | { readonly status: 'unavailable' };

export type CodeCollabV2DiffStoreTurnSnapshot =
  | { readonly status: 'ready'; readonly oldText: string | null; readonly newText: string | null }
  | { readonly status: 'too_large'; readonly rawBytes: number }
  | { readonly status: 'unavailable' };

export class CodeCollabV2DiffStore {
  private readonly store: TurnDiffStore;
  private readonly now: () => number;
  private readonly logger = getLogger('code-collab');

  constructor(
    readonly workspaceId: WorkspaceId | string,
    options: {
      readonly dbPath?: string;
      readonly retentionDays?: number;
      readonly maxStorageBytes?: number;
      readonly gcTargetBytes?: number;
      readonly workerUrl?: URL | string;
      readonly workerExecArgv?: readonly string[];
      readonly now?: () => number;
    } = {}
  ) {
    const dbPath = options.dbPath ?? getCodeCollabV2DiffStoreDbPath(workspaceId.toString());
    mkdirSync(path.dirname(dbPath), { recursive: true });
    const storeOptions: TurnDiffStoreOptions = {
      dbPath,
      retentionDays: normalizeRetentionDays(options.retentionDays),
      ...(options.maxStorageBytes === undefined
        ? {}
        : { maxStorageBytes: options.maxStorageBytes }),
      ...(options.gcTargetBytes === undefined ? {} : { gcTargetBytes: options.gcTargetBytes }),
    };
    const worker = resolveWorkerOptions(options);
    this.now = options.now ?? getServerNow;
    this.store = new TurnDiffStore({
      ...storeOptions,
      ...worker,
      now: this.now,
      onBackgroundGc: (result) => {
        const message = `[code-collab] turn-diff background GC completed deletedTurns=${
          result.deletedTurns
        } deletedSnapshots=${result.deletedSnapshots} deletedChunks=${
          result.deletedChunks
        } beforeBytes=${result.before.total} afterBytes=${result.after.total} blockedByLiveData=${
          result.blockedByLiveData
        }`;
        if (result.blockedByLiveData) this.logger.warn(message);
        else this.logger.info(message);
      },
      onBackgroundError: (error) => {
        this.logger.error(`[code-collab] turn-diff background GC failed: ${error.message}`);
      },
    });
  }

  async close(): Promise<void> {
    await this.store.close();
  }

  async listChangedPaths(input: {
    readonly ownerSessionId: SessionId;
    readonly nowMs?: number;
  }): Promise<readonly string[]> {
    return await this.store.listChangedPaths({
      ownerId: input.ownerSessionId,
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    });
  }

  async getEarliestOldSnapshot(input: {
    readonly ownerSessionId: SessionId;
    readonly path: string;
    readonly nowMs?: number;
    readonly maxRawBytes?: number;
  }): Promise<CodeCollabV2DiffStoreSnapshot> {
    return await this.store.getEarliestOldSnapshot({
      ownerId: input.ownerSessionId,
      path: input.path,
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
      ...(input.maxRawBytes === undefined ? {} : { maxRawBytes: input.maxRawBytes }),
    });
  }

  async getTurnDiffSnapshot(input: {
    readonly ownerSessionId: SessionId;
    readonly turnId: string;
    readonly path: string;
    readonly nowMs?: number;
    readonly maxRawBytes?: number;
  }): Promise<CodeCollabV2DiffStoreTurnSnapshot> {
    return await this.store.getTurnSnapshot({
      ownerId: input.ownerSessionId,
      turnId: input.turnId,
      path: input.path,
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
      ...(input.maxRawBytes === undefined ? {} : { maxRawBytes: input.maxRawBytes }),
    });
  }

  async listTurnFileDiffs(input: {
    readonly ownerSessionId: SessionId;
    readonly turnId: string;
    readonly nowMs?: number;
  }): Promise<FileDiff[]> {
    const files = await this.store.listTurnFiles({
      ownerId: input.ownerSessionId,
      turnId: input.turnId,
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    });
    return files.map((file) => ({ filePath: file.path, add: file.add, del: file.del }));
  }

  async gc(nowMs?: number): Promise<void> {
    await this.store.gc(nowMs);
  }

  async stats(): Promise<TurnDiffStoreStats> {
    return await this.store.stats();
  }
}

function resolveWorkerOptions(options: {
  readonly workerUrl?: URL | string;
  readonly workerExecArgv?: readonly string[];
}): { readonly workerUrl: URL | string; readonly workerExecArgv?: readonly string[] } {
  if (options.workerUrl !== undefined) {
    return {
      workerUrl: options.workerUrl,
      ...(options.workerExecArgv === undefined ? {} : { workerExecArgv: options.workerExecArgv }),
    };
  }
  if (existsSync(WORKER_FILENAME)) {
    return { workerUrl: pathToFileURL(WORKER_FILENAME) };
  }
  if (process.env.VITEST && existsSync(SOURCE_WORKER_FILENAME)) {
    return { workerUrl: pathToFileURL(SOURCE_WORKER_FILENAME) };
  }
  throw new Error(
    `Code Collab turn-diff worker is missing from the CLI bundle: ${WORKER_FILENAME}`
  );
}

export function getCodeCollabV2DiffStoreDbPath(workspaceId: string): string {
  return path.join(
    getMollyDataDir('local'),
    'code-collab-v2',
    safeWorkspaceSegment(workspaceId),
    'diff-store.sqlite3'
  );
}

function normalizeRetentionDays(value: number | undefined): number {
  const env = Number.parseInt((process.env.MOLLY_CODE_COLLAB_DIFF_RETENTION_DAYS ?? process.env.LODY_CODE_COLLAB_DIFF_RETENTION_DAYS) ?? '', 10);
  const candidate = value ?? (Number.isFinite(env) ? env : DEFAULT_RETENTION_DAYS);
  if (!Number.isFinite(candidate)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.trunc(candidate)));
}

function safeWorkspaceSegment(workspaceId: string): string {
  const safe = workspaceId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'workspace';
  const hash = createHash('sha256').update(workspaceId).digest('hex').slice(0, 12);
  return `${safe}-${hash}`;
}
