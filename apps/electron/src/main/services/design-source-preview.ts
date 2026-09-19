import { prepareDesignFrame } from './design-frame'
import { bindLiveSource, type LiveSource } from './design-live-source'
import { rememberDesignViewport, restoreDesignViewport } from './design-viewport'
import { WebContentsView, type BrowserWindow } from 'electron'
import { lstatSync } from 'node:fs'
import { startWorkspaceFileWatcher, type WorkspaceFileWatcher } from '@loro-dev/ignore'
import { SourceObservation } from './design-source-observation'
import { dirname, relative, resolve } from 'node:path'
import {
  designRequest,
  surface,
  designCanvasAccess,
  hideDesign,
  attachDesign,
  rememberCurrentDesignViewport,
  currentDesignBounds,
  isDesignVisible
} from './design-service'
import type { ObservedPreviewResult } from '../../../../cli/src/design/render-preview'
import { PreviewRequests } from './design-source-preview-core'

type PreviewStatus = {
  status: 'ready' | 'waiting'
  source: string
  sourceIdentity?: string
  error?: string
  retained?: boolean
  automaticError?: string
}
const statuses = new Map<string, PreviewStatus>()
const sources = new Map<
  string,
  {
    observation: SourceObservation
    watcher: WorkspaceFileWatcher
    error?: string
    paths: Set<string>
    close(): void
  }
>()
const subscriptions = new Map<string, string>()
const resolvedSources = new Map<string, string>()
const boundsByHost = new Map<string, Electron.Rectangle>()
const staging = new Map<string, Set<WebContentsView>>()
function release(hostId: string) {
  const source = subscriptions.get(hostId)
  subscriptions.delete(hostId)
  if (!source) return
  const shared = sources.get(source)
  shared?.observation.consumers.delete(hostId)
  if (shared && shared.observation.consumers.size === 0) {
    shared.close()
    sources.delete(source)
  }
}
function notify(hostId: string, status: PreviewStatus) {
  statuses.set(hostId, status)
  const owner = consumers.get(hostId)
  if (owner && !owner.isDestroyed() && !owner.webContents.isDestroyed())
    owner.webContents.send('design.preview', { hostId, ...status })
}
const requests = new PreviewRequests()
const resolutions = new PreviewRequests()
const consumers = new Map<string, BrowserWindow>()
const observedOwners = new WeakSet<BrowserWindow>()
const views = new Map<
  string,
  {
    owner: BrowserWindow
    artworkId: string
    source: string
    sourceIdentity: string
    isCurrent(): boolean
    view: WebContentsView
    dispose(): void
  }
>()

export function hideSourcePreview(hostId: string, cancel = true) {
  if (cancel) {
    requests.cancel(hostId)
    resolutions.cancel(hostId)
    release(hostId)
  }
  boundsByHost.delete(hostId)
  for (const view of staging.get(hostId) ?? []) {
    view.setVisible(false)
    if (cancel && !view.webContents.isDestroyed())
      view.webContents.close({ waitForBeforeUnload: false })
  }
  const view = views.get(hostId)?.view
  if (view) {
    void rememberDesignViewport(hostId, view)
    view.setVisible(false)
  }
}
export function closeSourcePreview(hostId: string) {
  const previous = views.get(hostId)
  const captured = previous && rememberDesignViewport(hostId, previous.view)
  previous?.view.setVisible(false)
  hideSourcePreview(hostId)
  consumers.delete(hostId)
  statuses.delete(hostId)
  resolvedSources.delete(hostId)
  if (!previous) return
  views.delete(hostId)
  // Remove visibility immediately; allow the camera read to finish before disposal.
  void Promise.resolve(captured).finally(() => {
    if (!previous.owner.isDestroyed()) previous.owner.contentView.removeChildView(previous.view)
    if (!previous.view.webContents.isDestroyed())
      previous.view.webContents.close({ waitForBeforeUnload: false })
    previous.dispose()
  })
}

/** Keep the last draft covering the editor until its pixels are ready. */
export async function attachDesignFromPreview(
  owner: BrowserWindow,
  artworkId: string,
  bounds: Electron.Rectangle,
  hostId = artworkId
) {
  const previous = views.get(hostId)
  if (previous && !designCanvasAccess.state(artworkId).turnId)
    void rememberDesignViewport(hostId, previous.view)
  await attachDesign(owner, artworkId, bounds, hostId)
  if (
    views.get(hostId) === previous &&
    isDesignVisible(hostId) &&
    !designCanvasAccess.state(artworkId).turnId
  ) {
    previous?.view.setVisible(false)
    closeSourcePreview(hostId)
  }
}

