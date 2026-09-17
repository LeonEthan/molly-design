import { WebContentsView, nativeImage, type BrowserWindow } from 'electron'
import { strict as assert } from 'node:assert'
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  attachDesign,
  designCanvasAccess,
  designRequest,
  hideDesign,
  importDesignSnapshot,
  destroyDesign,
  setDesignCanvasStateQuery
} from './design-service'
import {
  refreshSourcePreview,
  importSourcePreview,
  attachSourcePreview,
  hideSourcePreview,
  closeSourcePreview
} from './design-source-preview'

/** Synthetic native evidence: production collector, worker, Bento and access gate. */
export async function verifySourcePreview(
  owner: BrowserWindow,
  artworkId: string,
  canonical: WebContentsView,
  directory: string
) {
  const root = join(directory, 'authoring')
  await mkdir(join(root, 'media'), { recursive: true })
  const source = join(root, 'design.yaml')
  const host = randomUUID()
  const bounds = { x: 0, y: 0, width: 1200, height: 800 }
  const saved = await designRequest({ operation: 'read', sessionId: artworkId })
  await canonical.webContents.executeJavaScript(
    'document.querySelector(\'[data-c2a-kind="shape"]\').click(); window.molly.setReadonly(true)'
  )
  const editedSnapshot = await canonical.webContents.executeJavaScript(
    'window.bento.visual.snapshot()'
  )
  const missing = await refreshSourcePreview(owner, artworkId, host, async () => source)
  assert.equal(missing.status, 'waiting')
  assert.equal(canonical.webContents.isDestroyed(), false)
  const page =
    'format: molly-canvas/1\nsize: [320, 200]\nbackground: {type: solid, color: "#FFFFFF"}\nelements:\n  - id: photo\n    kind: image\n    bounds: [0, 0, 100, 100]\n    src: media/pic.png\n    fit: cover\n'
  await writeFile(source, page)
  const writeImage = async (color: number) =>
    writeFile(
      join(root, 'media/pic.png'),
      nativeImage.createFromBitmap(Buffer.from([color, 0, 0, 255]), { width: 1, height: 1 }).toPNG()
    )
  await writeImage(255)
  const first = await refreshSourcePreview(owner, artworkId, host, async () => source)
  assert.equal(first.status, 'ready', JSON.stringify(first))
  hideDesign(artworkId)
  attachSourcePreview(host, bounds)
  const getPreview = () =>
    owner.contentView.children.find(
      (child) => child instanceof WebContentsView && child !== canonical
    ) as WebContentsView
  const preview = getPreview()
  await writeFile(
    join(directory, 'source-preview.png'),
    (await preview.webContents.capturePage()).toPNG()
  )
  assert.equal((await preview.webContents.executeJavaScript('window.molly.state()')).readonly, true)
  assert.equal(
    await preview.webContents.executeJavaScript(
      "fetch('/ws/' + new URLSearchParams(location.search).get('ws') + '/save', {method:'POST', body:'{}'}).then(r => r.status)"
    ),
    403
  )
  await designCanvasAccess.update([
    { artworkId, turnId: 'synthetic-preview-execution', preparing: false }
  ])
  hideSourcePreview(host)
  await attachDesign(owner, artworkId, bounds, artworkId, false)
  assert.equal(
    (await canonical.webContents.executeJavaScript('window.molly.state()')).readonly,
    true
  )
  const before = await canonical.webContents.executeJavaScript('window.bento.visual.snapshot()')
  await canonical.webContents.executeJavaScript('window.bento.undo()')
  assert.equal(
    await canonical.webContents.executeJavaScript('window.bento.visual.snapshot()'),
    before
  )
  await writeFile(source, 'invalid: [')
  const invalid = await refreshSourcePreview(owner, artworkId, host, async () => source)
  assert.equal(invalid.status, 'waiting')
  assert.equal(getPreview(), preview, 'Invalid source retains the last rendered instance')
  await writeFile(source, page)
  await writeImage(100)
  const replacement = await refreshSourcePreview(owner, artworkId, host, async () => source)
  assert.equal(replacement.status, 'ready')
  if (replacement.status !== 'ready' || first.status !== 'ready')
    throw Error('Preview was not ready')
  assert.notEqual(replacement.sourceIdentity, first.sourceIdentity)
  // Subscribe to the real native publication signal before external file IO.
  const send = owner.webContents.send.bind(owner.webContents)
  let published:
    | ((payload: { hostId: string; status: string; sourceIdentity?: string }) => void)
    | undefined
  owner.webContents.send = (channel, ...args) => {
    send(channel, ...args)
    if (channel === 'design.preview') published?.(args[0])
  }
  const automatic = async (
    status: string,
    change: () => Promise<unknown>,
    previousIdentity?: string
  ) => {
    let timer: ReturnType<typeof setTimeout>
    const result = new Promise<{ sourceIdentity?: string }>((resolve, reject) => {
      timer = setTimeout(() => reject(Error(`No automatic ${status} publication`)), 30000)
      published = (payload) => {
        if (
          payload.hostId === host &&
          payload.status === status &&
          (!previousIdentity || payload.sourceIdentity !== previousIdentity)
        )
          resolve(payload)
      }
    })
    try {
      await change()
      return await result
    } finally {
      clearTimeout(timer!)
      published = undefined
    }
  }
  try {
    const invalidSurface = getPreview()
    await automatic('waiting', () =>
      writeFile(source, page.replace('media/pic.png', 'media/new.png'))
    )
    assert.equal(getPreview(), invalidSurface)
    const discovered = await automatic('ready', () =>
      writeFile(
        join(root, 'media/new.png'),
        nativeImage.createFromBitmap(Buffer.from([40, 0, 0, 255]), { width: 1, height: 1 }).toPNG()
      )
    )
    const beforeRename = getPreview()
    await writeFile(join(root, 'replacement.tmp'), page)
    const renamed = await automatic(
      'ready',
      () => rename(join(root, 'replacement.tmp'), source),
      discovered.sourceIdentity
    )
    assert.notEqual(getPreview(), beforeRename)
    const assetChanged = await automatic('ready', () => writeImage(88), renamed.sourceIdentity)
    assert.notEqual(assetChanged.sourceIdentity, replacement.sourceIdentity)
  } finally {
    owner.webContents.send = send
  }
  const image = await getPreview().webContents.executeJavaScript(
    "(async () => { const image = document.querySelector('.bento-slide img'); if (image && (!image.complete || !image.naturalWidth)) throw Error('Preview image not loaded'); return window.molly.snapshot(); })()"
  )
  assert.ok(
    Object.values(image.assets).includes(
      'data:image/png;base64,' + (await readFile(join(root, 'media/pic.png'))).toString('base64')
    )
  )
  let resolveLate!: (value: string) => void
  const late = refreshSourcePreview(
    owner,
    artworkId,
    host,
    () =>
      new Promise((resolve) => {
        resolveLate = resolve
      })
  )
  hideSourcePreview(host)
  resolveLate(source)
  assert.equal((await late).status, 'superseded')
  assert.equal(getPreview().getVisible(), false)
  assert.deepEqual(await designRequest({ operation: 'read', sessionId: artworkId }), saved)
  assert.equal(canonical.webContents.isDestroyed(), false)
  closeSourcePreview(host)
  await designCanvasAccess.update([])
  await attachDesign(owner, artworkId, bounds)
  const undoRedo = await canonical.webContents.executeJavaScript(`(() => {
    window.bento.undo(); const undone = window.bento.visual.snapshot();
    window.bento.redo(); const redone = window.bento.visual.snapshot();
    window.bento.undo(); return {undone, redone};
  })()`)
  assert.deepEqual(JSON.parse(undoRedo.undone), saved.doc)
  assert.equal(undoRedo.redone, editedSnapshot)
  await canonical.webContents.executeJavaScript('window.molly.save()')
  await writeFile(
    join(directory, 'source-preview-result.json'),
    JSON.stringify(
      {
        status: 'passed',
        initialWaiting: true,
        nativeAutomaticMissingDependency: true,
        nativeAutomaticRename: true,
        nativeAutomaticSamePathAsset: true,
        invalidRetainsSurface: true,
        samePathAssetChanges: true,
        lateResultDiscarded: true,
        readonlyDuringExecution: true,
        noPreviewSaveRoute: true,
        canonicalUnchanged: true,
        canonicalInstancePreserved: true,
        canonicalUndoRedoPreserved: true,
        authorCompletionNotInferred: true
      },
      null,
      2
    )
  )
}

