import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildItems,
  describeRun,
  finalAgentMessage,
  isVerdictComplete,
  listRuns,
  scoreReview,
  validateReviewInputs,
} from './design-eval-review.mjs';

const candidate = { 'poster/redesign': ['c1', 'c2', 'c3'], 'poster/resize': ['c4'] };
const baseline = { 'poster/redesign': ['b1', 'b2'] };
const completePair = (dims = {}) => ({
  dims: { composition: 'same', hierarchy: 'same', 'brand accuracy': 'same', finish: 'same', ...dims },
  preserved: { A: true, B: false },
  honest: { A: false, B: true },
});

void test('pairs run i with run i and only cases both labels ran', () => {
  const flips = [true, false];
  const items = buildItems(candidate, baseline, () => flips.shift());
  assert.deepEqual(items, [
    {
      id: 'poster/redesign#1',
      caseId: 'poster/redesign',
      sides: { A: { label: 'baseline', run: 'b1' }, B: { label: 'candidate', run: 'c1' } },
    },
    {
      id: 'poster/redesign#2',
      caseId: 'poster/redesign',
      sides: { A: { label: 'candidate', run: 'c2' }, B: { label: 'baseline', run: 'b2' } },
    },
  ]);
});

void test('single-label review shows every run on its own', () => {
  const items = buildItems({ 'poster/resize': ['c4'] }, undefined, () => true);
  assert.deepEqual(items, [
    {
      id: 'poster/resize#1',
      caseId: 'poster/resize',
      sides: { A: { label: 'candidate', run: 'c4' } },
    },
  ]);
});

void test('un-blinds and summarizes human choices without deciding design quality', () => {
  const flips = [true, false, false];
  const items = buildItems(
    { 'poster/redesign': ['c1', 'c2', 'c3'] },
    { 'poster/redesign': ['b1', 'b2', 'b3'] },
    () => flips.shift()
  );
  const result = scoreReview(items, {
    'poster/redesign#1': completePair({ composition: 'A', finish: 'B' }),
    'poster/redesign#2': completePair({ composition: 'B' }),
    'poster/redesign#3': completePair({ composition: 'A' }),
  });
  assert.deepEqual(result['poster/redesign'], {
    pairs: 3,
    reviewed: 3,
    worse: { composition: 2 },
    better: { finish: 1, composition: 1 },
  });
});

void test('counts accepted runs in single-label review', () => {
  const items = buildItems({ 'poster/resize': ['c1', 'c2'] }, undefined, () => false);
  const result = scoreReview(items, {
    'poster/resize#1': { accept: true },
    'poster/resize#2': { accept: false },
  });
  assert.equal(result['poster/resize'].accepted, 1);
  assert.equal(result['poster/resize'].reviewed, 2);
});

void test('partial autosaves do not count as completed reviews or contribute comparison votes', () => {
  const items = buildItems(candidate, { 'poster/redesign': ['b1', 'b2', 'b3'] }, () => false);
  const result = scoreReview(items, {
    'poster/redesign#1': { note: 'pending' },
    'poster/redesign#2': { dims: { composition: 'B' } },
    'poster/redesign#3': { preserved: { A: true } },
  });
  assert.equal(result['poster/redesign'].reviewed, 0);
  assert.deepEqual(result['poster/redesign'].worse, {});
  assert.equal(isVerdictComplete(items[0], completePair()), true);
  assert.equal(isVerdictComplete(items[0], { ...completePair(), honest: { A: false } }), false);
  assert.equal(isVerdictComplete(items[0], { ...completePair(), dims: { ...completePair().dims, finish: 'invalid' } }), false);
});

void test('single-label acceptance needs an explicit yes or no', () => {
  const items = buildItems({ 'poster/resize': ['c1', 'c2', 'c3'] }, undefined, () => false);
  const result = scoreReview(items, {
    'poster/resize#1': { note: 'pending' },
    'poster/resize#2': { accept: 'yes' },
    'poster/resize#3': { accept: false },
  });
  assert.equal(result['poster/resize'].reviewed, 1);
  assert.equal(result['poster/resize'].accepted, 0);
});

