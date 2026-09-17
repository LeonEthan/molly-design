import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  createSyntheticReviewRepository,
  PRIMARY_REVIEW_DIFF_PATH,
  SECONDARY_REVIEW_DIFF_PATH,
} from './synthetic-review-repository.js';

void test('creates and removes a deterministic dirty review repository', () => {
  const fixture = createSyntheticReviewRepository();
  try {
    for (const base of ['.claude', '.agents']) {
      const skill = join(fixture.rootPath, base, 'skills', 'graphic-design');
      mkdirSync(skill, { recursive: true });
      writeFileSync(join(skill, 'SKILL.md'), '# Synthetic materialized skill\n');
    }
    const status = execFileSync('git', ['status', '--short'], {
      cwd: fixture.rootPath,
      encoding: 'utf8',
    })
      .trimEnd()
      .split('\n');
    assert.deepEqual(status, [
      ' M README.md',
      ` M ${PRIMARY_REVIEW_DIFF_PATH}`,
      ` M ${SECONDARY_REVIEW_DIFF_PATH}`,
    ]);

    const numstat = execFileSync('git', ['diff', '--numstat'], {
      cwd: fixture.rootPath,
      encoding: 'utf8',
    });
    assert.match(numstat, new RegExp(`2400\\t2400\\t${PRIMARY_REVIEW_DIFF_PATH}`));
    assert.match(numstat, new RegExp(`1200\\t1200\\t${SECONDARY_REVIEW_DIFF_PATH}`));
  } finally {
    fixture.cleanup();
  }
  assert.equal(existsSync(fixture.rootPath), false);
});
