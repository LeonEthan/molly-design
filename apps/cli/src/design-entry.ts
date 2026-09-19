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
    if (line.length > 64 * 1024 * 1024) throw Error('Request exceeds 64 MiB');
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
    } else if (request?.operation === 'acknowledge') {
      const input = z
        .object({ operation: z.literal('acknowledge'), sessionId: z.string().uuid() })
        .strict()
        .parse(request);
      await acknowledgeDesign(dataRoot, input.sessionId);
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
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) +
        '\n'
    );
  }
}
