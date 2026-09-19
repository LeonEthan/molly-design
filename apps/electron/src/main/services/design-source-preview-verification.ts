import { WebContentsView, nativeImage, type BrowserWindow } from 'electron'
import { strict as assert } from 'node:assert'
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { attachDesign, designCanvasAccess, designRequest, hideDesign } from './design-service'
import {
  refreshSourcePreview,
  attachSourcePreview,
  hideSourcePreview,
  closeSourcePreview,
  attachDesignFromPreview
} from './design-source-preview'

/** Synthetic native evidence: production collector, worker, Bento and access gate. */
export async function verifySourcePreview(
  owner: BrowserWindow,
  artworkId: string,
  canonical: WebContentsView,
  directory: string
) {
  owner.showInactive()
  const root = join(directory, 'authoring')
  await mkdir(join(root, 'media'), { recursive: true })
  const source = join(root, 'design.yaml')
  const host = artworkId
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
  const addPreparedView = owner.contentView.addChildView.bind(owner.contentView)
  const prepared = new Set<WebContentsView>()
  const handoffFrames: { bytes: number; outgoingVisible: boolean }[] = []
  owner.contentView.addChildView = (view, index) => {
    if (view instanceof WebContentsView && view !== canonical) {
      if (!owner.contentView.children.includes(view)) {
        const capture = view.webContents.capturePage.bind(view.webContents)
        view.webContents.capturePage = async (...args) => {
          const outgoing = owner.contentView.children
            .filter(
              (child): child is WebContentsView =>
                child instanceof WebContentsView && child !== view && child.getVisible()
            )
            .at(-1)
          const frame = await capture(...args)
          assert.equal(frame.isEmpty(), false)
          if (outgoing)
            assert.equal(outgoing.getVisible(), true, 'Keep outgoing pixels through preparation')
          prepared.add(view)
          handoffFrames.push({ bytes: frame.toBitmap().length, outgoingVisible: !!outgoing })
          return frame
        }
      } else if (index === undefined) {
        assert.ok(prepared.has(view), 'A promoted preview must have prepared compositor pixels')
      }
    }
    addPreparedView(view, index)
  }
  const first = await refreshSourcePreview(owner, artworkId, host, async () => source)
  assert.equal(first.status, 'ready', JSON.stringify(first))
  assert.equal(canonical.getVisible(), true, 'Keep canonical until the first preview attaches')
  await attachSourcePreview(host, bounds)
  assert.equal(canonical.getVisible(), false)
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
  assert.equal(replacement.status, 'ready', JSON.stringify(replacement))
  if (replacement.status !== 'ready' || first.status !== 'ready')
    throw Error('Preview was not ready')
  assert.notEqual(replacement.sourceIdentity, first.sourceIdentity)
  hideDesign(artworkId, host)
  await attachSourcePreview(host, bounds)
  const camera = await getPreview().webContents.executeJavaScript(
    'window.bento.viewport({ scale: 4, x: 160, y: 100 })'
  )
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
  await attachSourcePreview(host, bounds)
  const afterCamera = await getPreview().webContents.executeJavaScript('window.bento.viewport()')
  for (const key of ['scale', 'x', 'y'] as const)
    assert.ok(
      Math.abs(camera[key] - afterCamera[key]) < (key === 'scale' ? 1e-6 : 1),
      `Viewport ${key} changed during replacement: ${camera[key]} -> ${afterCamera[key]}`
    )
  const image = await getPreview().webContents.executeJavaScript(
    "(async () => { const image = document.querySelector('.bento-slide img'); if (image && (!image.complete || !image.naturalWidth)) throw Error('Preview image not loaded'); return window.molly.snapshot(); })()"
  )
  assert.ok(
    Object.values(image.assets).includes(
      'data:image/png;base64,' + (await readFile(join(root, 'media/pic.png'))).toString('base64')
    )
  )
  // Golden uses an odd-height native viewport: rounded pan padding used to
  // grow its client box by one pixel and compound zoom on every replacement.
  const tallBounds = { x: 0, y: 0, width: 1295, height: 1299 }
  await writeFile(source, page.replace('[320, 200]', '[285, 2000]'))
  await refreshSourcePreview(owner, artworkId, host, async () => source)
  await attachSourcePreview(host, tallBounds)
  const tallCamera = await getPreview().webContents.executeJavaScript(
    'window.bento.viewport({ scale: 1.5, x: 142.5, y: 300 })'
  )
  for (const color of [91, 92]) {
    await writeImage(color)
    await refreshSourcePreview(owner, artworkId, host, async () => source)
    await attachSourcePreview(host, tallBounds)
    const observed = await getPreview().webContents.executeJavaScript('window.bento.viewport()')
    assert.ok(
      Math.abs(observed.scale - tallCamera.scale) < 1e-6,
      `Odd viewport scale drifted: ${tallCamera.scale} -> ${observed.scale}`
    )
    assert.ok(Math.abs(observed.x - tallCamera.x) < 1 && Math.abs(observed.y - tallCamera.y) < 1)
  }
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
  // Complete a turn with a visible preview: canonical preparation must not clear it.
  await refreshSourcePreview(owner, artworkId, host, async () => source)
  await attachSourcePreview(host, bounds)
  const outgoing = getPreview()
  const captureCanonical = canonical.webContents.capturePage.bind(canonical.webContents)
  let editorPrepared = false
  canonical.webContents.capturePage = async (...args) => {
    assert.equal(outgoing.getVisible(), true, 'Last draft covers the preparing editor')
    const frame = await captureCanonical(...args)
    assert.equal(outgoing.getVisible(), true)
    editorPrepared = true
    return frame
  }
  await designCanvasAccess.update([])
  try {
    await attachDesignFromPreview(owner, artworkId, bounds)
    assert.equal(editorPrepared, true)
    assert.equal(canonical.getVisible(), true)
    assert.equal(outgoing.getVisible(), false)
  } finally {
    canonical.webContents.capturePage = captureCanonical
    owner.contentView.addChildView = addPreparedView
  }
  assert.ok(handoffFrames.some((frame) => frame.outgoingVisible))
  const undoRedo = await canonical.webContents.executeJavaScript(`(() => {
    window.bento.undo(); const undone = window.bento.visual.snapshot();
    window.bento.redo(); const redone = window.bento.visual.snapshot();
    window.bento.undo(); return {undone, redone};
  })()`)
  assert.deepEqual(JSON.parse(undoRedo.undone), saved.doc)
  assert.equal(undoRedo.redone, editedSnapshot)
  await canonical.webContents.executeJavaScript('window.molly.save()')
  // Real first-write watch: ownership exists before the causal manifest identity.
  const liveRoot = join(directory, 'late-input')
  await mkdir(join(liveRoot, 'media'), { recursive: true })
  await writeFile(join(liveRoot, 'media/pic.png'), await readFile(join(root, 'media/pic.png')))
  const inputId = 'synthetic-late-input'
  const ownerToken = 'synthetic-late-owner'
  const dataRoot = process.env.MOLLY_DATA_DIR ?? process.env.LODY_DATA_DIR
  assert.ok(dataRoot)
  const inputDirectory = join(dataRoot, 'chats', artworkId, 'design-input', inputId)
  let inputReady = false
  const inputResolutions: boolean[] = []
  await designCanvasAccess.update([{ artworkId, turnId: ownerToken, preparing: false }])
  const resolveLive = async () => {
    inputResolutions.push(inputReady)
    return {
      path: join(liveRoot, 'design.yaml'),
      live: {
        sessionId: artworkId,
        turnId: ownerToken,
        sourceTurnId: inputReady ? inputId : undefined
      }
    }
  }
  const awaitingInput = await refreshSourcePreview(owner, artworkId, host, resolveLive)
  assert.equal(awaitingInput.status, 'waiting')
  assert.equal(
    'error' in awaitingInput ? awaitingInput.error : undefined,
    undefined,
    JSON.stringify(awaitingInput)
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  let complete!: () => void
  let sawPendingInput!: () => void
  const pendingInput = new Promise<void>((resolve) => {
    sawPendingInput = resolve
  })
  const firstWritePublications: unknown[] = []
  const firstWrite = new Promise<void>((resolve, reject) => {
    complete = resolve
    timer = setTimeout(
      () =>
        reject(
          Error(
            'First write never bound the late input: ' +
              JSON.stringify({
                state: designCanvasAccess.state(artworkId),
                inputResolutions,
                publications: firstWritePublications
              })
          )
        ),
      30000
    )
  })
  owner.webContents.send = (channel, ...args) => {
    send(channel, ...args)
    if (channel === 'design.preview') firstWritePublications.push(args[0])
    if (channel === 'design.preview' && args[0]?.hostId === host && args[0]?.status === 'waiting')
      sawPendingInput()
    if (channel === 'design.preview' && args[0]?.hostId === host && args[0]?.status === 'ready')
      complete()
  }
  try {
    await writeFile(join(liveRoot, 'design.yaml'), page)
    await Promise.race([pendingInput, firstWrite])
    await mkdir(inputDirectory, { recursive: true })
    await writeFile(
      join(inputDirectory, 'manifest.json'),
      JSON.stringify({
        version: 1,
        turnId: inputId,
        baselineRevisionId: saved.revisionId,
        artifactWorkdir: liveRoot,
        artifactAtSend: { status: 'absent' }
      })
    )
    inputReady = true
    // No further YAML/media event: the input handoff itself must reconcile.
    await firstWrite
    hideDesign(artworkId, host)
    await attachSourcePreview(host, bounds)
    assert.equal(
      (await getPreview().webContents.executeJavaScript('window.molly.state()')).readonly,
      true
    )
  } finally {
    clearTimeout(timer)
    owner.webContents.send = send
    const liveView = getPreview()
    const retired =
      liveView && !liveView.webContents.isDestroyed()
        ? new Promise<void>((resolve) => liveView.webContents.once('destroyed', () => resolve()))
        : Promise.resolve()
    closeSourcePreview(host)
    await retired
    await designCanvasAccess.update([])
    await attachDesign(owner, artworkId, bounds)
  }

  // Closing while the next native document is loading must retire the staging view too.
  const addView = owner.contentView.addChildView.bind(owner.contentView)
  owner.contentView.addChildView = (view, index) => {
    if (view instanceof WebContentsView && view !== canonical)
      view.webContents.once('did-start-loading', () => closeSourcePreview(host))
    addView(view, index)
  }
  try {
    const cancelled = await refreshSourcePreview(owner, artworkId, host, async () => source)
    assert.equal(cancelled.status, 'superseded')
    assert.deepEqual(
      owner.contentView.children.filter((view) => view instanceof WebContentsView),
      [canonical]
    )
  } finally {
    owner.contentView.addChildView = addView
  }
  await writeFile(
    join(directory, 'source-preview-result.json'),
    JSON.stringify(
      {
        status: 'passed',
        initialWaiting: true,
        firstWriteBindsLateInput: true,
        closedStagingViewRetired: true,
        preparedNativeFrames: handoffFrames,
        previewToEditorRetainsOutgoingUntilPrepared: editorPrepared,
        viewportPreserved: { before: camera, after: afterCamera },
        oddHeightLongCanvasViewportPreserved: tallCamera,
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
