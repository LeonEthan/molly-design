import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  HarnessImageRecoveryArgumentsSchema,
  HarnessImageRecoveryResultSchema,
  type HarnessImageRecoveryRequest,
  type HarnessImageRecoveryResult,
} from '@molly/shared/embedded-harness';
import { inspectGeneratedImage } from '@/mcp/image-generation';
import { HarnessImageImportIntentSchema } from './harness-image-import';
import { ensureDesignDirectory, type DesignWorkspace } from './workspace';

async function readBoundedFile(file: string, limit: number, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > limit)
      throw new Error('harness_image_recovery_unsafe');
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      signal.throwIfAborted();
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await handle.stat();
    signal.throwIfAborted();
    if (
      length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw new Error('harness_image_recovery_changed');
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

/** Read-only recovery of published bytes. Never fetches, republishes or settles a paid operation. */
export async function recoverHarnessImages(input: {
  sessionId: string;
  artworkId: string;
  query: HarnessImageRecoveryRequest['query'];
  operationDirectory: string;
  resolveWorkspace: (sourceTurnId: string) => Promise<DesignWorkspace>;
  signal: AbortSignal;
}): Promise<HarnessImageRecoveryResult> {
  const query = HarnessImageRecoveryArgumentsSchema.parse(input.query);
  const signal = input.signal;
  signal.throwIfAborted();
  const readIntent = async (id: string) =>
    HarnessImageImportIntentSchema.parse(
      JSON.parse(
        (
          await readBoundedFile(
            path.join(input.operationDirectory, `${id}.images.json`),
            64 * 1024,
            signal
          )
        ).toString('utf8')
      )
    );
  const owns = (intent: ReturnType<typeof HarnessImageImportIntentSchema.parse>) =>
    intent.identity.productSessionId === input.sessionId && intent.artworkId === input.artworkId;

  if (!query.operationId) {
    // Bound memory and receipt reads; the cursor advances over at most 100 names.
    // This reuses the existing journal directory, not a parallel recovery index.
    const ids: string[] = [];
    let directory;
    try {
      directory = await opendir(input.operationDirectory);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return { kind: 'listed', operations: [] };
      throw error;
    }
    for await (const entry of directory) {
      signal.throwIfAborted();
      if (!/^[a-f0-9]{64}\.images\.json$/.test(entry.name)) continue;
      const id = entry.name.slice(0, 64);
      if (query.cursor && id <= query.cursor) continue;
      ids.push(id);
      ids.sort();
      if (ids.length > 101) ids.pop();
    }
    const operations: Extract<HarnessImageRecoveryResult, { kind: 'listed' }>['operations'] = [];
    let scanned = 0;
    for (const id of ids.slice(0, 100)) {
      scanned++;
      try {
        const intent = await readIntent(id);
        if (intent.operationId !== id || !owns(intent)) continue;
        operations.push({
          operationId: id,
          sourceTurnId: intent.identity.turnId,
          connectionId: intent.identity.connectionId,
          connectionRevision: intent.identity.connectionRevision,
          toolName: intent.identity.toolName,
          expectedAssets: intent.expectedAssets.length,
        });
      } catch {
        signal.throwIfAborted();
        // Invalid/foreign intents confer no recovery authority and remain untouched.
      }
      if (operations.length === 20) break;
    }
    signal.throwIfAborted();
    return HarnessImageRecoveryResultSchema.parse({
      kind: 'listed',
      operations,
      ...(scanned < ids.length ? { nextCursor: ids[scanned - 1] } : {}),
    });
  }

  const intent = await readIntent(query.operationId);
  if (intent.operationId !== query.operationId || !owns(intent))
    throw new Error('harness_image_recovery_not_owned');
  const workspace = await input.resolveWorkspace(intent.identity.turnId);
  const checkWorkspace = () =>
    ensureDesignDirectory(
      workspace.artifactWorkdir === workspace.inputWorkdir
        ? workspace.inputWorkdir
        : workspace.workspaceRoot,
      workspace.artifactWorkdir
    );
  await checkWorkspace();
  const root = await realpath(workspace.artifactWorkdir);
  const media = path.join(root, 'media');
  const assets: Extract<HarnessImageRecoveryResult, { kind: 'verified' }>['assets'] = [];
  const unavailable: Extract<HarnessImageRecoveryResult, { kind: 'verified' }>['unavailable'] = [];
  for (const expected of intent.expectedAssets) {
    signal.throwIfAborted();
    try {
      await checkWorkspace();
      const parent = await lstat(media);
      if (!parent.isDirectory() || parent.isSymbolicLink() || (await realpath(media)) !== media)
        throw new Error('harness_image_recovery_unsafe');
      const absolutePath = path.join(root, expected.path);
      const bytes = await readBoundedFile(absolutePath, expected.bytes, signal);
      const actual = await inspectGeneratedImage(bytes, signal);
      if (
        Object.entries(expected).some(
          ([key, value]) => actual[key as keyof typeof actual] !== value
        )
      )
        throw new Error('harness_image_recovery_changed');
      const after = await lstat(media);
      await checkWorkspace();
      if (
        !after.isDirectory() ||
        after.isSymbolicLink() ||
        parent.ino !== after.ino ||
        parent.dev !== after.dev ||
        (await realpath(media)) !== media
      )
        throw new Error('harness_image_recovery_unsafe');
      assets.push({ ...actual, absolutePath });
    } catch (error) {
      signal.throwIfAborted();
      unavailable.push({
        path: expected.path,
        reason:
          error instanceof Error && 'code' in error && error.code === 'ENOENT'
            ? 'missing'
            : error instanceof Error && error.message === 'harness_image_recovery_changed'
              ? 'changed'
              : 'unsafe',
      });
    }
  }
  signal.throwIfAborted();
  return HarnessImageRecoveryResultSchema.parse({
    kind: 'verified',
    operationId: intent.operationId,
    sourceTurnId: intent.identity.turnId,
    assets,
    unavailable,
  });
}
