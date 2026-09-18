import { verifySourcePreview } from './design-source-preview-verification'
import { app, BrowserWindow, WebContentsView, nativeImage, dialog } from 'electron'
import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { AppUpdaterService } from './app-updater-service'
import { shouldConstructUpdaterEnabled } from './app-updater-sparkle-policy'
import {
  attachDesign,
  designCanvasAccess,
  leaveDesign,
  hideDesign,
  destroyDesign,
  designRequest,
  saveDesign,
  copyDesign,
  finishDesignCopy,
  renderSavedDesign,
  prepareDesignQuit,
  syncDesignCanvasFromStore
} from './design-service'

/** Opt-in synthetic acceptance journey using the production editor and persistence path. */
export async function verifyDesign(directory: string) {
  // Packaged runs ignore the development-only auth override. Require the native
  // Electron switch as well, before this probe creates any synthetic designs.
  const expectedUserData =
    process.env.MOLLY_ELECTRON_USER_DATA_DIR ?? process.env.LODY_ELECTRON_USER_DATA_DIR
  assert.ok(
    process.env.MOLLY_DATA_DIR ?? process.env.LODY_DATA_DIR,
    'Use an isolated MOLLY_DATA_DIR'
  )
  assert.ok(expectedUserData, 'Use an isolated MOLLY_ELECTRON_USER_DATA_DIR')
  assert.equal(app.getPath('userData'), resolve(expectedUserData))
  await mkdir(directory, { recursive: true })
  const dimensions = { width: 913, height: 617 }
  for (const forceEnable of [false, true]) {
    const updater = new AppUpdaterService({
      enabled: shouldConstructUpdaterEnabled({ localPlatform: true, forceEnable })
    })
    updater.start()
    assert.equal(updater.getState().phase, 'disabled')
    assert.deepEqual(await updater.checkForUpdates(), { started: false, error: 'updater_disabled' })
    assert.deepEqual(await updater.quitAndInstall(), { ok: false, error: 'updater_disabled' })
    updater.stop()
  }
  const owner = new BrowserWindow({ width: 1200, height: 800, show: false })
  const association = {
    sessionId: randomUUID(),
    name: 'P1 synthetic design',
    userId: 'local:verification',
    machineId: 'verification',
    createdAt: new Date().toISOString()
  }
  const id = association.sessionId
  const created = await designRequest({ operation: 'create', association, ...dimensions })
  await attachDesign(owner, id, { x: 0, y: 0, width: 1200, height: 800 })
  let view = owner.contentView.children.find(
    (child) => child instanceof WebContentsView
  ) as WebContentsView
  await view.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const timer = setTimeout(() => { observer.disconnect(); reject(Error('Editor not ready')); }, 30000);
    const observer = new MutationObserver(check); observer.observe(document, { childList:true, subtree:true });
    function check() { if (window.molly && document.querySelector('[data-c2a-kind="text"]')) { clearTimeout(timer); observer.disconnect(); resolve(true); } } check();
  })`)
  await view.webContents.executeJavaScript(
    `document.querySelector('[data-c2a-kind="text"]').click(); document.querySelector('[data-c2a-kind="shape"]').click();`
  )
  await saveDesign(id)
  const edited = await designRequest({ operation: 'read', sessionId: id })
  assert.equal(edited.doc.elements.length, 2)
  assert.notEqual(edited.revisionId, created.revisionId)
  const fontEvidence = await view.webContents.executeJavaScript(`(async () => ({
    loaded: (await document.fonts.load('16px Inter')).length > 0,
    boldItalicLoaded: (await document.fonts.load('italic 700 16px Inter')).length > 0,
    defaultRendered: Array.from(document.querySelectorAll('[data-el-id] [style]'))
      .some(node => getComputedStyle(node).fontFamily.replaceAll('"', '') === 'Inter')
  }))()`)
  assert.deepEqual(fontEvidence, { loaded: true, boldItalicLoaded: true, defaultRendered: true })
  await writeFile(join(directory, 'default-font.json'), JSON.stringify(fontEvidence, null, 2))
  await view.webContents.executeJavaScript('window.bento.undo()')
  await saveDesign(id)
  assert.equal((await designRequest({ operation: 'read', sessionId: id })).doc.elements.length, 1)
  hideDesign(id)
  await attachDesign(owner, id, { x: 0, y: 0, width: 1200, height: 800 })
  await view.webContents.executeJavaScript('window.bento.redo()')
  await saveDesign(id)
  assert.equal((await designRequest({ operation: 'read', sessionId: id })).doc.elements.length, 2)
  const beforeCommit = await designRequest({ operation: 'read', sessionId: id })
  await designRequest({
    operation: 'save',
    sessionId: id,
    baseRevisionId: beforeCommit.revisionId,
    content: {
      doc: { ...beforeCommit.doc, background: { type: 'solid', color: '#FDF3E3' } },
      assets: beforeCommit.assets
    }
  })
  await syncDesignCanvasFromStore(id)
  view = owner.contentView.children.find(
    (child) => child instanceof WebContentsView
  ) as WebContentsView
  await view.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const timer = setTimeout(() => { observer.disconnect(); reject(Error('Editor not ready after commit reload')); }, 30000);
    const observer = new MutationObserver(check); observer.observe(document, { childList:true, subtree:true });
    function check() { if (window.molly && window.bento?.doc) { clearTimeout(timer); observer.disconnect(); resolve(true); } } check();
  })`)
  assert.deepEqual(
    JSON.parse(await view.webContents.executeJavaScript('window.bento.visual.snapshot()'))
      .background,
    { type: 'solid', color: '#FDF3E3' }
  )
  const beforeConflict = await designRequest({ operation: 'read', sessionId: id })
  await designRequest({
    operation: 'save',
    sessionId: id,
    baseRevisionId: beforeConflict.revisionId,
    content: {
      doc: { ...beforeConflict.doc, background: { type: 'solid', color: '#00000000' } },
      assets: beforeConflict.assets
    }
  })
  await view.webContents.executeJavaScript(
    `document.querySelector('[data-c2a-kind="shape"]').click()`
  )
  await assert.rejects(saveDesign(id), /DESIGN_CONFLICT/)
  const showMessageBox = dialog.showMessageBox
  let saveWarning = ''
  // Simulate the explicit Keep editing choice, using the real leave/quit path.
  dialog.showMessageBox = (async (_owner: unknown, options: { message: string }) => {
    saveWarning = options.message
    return { response: 0, checkboxChecked: false }
  }) as typeof dialog.showMessageBox
  try {
    assert.equal(await prepareDesignQuit(), false)
    assert.match(saveWarning, /This canvas is not saved/)
    assert.equal(view.webContents.isDestroyed(), false)
    assert.equal(await view.webContents.executeJavaScript('document.body.inert'), false)
  } finally {
    dialog.showMessageBox = showMessageBox
  }
  const copy = await copyDesign(id, {
    ...association,
    sessionId: randomUUID(),
    name: 'Independent copy'
  })
  assert.equal(copy.doc.elements.length, 3)
  await finishDesignCopy(id, copy.association.sessionId)
  let original = await designRequest({ operation: 'read', sessionId: id })
  assert.equal(original.doc.elements.length, 2)
  assert.deepEqual(original.doc.background, { type: 'solid', color: '#00000000' })
  await attachDesign(owner, id, { x: 0, y: 0, width: 1200, height: 800 })
  const reopenedView = owner.contentView.children.find(
    (child) => child instanceof WebContentsView
  ) as WebContentsView
  await saveDesign(id)
  await reopenedView.webContents.executeJavaScript('window.bento.undo()')
  assert.deepEqual(
    JSON.parse(await reopenedView.webContents.executeJavaScript('window.bento.visual.snapshot()')),
    original.doc
  )
  hideDesign(id, randomUUID())
  assert.equal(reopenedView.getVisible(), true, 'A stale host cannot hide the active editor')
  for (const format of ['png', 'jpeg'] as const) {
    const bytes = await renderSavedDesign(original, format)
    const image = nativeImage.createFromBuffer(bytes)
    assert.deepEqual(image.getSize(), dimensions)
    const pixel = image.toBitmap().subarray(0, 4)
    if (format === 'png') assert.equal(pixel[3], 0)
    else assert.ok(pixel[0] > 250 && pixel[1] > 250 && pixel[2] > 250)
    await writeFile(join(directory, 'design.' + format), bytes)
  }
  await verifySourcePreview(owner, id, reopenedView, directory)
  original = await designRequest({ operation: 'read', sessionId: id })
  // Invalid writes must reject and leave the confirmed drawing intact.
  await assert.rejects(
    designRequest({
      operation: 'save',
      sessionId: id,
      baseRevisionId: original.revisionId,
      content: {
        doc: { ...original.doc, canvas: { width: 0, height: 617 } },
        assets: original.assets
      }
    })
  )
  await assert.rejects(
    designRequest({
      operation: 'save',
      sessionId: id,
      baseRevisionId: original.revisionId,
      content: {
        doc: {
          ...original.doc,
          fonts: [{ family: 'Missing verification font', src: 'asset:' + 'a'.repeat(64) }]
        },
        assets: original.assets
      }
    })
  )
  assert.deepEqual(await designRequest({ operation: 'read', sessionId: id }), original)
  // Explicit synthetic active state keeps three different dirty documents intact.
  const secondHost = randomUUID()
  const thirdHost = randomUUID()
  const secondOwner = new BrowserWindow({ width: 1200, height: 800, show: false })
  const thirdOwner = new BrowserWindow({ width: 1200, height: 800, show: false })
  await attachDesign(secondOwner, id, { x: 0, y: 0, width: 1200, height: 800 }, secondHost)
  await attachDesign(thirdOwner, id, { x: 0, y: 0, width: 1200, height: 800 }, thirdHost)
  const secondView = secondOwner.contentView.children.find(
    (child) => child instanceof WebContentsView
  ) as WebContentsView
  const thirdView = thirdOwner.contentView.children.find(
    (child) => child instanceof WebContentsView
  ) as WebContentsView
  for (const [index, target] of [reopenedView, secondView, thirdView].entries()) {
    await target.webContents.executeJavaScript(`
      for (let i = 0; i < ${index + 1}; i++) document.querySelector('[data-c2a-kind="shape"]').click();
      window.molly.setReadonly(true);
    `)
  }
  await designCanvasAccess.update([{ artworkId: id, turnId: randomUUID(), preparing: false }])
  const firstDirty = await reopenedView.webContents.executeJavaScript(
    'window.bento.visual.snapshot()'
  )
  const thirdDirty = await thirdView.webContents.executeJavaScript('window.bento.visual.snapshot()')
  await assert.rejects(
    copyDesign(id, { ...association, sessionId: randomUUID() }),
    /specific canvas instance/
  )
  const selectedCopy = await copyDesign(
    id,
    {
      ...association,
      sessionId: randomUUID(),
      name: 'Selected second instance'
    },
    secondHost
  )
  assert.equal(selectedCopy.doc.elements.length, original.doc.elements.length + 2)
  const secondClosed = new Promise<void>((confirmClosed) =>
    secondView.webContents.once('destroyed', () => confirmClosed())
  )
  await finishDesignCopy(id, selectedCopy.association.sessionId, secondHost)
  await secondClosed
  assert.equal(secondView.webContents.isDestroyed(), true)
  assert.equal(
    await reopenedView.webContents.executeJavaScript('window.bento.visual.snapshot()'),
    firstDirty
  )
  assert.equal(
    await thirdView.webContents.executeJavaScript('window.bento.visual.snapshot()'),
    thirdDirty
  )
  dialog.showMessageBox = (async () => ({
    response: 2,
    checkboxChecked: false
  })) as typeof dialog.showMessageBox
  try {
    const firstClosed = new Promise<void>((confirmClosed) =>
      reopenedView.webContents.once('destroyed', () => confirmClosed())
    )
    assert.equal(await leaveDesign(id, id), true)
    await firstClosed
    assert.equal(reopenedView.webContents.isDestroyed(), true)
    assert.equal(
      await thirdView.webContents.executeJavaScript('window.bento.visual.snapshot()'),
      thirdDirty
    )
    assert.equal(
      (await thirdView.webContents.executeJavaScript('window.molly.state()')).dirty,
      true
    )
  } finally {
    dialog.showMessageBox = showMessageBox
  }
  destroyDesign(id)
  secondOwner.destroy()
  thirdOwner.destroy()
  await designCanvasAccess.update([])
  await designRequest({ operation: 'acknowledge', sessionId: selectedCopy.association.sessionId })
  await designRequest({ operation: 'acknowledge', sessionId: id })
  await designRequest({ operation: 'acknowledge', sessionId: copy.association.sessionId })
  destroyDesign(id)
  await prepareDesignQuit()
  owner.destroy()
  await writeFile(
    join(directory, 'result.json'),
    JSON.stringify(
      {
        status: 'passed',
        packaged: app.isPackaged,
        electron: process.versions.electron,
        chromium: process.versions.chrome,
        platform: process.platform,
        arch: process.arch,
        appName: app.getName(),
        version: app.getVersion(),
        dimensions,
        isolatedData: true,
        crossProductUpdaterDisabled: true,
        invalidDocumentPreserved: true,
        missingFontAssetPreserved: true,
        create: true,
        edit: true,
        undoRedoAcrossHide: true,
        reopenWithoutUndo: true,
        staleHostIgnored: true,
        commitReloadsOpenCanvas: true,
        conflictPreserved: true,
        quitSaveFailureKeepsEditor: true,
        independentCopy: true,
        multiInstanceCopyAndDiscardPreserveOtherDrafts: true,
        syntheticKnownIdleContext: true,
        pngTransparency: true,
        jpegWhite: true
      },
      null,
      2
    ) + '\n'
  )
}
