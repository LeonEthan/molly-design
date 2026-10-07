import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  readDesignEvalTurn,
  readDesignEvalTurnIds,
  requireCommittedDesignEvalTurn,
} from './design-eval-receipts.js';

const artworkId = 'synthetic-artwork';
const prompt = 'Redesign the synthetic poster';
const committed = {
  version: 1,
  status: 'committed',
  turnId: 'turn-new',
  artworkId,
  revisionId: 'a'.repeat(64),
  timestamp: '2026-10-06T12:00:00.000Z',
};
const manifest = { version: 1, turnId: 'turn-new', artworkId, prompt };

void test('awaits the new receipt without reusing an older committed turn', async (t) => {
  const workdir = await mkdtemp(join(tmpdir(), 'molly-design-eval-receipt-'));
  t.after(() => rm(workdir, { recursive: true, force: true }));
  assert.deepEqual(await readDesignEvalTurnIds(workdir), []);
  const old = join(workdir, 'design-input', 'turn-old');
  await mkdir(old, { recursive: true });
  await writeFile(join(old, 'manifest.json'), JSON.stringify({ ...manifest, turnId: 'turn-old' }));
  await writeFile(join(old, 'receipt.json'), JSON.stringify({ ...committed, turnId: 'turn-old' }));
  const previous = await readDesignEvalTurnIds(workdir);
  assert.equal(await readDesignEvalTurn(workdir, previous), undefined);
  const current = join(workdir, 'design-input', 'turn-new');
  await mkdir(current);
  await writeFile(join(current, 'manifest.json'), JSON.stringify(manifest));
  assert.equal(await readDesignEvalTurn(workdir, previous), undefined);
  await writeFile(join(current, 'receipt.json'), JSON.stringify(committed));
  const turn = await readDesignEvalTurn(workdir, previous);
  assert.ok(turn);
  assert.equal(
    requireCommittedDesignEvalTurn(turn, artworkId, prompt).revisionId,
    committed.revisionId
  );
  await mkdir(join(workdir, 'design-input', 'turn-unexpected'));
  await assert.rejects(readDesignEvalTurn(workdir, previous), /More than one new design turn/);
});

void test('terminal receipts without a commit cannot advance or export a design eval turn', () => {
  for (const status of ['invalid', 'no_artifact', 'failed', 'cancelled', 'candidate'])
    assert.throws(
      () =>
        requireCommittedDesignEvalTurn(
          {
            turnId: 'turn-new',
            manifest,
            receipt: { ...committed, status },
          },
          artworkId,
          prompt
        ),
      /no matching committed receipt/
    );
});

void test('the committed receipt must identify this artwork, turn and prompt with a revision', () => {
  const turn = { turnId: 'turn-new', manifest, receipt: committed };
  for (const receipt of [
    { ...committed, artworkId: 'another-artwork' },
    { ...committed, turnId: 'turn-old' },
    { ...committed, revisionId: undefined },
    { ...committed, revisionId: 'invalid-revision' },
    { ...committed, version: 2 },
  ])
    assert.throws(
      () => requireCommittedDesignEvalTurn({ ...turn, receipt }, artworkId, prompt),
      /no matching committed receipt/
    );
  for (const changed of [
    { ...manifest, turnId: 'turn-old' },
    { ...manifest, artworkId: 'another-artwork' },
    { ...manifest, prompt: 'Resize instead' },
    null,
  ])
    assert.throws(
      () => requireCommittedDesignEvalTurn({ ...turn, manifest: changed }, artworkId, prompt),
      /no matching committed receipt/
    );
});
