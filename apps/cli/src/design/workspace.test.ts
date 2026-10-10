import { withHistoryPort } from '../../tests/history-port-fixture';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionHistoryInput, SessionId, SessionMeta } from '@molly/shared';
import { designOperation } from './store';
import { materializeDesignTurnInput, readDesignTurnReceipt } from './turn-input';
import { getOperationCompletionTurnId } from '../orchestration/operation-store';
import { readDesignArtifact } from './artifact';
import { buildLivePreviewPayload } from './live-preview';
import { collectDesignTurnOutcome } from './turn-outcome';
import { ARTWORK_ENTRY, exportAuthoring } from '@molly/design-authoring';
import {
  resolveDesignContext,
  resolveDesignWorkspace,
  resolveDesignTurnWorkspace,
} from './workspace';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup(kind = 'project') {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-workspace-'));
  roots.push(root);
  const sessionId = randomUUID();
  const legacyWorkdir = path.join(root, 'chats', sessionId);
  const workspaceRoot = kind === 'chat' ? legacyWorkdir : path.join(root, kind);
  await mkdir(workspaceRoot, { recursive: true });
  if (kind === 'project') await mkdir(path.join(workspaceRoot, '.git'));
  const workspace = resolveDesignWorkspace({
    workspaceRoot,
    sessionId,
    artworkId: sessionId,
    legacyWorkdir,
  });
  const payload = await designOperation(root, {
    operation: 'create',
    association: {
      sessionId,
      name: 'Synthetic',
      userId: 'local:test',
      machineId: 'test',
      createdAt: '2026-09-11T00:00:00Z',
    },
    width: 320,
    height: 200,
  });
  return { root, sessionId, workspace, payload };
}