export async function attachSourcePreview(hostId: string, bounds: Electron.Rectangle) {
  boundsByHost.set(hostId, bounds)
  const current = views.get(hostId)
  if (!current || !requests.visible(hostId) || !current.isCurrent()) return
  current.view.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height))
  })
  const needsFrame = !current.view.getVisible()
  try {
    await rememberCurrentDesignViewport(hostId)
    if (views.get(hostId) !== current || !boundsByHost.has(hostId) || !current.isCurrent()) return
    await restoreDesignViewport(hostId, current.view)
    if (needsFrame) await prepareDesignFrame(current.view, current.owner)
  } catch (error) {
    if (views.get(hostId) === current) throw error
  }
  if (views.get(hostId) === current && boundsByHost.has(hostId) && current.isCurrent()) {
    current.view.setVisible(true)
    current.owner.contentView.addChildView(current.view)
    hideDesign(current.artworkId, hostId)
  }
}

/** Resolve trusted paths before subscribing; reopening always reconciles exact bytes. */
function registerConsumer(owner: BrowserWindow, artworkId: string, hostId: string) {
  if (!observedOwners.has(owner)) {
    observedOwners.add(owner)
    const close = () => {
      for (const [key, window] of consumers) if (window === owner) closeSourcePreview(key)
    }
    owner.once('closed', close)
    owner.webContents.on('render-process-gone', close)
    owner.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame) close()
    })
  }
  const retained = views.get(hostId)
  if (retained && (retained.artworkId !== artworkId || retained.owner !== owner))
    closeSourcePreview(hostId)
  consumers.set(hostId, owner)
}

