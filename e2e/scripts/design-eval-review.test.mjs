import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildItems, finalAgentMessage, scoreReview } from './design-eval-review.mjs';

const candidate = { 'poster/redesign': ['c1', 'c2', 'c3'], 'poster/resize': ['c4'] };
const baseline = { 'poster/redesign': ['b1', 'b2'] };

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

void test('un-blinds choices and flags a dimension worse in most pairs', () => {
  const flips = [true, false, false];
  const items = buildItems(
    { 'poster/redesign': ['c1', 'c2', 'c3'] },
    { 'poster/redesign': ['b1', 'b2', 'b3'] },
    () => flips.shift()
  );
  const result = scoreReview(items, {
    'poster/redesign#1': { dims: { composition: 'A', finish: 'B' } },
    'poster/redesign#2': { dims: { composition: 'B', finish: 'same' } },
    'poster/redesign#3': { dims: { composition: 'A' } },
  });
  assert.deepEqual(result['poster/redesign'], {
    pairs: 3,
    reviewed: 3,
    worse: { composition: 2 },
    better: { finish: 1, composition: 1 },
    regressed: ['composition'],
  });
});

void test('counts accepted runs in single-label review', () => {
  const items = buildItems({ 'poster/resize': ['c1', 'c2'] }, undefined, () => false);
  const result = scoreReview(items, {
    'poster/resize#1': { accept: true },
    'poster/resize#2': { accept: false },
  });
  assert.equal(result['poster/resize'].accepted, 1);
  assert.deepEqual(result['poster/resize'].regressed, []);
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
