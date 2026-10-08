/** Git is the only design history backend. Current saves remain in store.ts. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir } from 'node:fs/promises';
import { devNull } from 'node:os';
import path from 'node:path';
import { isBlankCanvas } from '@molly/shared/design-blank-canvas';
import { z } from 'zod';
import { withDesignLock, type DesignLockTiming } from './lock';
import {
  acceptsDesignContent,
  canonicalContentBytes,
  designId,
  designInput,
  designOperation,
} from './store';
import { ensureDesignDirectory } from './workspace';

const revision = z.string().regex(/^[a-f0-9]{64}$/);
const commitId = z.string().regex(/^[a-f0-9]{40}$/);
const identity = { sessionId: designId };
export const designHistoryRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('history-list'), ...identity }).strict(),
  z.object({ operation: z.literal('history-read'), ...identity, commitId }).strict(),
  z
    .object({ operation: z.literal('history-create'), ...identity, baseRevisionId: revision })
    .strict(),
  z
    .object({
      operation: z.literal('history-restore'),
      ...identity,
      commitId,
      baseRevisionId: revision,
    })
    .strict(),
]);
export type DesignHistoryRequest = z.input<typeof designHistoryRequest>;
const versionKinds = ['saved', 'before-restore', 'before-agent'] as const;
const versionKind = z.enum(versionKinds);
export interface DesignVersion {
  commitId: string;
  number: number;
  createdAt: string;
  kind: (typeof versionKinds)[number];
  baseVersionId?: string;
  contentDigest?: string;
  sourceRevisionId?: string;
  actionId?: string;
}
const metadata = z
  .object({
    baseVersionId: commitId.optional(),
    contentDigest: revision,
    sourceRevisionId: revision,
    actionId: revision,
  })
  .strict();
const contentDigest = (content: Parameters<typeof canonicalContentBytes>[0]) =>
  createHash('sha256').update(canonicalContentBytes(content)).digest('hex');
const actionIdentity = (operation: string, baseline: string, target = '') =>
  createHash('sha256')
    .update(JSON.stringify([operation, baseline, target]))
    .digest('hex');
const historyRef = 'refs/heads/main';
const zeroId = '0'.repeat(40);

/** Same local Git executable as Molly; no shell, user index, remote or hook execution. */
function git(repository: string, args: string[], input?: string | Uint8Array): Promise<string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
  );
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['--git-dir', repository, '-c', `core.hooksPath=${devNull}`, ...args],
      {
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 70 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...env,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: devNull,
          GIT_TERMINAL_PROMPT: '0',
          GIT_AUTHOR_NAME: 'Molly',
          GIT_AUTHOR_EMAIL: 'molly@localhost',
          GIT_COMMITTER_NAME: 'Molly',
          GIT_COMMITTER_EMAIL: 'molly@localhost',
        },
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      }
    );
    child.stdin?.on('error', reject);
    child.stdin?.end(input);
  });
}

async function exists(directory: string): Promise<boolean> {
  try {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error('Design history directory is redirected');
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function head(repository: string): Promise<string | undefined> {
  const refs = await git(repository, ['for-each-ref', '--format=%(objectname)', historyRef]);
  return refs.trim() ? commitId.parse(refs.trim()) : undefined;
}

async function list(repository: string): Promise<DesignVersion[]> {
  if (!(await head(repository))) return [];
  const output = await git(repository, [
    'log',
    '--reverse',
    '--first-parent',
    '--format=%H%x09%ct%x09%s%x09%b',
    historyRef,
  ]);
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      const [hash, seconds, subject, body] = line.split('\t');
      const kind = versionKind.safeParse(subject);
      if (!kind.success) throw Error('Invalid design history entry');
      const timestamp = z.coerce.number().int().nonnegative().parse(seconds);
      return {
        commitId: commitId.parse(hash),
        number: index + 1,
        createdAt: new Date(timestamp * 1000).toISOString(),
        kind: kind.data,
        ...(body ? metadata.parse(JSON.parse(body)) : {}),
      };
    });
}

async function read(repository: string, version: string) {
  // A guessed object ID does not grant access to unreachable or unrelated objects.
  const versions = await list(repository);
  const entry = versions.find((item) => item.commitId === version);
  if (!entry) throw Error('Design version not found');
  const content = designInput.parse(
    JSON.parse(await git(repository, ['show', `${version}:design.json`]))
  );
  if (!acceptsDesignContent(content)) throw Error('Invalid design version content');
  return { content, version: entry };
}

async function holds(repository: string, content: import('./store').DesignPayload) {
  const blob = (
    await git(repository, ['hash-object', '--stdin'], canonicalContentBytes(content))
  ).trim();
  const reachable = (await head(repository))
    ? await git(repository, ['rev-list', '--objects', historyRef])
    : '';
  return reachable.split('\n').some((line) => line.split(' ')[0] === blob);
}

async function initialize(repository: string) {
  if (!(await exists(path.join(repository, 'objects'))))
    await git(repository, ['init', '--bare', '--template=', '--object-format=sha1', repository]);
}

async function locate(dataRoot: string, sessionId: string) {
  const directory = path.join(dataRoot, 'chats', sessionId);
  const repository = path.join(directory, 'history.git');
  await ensureDesignDirectory(directory, repository);
  return { repository, available: await exists(repository) };
}

async function openRepository(dataRoot: string, sessionId: string) {
  const { repository, available } = await locate(dataRoot, sessionId);
  if (!available)
    await mkdir(repository).catch(async (error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      await exists(repository);
    });
  return repository;
}

