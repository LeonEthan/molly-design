import { BrowserWindow, WebContentsView } from 'electron'
import { strict as assert } from 'node:assert'
import { assertDesignFits } from './design-viewport-verification'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DesignVersion } from '../../../../cli/src/design/history'
import {
  attachDesign,
  createDesignVersion,
  restoreDesignVersion,
  designRequest,
  destroyDesign,
  readDesignCanvasState
} from './design-service'

/** Native editing → flush → Git → reload; independent of paid model acceptance. */
export async function verifyDesignVersions(directory: string) {
  const owner = new BrowserWindow({ width: 1000, height: 700, show: false })
  const id = randomUUID()
  const bounds = { x: 0, y: 0, width: 1000, height: 700 }
  const canvas = () =>
    owner.contentView.children.find((v) => v instanceof WebContentsView) as WebContentsView
  const read = () => designRequest({ operation: 'read', sessionId: id })
  const add = (kind: 'shape' | 'text') =>
    canvas().webContents.executeJavaScript(
      `document.querySelector('[data-c2a-kind="${kind}"]').click()`
    )
  const restore = async (version: DesignVersion) => {
    await canvas().webContents.executeJavaScript('window.bento.viewport({scale: 4, x: 40, y: 40})')
    const result = await restoreDesignVersion(id, version.commitId)
    assert.equal(result.reloadError, undefined)
    await assertDesignFits(canvas())
    assert.equal((await readDesignCanvasState(id)).baseVersionId, version.commitId)
    assert.equal(
      (await canvas().webContents.executeJavaScript('window.molly.state()')).readonly,
      false
    )
  }
  try {
    await designRequest({
      operation: 'create',
      width: 320,
      height: 200,
      association: {
        sessionId: id,
        name: 'Synthetic version branches',
        userId: 'local:verification',
        machineId: 'verification',
        createdAt: new Date().toISOString()
      }
    })
    await attachDesign(owner, id, bounds)
    await add('shape')
    const v1 = await createDesignVersion(id)
    const first = await read()
    const originalView = canvas()
    await add('text')
    const v2 = await createDesignVersion(id)
    const second = await read()
    assert.equal(canvas(), originalView, 'Metadata save preserves the editor instance')
    assert.equal(second.doc.elements.length, first.doc.elements.length + 1)
    assert.equal(second.editing?.baseVersionId, v2.commitId)
    assert.equal((await createDesignVersion(id)).commitId, v2.commitId)
    await restore(v1)
    assert.deepEqual((await read()).doc, first.doc)
    await add('shape')
    const v3 = await createDesignVersion(id)
    assert.equal(v3.baseVersionId, v1.commitId)
    await add('text')
    const unsaved = JSON.parse(
      await canvas().webContents.executeJavaScript('window.bento.visual.snapshot()')
    )
    await restore(v2)
    assert.deepEqual((await read()).doc, second.doc)
    const versions = await designRequest<DesignVersion[]>({
      operation: 'history-list',
      sessionId: id
    })
    assert.equal(versions.length, 4)
    const protection = versions.at(-1)!
    assert.equal(protection.kind, 'before-restore')
    assert.equal(protection.baseVersionId, v3.commitId)
    destroyDesign(id)
    await attachDesign(owner, id, bounds)
    assert.equal((await readDesignCanvasState(id)).baseVersionId, v2.commitId)
    assert.deepEqual(await designRequest({ operation: 'history-list', sessionId: id }), versions)
    await restore(protection)
    assert.deepEqual((await read()).doc, unsaved)
    await restore(v1)
    assert.deepEqual((await read()).doc, first.doc)
    await writeFile(
      join(directory, 'version-result.json'),
      JSON.stringify(
        {
          status: 'passed',
          v1,
          v2,
          v3,
          protection,
          nativeEditsFlushed: true,
          unchangedSaveIdempotent: true,
          branchOriginPreserved: true,
          unversionedEditsProtected: true,
          reopenPreserved: true
        },
        null,
        2
      )
    )
  } finally {
    destroyDesign(id)
    owner.destroy()
  }
}
