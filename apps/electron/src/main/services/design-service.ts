import { prepareDesignFrame } from './design-frame'
import { rememberDesignViewport, restoreDesignViewport } from './design-viewport'
import {
  DesignElementReferenceSchema,
  validateDesignElementReferences
} from '@molly/shared/design-element-reference'
import {
  DESIGN_SELECTION_BODY_LIMIT,
  DesignCanvasCommandResultSchema,
  DesignCanvasCommandSchema,
  DesignSelectionSummarySchema,
  DesignToolbarRequestSchema,
  DesignToolbarPresentationSchema,
  type DesignCanvasCommandResult,
  type DesignSelectionSummary
} from '@molly/shared/design-selection-commands'
import { isDeepStrictEqual } from 'node:util'
import {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  dialog,
  nativeImage,
  type NativeImage
} from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { readFile, open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { DesignWorker, quitDesignWorker } from './design-worker'
import type { DesignPayload, DesignRequest } from '../../../../cli/src/design/store'
import type { DesignHistoryRequest, DesignVersion } from '../../../../cli/src/design/history'
import { openDesignCanvasNeedsReload, selectCanvasInstance } from './design-canvas-sync-core'
import { DesignCanvasAccess, type CanvasInstance } from './design-canvas-access'
import { drainRelevantLoads } from './design-leave-drain-core'
import { waitForCanvasReady } from './design-canvas-ready-core'

/** Historical candidate files are read back through the existing design worker channel; new candidate production is retired. */
type DesignCandidateRequest = { sessionId: string; candidateId: string }

const resources = () =>
  app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked/resources')
    : join(app.getAppPath(), 'resources')
type RecordEntry = {
  artworkId: string
  access: CanvasInstance
  view: WebContentsView
  owner: BrowserWindow
  dispose(): void
  revisionId: string
}
export const designCanvasAccess = new DesignCanvasAccess()
export function notifyDesignState(artworkId?: string) {
  for (const window of BrowserWindow.getAllWindows())
    if (!window.isDestroyed()) window.webContents.send('design.state', { artworkId })
}
export async function readDesignCanvasState(id: string) {
  await queryCanvasState?.().catch(() => {})
  const current = await designRequest({ operation: 'read', sessionId: id })
  let changed = true
  if (current.editing) {
    const base = await designRequest({
      operation: 'history-read',
      sessionId: id,
      commitId: current.editing.baseVersionId
    })
    changed = !isDeepStrictEqual(
      { doc: current.doc, assets: current.assets },
      { doc: base.doc, assets: base.assets }
    )
  }
  return {
    ...designCanvasAccess.state(id),
    revisionId: current.revisionId,
    baseVersionId: current.editing?.baseVersionId,
    changed
  }
}
let queryCanvasState: (() => Promise<void>) | undefined
export function setDesignCanvasStateQuery(query: () => Promise<void>) {
  queryCanvasState = query
}
export async function prepareDesignUpdate(): Promise<() => Promise<void>> {
  if (!queryCanvasState) throw Error('Reconnect the Molly background service before updating')
  return designCanvasAccess.prepareApplicationUpdate(queryCanvasState)
}
const records = new Map<string, RecordEntry>()
export const rememberCurrentDesignViewport = (hostId: string) => {
  const record = records.get(hostId)
  return record && rememberDesignViewport(hostId, record.view)
}
export const currentDesignBounds = (hostId: string) => records.get(hostId)?.view.getBounds()
export const isDesignVisible = (hostId: string) => records.get(hostId)?.view.getVisible() ?? false
// Last non-empty selection summary per host, mirrored from the canvas's own
// reports. A hidden-but-alive canvas keeps its document (and selection) across
// renderer remounts while no new report fires, so the shell reseeds its
// composer selection from this cache after reattach. Entries die with the record:
// every path that recreates the document (attach/restore/reload/disconnect)
// goes through record creation or destroyDesignInstance.
const lastSelectionSummaries = new Map<string, DesignSelectionSummary>()
const recordsFor = (id: string) => [...records.values()].filter((record) => record.artworkId === id)
const loading = new Map<string, Promise<RecordEntry>>()
const syncing = new Map<string, Promise<void>>()
const hosts = new Map<string, string>()
const designWorker = new DesignWorker(() =>
  spawn(process.execPath, [join(resources(), 'cli/design.js')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
)

export const shutdownDesignWorker = () => designWorker.close()

export function designRequest<T = DesignPayload>(
  request:
    | DesignRequest
    | DesignHistoryRequest
    | {
        operation: 'source-preview'
        workdir: string
        previousSourceIdentity?: string
        live?: { sessionId: string; sourceTurnId: string }
      }
    | { operation: 'pending' }
    | { operation: 'acknowledge'; sessionId: string }
    | ({ operation: 'candidate-file' } & DesignCandidateRequest),
  beforeSend?: () => void
): Promise<T> {
  return designWorker.request<T>(request, beforeSend)
}

export async function surface(
  payload: DesignPayload,
  editable: boolean,
  hostId?: string,
  preview = false
) {
  const shell = await readFile(join(resources(), 'design/editor.html'))
  const manifest = JSON.parse(await readFile(join(resources(), 'design/build.json'), 'utf8'))
  if (createHash('sha256').update(shell).digest('hex') !== manifest.shellSha256)
    throw Error('Bento resource integrity failure')
  const isolated = session.fromPartition('molly-canvas-' + randomUUID())
  const host = 'canvas-' + randomUUID()
  const origin = 'molly-design://' + host
  const id = payload.association.sessionId
  isolated.setPermissionRequestHandler((_c, _p, done) => done(false))
  isolated.setPermissionCheckHandler(() => false)
  isolated.webRequest.onBeforeRequest((details, done) =>
    done({ cancel: !details.url.startsWith(origin + '/') && !/^(data|blob):/.test(details.url) })
  )
  await isolated.protocol.handle('molly-design', async (request) => {
    const url = new URL(request.url)
    const headers = {
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'self' data:; worker-src blob:; base-uri 'none'; form-action 'none'"
    }
    if (url.protocol !== 'molly-design:' || url.host !== host)
      return new Response(null, { status: 403 })
    if (request.method === 'GET' && url.pathname === '/editor.html')
      return new Response(shell, { headers: { ...headers, 'Content-Type': 'text/html' } })
    if (request.method === 'GET' && url.pathname === '/ws/' + id)
      return Response.json(payload, { headers })
    if (editable && request.method === 'POST' && url.pathname === '/ws/' + id + '/save') {
      try {
        const text = await request.text()
        if (text.length > 64 * 1024 * 1024) throw Error('Design exceeds 64 MiB')
        const input = JSON.parse(text)
        const saved = await designCanvasAccess.write(id, input.writePermit, () =>
          designRequest({
            operation: 'save',
            sessionId: id,
            baseRevisionId: input.baseRevisionId,
            content: { doc: input.doc, assets: input.assets }
          })
        )
        payload = saved
        const record = hostId ? records.get(hostId) : undefined
        if (record) record.revisionId = saved.revisionId
        notifyDesignState(id)
        return Response.json({ ok: true, revisionId: saved.revisionId }, { headers })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return Response.json(
          { ok: false, code: message, error: message },
          { status: message === 'DESIGN_CONFLICT' ? 409 : 400, headers }
        )
      }
    }
    if (
      editable &&
      hostId &&
      request.method === 'POST' &&
      url.pathname === '/ws/' + id + '/toolbar'
    ) {
      try {
        const text = await request.text()
        if (text.length > DESIGN_SELECTION_BODY_LIMIT) throw Error('Toolbar request too large')
        const input = DesignToolbarRequestSchema.parse(JSON.parse(text))
        const record = records.get(hostId)
        const assertCurrent = () => {
          if (
            !record ||
            records.get(hostId) !== record ||
            record.view.webContents.session !== isolated ||
            hosts.get(hostId) !== id
          )
            throw Error('Current artwork is not visible')
        }
        assertCurrent()
        if (input.type === 'command') {
          const result = await applyDesignCommand(
            id,
            hostId,
            input.command,
            input.selectionEpoch,
            assertCurrent
          )
          return Response.json(result, { headers })
        }
        const reference = await getDesignSelection(
          id,
          hostId,
          input.action === 'edit' || input.action === 'generate' ? 'image' : undefined,
          { selectionEpoch: input.selectionEpoch, assertCurrent }
        )
        assertCurrent()
        record!.owner.webContents.send('design.selectionAction', {
          hostId,
          action: input.action,
          reference
        })
        return Response.json({ ok: true }, { headers })
      } catch (error) {
        return Response.json(
          { ok: false, error: String(error).slice(0, 500) },
          { status: 400, headers }
        )
      }
    }
    if (editable && request.method === 'POST' && url.pathname === '/ws/' + id + '/selection') {
      // Display-only hint for the shell's composer selection. Element references
      // still originate exclusively from the validated selection capture.
      try {
        const text = await request.text()
        if (text.length > DESIGN_SELECTION_BODY_LIMIT) throw Error('Selection report too large')
        const summary = DesignSelectionSummarySchema.parse(JSON.parse(text))
        if (hostId && records.get(hostId)?.view.webContents.session !== isolated)
          throw Error('Retired canvas')
        if (hostId) {
          if (summary.count > 0) lastSelectionSummaries.set(hostId, summary)
          else lastSelectionSummaries.delete(hostId)
        }
        const record = hostId ? records.get(hostId) : undefined
        if (record && !record.owner.isDestroyed())
          record.owner.webContents.send('design.selection', { hostId, ...summary })
        return Response.json({ ok: true }, { headers })
      } catch {
        return Response.json({ ok: false }, { status: 400, headers })
      }
    }
    return new Response(null, { status: 403 })
  })
  return {
    isolated,
    url: origin + '/editor.html?ws=' + id + (editable || preview ? '&autosave=1&molly=1' : ''),
    dispose: () => isolated.protocol.unhandle('molly-design')
  }
}

const DESIGN_CANVAS_READY_TIMEOUT_MS = 30_000

/**
 * Wait for Bento's public product API and its real font-backed ready state.
 * The event is emitted by the product session after it publishes all generic
 * state/snapshot/flush/readonly methods; the immediate check closes the race
 * where readiness happened before this listener was installed.
 */
async function waitForDesignCanvasReady(webContents: Electron.WebContents): Promise<void> {
  await waitForCanvasReady(
    () =>
      webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const event = 'molly:ready';
    const cleanup = () => {
      window.removeEventListener(event, check);
    };
    const check = () => {
      try {
        const api = window.molly;
        if (!api || typeof api.state !== 'function' || typeof api.snapshot !== 'function' ||
            typeof api.flush !== 'function' || typeof api.setReadonly !== 'function') return;
        if (api.state()?.ready !== true) return;
        cleanup();
        resolve(true);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    window.addEventListener(event, check);
    check();
  })`),
    { timeoutMs: DESIGN_CANVAS_READY_TIMEOUT_MS }
  )
}

export async function attachDesign(
  owner: BrowserWindow,
  id: string,
  bounds: Electron.Rectangle,
  hostId = id,
  reconcile = true
) {
  hosts.set(hostId, id)
  let record = records.get(hostId)
  const needsFrame = !record?.view.getVisible()
  if (!record) {
    // A fresh document starts with no selection; drop any summary a previous
    // view for this host reported.
    lastSelectionSummaries.delete(hostId)
    let opening = loading.get(hostId)
    if (!opening) {
      opening = (async () => {
        const payload = await designRequest({ operation: 'read', sessionId: id })
        const source = await surface(payload, true, hostId)
        const view = new WebContentsView({
          webPreferences: {
            session: source.isolated,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false
          }
        })
        const access: CanvasInstance = {
          artworkId: id,
          setReadonly: async (value, reason) => {
            await view.webContents.executeJavaScript(
              'window.molly.setReadonly(' +
                JSON.stringify(value) +
                ',' +
                JSON.stringify(reason) +
                ')'
            )
          },
          flush: async (permit) => {
            const result = await view.webContents.executeJavaScript(
              'window.molly.flush(' + JSON.stringify(permit) + ')'
            )
            if (!result?.ok) throw Error(result?.error ?? 'Canvas is not ready; edits are retained')
          }
        }
        const entry = {
          artworkId: id,
          access,
          view,
          owner,
          dispose: source.dispose,
          revisionId: payload.revisionId
        }
        records.set(hostId, entry)
        owner.contentView.addChildView(view, 0)
        view.setBounds({
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.max(1, Math.round(bounds.width)),
          height: Math.max(1, Math.round(bounds.height))
        })
        // Loading may outlive a panel close before the record existed.
        view.setVisible(hosts.get(hostId) === id)
        view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        view.webContents.on('will-navigate', (event) => event.preventDefault())
        view.webContents.on('will-redirect', (event) => event.preventDefault())
        view.webContents.on('will-prevent-unload', (event) => event.preventDefault())
        try {
          await view.webContents.loadURL(source.url)
          await waitForDesignCanvasReady(view.webContents)
        } catch (error) {
          destroyDesignInstance(hostId)
          throw error
        }
        await designCanvasAccess.register(access)
        if (!reconcile)
          await access.setReadonly(designCanvasAccess.isReadonly(id), '只读 / Read-only')
        try {
          if (reconcile) await queryCanvasState?.()
        } catch {
          await designCanvasAccess.disconnected()
        }
        installCloseGuard(owner)
        return entry
      })()
      loading.set(hostId, opening)
      void opening.finally(() => loading.delete(hostId)).catch(() => {})
    }
    record = await opening
  }
  if (hosts.get(hostId) !== id) return
  if (record.owner !== owner) throw Error('Design owner mismatch')
  const [width, height] = owner.getContentSize()
  const x = Math.max(0, Math.round(bounds.x)),
    y = Math.max(0, Math.round(bounds.y))
  record.view.setBounds({
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.round(bounds.width))),
    height: Math.max(1, Math.min(height - y, Math.round(bounds.height)))
  })
  try {
    await record.view.webContents.executeJavaScript('document.body.inert = false')
    // Restoring layout can reveal a hidden view; do not revive a cancelled attach.
    if (records.get(hostId) !== record || hosts.get(hostId) !== id) return
    await restoreDesignViewport(hostId, record.view)
    if (needsFrame) await prepareDesignFrame(record.view, owner)
  } catch (error) {
    if (records.get(hostId) === record && hosts.get(hostId) === id) {
      if (needsFrame) record.view.setVisible(false)
      throw error
    }
    return
  }
  if (records.get(hostId) === record) record.view.setVisible(hosts.get(hostId) === id)
}
export function hideDesign(id: string, hostId?: string) {
  // Cancel visibility intent even while the first native instance is still loading.
  for (const [key, artworkId] of hosts)
    if (artworkId === id && (hostId === undefined || hostId === key)) hosts.delete(key)
  for (const [key, record] of records) {
    if (record.artworkId !== id || (hostId && key !== hostId)) continue
    hosts.delete(key)
    void rememberDesignViewport(key, record.view)
    record.view.setVisible(false)
  }
}
function destroyDesignInstance(key: string) {
  const record = records.get(key)
  if (!record) return
  records.delete(key)
  hosts.delete(key)
  lastSelectionSummaries.delete(key)
  designCanvasAccess.unregister(record.access)
  if (!record.owner.isDestroyed()) record.owner.contentView.removeChildView(record.view)
  if (!record.view.webContents.isDestroyed())
    record.view.webContents.close({ waitForBeforeUnload: false })
  record.dispose()
}
export function destroyDesign(id: string) {
  for (const [key, record] of records) if (record.artworkId === id) destroyDesignInstance(key)
}
/**
 * Selection summary a remounted shell can reseed its composer selection from. Returns null
 * unless the canvas view that reported it is still alive, so a reseed can
 * never present a selection the document no longer holds.
 */
export function currentDesignSelection(hostId: string): DesignSelectionSummary | null {
  if (!records.has(hostId)) return null
  return lastSelectionSummaries.get(hostId) ?? null
}
export async function saveDesign(id: string) {
  if (designCanvasAccess.isReadonly(id)) throw Error('Canvas is read-only; edits are retained')
  await designCanvasAccess.prepareForSend(id)
}
/** Version actions share the canonical replacement gate and flush every instance. */
export async function createDesignVersion(id: string): Promise<DesignVersion> {
  await queryCanvasState?.()
  return designCanvasAccess.replaceAfterFlush(id, async (assertIdle) => {
    const current = await designRequest({ operation: 'read', sessionId: id })
    assertIdle()
    const version = await designRequest<DesignVersion>(
      { operation: 'history-create', sessionId: id, baseRevisionId: current.revisionId },
      assertIdle
    )
    const saved = await designRequest({ operation: 'read', sessionId: id })
    // Metadata-only revision change preserves the native document and undo stack.
    for (const record of recordsFor(id)) {
      if (record.revisionId === saved.revisionId) continue
      const snapshot = await record.view.webContents.executeJavaScript('window.molly.snapshot()')
      if (
        !isDeepStrictEqual(
          { doc: snapshot.doc, assets: snapshot.assets },
          { doc: saved.doc, assets: saved.assets }
        )
      ) {
        await syncDesignCanvasFromStore(id)
        break
      }
      await record.view.webContents.executeJavaScript(
        `window.molly.rebase(${JSON.stringify(record.revisionId)},${JSON.stringify(saved.revisionId)})`
      )
      record.revisionId = saved.revisionId
    }
    notifyDesignState(id)
    return version
  })
}

export async function restoreDesignVersion(
  id: string,
  commitId: string
): Promise<{ revisionId: string; reloadError?: string }> {
  await queryCanvasState?.()
  let saved: DesignPayload | undefined
  try {
    return await designCanvasAccess.replaceAfterFlush(id, async (assertIdle) => {
      const current = await designRequest({ operation: 'read', sessionId: id })
      assertIdle()
      const result = await designRequest<DesignPayload>(
        {
          operation: 'history-restore',
          sessionId: id,
          commitId,
          baseRevisionId: current.revisionId
        },
        assertIdle
      )
      saved = result
      await syncDesignCanvasFromStore(id)
      notifyDesignState(id)
      return { revisionId: result.revisionId }
    })
  } catch (error) {
    if (saved) return { revisionId: saved.revisionId, reloadError: String(error) }
    throw error
  }
}

/** Capture only the visible canonical editor, after its ordinary save finishes. */
export async function getDesignSelection(
  id: string,
  hostId: string,
  kind?: 'image',
  {
    selectionEpoch,
    assertCurrent,
    onlySaved = false
  }: { selectionEpoch?: number; assertCurrent?: () => void; onlySaved?: boolean } = {}
) {
  await queryCanvasState?.()
  if (designCanvasAccess.isReadonly(id))
    throw Error('Wait for execution to finish before referencing elements')
  const record = records.get(hostId)
  if (!record || record.artworkId !== id || hosts.get(hostId) !== id)
    throw Error('Current artwork is not visible')
  assertCurrent?.()
  const selection: unknown = await record.view.webContents.executeJavaScript(
    `window.molly.selection(${JSON.stringify(selectionEpoch)})`
  )
  if (!Array.isArray(selection) || selection.length === 0)
    throw Error('Select an element in the current artwork first')
  // A clean, saved selection needs no mutation barrier. Passive composer mirroring
  // must not briefly freeze the native toolbar and dismiss an open property popup.
  // Explicit actions flush dirty siblings. Passive mirrors wait for the ordinary
  // autosave report instead of interrupting an in-progress toolbar interaction.
  const states = await Promise.all(
    recordsFor(id).map((entry) => entry.view.webContents.executeJavaScript('window.molly.state()'))
  )
  if (states.some((state) => !state || state.dirty || state.saving || state.composing)) {
    if (onlySaved) throw Error('Selection will be mirrored after autosave')
    await saveDesign(id)
  }
  if (
    designCanvasAccess.isReadonly(id) ||
    records.get(hostId) !== record ||
    hosts.get(hostId) !== id
  )
    throw Error('Artwork changed while selecting; select the current elements again')
  const state = await record.view.webContents.executeJavaScript('window.molly.state()')
  const saved = await designRequest({ operation: 'read', sessionId: id })
  const reference = DesignElementReferenceSchema.parse({
    artworkId: id,
    baselineRevisionId: state?.revisionId,
    elementIds: selection.map((element: unknown) =>
      typeof element === 'object' && element !== null && 'id' in element ? element.id : undefined
    )
  })
  validateDesignElementReferences([reference], id, saved)
  if (
    kind === 'image' &&
    reference.elementIds.some(
      (elementId) =>
        saved.doc.elements.find((element: { id: string; kind: string }) => element.id === elementId)
          ?.kind !== 'image'
    )
  )
    throw Error('Select only images in the current artwork for this action')
  if (
    designCanvasAccess.isReadonly(id) ||
    records.get(hostId) !== record ||
    hosts.get(hostId) !== id
  )
    throw Error('Artwork changed while selecting; select the current elements again')
  assertCurrent?.()
  if (selectionEpoch !== undefined)
    await record.view.webContents.executeJavaScript(`window.molly.selection(${selectionEpoch})`)
  assertCurrent?.()
  if (designCanvasAccess.isReadonly(id)) throw Error('Canvas is read-only')
  return reference
}

/**
 * Shell-originated property edits on the visible canonical selection, mapped
 * in-canvas to one kernel batch (one undo step) through the generic bridge.
 */
export async function applyDesignCommand(
  id: string,
  hostId: string,
  input: unknown,
  selectionEpoch?: number,
  assertCurrent?: () => void
): Promise<DesignCanvasCommandResult> {
  const command = DesignCanvasCommandSchema.parse(input)
  await queryCanvasState?.()
  if (designCanvasAccess.isReadonly(id)) throw Error('Canvas is read-only')
  const record = records.get(hostId)
  if (!record || record.artworkId !== id || hosts.get(hostId) !== id)
    throw Error('Current artwork is not visible')
  assertCurrent?.()
  const result: unknown = await record.view.webContents.executeJavaScript(
    `window.molly?.applyCommands ? window.molly.applyCommands(${JSON.stringify(command)}, ${JSON.stringify(selectionEpoch)}) : { ok: false, error: 'Canvas does not support commands' }`
  )
  return DesignCanvasCommandResultSchema.parse(result)
}

export async function saveDesignForDispatch(id: string) {
  await queryCanvasState?.()
  await designCanvasAccess.prepareForSend(id)
}
/** Resolve one historical file; the existing local file capability serves its bytes. */
export async function readDesignCandidateFile(
  id: string,
  candidateId: string
): Promise<{ path: string }> {
  return await designRequest<{ path: string }>({
    operation: 'candidate-file',
    sessionId: id,
    candidateId
  })
}

/**
 * P2-A2: if this artwork's editor is open on a superseded revision, tear it
 * down and re-create it from the store.
 *
 * The daemon commits in-process after a turn; this process's editor does not
 * see that write. The renderer calls here when session history records a
 * committed outcome. A canvas that was never attached this run is left
 * untouched — the next attach reads the store. An editor whose loaded
 * revision already matches is left untouched, so a historical committed receipt
 * on first mount or a later manual save does not
 * destroy undo. Two callers are serialized per artwork so a second signal
 * cannot tear down the reload of the first.
 *
 * Any exceptional dirty/composing/saving instance blocks reloading all instances;
 * no draft is discarded to make the saved revision visible. A canvas the user does not have on screen
 * stays closed: destroy is enough, and the next attach reads the store.
 */
export async function syncDesignCanvasFromStore(id: string): Promise<void> {
  const previous = syncing.get(id) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(() => syncDesignCanvasFromStoreOnce(id))
  syncing.set(id, next)
  try {
    await next
  } finally {
    if (syncing.get(id) === next) syncing.delete(id)
  }
}

async function syncDesignCanvasFromStoreOnce(id: string): Promise<void> {
  const saved = await designRequest({ operation: 'read', sessionId: id })
  if (
    recordsFor(id).some((record) =>
      openDesignCanvasNeedsReload(record.revisionId, saved.revisionId)
    )
  )
    await reloadDesignCanvas(id)
}

async function reloadDesignCanvas(id: string) {
  const entries = [...records].filter(([, record]) => record.artworkId === id)
  // Check every instance before destroying any: exceptional dirty content is never discarded.
  for (const [, record] of entries) {
    const state = await record.view.webContents.executeJavaScript('window.molly?.state()')
    if (!state || state.dirty || state.saving || state.composing)
      throw Error('Canvas has unsaved edits; preserve or save them before reloading')
  }
  for (const [key, record] of entries) {
    const visible = hosts.has(key)
    const bounds = record.view.getBounds()
    await rememberDesignViewport(key, record.view)
    destroyDesignInstance(key)
    if (visible) await attachDesign(record.owner, id, bounds, key, false)
  }
}

export async function leaveDesign(id: string, hostId?: string): Promise<boolean> {
  // An attach that is still loading already owns a record whose webContents
  // has no window.molly yet. Reading its state now misreports a clean loading
  // canvas as unsaved edits, so drain relevant loads first (see
  // `design-leave-drain-core.ts` for the selection semantics and its tests).
  await drainRelevantLoads(loading, hosts, id, hostId)
  const entries = [...records].filter(
    ([key, record]) => record.artworkId === id && (hostId === undefined || hostId === key)
  )
  for (const [key, record] of entries) {
    try {
      if (!designCanvasAccess.isReadonly(id)) await saveDesign(id)
      const state = await record.view.webContents.executeJavaScript('window.molly?.state()')
      if (!state || state.dirty || state.saving || state.composing)
        throw Error('Canvas still has unsaved edits')
    } catch (error) {
      // A different instance's failed flush is not permission to discard this one.
      const state = await record.view.webContents.executeJavaScript('window.molly?.state()')
      if (state && !state.dirty && !state.saving && !state.composing) continue
      const answer = await dialog.showMessageBox(record.owner, {
        type: 'warning',
        message: '此画布尚未保存 / This canvas is not saved',
        detail: String(error),
        buttons: [
          '返回编辑 / Keep editing',
          '重试 / Retry',
          '放弃此画布修改 / Discard this canvas edits'
        ],
        defaultId: 0,
        cancelId: 0
      })
      if (answer.response === 1) {
        if (!(await leaveDesign(id, key))) return false
      } else if (answer.response === 2) destroyDesignInstance(key)
      else {
        await unfreezeDesigns()
        return false
      }
    }
  }
  return true
}
export async function copyDesign(
  id: string,
  association: Extract<DesignRequest, { operation: 'create' }>['association'],
  hostId?: string
) {
  const record = selectCanvasInstance(records, id, hostId)?.[1]
  if (!record) throw Error('Canvas is not open')
  const copy = await record.view.webContents.executeJavaScript('window.molly.snapshot()')
  return designRequest({
    operation: 'create',
    association,
    width: copy.doc.canvas.width,
    height: copy.doc.canvas.height,
    copy
  })
}
const guarded = new WeakSet<BrowserWindow>()
function installCloseGuard(owner: BrowserWindow) {
  if (guarded.has(owner)) return
  guarded.add(owner)
  let leaving = false
  let allowed = false
  owner.on('show', () => {
    void unfreezeDesigns()
  })
  owner.once('closed', () => {
    for (const [key, record] of records) if (record.owner === owner) destroyDesignInstance(key)
  })
  owner.prependListener('close', (event) => {
    if (allowed) {
      allowed = false
      return
    }
    if (!records.size) return
    event.preventDefault()
    if (leaving) return
    leaving = true
    void (async () => {
      for (const [key, record] of records)
        if (record.owner === owner && !(await leaveDesign(record.artworkId, key))) return
      allowed = true
      owner.close()
    })()
      .catch((error) => dialog.showErrorBox('Molly', String(error)))
      .finally(() => {
        leaving = false
      })
  })
}

export async function exportDesign(id: string, format: 'png' | 'jpeg', title: string) {
  if (!designCanvasAccess.isReadonly(id)) await saveDesign(id)
  const payload = await designRequest({ operation: 'read', sessionId: id })
  const target = await dialog.showSaveDialog({
    defaultPath:
      // oxlint-disable-next-line no-control-regex -- File names cannot contain control characters.
      title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + (format === 'png' ? '.png' : '.jpg'),
    filters: [{ name: format.toUpperCase(), extensions: [format === 'png' ? 'png' : 'jpg'] }]
  })
  if (target.canceled || !target.filePath) return
  const bytes = await renderSavedDesign(payload, format)
  const temporary = target.filePath + '.' + randomUUID() + '.tmp'
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(bytes)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, target.filePath)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

/** Upper bound for Chromium to force-redraw and copy the prepared design surface. */
const RENDER_CAPTURE_VERIFY_TIMEOUT_MS = 30_000

/**
 * Capture the prepared render-only surface through Chromium's screenshot path.
 * `Page.captureScreenshot` force-redraws before copying the compositor surface,
 * unlike Electron's OSR `invalidate()`, which can recomposite cached backing.
 * The protocol always returns PNG so transparency survives until the existing
 * logical resize and PNG/JPEG encoding step.
 */
async function captureVerifiedArtwork(
  window: BrowserWindow,
  format: 'png' | 'jpeg'
): Promise<NativeImage> {
  const client = window.webContents.debugger
  let timer: NodeJS.Timeout | undefined
  let attached = false
  try {
    client.attach('1.3')
    attached = true
    const capture = (async () => {
      await client.sendCommand('Emulation.setDefaultBackgroundColorOverride', {
        color: format === 'png' ? { r: 0, g: 0, b: 0, a: 0 } : { r: 255, g: 255, b: 255, a: 1 }
      })
      return client.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false
      })
    })()
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(Error('Canvas capture did not settle on the saved artwork')),
        RENDER_CAPTURE_VERIFY_TIMEOUT_MS
      )
      timer.unref()
    })
    const response = (await Promise.race([capture, deadline])) as { data?: unknown }
    if (typeof response.data !== 'string') throw Error('Canvas capture returned no PNG data')
    const image = nativeImage.createFromBuffer(Buffer.from(response.data, 'base64'))
    if (image.isEmpty()) throw Error('Canvas capture returned an empty PNG')
    return image
  } finally {
    if (timer) clearTimeout(timer)
    if (attached && client.isAttached()) client.detach()
  }
}

export async function renderSavedDesign(
  payload: DesignPayload,
  format: 'png' | 'jpeg'
): Promise<Buffer> {
  const source = await surface(payload, false)
  const { width, height } = payload.doc.canvas
  const window = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      session: source.isolated,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      offscreen: true
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await window.loadURL(source.url)
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const timer = setTimeout(() => { observer.disconnect(); reject(Error('Canvas rendering timed out')); }, 30000);
      const observer = new MutationObserver(check); observer.observe(document, { childList:true, subtree:true });
      async function check() {
        const stage = document.querySelector('.ed-stage-scale .bento-slide');
        if (!window.bento?.doc || !stage) return;
        observer.disconnect();
        try {
          await document.fonts.ready;
          if ([...document.fonts].some(font => font.status === 'error')) throw Error('Font failed to load');
          await Promise.all([...stage.querySelectorAll('img')].map(image => image.decode()));
          await Promise.all([...stage.querySelectorAll('image')].map(node => { const image = new Image(); image.src = node.getAttribute('href') || node.getAttribute('xlink:href') || ''; return image.decode(); }));
          if (stage.offsetWidth !== ${width} || stage.offsetHeight !== ${height}) throw Error('Canvas dimensions differ');
          document.documentElement.style.cssText = 'margin:0;background:${format === 'jpeg' ? '#fff' : 'transparent'}!important;overflow:hidden';
          document.body.style.cssText = 'margin:0;background:transparent!important;overflow:hidden';
          stage.style.cssText += ';transform:none;position:absolute;left:0;top:0'; stage.inert = true;
          document.body.replaceChildren(stage);
          await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
          clearTimeout(timer); resolve(true);
        } catch(error) { clearTimeout(timer); reject(error); }
      } check();
    })`)
    const image = await captureVerifiedArtwork(window, format)
    const exact = image.resize({ width, height })
    return format === 'png' ? exact.toPNG() : exact.toJPEG(95)
  } finally {
    window.destroy()
    source.dispose()
  }
}

export async function finishDesignCopy(sourceId: string, targetId: string, hostId?: string) {
  const selected = selectCanvasInstance(records, sourceId, hostId)
  if (!selected) return
  const [key, record] = selected
  const current = await record.view.webContents.executeJavaScript('window.molly.snapshot()')
  const saved = await designRequest({ operation: 'read', sessionId: targetId })
  if (!isDeepStrictEqual(current.doc, saved.doc))
    throw Error('Drawing changed during copy; save the newer edits before leaving')
  destroyDesignInstance(key)
}
export async function renameDesign(id: string, name: string) {
  await saveDesign(id)
  const saved = await designRequest({ operation: 'read', sessionId: id })
  const renamed = await designCanvasAccess.write(id, undefined, () =>
    designRequest({
      operation: 'save',
      sessionId: id,
      baseRevisionId: saved.revisionId,
      name,
      content: { doc: saved.doc, assets: saved.assets }
    })
  )
  for (const record of recordsFor(id)) {
    if (record.revisionId !== saved.revisionId) continue
    await record.view.webContents.executeJavaScript(
      'window.molly.rebase(' +
        JSON.stringify(saved.revisionId) +
        ',' +
        JSON.stringify(renamed.revisionId) +
        ')'
    )
    record.revisionId = renamed.revisionId
  }
  await syncDesignCanvasFromStore(id)
  return renamed
}
export async function prepareDesignQuit(): Promise<boolean> {
  return quitDesignWorker(
    designWorker,
    async () => {
      for (const id of new Set([...records.values()].map((entry) => entry.artworkId)))
        if (!(await leaveDesign(id))) return false
      return true
    },
    () => {
      for (const key of [...records.keys()]) destroyDesignInstance(key)
    }
  )
}

async function unfreezeDesigns() {
  await Promise.all(
    [...records.values()].map((record) =>
      record.view.webContents.executeJavaScript('document.body.inert = false').catch(() => {})
    )
  )
}

/** Presentation is ephemeral and belongs to the retained native view. */
export async function presentDesignToolbar(id: string, hostId: string, input: unknown) {
  const presentation = DesignToolbarPresentationSchema.parse(input)
  const record = records.get(hostId)
  if (!record || record.artworkId !== id || hosts.get(hostId) !== id) return
  await record.view.webContents.executeJavaScript(
    `window.molly?.presentToolbar(${JSON.stringify(presentation)})`
  )
}
