import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  PaidOperationSchema,
  recoverPaidOperation,
  ImageOperationResultSchema,
  HarnessImageImportResultSchema,
  type HarnessImageImportResult,
  type HarnessRunSnapshot,
} from '@molly/shared/embedded-harness';
import type { BrowserTaskApproval } from './approved-tools';

const RecordSchema = PaidOperationSchema.extend({
  parentOperationId: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  requiresExplicitRetry: z.boolean().optional(),
  authorization: z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('allow_once'),
        runtimeEpoch: z.string().min(1),
        toolCallId: z.string().min(1).max(512),
      })
      .strict(),
    z
      .object({
        kind: z.literal('browse_task'),
        runtimeEpoch: z.string().min(1),
        toolCallId: z.string().min(1).max(512),
        sites: z.array(z.string().min(1)).min(1).max(8),
      })
      .strict(),
  ]),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type OperationReceipt = z.infer<typeof RecordSchema>;

/** Scoped to one live parent dispatch; it cannot choose a run, server or tool. */
export type OperationResourceRead = (
  toolCallId: string,
  uri: string,
  invoke: () => Promise<unknown>
) => Promise<unknown>;
export type OperationDispatchContext = { readResource: OperationResourceRead };

/** Dispatch receipts only. Canonical artwork/assets/history remain owned by design services. */
export class ToolOperationJournal {
  private readonly pendingRuns = new Map<string, Promise<unknown>>();
  constructor(private readonly directory: string) {}
  private async write(file: string, record: OperationReceipt, exclusive = false): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = exclusive ? file : join(this.directory, `${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      try {
        await handle.writeFile(JSON.stringify(RecordSchema.parse(record)));
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (!exclusive) await rename(temporary, file);
      if (process.platform !== 'win32') {
        const parent = await open(this.directory, 'r');
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
      }
    } finally {
      if (!exclusive) await unlink(temporary).catch(() => undefined);
    }
  }

  operationId(runId: string, toolCallId: string): string {
    return createHash('sha256')
      .update(JSON.stringify([runId, toolCallId]))
      .digest('hex');
  }

  async read(operationId: string) {
    if (!/^[a-f0-9]{64}$/.test(operationId)) throw new Error('harness_invalid_operation_id');
    const record = RecordSchema.parse(
      JSON.parse(await readFile(join(this.directory, `${operationId}.json`), 'utf8'))
    );
    return { ...record, ...recoverPaidOperation(record) };
  }

  /** Call only after the matching live request has received an approval decision. */
  async dispatch(
    input: {
      snapshot: Pick<HarnessRunSnapshot, 'runId' | 'runtimeEpoch'>;
      connectionId: string;
      connectionRevision: number;
      toolCallId: string;
      toolName: string;
      arguments: Record<string, unknown>;
      authorization?: BrowserTaskApproval;
      /** Only the host's built-in image server may supply the private image receipt. */
      builtinImage?: boolean;
      /** Declared external image calls may be paid, but their private receipts are untrusted. */
      externalImage?: boolean;
      /** Trusted owning host, never an MCP producer's private metadata. */
      importImages?: (result: unknown) => Promise<HarnessImageImportResult>;
    },
    invoke: (context?: OperationDispatchContext) => Promise<unknown>
  ): Promise<unknown> {
    const previous = this.pendingRuns.get(input.snapshot.runId) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(() => this.dispatchOnce(input, invoke));
    this.pendingRuns.set(input.snapshot.runId, pending);
    try {
      return await pending;
    } finally {
      if (this.pendingRuns.get(input.snapshot.runId) === pending)
        this.pendingRuns.delete(input.snapshot.runId);
    }
  }

  private async dispatchOnce(
    input: Parameters<ToolOperationJournal['dispatch']>[0],
    invoke: (context?: OperationDispatchContext) => Promise<unknown>,
    parentOperationId?: string
  ): Promise<unknown> {
    const operationId = this.operationId(input.snapshot.runId, input.toolCallId);
    const file = join(this.directory, `${operationId}.json`);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(this.directory)) {
      if (
        !/^[a-f0-9]{64}\.json$/.test(entry) ||
        entry === `${operationId}.json` ||
        entry === `${parentOperationId}.json`
      )
        continue;
      const prior = await this.read(entry.slice(0, -5));
      // A new call ID, tool or connection does not establish a new user operation.
      // The host must end this run and accept explicit user input before trying again.
      if (prior.runId === input.snapshot.runId && prior.state === 'outcome_unknown')
        throw new Error('harness_mcp_outcome_unknown');
      if (prior.runId === input.snapshot.runId && prior.requiresExplicitRetry)
        throw new Error('harness_paid_retry_requires_user');
    }
    const record = RecordSchema.parse({
      schemaVersion: 1,
      operationId,
      ...(parentOperationId ? { parentOperationId } : {}),
      runId: input.snapshot.runId,
      connectionId: input.connectionId,
      connectionRevision: input.connectionRevision,
      toolName: input.toolName,
      state: 'prepared',
      assetDigests: [],
      authorization: {
        kind: input.authorization?.kind ?? 'allow_once',
        runtimeEpoch: input.snapshot.runtimeEpoch,
        toolCallId: input.toolCallId,
        ...(input.authorization ? { sites: input.authorization.sites } : {}),
      },
      requestDigest: createHash('sha256').update(JSON.stringify(input.arguments)).digest('hex'),
    });
    await this.write(file, record, true);
    record.state = 'dispatched';
    await this.write(file, record);
    try {
      let readsOpen = true;
      let pendingReads: Promise<unknown> = Promise.resolve();
      const readResource: OperationResourceRead = (toolCallId, uri, read) => {
        if (!readsOpen || parentOperationId)
          return Promise.reject(new Error('harness_resource_parent_retired'));
        const pending = pendingReads.then(() =>
          this.dispatchOnce(
            {
              snapshot: input.snapshot,
              connectionId: input.connectionId,
              connectionRevision: input.connectionRevision,
              toolCallId,
              toolName: 'resources/read',
              arguments: { uri },
            },
            read,
            operationId
          )
        );
        // A failed child prevents later sibling reads; parent settlement awaits all.
        pendingReads = pending;
        return pending;
      };
      let result;
      try {
        result = await invoke(parentOperationId ? undefined : { readResource });
      } finally {
        readsOpen = false;
        await pendingReads;
      }
      if (input.builtinImage) {
        const parsed = ImageOperationResultSchema.safeParse(
          result &&
            typeof result === 'object' &&
            '_meta' in result &&
            result._meta &&
            typeof result._meta === 'object' &&
            'mollyImageOperation' in result._meta
            ? result._meta.mollyImageOperation
            : undefined
        );
        if (!parsed.success) throw new Error('harness_image_receipt_missing');
        record.state = parsed.data.state;
        record.assetDigests = input.importImages ? [] : parsed.data.assetDigests;
        record.requiresExplicitRetry = parsed.data.dispatched && parsed.data.state !== 'succeeded';
        if (record.state === 'succeeded' && input.importImages) {
          if (!parsed.data.dispatched) throw new Error('harness_image_receipt_invalid');
          const imported = HarnessImageImportResultSchema.parse(await input.importImages(result));
          record.assetDigests = imported.assets.map((asset) => asset.sha256);
          result = {
            content: [{ type: 'text', text: JSON.stringify({ importedAssets: imported.assets }) }],
          };
        }
        await this.write(file, record);
        if (parsed.data.state === 'outcome_unknown') throw new Error('harness_mcp_outcome_unknown');
        // Return a known failure unchanged; the adapter interrupts paid retries below.
        return result;
      }
      record.state =
        result && typeof result === 'object' && 'isError' in result && result.isError === true
          ? 'failed'
          : 'succeeded';
      record.requiresExplicitRetry = input.externalImage === true && record.state === 'failed';
      if (input.externalImage && input.importImages && record.state === 'succeeded') {
        const imported = HarnessImageImportResultSchema.parse(await input.importImages(result));
        record.assetDigests = imported.assets.map((asset) => asset.sha256);
        await this.write(file, record);
        // Imported assets are available for an explicit native read. Do not present a
        // server-authored path/receipt as if it came from the owning design service.
        return {
          content: [{ type: 'text', text: JSON.stringify({ importedAssets: imported.assets }) }],
        };
      }
      await this.write(file, record);
      return result;
    } catch {
      record.state = 'outcome_unknown';
      // If settlement cannot be persisted, the durable dispatched receipt stays unknown.
      await this.write(file, record).catch(() => undefined);
      throw new Error('harness_mcp_outcome_unknown');
    }
  }
}
