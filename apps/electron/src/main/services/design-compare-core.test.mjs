import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { findDesignCompareSource } from './design-compare-core.ts'

const contentDigest = (content) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        doc: content.doc,
        assets: Object.fromEntries(
          Object.keys(content.assets)
            .sort()
            .map((key) => [key, content.assets[key]])
        )
      })
    )
    .digest('hex')
const baseline = {
  doc: { canvas: { background: '#ffffff' }, elements: [{ id: 'text' }] },
  assets: { z: 'last', a: 'first' }
}
const version = (commitId, content, sourceRevisionId = 'original-envelope') => ({
  commitId,
  contentDigest: contentDigest(content),
  sourceRevisionId
})

void test('compare finds deduplicated content after Save Version or restore rebases its envelope', () => {
  const versions = [
    version('saved', baseline),
    version('other', { ...baseline, doc: { elements: [] } })
  ]
  assert.equal(findDesignCompareSource(versions, baseline)?.commitId, 'saved')
})

void test('compare chooses the newest matching document and assets regardless of asset insertion order', () => {
  const versions = [
    version('old', baseline),
    version('new', { ...baseline, assets: { a: 'first', z: 'last' } })
  ]
  assert.equal(findDesignCompareSource(versions, baseline)?.commitId, 'new')
  assert.equal(
    findDesignCompareSource(versions, { ...baseline, assets: { a: 'different', z: 'last' } }),
    undefined
  )
})

void test('no matching content never falls back to an envelope revision', () => {
  assert.equal(
    findDesignCompareSource([version('other', { ...baseline, doc: {} })], baseline),
    undefined
  )
  assert.equal(findDesignCompareSource([{ commitId: 'legacy' }], baseline), undefined)
})
