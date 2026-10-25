import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  LEGAL_RESOURCE_SOURCES,
  stageLegalResources,
  verifyLegalResources
} from './legal-resources.mjs'

test('stages readable legal files byte-for-byte from their repository sources', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'molly-legal-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  stageLegalResources(directory)
  assert.doesNotThrow(() => verifyLegalResources(directory))
  for (const [destination, source] of Object.entries(LEGAL_RESOURCE_SOURCES)) {
    assert.deepEqual(
      readFileSync(join(directory, destination)),
      readFileSync(new URL(`../../../${source}`, import.meta.url))
    )
  }
})

for (const name of Object.keys(LEGAL_RESOURCE_SOURCES)) {
  for (const contents of [null, '', ' \n\t']) {
    const state = contents === null ? 'missing' : contents === '' ? 'empty' : 'blank'
    test(`rejects ${state} ${name} in collected package resources`, (t) => {
      const directory = mkdtempSync(join(tmpdir(), 'molly-legal-'))
      t.after(() => rmSync(directory, { recursive: true, force: true }))
      stageLegalResources(directory)
      const file = join(directory, name)
      if (contents === null) rmSync(file)
      else writeFileSync(file, contents)
      assert.throws(
        () => verifyLegalResources(directory),
        (error) => error.message.startsWith('[licenses]') && error.message.includes(file)
      )
    })
  }
}
