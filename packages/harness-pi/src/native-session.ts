import { open, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { z } from 'zod';
import { createHash } from 'node:crypto';

const Header = z.object({
  type: z.literal('session'),
  version: z.literal(3),
  id: z.string().uuid(),
  cwd: z.string(),
});
const Entry = z.object({
  type: z.enum([
    'message',
    'thinking_level_change',
    'model_change',
    'compaction',
    'branch_summary',
    'custom',
    'custom_message',
    'label',
    'session_info',
  ]),
  id: z.string().min(1),
  parentId: z.string().nullable(),
});

/** Read-only preflight: Pi's forgiving JSONL reader must not silently drop corrupt records. */
export async function validateNativeSession(
  file: string,
  directory: string,
  cwd: string,
  expectedId?: string
): Promise<string> {
  const root = await realpath(directory);
  const actual = await realpath(file);
  const local = relative(root, actual);
  if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local))
    throw new Error('harness_native_session_outside_private_root');
  const handle = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > 128 * 1024 * 1024)
      throw new Error('harness_native_session_invalid');
    const text = await handle.readFile('utf8');
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    const header = Header.parse(JSON.parse(lines.shift()!));
    if (
      (expectedId && header.id !== expectedId) ||
      (await realpath(header.cwd)) !== (await realpath(cwd))
    )
      throw new Error('harness_native_session_identity_mismatch');
    const ids = new Set<string>();
    for (const line of lines) {
      const entry = Entry.parse(JSON.parse(line));
      if (ids.has(entry.id) || (entry.parentId !== null && !ids.has(entry.parentId)))
        throw new Error('harness_native_session_tree_invalid');
      ids.add(entry.id);
    }
    return actual;
  } catch {
    throw new Error('harness_native_session_invalid');
  } finally {
    await handle.close();
  }
}

/** Connection folders are creation partitions, not separate copies of product history. */
export async function resolveProductNativeSession(
  privateRoot: string,
  productSessionId: string,
  sessionId: string,
  cwd: string
): Promise<{ file: string; directory: string }> {
  z.string().uuid().parse(sessionId);
  const root = await realpath(join(privateRoot, 'sessions'));
  const product = createHash('sha256').update(productSessionId).digest('hex');
  const partitions = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)
  );
  const matches: Array<{ file: string; directory: string }> = [];
  for (const partition of partitions) {
    const directory = join(root, partition.name, product);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    // A substituted product directory must not escape its owning partition.
    if ((await realpath(directory)) !== directory)
      throw new Error('harness_native_session_outside_private_root');
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(`_${sessionId}.jsonl`))
        matches.push({ file: join(directory, entry.name), directory });
    }
  }
  if (matches.length !== 1) throw new Error('harness_native_session_missing_or_ambiguous');
  const match = matches[0]!;
  return {
    ...match,
    file: await validateNativeSession(match.file, match.directory, cwd, sessionId),
  };
}