export async function refreshSourcePreview(
  owner: BrowserWindow,
  artworkId: string,
  hostId: string,
  resolveSource: () => Promise<string | LiveSource>
) {
  registerConsumer(owner, artworkId, hostId)
  let token = resolutions.begin(hostId, artworkId)
  try {
    const resolved = await resolveSource()
    const source = typeof resolved === 'string' ? resolved : resolved.path
    const live = typeof resolved === 'string' ? undefined : resolved.live
    const sourceKey = `${source}\0${live?.turnId ?? ''}`
    if (!resolutions.current(token)) return { status: 'superseded' as const }
    if (resolvedSources.has(hostId) && resolvedSources.get(hostId) !== sourceKey) {
      closeSourcePreview(hostId)
      registerConsumer(owner, artworkId, hostId)
      token = resolutions.begin(hostId, artworkId)
    }
    resolvedSources.set(hostId, sourceKey)
    let shared = sources.get(sourceKey)
    if (!shared) {
      const workdir = dirname(source)
      let watchRoot = dirname(workdir)
      while (true) {
        try {
          const stat = lstatSync(watchRoot)
          if (!stat.isDirectory() || stat.isSymbolicLink())
            throw Error('Preview watch directory is redirected')
          break
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
            dirname(watchRoot) === watchRoot
          )
            throw error
          watchRoot = dirname(watchRoot)
        }
      }
      const sourceEntry = relative(workdir, source).split('\\').join('/')
      if (!sourceEntry || sourceEntry.endsWith('.pptd'))
        throw Error('Leftover PPTD is not a preview source')
      const paths = new Set([sourceEntry])
      const validPaths = new Set(paths)
      const files = () =>
        [...paths].map((path) => ({
          id: path,
          path: relative(watchRoot, resolve(workdir, path)).split('\\').join('/')
        }))
      let boundInput = live
      let bindingTimer: ReturnType<typeof setTimeout> | undefined
      const observation = new SourceObservation(
        async (previousSourceIdentity) => {
          if (boundInput) {
            const input = await bindLiveSource({ path: source, live: boundInput }, resolveSource)
            if (!input) {
              // Input provenance can become available without another authoring write.
              // Reconcile only this startup handoff; normal snapshots remain file-driven.
              bindingTimer ??= setTimeout(() => {
                bindingTimer = undefined
                void observation.refresh()
              }, 250)
              return { status: 'refused', error: '', dependencies: [sourceEntry] }
            }
            clearTimeout(bindingTimer)
            bindingTimer = undefined
            boundInput = input
          }
          return designRequest<ObservedPreviewResult>({
            operation: 'source-preview',
            workdir,
            ...(boundInput?.sourceTurnId
              ? { live: { sessionId: boundInput.sessionId, sourceTurnId: boundInput.sourceTurnId } }
              : {}),
            previousSourceIdentity
          })
        },
        (dependencies, valid) => {
          const before = [...paths].sort().join('\0')
          paths.clear()
          if (valid) {
            validPaths.clear()
            for (const path of dependencies) validPaths.add(path)
          }
          for (const path of validPaths) paths.add(path)
          for (const path of dependencies) paths.add(path)
          watcher.update({ textFiles: files() })
          return before !== [...paths].sort().join('\0')
        },
        [sourceEntry]
      )
      let watchError: string | undefined
      const watcher = startWorkspaceFileWatcher({
        workspaceRoot: watchRoot,
        textFiles: files(),
        trackedOnly: true,
        onWorkspaceChanged: () => observation.invalidate(),
        onTextFileChanged: () => {
          void observation.refresh()
        },
        onEvent: (event) => {
          if (event.type !== 'error') return
          watchError = event.message
          const entry = sources.get(sourceKey)
          if (entry) {
            entry.error = watchError
            for (const key of entry.observation.consumers.keys()) {
              const status = statuses.get(key)
              if (status) notify(key, { ...status, automaticError: watchError })
            }
          }
        }
      })
      shared = {
        observation,
        watcher,
        paths,
        error: watchError,
        close() {
          clearTimeout(bindingTimer)
          observation.close()
          watcher.close()
        }
      }
      sources.set(sourceKey, shared)
    }
    subscriptions.set(hostId, sourceKey)
    const entry = shared
    entry.observation.consumers.set(hostId, async (built, current) => {
      const owns = () =>
        current() &&
        subscriptions.get(hostId) === sourceKey &&
        (!live || designCanvasAccess.state(artworkId).turnId === live.turnId)
      if (!owns()) return
      const result = await renderSourcePreview(owner, artworkId, hostId, source, built, owns)
      if (!owns() || result.status === 'superseded') return
      notify(hostId, { ...result, automaticError: entry.error })
      const bounds = boundsByHost.get(hostId)
      if (bounds) {
        await attachSourcePreview(hostId, bounds)
      }
    })
    await entry.observation.refresh()
    return statuses.get(hostId) ?? { status: 'superseded' as const }
  } catch (error) {
    if (!resolutions.current(token)) return { status: 'superseded' as const }
    const result: PreviewStatus = {
      status: 'waiting',
      source: views.get(hostId)?.source ?? '',
      error: String(error),
      retained: views.has(hostId),
      sourceIdentity: views.get(hostId)?.sourceIdentity
    }
    notify(hostId, result)
    return result
  }
}