describe('resolved design workspace', () => {
  it.each(
    ['project', 'non-git', 'chat'].flatMap((kind) =>
      ['user', 'operation-completion'].map((source) => ({ kind, source }))
    )
  )('projects, previews and collects one $source draft in $kind', async ({ kind, source }) => {
    const { root, sessionId, workspace, payload } = await setup(kind);
    const turnId =
      source === 'user'
        ? 'turn-1'
        : getOperationCompletionTurnId(sessionId as SessionId, 'research-round-1');
    // A synthetic application projection demonstrates the separate input path;
    // production projection synchronization belongs to the read-hook slice.
    for (const [file, bytes] of exportAuthoring(payload.doc, new Map())) {
      await mkdir(path.dirname(path.join(workspace.projectionWorkdir, file)), {
        recursive: true,
      });
      await writeFile(path.join(workspace.projectionWorkdir, file), bytes);
    }
    expect(await readDesignArtifact(workspace.artifactWorkdir)).toEqual({ status: 'absent' });
    const manifest = await materializeDesignTurnInput({
      workdir: workspace.inputWorkdir,
      artifactWorkdir: workspace.artifactWorkdir,
      artworkId: sessionId,
      turnId,
      prompt: 'Synthetic',
      skillSourceIdentity: 'a'.repeat(64),
      dataRoot: root,
    });
    expect(manifest.turnId).toBe(turnId);
    expect(manifest.artifactAtSend).toEqual({ status: 'absent' });
    expect(
      await materializeDesignTurnInput({
        workdir: workspace.inputWorkdir,
        artifactWorkdir: workspace.artifactWorkdir,
        artworkId: sessionId,
        turnId,
        prompt: 'A later dispatch must not replace the frozen prompt',
        skillSourceIdentity: 'b'.repeat(64),
        dataRoot: root,
      })
    ).toEqual(manifest);
    // Synthetic Agent copies baseline then changes its own page, through the ordinary filesystem.
    await cp(workspace.projectionWorkdir, workspace.artifactWorkdir, { recursive: true });
    const page = path.join(workspace.artifactWorkdir, ARTWORK_ENTRY);
    await writeFile(page, (await readFile(page, 'utf8')).replace('#FFFFFF', '#112233'));
    const preview = await buildLivePreviewPayload(root, workspace.artifactWorkdir, {
      sessionId,
      sourceTurnId: turnId,
    });
    expect(preview.status).toBe('ok');
    let history: SessionHistoryInput[] = [
      {
        id: turnId,
        role: source === 'user' ? 'user' : 'system',
        items: [{ type: 'text', text: 'Synthetic' }],
        timestamp: '2026-09-11T00:00:00Z',
        status: 'handled',
        fileDiff: [],
      },
    ];
    const outcome = await collectDesignTurnOutcome({
      sessionId,
      turnId,
      dataRoot: root,
      workdir: workspace.inputWorkdir,
      workspaceRoot: workspace.workspaceRoot,
      sessionDoc: withHistoryPort({
        getMetaState: async () =>
          ({
            id: sessionId as SessionId,
            userId: 'local:test',
            design: { artworkId: sessionId, path: 'design.json' },
          }) as SessionMeta,
        getHistory: () => history,
        updateHistory: async (update) => {
          history = update(history);
        },
      }),
    });
    expect(outcome.status).toBe('recorded');
    if (outcome.status === 'recorded') {
      expect(outcome.outcome.status).toBe('committed');
      expect(outcome.outcome.turnId).toBe(turnId);
      expect(await readDesignTurnReceipt(workspace.inputWorkdir, turnId)).toEqual(outcome.outcome);
      expect(history.find((entry) => entry.id === turnId)?.designOutcome).toEqual(outcome.outcome);
    }
    const current = await designOperation(root, { operation: 'read', sessionId });
    if (preview.status === 'ok') expect(current.doc).toEqual(preview.doc);
    expect(
      await resolveDesignContext({
        workspaceRoot: workspace.workspaceRoot,
        sessionId,
        artworkId: sessionId,
        legacyWorkdir: workspace.inputWorkdir,
        turnId,
        requireTurnManifest: true,
      })
    ).toEqual(workspace);
  });

  it('isolates artwork and session identities and rejects redirected namespaces', async () => {
    const { workspace, sessionId, root } = await setup();
    const other = resolveDesignWorkspace({
      workspaceRoot: workspace.workspaceRoot,
      sessionId: randomUUID(),
      artworkId: randomUUID(),
      legacyWorkdir: path.join(root, 'chats', randomUUID()),
    });
    expect(other.artifactWorkdir).not.toBe(workspace.artifactWorkdir);
    expect(() =>
      resolveDesignWorkspace({
        workspaceRoot: root,
        sessionId,
        artworkId: '../other',
        legacyWorkdir: root,
      })
    ).toThrow();
    await symlink(workspace.inputWorkdir, path.join(workspace.workspaceRoot, '.molly'));
    await expect(
      resolveDesignContext({
        workspaceRoot: workspace.workspaceRoot,
        sessionId,
        artworkId: sessionId,
        legacyWorkdir: workspace.inputWorkdir,
      })
    ).rejects.toThrow('redirected');
  });

  it('preserves frozen dispatch facts, rejects changed roots and keeps legacy turns at the known chat root', async () => {
    const { root, sessionId, workspace } = await setup();
    const opts = {
      workdir: workspace.inputWorkdir,
      artifactWorkdir: workspace.artifactWorkdir,
      artworkId: sessionId,
      turnId: 'frozen',
      prompt: 'first',
      skillSourceIdentity: 'a'.repeat(64),
      dataRoot: root,
    };
    const first = await materializeDesignTurnInput(opts);
    const file = path.join(workspace.inputWorkdir, 'design-input/frozen/manifest.json');
    const bytes = await readFile(file);
    await expect(
      materializeDesignTurnInput({ ...opts, artifactWorkdir: '/different' })
    ).rejects.toThrow('changed since dispatch');
    expect(await readFile(file)).toEqual(bytes);
    expect(() =>
      resolveDesignTurnWorkspace(
        workspace,
        { ...first, artifactWorkdir: '/outside/secret' },
        sessionId
      )
    ).toThrow();
    const switched = resolveDesignWorkspace({
      workspaceRoot: path.join(root, 'other-project'),
      sessionId,
      artworkId: sessionId,
      legacyWorkdir: workspace.inputWorkdir,
    });
    expect(() => resolveDesignTurnWorkspace(switched, first, sessionId)).toThrow();
    expect(resolveDesignTurnWorkspace(switched, {}, sessionId).artifactWorkdir).toBe(
      workspace.inputWorkdir
    );
  });
});

it('continues a Geon draft in place and rejects unrelated frozen paths', async () => {
  const { workspace, sessionId } = await setup();
  const legacy = path.join(workspace.workspaceRoot, '.geon', 'artworks', sessionId, sessionId);
  await mkdir(legacy, { recursive: true });
  await writeFile(path.join(legacy, 'design.yaml'), 'unfinished legacy draft');
  const args = {
    workspaceRoot: workspace.workspaceRoot,
    sessionId,
    artworkId: sessionId,
    legacyWorkdir: workspace.inputWorkdir,
  };
  const resumed = await resolveDesignContext(args);
  expect(resumed.artifactWorkdir).toBe(legacy);
  expect(await readFile(path.join(resumed.artifactWorkdir, 'design.yaml'), 'utf8')).toBe(
    'unfinished legacy draft'
  );
  expect(
    resolveDesignTurnWorkspace(
      workspace,
      { artworkId: sessionId, artifactWorkdir: legacy },
      sessionId
    ).artifactWorkdir
  ).toBe(legacy);
  expect(() =>
    resolveDesignTurnWorkspace(
      workspace,
      { artifactWorkdir: path.join(legacy, '..', 'other') },
      sessionId
    )
  ).toThrow();
  await mkdir(workspace.artifactWorkdir, { recursive: true });
  await expect(resolveDesignContext(args)).rejects.toThrow('conflicting design draft');
});
