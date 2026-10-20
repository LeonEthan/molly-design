import assert from 'node:assert/strict'
import test from 'node:test'
import { findDesignCompareSource } from './design-compare-core.ts'

const version = (commitId, sourceRevisionId, kind = 'saved') => ({
  commitId,
  number: 1,
  createdAt: '2026-10-20T00:00:00.000Z',
  kind,
  ...(sourceRevisionId ? { sourceRevisionId } : {})
})

void test('the compare source is the newest entry holding the superseded content', () => {
  const versions = [
    version('aaaa', 'rev-1', 'saved'),
    version('bbbb', 'rev-2', 'before-agent'),
    version('cccc', 'rev-1', 'before-restore')
  ]
  assert.equal(findDesignCompareSource(versions, 'rev-1')?.commitId, 'cccc')
  assert.equal(findDesignCompareSource(versions, 'rev-2')?.commitId, 'bbbb')
})

void test('entries without a source revision never match', () => {
  const versions = [version('aaaa')]
  assert.equal(findDesignCompareSource(versions, 'rev-1'), undefined)
})

void test('no matching content means no compare source', () => {
  const versions = [version('aaaa', 'rev-1')]
  assert.equal(findDesignCompareSource(versions, 'rev-9'), undefined)
})