async function renderSourcePreview(
  owner: BrowserWindow,
  artworkId: string,
  hostId: string,
  source: string,
  built: ObservedPreviewResult,
  sourceCurrent: () => boolean
) {
  const token = requests.begin(hostId, artworkId)
  const current = () => requests.current(token) && sourceCurrent()
  try {
    if (built.status !== 'ok' || !built.sourceIdentity)
      throw Error(built.status === 'refused' ? built.error : 'Missing snapshot identity')
    if (
      views.get(hostId)?.source === source &&
      views.get(hostId)?.sourceIdentity === built.sourceIdentity
    ) {
      views.get(hostId)!.isCurrent = sourceCurrent
      return { status: 'ready' as const, source, sourceIdentity: built.sourceIdentity }
    }
    const saved = await designRequest({ operation: 'read', sessionId: artworkId })
    const resource = await surface(
      {
        doc: built.doc,
        assets: built.assets,
        association: saved.association,
        revisionId: built.sourceIdentity
      },
      false,
      undefined,
      true
    )
    if (!current() || owner.isDestroyed()) {
      resource.dispose()
      return { status: 'superseded' as const }
    }
    const view = new WebContentsView({
      webPreferences: {
        session: resource.isolated,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    const [width, height] = owner.getContentSize()
    const intended = boundsByHost.get(hostId) ??
      currentDesignBounds(hostId) ?? { x: 0, y: 0, width, height }
    view.setBounds({
      x: Math.round(intended.x),
      y: Math.round(intended.y),
      width: Math.max(1, Math.round(intended.width)),
      height: Math.max(1, Math.round(intended.height))
    })
    const preparing = staging.get(hostId) ?? new Set<WebContentsView>()
    preparing.add(view)
    staging.set(hostId, preparing)
    view.setVisible(boundsByHost.has(hostId) || isDesignVisible(hostId))
    owner.contentView.addChildView(view, 0)
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('will-navigate', (event) => event.preventDefault())
    view.webContents.on('will-redirect', (event) => event.preventDefault())
    try {
      await view.webContents.loadURL(resource.url)
      await view.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const timer = setTimeout(() => { observer.disconnect(); reject(Error('Preview rendering timed out')); }, 30000);
        let started = false;
        const observer = new MutationObserver(check);
        observer.observe(document, { childList: true, subtree: true });
        async function check() {
          if (started || !window.molly || !window.bento?.doc || !document.querySelector('.bento-slide')) return;
          started = true; observer.disconnect();
          try {
            window.molly.setReadonly(true, ${JSON.stringify('Agent 正在构建 · 只读 / Agent is building · Read-only')});
            document.querySelector('.bento-slide').getBoundingClientRect();
            await Promise.all([...document.fonts].filter(font => font.status === 'loading').map(font => font.load()));
            if ([...document.fonts].some(font => font.status === 'error')) throw Error('Preview font failed to load');
            const images = [...document.querySelectorAll('.bento-slide img')];
            for (const node of document.querySelectorAll('.bento-slide image')) { const image = new Image(); image.src = node.getAttribute('href') || node.getAttribute('xlink:href') || ''; images.push(image); }
            await Promise.all(images.map(image => new Promise((loaded, failed) => {
              const check = () => image.naturalWidth > 0 ? loaded(true) : failed(Error('Preview image failed to load'));
              if (image.complete) check();
              else { image.addEventListener('load', check, { once: true }); image.addEventListener('error', () => failed(Error('Preview image failed to load')), { once: true }); }
            })));
            clearTimeout(timer); resolve(true);
          } catch(error) { clearTimeout(timer); reject(error); }
        }
        check();
      })`)
      if (!current() || owner.isDestroyed()) {
        if (!owner.isDestroyed()) owner.contentView.removeChildView(view)
        if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false })
        resource.dispose()
        return { status: 'superseded' as const }
      }
      const previous = views.get(hostId)
      if (boundsByHost.has(hostId) || isDesignVisible(hostId)) {
        if (previous?.view.getVisible()) await rememberDesignViewport(hostId, previous.view)
        else await rememberCurrentDesignViewport(hostId)
        if (!current() || view.webContents.isDestroyed()) throw Error('Preview superseded')
        await restoreDesignViewport(hostId, view)
        await prepareDesignFrame(view, owner)
      }
      if (!current() || owner.isDestroyed()) {
        if (!owner.isDestroyed()) owner.contentView.removeChildView(view)
        if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false })
        resource.dispose()
        return { status: 'superseded' as const }
      }
      // Promote prepared pixels before retiring the outgoing view, in one main-process turn.
      if (boundsByHost.has(hostId)) owner.contentView.addChildView(view)
      else view.setVisible(false)
      if (previous && views.get(hostId) === previous) {
        owner.contentView.removeChildView(previous.view)
        previous.view.webContents.close({ waitForBeforeUnload: false })
        previous.dispose()
      }
      if (!boundsByHost.has(hostId)) view.setVisible(false)
      views.set(hostId, {
        owner,
        artworkId,
        source,
        sourceIdentity: built.sourceIdentity,
        isCurrent: sourceCurrent,
        view,
        dispose: resource.dispose
      })
      return { status: 'ready' as const, source, sourceIdentity: built.sourceIdentity }
    } catch (error) {
      if (!owner.isDestroyed()) owner.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false })
      resource.dispose()
      throw error
    } finally {
      preparing.delete(view)
      if (staging.get(hostId) === preparing && preparing.size === 0) staging.delete(hostId)
    }
  } catch (error) {
    if (!current()) return { status: 'superseded' as const }
    return {
      status: 'waiting' as const,
      source: views.get(hostId)?.source ?? source,
      error: built.status === 'refused' && !built.error ? undefined : String(error),
      retained: views.has(hostId),
      sourceIdentity: views.get(hostId)?.sourceIdentity
    }
  }
}
