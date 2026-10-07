import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildItems,
  createBlindReview,
  createVerdictWriter,
  describeRun,
  finalAgentMessage,
  isReviewRequestAllowed,
  isVerdictComplete,
  listRuns,
  scoreReview,
  validateReviewInputs,
  writeVerdicts,
} from './design-eval-review.mjs';

const candidate = { 'poster/redesign': ['c1', 'c2', 'c3'], 'poster/resize': ['c4'] };
const baseline = { 'poster/redesign': ['b1', 'b2'] };
const completePair = (dims = {}) => ({
  dims: {
    composition: 'same',
    hierarchy: 'same',
    'brand accuracy': 'same',
    finish: 'same',
    ...dims,
  },
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
  assert.equal(
    isVerdictComplete(items[0], {
      ...completePair(),
      dims: { ...completePair().dims, finish: 'invalid' },
    }),
    false
  );
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
  assert.deepEqual(await listRuns('baseline', { acceptedOnly: true, dataRoot: root }), {
    'poster/redesign': [runs[1]],
  });
  verdicts['poster/redesign#2'].accept = false;
  await writeFile(join(review, 'verdicts.json'), JSON.stringify(verdicts));
  assert.deepEqual(await listRuns('baseline', { acceptedOnly: true, dataRoot: root }), {});
  assert.deepEqual(await listRuns('baseline', { dataRoot: root }), { 'poster/redesign': runs });
});

void test('unfinished new runs cannot enter review or accepted baseline selection', async (t) => {
  const root = await ownedDirectory(t);
  const reports = [
    { caseSnapshot: {}, activeTurn: { index: 1 } },
    { caseSnapshot: {}, turns: [{ prompt: 'First turn' }] },
    { caseSnapshot: {}, overall: 'completed', gate: { status: 'failed' } },
    { overall: 'failed' },
    { gate: { status: 'passed' } },
  ];
  const runs = [];
  for (const [index, report] of reports.entries()) {
    const run = join(root, 'runs', 'candidate', 'poster', 'redesign', `run-${index + 1}`);
    await mkdir(run, { recursive: true });
    await writeFile(join(run, 'preview.png'), 'synthetic preview');
    await writeFile(join(run, 'run.json'), JSON.stringify(report));
    runs.push(run);
  }
  const eligible = { 'poster/redesign': [runs[2], runs[4]] };
  assert.deepEqual(await listRuns('candidate', { dataRoot: root }), eligible);
  const review = join(root, 'reviews', 'candidate');
  await mkdir(review, { recursive: true });
  const items = buildItems({ 'poster/redesign': runs }, undefined, () => false);
  const verdicts = Object.fromEntries(items.map((item) => [item.id, { accept: true }]));
  await writeFile(join(review, 'key.json'), JSON.stringify(items));
  await writeFile(join(review, 'verdicts.json'), JSON.stringify(verdicts));
  assert.deepEqual(await listRuns('candidate', { dataRoot: root, acceptedOnly: true }), eligible);
});

void test('verdict writes require the bound host, same origin and review token', () => {
  const origin = 'http://127.0.0.1:54321';
  const token = 'synthetic-review-token';
  const headers = {
    host: '127.0.0.1:54321',
    origin,
    'content-type': 'application/json',
    'x-review-token': token,
  };
  assert.equal(isReviewRequestAllowed(headers, origin, token, true), true);
  assert.equal(isReviewRequestAllowed({ host: headers.host }, origin, token), true);
  for (const invalid of [
    { ...headers, host: 'other.example:54321' },
    { ...headers, origin: 'https://other.example' },
    { ...headers, origin: undefined },
    { ...headers, 'content-type': 'text/plain' },
    { ...headers, 'x-review-token': undefined },
    { ...headers, 'x-review-token': 'another-review' },
  ])
    assert.equal(isReviewRequestAllowed(invalid, origin, token, true), false);
  assert.equal(isReviewRequestAllowed({ host: 'other.example:54321' }, origin, token), false);
});