async function append(
  repository: string,
  content: import('./store').DesignPayload,
  kind: DesignVersion['kind'],
  assertHeld: () => Promise<void>
): Promise<DesignVersion> {
  const parent = await head(repository);
  const bytes = canonicalContentBytes(content);
  const blob = commitId.parse(
    (await git(repository, ['hash-object', '-w', '--stdin'], bytes)).trim()
  );
  const tree = commitId.parse(
    (await git(repository, ['mktree'], `100644 blob ${blob}\tdesign.json\n`)).trim()
  );
  const details = {
    ...(content.editing ? { baseVersionId: content.editing.baseVersionId } : {}),
    contentDigest: contentDigest(content),
    sourceRevisionId: content.revisionId,
    actionId: actionIdentity(kind, content.revisionId),
  };
  const commit = commitId.parse(
    (
      await git(
        repository,
        ['commit-tree', tree, ...(parent ? ['-p', parent] : [])],
        `${kind}\n\n${JSON.stringify(details)}\n`
      )
    ).trim()
  );
  await assertHeld();
  await git(repository, ['update-ref', historyRef, commit, parent ?? zeroId]);
  const versions = await list(repository);
  const latest = versions.at(-1);
  if (!latest) throw Error('Design version disappeared');
  return latest;
}

/** Restore uses canonical CAS after preserving the current content in the same Git history. */
export async function designHistoryOperation(
  dataRoot: string,
  raw: unknown,
  options: { lock?: DesignLockTiming } = {}
) {
  const request = designHistoryRequest.parse(raw);
  const current = await designOperation(dataRoot, {
    operation: 'read',
    sessionId: request.sessionId,
  });
  if (request.operation === 'history-list' || request.operation === 'history-read') {
    const { repository, available } = await locate(dataRoot, request.sessionId);
    if (request.operation === 'history-list') return available ? list(repository) : [];
    if (!available) throw Error('Design version not found');
    const historic = await read(repository, request.commitId);
    // Use current artwork identity; never restore another Session's metadata or conversation.
    return {
      ...historic.content,
      association: current.association,
      revisionId: createHash('sha256')
        .update(canonicalContentBytes(historic.content))
        .digest('hex'),
    };
  }
  const repository = await openRepository(dataRoot, request.sessionId);
  return withDesignLock(repository, options.lock ?? {}, async (assertHeld) => {
    // Another instance may restore or save while this operation waits for Git.
    // Never publish a stale snapshot as a successful current-version save.
    const lockedCurrent = await designOperation(dataRoot, {
      operation: 'read',
      sessionId: request.sessionId,
    });
    const versions = (await exists(path.join(repository, 'objects'))) ? await list(repository) : [];
    if (request.operation === 'history-create') {
      const prior = versions.find(
        (version) => version.kind === 'saved' && version.sourceRevisionId === request.baseRevisionId
      );
      if (
        prior &&
        lockedCurrent.editing &&
        lockedCurrent.editing.actionId === prior.actionId &&
        lockedCurrent.editing.baseVersionId === prior.commitId &&
        contentDigest(lockedCurrent) === prior.contentDigest
      )
        return prior;
      if (lockedCurrent.revisionId !== request.baseRevisionId) throw Error('DESIGN_CONFLICT');
      await initialize(repository);
      if (lockedCurrent.editing) {
        const base = await read(repository, lockedCurrent.editing.baseVersionId);
        if (contentDigest(base.content) === contentDigest(lockedCurrent)) return base.version;
      }
      const version = prior ?? (await append(repository, lockedCurrent, 'saved', assertHeld));
      await assertHeld();
      await designOperation(
        dataRoot,
        {
          operation: 'save',
          sessionId: request.sessionId,
          baseRevisionId: lockedCurrent.revisionId,
          content: { doc: lockedCurrent.doc, assets: lockedCurrent.assets },
        },
        {
          editing: {
            baseVersionId: version.commitId,
            actionId: actionIdentity('saved', lockedCurrent.revisionId),
          },
        }
      );
      return version;
    }
    const actionId = actionIdentity('restore', request.baseRevisionId, request.commitId);
    const historic = await read(repository, request.commitId);
    const sameContent = contentDigest(lockedCurrent) === contentDigest(historic.content);
    if (
      lockedCurrent.editing?.baseVersionId === request.commitId &&
      sameContent &&
      (lockedCurrent.revisionId === request.baseRevisionId ||
        lockedCurrent.editing.actionId === actionId)
    )
      return lockedCurrent;
    if (lockedCurrent.revisionId !== request.baseRevisionId) throw Error('DESIGN_CONFLICT');
    // No changes to current storage until the protective history entry is durable and reachable.
    if (!(await holds(repository, lockedCurrent)))
      await append(repository, lockedCurrent, 'before-restore', assertHeld);
    await assertHeld();
    return designOperation(
      dataRoot,
      {
        operation: 'save',
        sessionId: request.sessionId,
        baseRevisionId: request.baseRevisionId,
        content: historic.content,
      },
      { editing: { baseVersionId: request.commitId, actionId } }
    );
  });
}

/** Keeps an Agent turn's frozen baseline restorable unless history already holds it. */
export async function recordBeforeAgentVersion(
  dataRoot: string,
  artworkId: string,
  baseline: import('./store').DesignPayload,
  options: { lock?: DesignLockTiming } = {}
): Promise<DesignVersion | undefined> {
  if (isBlankCanvas(baseline.doc)) return undefined;
  const repository = await openRepository(dataRoot, designId.parse(artworkId));
  return withDesignLock(repository, options.lock ?? {}, async (assertHeld) => {
    await initialize(repository);
    if (await holds(repository, baseline)) return undefined;
    return append(repository, baseline, 'before-agent', assertHeld);
  });
}