async function ownedDirectory(t) {
  const root = await mkdtemp(join(tmpdir(), 'molly-design-eval-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

void test('baseline loading consults saved human acceptance by run path, including after rejection changes', async (t) => {
  const root = await ownedDirectory(t);
  const runs = [];
  for (let index = 1; index <= 4; index += 1) {
    const run = join(root, 'runs', 'baseline', 'poster', 'redesign', `run-${index}`);
    await mkdir(run, { recursive: true });
    await writeFile(join(run, 'preview.png'), 'synthetic preview');
    await writeFile(join(run, 'run.json'), JSON.stringify({ gate: { status: 'failed' } }));
    runs.push(run);
  }
  const review = join(root, 'reviews', 'baseline');
  await mkdir(review, { recursive: true });
  const items = buildItems({ 'poster/redesign': runs }, undefined, () => false);
  await writeFile(join(review, 'key.json'), JSON.stringify(items));
  const verdicts = {
    'poster/redesign#1': { accept: false },
    'poster/redesign#2': { accept: true },
    'poster/redesign#3': { note: 'pending' },
    'poster/redesign#4': { accept: 'yes' },
  };
  await writeFile(join(review, 'verdicts.json'), JSON.stringify(verdicts));
  assert.deepEqual(await listRuns('baseline', { acceptedOnly: true, dataRoot: root }), { 'poster/redesign': [runs[1]] });
  verdicts['poster/redesign#2'].accept = false;
  await writeFile(join(review, 'verdicts.json'), JSON.stringify(verdicts));
  assert.deepEqual(await listRuns('baseline', { acceptedOnly: true, dataRoot: root }), {});
  assert.deepEqual(await listRuns('baseline', { dataRoot: root }), { 'poster/redesign': runs });
});

void test('review uses the retained original inputs and rejects mismatched tasks or missing pair evidence', async (t) => {
  const root = await ownedDirectory(t);
  const source = Buffer.from('synthetic original poster');
  const caseSnapshot = {
    id: 'poster/redesign',
    input: { type: 'flat-raster', source: 'input.png', sha256: createHash('sha256').update(source).digest('hex') },
    prompt: 'Redesign this poster',
    followUps: [],
    knownDefects: ['crowded title'],
    preserve: ['logo'],
  };
  await writeFile(join(root, 'input.png'), source);
  await writeFile(join(root, 'run.json'), JSON.stringify({
    case: caseSnapshot.id,
    prompt: caseSnapshot.prompt,
    followUps: [],
    caseSnapshot,
    gate: { status: 'failed', failures: ['missing editable text'] },
  }));
  const original = await describeRun(root);
  assert.equal(original.prompt, 'Redesign this poster');
  assert.equal(original.source, join(root, 'input.png'));
  assert.deepEqual(original.caseSnapshot.knownDefects, ['crowded title']);
  validateReviewInputs({ A: original, B: original });
  validateReviewInputs({ A: {} });
  assert.throws(() => validateReviewInputs({ A: original, B: {} }), /without original case snapshots/);
  for (const changed of [
    { ...caseSnapshot, prompt: 'Resize instead' },
    { ...caseSnapshot, followUps: ['Change the title'] },
    { ...caseSnapshot, knownDefects: ['wrong colours'] },
    { ...caseSnapshot, input: { ...caseSnapshot.input, sha256: 'a different source' } },
  ])
    assert.throws(() => validateReviewInputs({ A: original, B: { caseSnapshot: changed } }), /different recorded case inputs/);
  await writeFile(join(root, 'input.png'), 'changed source');
  await assert.rejects(describeRun(root), /retained inputs do not match/);
});

void test('extracts the final agent message from the visible conversation', () => {
  const conversation = [
    'Worked for 3m',
    'first answer',
    '周末快乐',
    'Worked for 12m 5s',
    '',
    'Changed the headline only.',
    '',
    '08:16 AM',
    'Message',
    'gpt-6-luna',
  ].join('\n');
  assert.equal(finalAgentMessage(conversation), 'Changed the headline only.');
  assert.equal(finalAgentMessage('no turns yet'), '');
});
