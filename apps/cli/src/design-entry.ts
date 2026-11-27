import { createInterface } from 'node:readline';
import { getMollyDataDir } from '@molly/shared/node/installation-profile';
import { z } from 'zod';
import { buildPreviewPayload } from './design/render-preview';
import { buildLivePreviewPayload } from './design/live-preview';
import { designHistoryOperation } from './design/history';
import {
  acknowledgeDesign,
  designOperation,
  pendingDesigns,
  pendingDesignAssociations,
  pendingOptions,
  repairDesignProjection,
  readDesignCandidate,
} from './design/store';

/** P2.5 candidate requests: same strict shape rule, same single committer. */
const candidateRequest = z
  .object({
    sessionId: z.string().uuid(),
    candidateId: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

// ponytail: one writer queue for all canvases; use per-artwork queues if save throughput matters.
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    if (Buffer.byteLength(line, 'utf8') > 68 * 1024 * 1024) throw Error('Request exceeds 68 MiB');
    const request = JSON.parse(line);
    const dataRoot = getMollyDataDir('local');
    let value: unknown;
    if (request?.operation === 'source-preview') {
      const input = z
        .object({
          operation: z.literal('source-preview'),
          workdir: z.string().min(1),
          live: z
            .object({ sessionId: z.string().uuid(), sourceTurnId: z.string().min(1).max(200) })
            .strict()
            .optional(),
          previousSourceIdentity: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        })
        .strict()
        .parse(request);
      value = input.live
        ? await buildLivePreviewPayload(
            dataRoot,
            input.workdir,
            input.live,
            input.previousSourceIdentity
          )
        : await buildPreviewPayload(input.workdir, {
            previousSourceIdentity: input.previousSourceIdentity,
          });
    } else if (request?.operation === 'pending') {
      z.object({ operation: z.literal('pending') })
        .strict()
        .parse(request);
      value = await pendingDesigns(dataRoot);
    } else if (request?.operation === 'pending-associations') {
      const input = pendingOptions
        .extend({ operation: z.literal('pending-associations') })
        .strict()
        .parse(request);
      value = await pendingDesignAssociations(dataRoot, input);
    } else if (request?.operation === 'repair-projection') {
      const input = z
        .object({ operation: z.literal('repair-projection'), sessionId: z.string().uuid() })
        .strict()
        .parse(request);
      value = await repairDesignProjection(dataRoot, input.sessionId);
    } else if (request?.operation === 'acknowledge') {
      const input = z
        .object({
          operation: z.literal('acknowledge'),
          verifyProjection: z.boolean().optional(),
          sessionId: z.string().uuid(),
        })
        .strict()
        .parse(request);
      await acknowledgeDesign(dataRoot, input.sessionId, input);
      value = null;
    } else if (request?.operation === 'candidate-file') {
      const input = candidateRequest
        .extend({ operation: z.literal('candidate-file') })
        .parse(request);
      // Return the verified original file, including its embedded assets. The
      // ordinary file preview owns byte transport; never copy/rewrite history.
      const { file } = await readDesignCandidate(dataRoot, input.sessionId, input.candidateId);
      value = { path: file };
    } else if (typeof request?.operation === 'string' && request.operation.startsWith('history-')) {
      value = await designHistoryOperation(dataRoot, request);
    } else value = await designOperation(dataRoot, request);
    process.stdout.write(JSON.stringify({ ok: true, value }) + '\n');
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? { code: error.code }
          : {}),
        ...(error instanceof Error && 'revisionId' in error && typeof error.revisionId === 'string'
          ? { revisionId: error.revisionId }
          : {}),
      }) + '\n'
    );
  }
}
