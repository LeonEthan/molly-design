import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  HarnessRunSnapshotSchema,
  HarnessRunOutcomeSchema,
  type HarnessRunSnapshot,
  type HarnessRunOutcome,
} from '@molly/shared/embedded-harness';

const RecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshot: HarnessRunSnapshotSchema,
    state: z.enum(['dispatched', 'settled']),
    outcome: HarnessRunOutcomeSchema.optional(),
  })
  .strict()
  .refine((value) => (value.state === 'settled') === Boolean(value.outcome));
export type RunRecord = z.infer<typeof RecordSchema>;

/** Dispatch facts only, never another copy of model messages or tool arguments. */
export class RunJournal {
  constructor(private readonly directory: string) {}
  private path(runId: string): string {
    return join(this.directory, `${createHash('sha256').update(runId).digest('hex')}.json`);
  }
  private async syncDirectory(): Promise<void> {
    if (process.platform === 'win32') return;
    const handle = await open(this.directory, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async begin(input: HarnessRunSnapshot): Promise<void> {
    const snapshot = HarnessRunSnapshotSchema.parse(input);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    // Exclusive creation is the dispatch fence, including across worker restarts.
    // A partial record is deliberately not removed: it also forbids replay.
    const handle = await open(this.path(snapshot.runId), 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify({ schemaVersion: 1, snapshot, state: 'dispatched' }));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.syncDirectory();
  }
  async read(runId: string): Promise<RunRecord> {
    return RecordSchema.parse(JSON.parse(await readFile(this.path(runId), 'utf8')));
  }
  async settle(runId: string, runtimeEpoch: string, input: HarnessRunOutcome): Promise<void> {
    const outcome = HarnessRunOutcomeSchema.parse(input);
    const previous = await this.read(runId);
    if (previous.snapshot.runtimeEpoch !== runtimeEpoch || previous.state !== 'dispatched')
      throw new Error('harness_stale_settlement');
    const record = RecordSchema.parse({ ...previous, state: 'settled', outcome });
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      try {
        await handle.writeFile(JSON.stringify(record));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.path(runId));
      await this.syncDirectory();
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}

/** An exclusive-open collision is the only signal that a run was already dispatched. */
export function isAlreadyDispatched(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'EEXIST' &&
    'syscall' in error &&
    error.syscall === 'open'
  );
}