void test('review uses the retained original inputs and rejects mismatched tasks or missing pair evidence', async (t) => {
  const root = await ownedDirectory(t);
  const source = Buffer.from('synthetic original poster');
  const caseSnapshot = {
    id: 'poster/redesign',
    input: {
      type: 'flat-raster',
      source: 'input.png',
      sha256: createHash('sha256').update(source).digest('hex'),
    },
    prompt: 'Redesign this poster',
    followUps: [],
    knownDefects: ['crowded title'],
    preserve: ['logo'],
  };
  await writeFile(join(root, 'input.png'), source);
  await writeFile(
    join(root, 'run.json'),
    JSON.stringify({
      case: caseSnapshot.id,
      prompt: caseSnapshot.prompt,
      followUps: [],
      caseSnapshot,
      model: { modelId: 'synthetic-agent', reasoning: 'high' },
      imageModel: 'synthetic-image',
      gate: { status: 'failed', failures: ['missing editable text'] },
    })
  );
  const original = await describeRun(root);
  assert.equal(original.prompt, 'Redesign this poster');
  assert.equal(original.source, join(root, 'input.png'));
  assert.deepEqual(original.caseSnapshot.knownDefects, ['crowded title']);
  validateReviewInputs({ A: original, B: original });
  for (const changed of [
    { ...original, model: { ...original.model, modelId: 'another-agent' } },
    { ...original, model: { ...original.model, reasoning: 'max' } },
    { ...original, imageModel: 'another-image-model' },
  ])
    assert.throws(
      () => validateReviewInputs({ A: original, B: changed }),
      /different Agent models/
    );
  assert.throws(
    () => validateReviewInputs({ A: original, B: { ...original, model: undefined } }),
    /require recorded Agent model/
  );
  validateReviewInputs({ A: {} });
  assert.throws(
    () => validateReviewInputs({ A: original, B: {} }),
    /without original case snapshots/
  );
  for (const changed of [
    { ...caseSnapshot, prompt: 'Resize instead' },
    { ...caseSnapshot, followUps: ['Change the title'] },
    { ...caseSnapshot, knownDefects: ['wrong colours'] },
    { ...caseSnapshot, input: { ...caseSnapshot.input, sha256: 'a different source' } },
  ])
    assert.throws(
      () => validateReviewInputs({ A: original, B: { caseSnapshot: changed } }),
      /different recorded case inputs/
    );
  await writeFile(join(root, 'input.png'), 'changed source');
  await assert.rejects(describeRun(root), /retained inputs do not match/);
});

void test('blind client data and image identifiers do not contain run labels or paths', () => {
  const candidatePath = '/private/runs/version-candidate/poster/redesign/run-1/preview.png';
  const baselinePath = '/private/runs/version-baseline/poster/redesign/run-1/preview.png';
  const details = (path) => ({
    previews: [path],
    source: '/private/source.png',
    caseSnapshot: { input: { source: path } },
    model: { modelId: 'private-model', reasoning: 'high' },
    gate: { status: 'passed' },
    minutes: [1],
    summary: 'Synthetic final summary',
  });
  const review = createBlindReview([
    {
      id: 'poster/redesign#1',
      caseId: 'poster/redesign',
      caseLabel: '合成案例',
      prompt: 'Redesign the synthetic poster',
      followUps: [],
      knownDefects: [],
      preserve: [],
      source: '/private/source.png',
      sides: { A: details(candidatePath), B: details(baselinePath) },
    },
  ]);
  const payload = JSON.stringify(review.data);
  for (const value of [
    'version-candidate',
    'version-baseline',
    '/private/',
    'private-model',
    'caseSnapshot',
  ])
    assert.equal(payload.includes(value), false);
  const item = review.data[0];
  assert.equal(review.artifacts.get(item.source), '/private/source.png');
  assert.equal(review.artifacts.get(item.sides.A.previews[0]), candidatePath);
  assert.equal(review.artifacts.get(item.sides.B.previews[0]), baselinePath);
  assert.notEqual(item.sides.A.previews[0], item.sides.B.previews[0]);
  assert.equal(review.artifacts.get(candidatePath), undefined);
});

void test('overlapping autosaves preserve the latest answers and other items as valid JSON', async (t) => {
  const root = await ownedDirectory(t);
  const file = join(root, 'verdicts.json');
  const initial = { untouched: { accept: true }, pair: { note: 'original' } };
  await writeVerdicts(file, JSON.stringify(initial));
  const verdicts = structuredClone(initial);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const save = createVerdictWriter(file, verdicts, async (target, contents) => {
    if (JSON.parse(contents).pair.note === 'first') {
      started.resolve();
      await release.promise;
    }
    await writeVerdicts(target, contents);
  });
  const first = save('pair', { note: 'first', dims: { composition: 'A' } });
  await started.promise;
  const latest = { note: 'latest', dims: { composition: 'B', finish: 'same' } };
  const second = save('pair', latest);
  latest.note = 'mutated after enqueue';
  const third = save('another', { accept: false });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), initial);
  release.resolve();
  await Promise.all([first, second, third]);
  const expected = {
    untouched: { accept: true },
    pair: { note: 'latest', dims: { composition: 'B', finish: 'same' } },
    another: { accept: false },
  };
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), expected);
  assert.deepEqual(verdicts, expected);
});

void test('a failed save preserves the prior verdict and later saves can continue', async (t) => {
  const root = await ownedDirectory(t);
  const file = join(root, 'verdicts.json');
  const verdicts = { original: { accept: true } };
  await writeVerdicts(file, JSON.stringify(verdicts));
  const save = createVerdictWriter(file, verdicts, async (target, contents) => {
    if (JSON.parse(contents).original.accept === false) throw Error('synthetic write failure');
    await writeVerdicts(target, contents);
  });
  await assert.rejects(save('original', { accept: false }), /synthetic write failure/);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { original: { accept: true } });
  assert.deepEqual(verdicts, { original: { accept: true } });
  await save('later', { accept: false });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    original: { accept: true },
    later: { accept: false },
  });
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
