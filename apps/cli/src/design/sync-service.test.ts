import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DesignSyncService } from './sync-service';
import { designOperation } from './store';
import { resolveDesignWorkspace } from './workspace';
import { readDesignArtifact } from './artifact';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'design-submit-test-'));
  roots.push(root);
  const id = randomUUID();
  const workspace = resolveDesignWorkspace({
    workspaceRoot: root,
    sessionId: id,
    artworkId: id,
    legacyWorkdir: path.join(root, 'chats', id),
  });
  const payload = await designOperation(root, {
    operation: 'create',
    association: {
      sessionId: id,
      name: 'Synthetic',
      userId: 'test',
      machineId: 'test',
      createdAt: '2026-09-12T00:00:00Z',
    },
  });
  return {
    root,
    id,
    workspace,
    payload,
    service: new DesignSyncService({
      artworkId: id,
      workspace,
      dataRoot: root,
      assertActive: () => {},
    }),
  };
}
it('binds only explicit exact draft/revision facts without any read or model generation proof', async () => {
  const { root, id, workspace, payload, service } = await setup();
  for (const file of ['design.yaml']) {
    const target = path.join(workspace.artifactWorkdir, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(path.join(workspace.projectionWorkdir, file)));
  }
  const artifact = await readDesignArtifact(workspace.artifactWorkdir);
  if (artifact.status !== 'present') throw Error('Fixture missing');
  expect(service.getSubmission()).toBeUndefined();
  await expect(
    service.handle({
      phase: 'resubmit',
      expectedRevisionId: 'a'.repeat(64),
      artifactDigest: artifact.digest,
    })
  ).rejects.toThrow('DESIGN_CONFLICT');
  await expect(
    service.handle({
      phase: 'resubmit',
      expectedRevisionId: payload.revisionId,
      artifactDigest: 'b'.repeat(64),
    })
  ).rejects.toThrow('DESIGN_DRAFT_CHANGED');
  await service.handle({
    phase: 'resubmit',
    expectedRevisionId: payload.revisionId,
    artifactDigest: artifact.digest,
  });
  expect(service.getSubmission()).toEqual({
    artworkId: id,
    draftId: workspace.artifactWorkdir,
    revisionId: payload.revisionId,
    artifactDigest: artifact.digest,
  });
  expect((await designOperation(root, { operation: 'read', sessionId: id })).revisionId).toBe(
    payload.revisionId
  );
});
it('requires actual native settlement for the registered execution and never guesses success', async () => {
  const { service } = await setup();
  const runId = randomUUID();
  expect(service.getTerminalOutcome()).toBeUndefined();
  await expect(service.handle({ phase: 'terminal', runId, status: 'end_turn' })).rejects.toThrow();
  await service.handle({ phase: 'start', runId });
  await expect(
    service.handle({ phase: 'terminal', runId: randomUUID(), status: 'end_turn' })
  ).rejects.toThrow();
  await service.handle({ phase: 'terminal', runId, status: 'cancelled' });
  expect(service.getTerminalOutcome()).toBe('cancelled');
  await expect(service.handle({ phase: 'terminal', runId, status: 'end_turn' })).rejects.toThrow();
});
