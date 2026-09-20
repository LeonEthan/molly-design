import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hasRelatedIssueLink,
  normalizeRelatedIssueLink,
  relatedIssueNumbers,
} from './pr-issue-link.mjs';

const body = (reference) => `## Related issue

${reference}

## Summary

Focused change.
`;

void describe('pull request issue links', () => {
  void it('normalizes exact references without changing explicit intent', () => {
    assert.match(normalizeRelatedIssueLink(body('#121')), /\nCloses #121\n/);
    assert.match(
      normalizeRelatedIssueLink(body('https://github.com/LeonEthan/molly-design/issues/122')),
      /\nCloses #122\n/
    );
    assert.equal(normalizeRelatedIssueLink(body('Fixes #121')), body('Fixes #121'));
    assert.equal(normalizeRelatedIssueLink(body('Refs #121')), body('Refs #121'));
  });

  void it('does not infer issue links from other sections or prose', () => {
    const prose = body('Discussed in https://github.com/LeonEthan/molly-design/issues/121');
    assert.equal(normalizeRelatedIssueLink(prose), prose);
    assert.equal(
      normalizeRelatedIssueLink(
        '## Summary\n\nhttps://github.com/LeonEthan/molly-design/issues/121\n'
      ),
      '## Summary\n\nhttps://github.com/LeonEthan/molly-design/issues/121\n'
    );
    assert.equal(hasRelatedIssueLink(body('LeonEthan/molly-design#121')), true);
    assert.equal(hasRelatedIssueLink(body('Issue 121')), false);
    assert.deepEqual(relatedIssueNumbers(body('Closes #121')), [121]);
    assert.deepEqual(relatedIssueNumbers(body('Issue 121')), []);
  });

  void it('preserves foreign references without treating them as Molly issues', () => {
    for (const reference of [
      'https://github.com/LodyAI/Lody/issues/121',
      'LodyAI/Lody#121',
      'Closes https://github.com/LodyAI/Lody/issues/121',
      'Refs other/project#121',
    ]) {
      assert.equal(normalizeRelatedIssueLink(body(reference)), body(reference));
      assert.deepEqual(relatedIssueNumbers(body(reference)), []);
    }
    assert.deepEqual(relatedIssueNumbers(body('LeonEthan/molly-design#121')), [121]);
    assert.equal(
      normalizeRelatedIssueLink(body('Refs https://github.com/LeonEthan/molly-design/issues/121')),
      body('Refs #121')
    );
  });

  void it('is idempotent after adding the native closing keyword', () => {
    const normalized = normalizeRelatedIssueLink(body('#121'));
    assert.equal(normalizeRelatedIssueLink(normalized), normalized);
  });
});
