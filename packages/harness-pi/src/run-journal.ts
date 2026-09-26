import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  HarnessRunSnapshotSchema,
  HarnessRunOutcomeSchema,
  type HarnessRunSnapshot,
  type HarnessRunOutcome,
  encodeMollyModelOption,
} from '@molly/shared/embedded-harness';
import type { ModelUsage } from 'acp-extension-core';

const UsageSchema = z
  .object({
    inputTokens: z.number().nonnegative().finite(),
    outputTokens: z.number().nonnegative().finite(),
    cacheReadInputTokens: z.number().nonnegative().finite(),
    cacheCreationInputTokens: z.number().nonnegative().finite(),
  })
  .strict();
const RequestSchema = z
  .object({
    id: z.string().uuid(),
    state: z.enum(['dispatched', 'succeeded', 'failed', 'outcome_unknown']),
    usage: UsageSchema.optional(),
  })
  .strict();
export type ModelRequestRecord = z.infer<typeof RequestSchema>;

/** Authorization provenance for one tool call or network escalation; never its arguments. */
const ApprovalSchema = z
  .object({
    toolCallId: z.string().min(1).max(512),
    tool: z.string().min(1).max(512),
    source: z.enum(['sandbox', 'workspace', 'design_tool', 'browse_task', 'classifier', 'user']),
    decision: z.enum(['allow', 'deny']),
    reviewOutcome: z
      .enum(['allow', 'deny', 'timeout', 'invalid_response', 'failed', 'cancelled'])
      .optional(),
  })
  .strict();
export type ApprovalRecord = z.infer<typeof ApprovalSchema>;

const RecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshot: HarnessRunSnapshotSchema,
    state: z.enum(['dispatched', 'settled']),
    outcome: HarnessRunOutcomeSchema.optional(),
    modelRequests: z.array(RequestSchema).max(10000).optional(),
    approvals: z.array(ApprovalSchema).max(10000).optional(),
  })
  .strict()
  .refine((value) => (value.state === 'settled') === Boolean(value.outcome));
export type RunRecord = z.infer<typeof RecordSchema>;

/** Only dispatch facts, never another copy of model messages or tool arguments. */
export class RunJournal {
  private readonly pending = new Map<string, Promise<unknown>>();
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
  private serial<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const pending = (this.pending.get(runId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(operation);
    this.pending.set(runId, pending);
    return pending.finally(() => {
      if (this.pending.get(runId) === pending) this.pending.delete(runId);
    });
  }

  async modelRequest(
    runId: string,
    runtimeEpoch: string,
    request: ModelRequestRecord
  ): Promise<void> {
    return this.serial(runId, async () => {
      const previous = await this.read(runId);
      if (previous.snapshot.runtimeEpoch !== runtimeEpoch || previous.state !== 'dispatched')
        throw new Error('harness_stale_request');
      const parsed = RequestSchema.parse(request);
      const requests = previous.modelRequests ?? [];
      const index = requests.findIndex((entry) => entry.id === parsed.id);
      if (parsed.state === 'dispatched') {
        if (index !== -1) throw new Error('harness_model_request_replayed');
        requests.push(parsed);
      } else {
        if (index === -1 || requests[index]?.state !== 'dispatched')
          throw new Error('harness_model_request_not_active');
        requests[index] = parsed;
      }
      await this.replace(runId, RecordSchema.parse({ ...previous, modelRequests: requests }));
    });
  }

  async approval(runId: string, runtimeEpoch: string, approval: ApprovalRecord): Promise<void> {
    return this.serial(runId, async () => {
      const previous = await this.read(runId);
      if (previous.snapshot.runtimeEpoch !== runtimeEpoch || previous.state !== 'dispatched')
        throw new Error('harness_stale_request');
      const approvals = [...(previous.approvals ?? []), ApprovalSchema.parse(approval)];
      await this.replace(runId, RecordSchema.parse({ ...previous, approvals }));
    });
  }

  /** Restore accounting facts, including requests lost before native history was appended. */
  async modelUsage(
    sessionId: string
  ): Promise<Array<{ id: string; model: string; usage: ModelUsage }>> {
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const results: Array<{ id: string; model: string; usage: ModelUsage }> = [];
    for (const file of files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
      const record = RecordSchema.parse(
        JSON.parse(await readFile(join(this.directory, file), 'utf8'))
      );
      if (record.snapshot.sessionId !== sessionId) continue;
      for (const request of record.modelRequests ?? [])
        results.push({
          id: request.id,
          model: encodeMollyModelOption(
            record.snapshot.connection.id,
            record.snapshot.selection.modelId
          ),
          // Unknown token counts stay unpriced. No SDK price-table estimate becomes an invoice.
          usage: request.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 },
        });
    }
    return results;
  }
  async settle(runId: string, runtimeEpoch: string, input: HarnessRunOutcome): Promise<void> {
    return this.serial(runId, async () => {
      const outcome = HarnessRunOutcomeSchema.parse(input);
      const previous = await this.read(runId);
      if (previous.snapshot.runtimeEpoch !== runtimeEpoch || previous.state !== 'dispatched') {
        throw new Error('harness_stale_settlement');
      }
      const record = RecordSchema.parse({ ...previous, state: 'settled', outcome });
      await this.replace(runId, record);
    });
  }

  private async replace(runId: string, record: RunRecord): Promise<void> {
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