/** Import uses the same production preview and canonical worker, with explicit race signals. */
export async function verifySourceImport(owner: BrowserWindow, directory: string) {
  setDesignCanvasStateQuery(async () => {})
  const artworkId = randomUUID(),
    host = randomUUID()
  const saved = await designRequest({
    operation: 'create',
    association: {
      sessionId: artworkId,
      name: 'Synthetic import',
      userId: 'verification',
      machineId: 'verification',
      createdAt: new Date().toISOString()
    },
    width: 320,
    height: 200
  })
  const root = join(directory, 'import-authoring')
  await mkdir(join(root, 'media'), { recursive: true })
  const source = join(root, 'design.yaml')
  const page =
    'format: molly-canvas/1\nsize: [320, 200]\nbackground: {type: solid, color: "#FFFFFF"}\nelements:\n  - id: photo\n    kind: image\n    bounds: [0, 0, 100, 100]\n    src: media/pic.png\n    fit: cover\n'
  await writeFile(source, page)
  const firstAsset = nativeImage
    .createFromBitmap(Buffer.from([100, 0, 0, 255]), { width: 1, height: 1 })
    .toPNG()
  await writeFile(join(root, 'media/pic.png'), firstAsset)
  const shown = await refreshSourcePreview(owner, artworkId, host, async () => source)
  if (shown.status !== 'ready' || !shown.sourceIdentity) throw Error('Import preview not ready')
  attachSourcePreview(host, { x: 0, y: 0, width: 1000, height: 700 })
  await designCanvasAccess.update([
    { artworkId, turnId: 'synthetic-import-processing', preparing: false }
  ])
  await assert.rejects(importSourcePreview(owner, artworkId, host, shown.sourceIdentity), /active/)
  await designCanvasAccess.update([])
  let started!: () => void, finish!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  const released = new Promise<void>((resolve) => {
    finish = resolve
  })
  const buffered = {
    artworkId,
    async setReadonly() {},
    async flush() {
      started()
      await released
    }
  }
  await designCanvasAccess.register(buffered)
  const importing = importSourcePreview(owner, artworkId, host, shown.sourceIdentity)
  await entered
  await writeFile(
    join(root, 'media/pic.png'),
    nativeImage.createFromBitmap(Buffer.from([200, 0, 0, 255]), { width: 1, height: 1 }).toPNG()
  )
  const latest = await refreshSourcePreview(owner, artworkId, host, async () => source)
  if (latest.status !== 'ready') throw Error('Updated import preview not ready')
  assert.notEqual(latest.sourceIdentity, shown.sourceIdentity)
  finish()
  const result = await importing
  assert.equal(result.reloadError, undefined)
  designCanvasAccess.unregister(buffered)
  const imported = await designRequest({ operation: 'read', sessionId: artworkId })
  assert.ok(
    Object.values(imported.assets).includes(
      'data:image/png;base64,' + firstAsset.toString('base64')
    )
  )
  assert.notEqual(imported.revisionId, saved.revisionId)
  await assert.rejects(importSourcePreview(owner, artworkId, host, shown.sourceIdentity), /changed/)
  const retry = {
    content: { doc: imported.doc, assets: imported.assets },
    baseRevisionId: saved.revisionId
  }
  assert.equal((await importDesignSnapshot(artworkId, retry)).revisionId, imported.revisionId)
  const conflict = {
    content: { doc: saved.doc, assets: saved.assets },
    baseRevisionId: saved.revisionId
  }
  await assert.rejects(importDesignSnapshot(artworkId, conflict), /DESIGN_CONFLICT/)
  await assert.rejects(
    importDesignSnapshot(artworkId, { content: { doc: imported.doc, assets: {} } }),
    /asset/i
  )
  const failure = {
    artworkId,
    async setReadonly() {},
    async flush() {
      throw Error('Synthetic flush failure; draft retained')
    }
  }
  await designCanvasAccess.register(failure)
  await assert.rejects(importDesignSnapshot(artworkId, retry), /draft retained/)
  designCanvasAccess.unregister(failure)
  assert.deepEqual(await designRequest({ operation: 'read', sessionId: artworkId }), imported)
  assert.equal(await readFile(source, 'utf8'), page)
  closeSourcePreview(host)
  await assert.rejects(
    importSourcePreview(owner, artworkId, host, latest.sourceIdentity!),
    /closed/
  )
  await attachDesign(owner, artworkId, { x: 0, y: 0, width: 1000, height: 700 }, artworkId, false)
  const editor = owner.contentView.children.find(
    (child) => child instanceof WebContentsView && child.webContents.getURL().includes(artworkId)
  ) as WebContentsView
  assert.ok(editor)
  assert.deepEqual(
    (await editor.webContents.executeJavaScript('window.molly.snapshot()')).doc,
    imported.doc
  )
  assert.equal((await editor.webContents.executeJavaScript('window.molly.state()')).readonly, false)
  destroyDesign(artworkId)
  setDesignCanvasStateQuery(async () => {
    await designCanvasAccess.update([])
  })
  await writeFile(
    join(directory, 'source-import-result.json'),
    JSON.stringify(
      {
        status: 'passed',
        exactClickedAssetsAcrossRefresh: true,
        executionProcessingRefused: true,
        closedOrReplacedIdentityRefused: true,
        lostReplyIdempotence: true,
        staleVersionRefused: true,
        assetFailurePreservesCanonical: true,
        flushFailurePreservesCanonical: true,
        workspacePreserved: true,
        savedCanonicalEditable: true
      },
      null,
      2
    )
  )
}
