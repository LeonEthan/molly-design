import { WebContentsView, type BrowserWindow } from 'electron'
import { lstatSync } from 'node:fs'
import { startWorkspaceFileWatcher, type WorkspaceFileWatcher } from '@loro-dev/ignore'
import { SourceObservation } from './design-source-observation'
import { dirname, relative, resolve } from 'node:path'
import { designRequest, surface, importDesignSnapshot } from './design-service'
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
  }
>()
const subscriptions = new Map<string, string>()
const boundsByHost = new Map<string, Electron.Rectangle>()
function release(hostId: string) {
  const source = subscriptions.get(hostId)
  subscriptions.delete(hostId)
  if (!source) return
  const shared = sources.get(source)
  shared?.observation.consumers.delete(hostId)
  if (shared && shared.observation.consumers.size === 0) {
    shared.observation.close()
    shared.watcher.close()
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
    kind: 'source' | 'history'
    snapshot: {
      content: Pick<import('../../../../cli/src/design/store').DesignPayload, 'doc' | 'assets'>
      baseRevisionId?: string
    }
    view: WebContentsView
    dispose(): void
  }
>()

/** A click names the rendered identity, never the watcher's newest observation. */
export async function importSourcePreview(
  owner: BrowserWindow,
  artworkId: string,
  hostId: string,
  sourceIdentity: string
) {
  const shown = views.get(hostId)
  if (
    !shown ||
    shown.kind !== 'source' ||
    shown.owner !== owner ||
    shown.artworkId !== artworkId ||
    shown.sourceIdentity !== sourceIdentity ||
    !requests.visible(hostId) ||
    !shown.view.getVisible() ||
    shown.view.webContents.isDestroyed()
  )
    throw Error('Preview changed or closed; view the document again before importing')
  return importDesignSnapshot(artworkId, shown.snapshot)
}

export function hideSourcePreview(hostId: string, cancel = true) {
  if (cancel) {
    requests.cancel(hostId)
    resolutions.cancel(hostId)
    release(hostId)
  }
  boundsByHost.delete(hostId)
  views.get(hostId)?.view.setVisible(false)
}
export function closeSourcePreview(hostId: string) {
  hideSourcePreview(hostId)
  consumers.delete(hostId)
  statuses.delete(hostId)
  const previous = views.get(hostId)
  if (!previous) return
  views.delete(hostId)
  if (!previous.owner.isDestroyed()) previous.owner.contentView.removeChildView(previous.view)
  if (!previous.view.webContents.isDestroyed())
    previous.view.webContents.close({ waitForBeforeUnload: false })
  previous.dispose()
}

export function attachSourcePreview(hostId: string, bounds: Electron.Rectangle) {
  boundsByHost.set(hostId, bounds)
  const current = views.get(hostId)
  if (!current || !requests.visible(hostId)) return
  current.view.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height))
  })
  current.view.setVisible(true)
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

/** Immutable history uses the existing isolated renderer, without a file watcher. */
export async function showDesignVersion(
  owner: BrowserWindow,
  artworkId: string,
  hostId: string,
  commitId: string
) {
  closeSourcePreview(hostId)
  registerConsumer(owner, artworkId, hostId)
  const token = resolutions.begin(hostId, artworkId)
  const saved = await designRequest<import('../../../../cli/src/design/store').DesignPayload>({
    operation: 'history-read',
    sessionId: artworkId,
    commitId
  })
  if (!resolutions.current(token)) return { status: 'superseded' as const }
  return renderSourcePreview(
    owner,
    artworkId,
    hostId,
    `git:${commitId}`,
    {
      status: 'ok',
      doc: saved.doc,
      assets: saved.assets,
      width: saved.doc.canvas.width,
      height: saved.doc.canvas.height,
      sourceIdentity: saved.revisionId
    },
    () => resolutions.current(token),
    'history'
  )
}

export async function refreshSourcePreview(
  owner: BrowserWindow,
  artworkId: string,
  hostId: string,
  resolveSource: () => Promise<string>
) {
  registerConsumer(owner, artworkId, hostId)
  const token = resolutions.begin(hostId, artworkId)
  try {
    const source = await resolveSource()
    if (!resolutions.current(token)) return { status: 'superseded' as const }
    if (subscriptions.get(hostId) !== source) release(hostId)
    let shared = sources.get(source)
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
      const observation = new SourceObservation(
        (previousSourceIdentity) =>
          designRequest<ObservedPreviewResult>({
            operation: 'source-preview',
            workdir,
            previousSourceIdentity
          }),
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
          const entry = sources.get(source)
          if (entry) {
            entry.error = watchError
            for (const key of entry.observation.consumers.keys()) {
              const status = statuses.get(key)
              if (status) notify(key, { ...status, automaticError: watchError })
            }
          }
        }
      })
      shared = { observation, watcher, paths, error: watchError }
      sources.set(source, shared)
    }
    subscriptions.set(hostId, source)
    const entry = shared
    entry.observation.consumers.set(hostId, async (built, current) => {
      if (!current() || subscriptions.get(hostId) !== source) return
      const result = await renderSourcePreview(owner, artworkId, hostId, source, built, current)
      if (!current() || subscriptions.get(hostId) !== source || result.status === 'superseded')
        return
      notify(hostId, { ...result, automaticError: entry.error })
      const bounds = boundsByHost.get(hostId)
      if (bounds) attachSourcePreview(hostId, bounds)
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
  sourceCurrent: () => boolean,
  kind: 'source' | 'history' = 'source'
) {
  const token = requests.begin(hostId, artworkId)
  const current = () => requests.current(token) && sourceCurrent()
  try {
    if (built.status !== 'ok' || !built.sourceIdentity)
      throw Error(built.status === 'refused' ? built.error : 'Missing snapshot identity')
    if (
      views.get(hostId)?.source === source &&
      views.get(hostId)?.sourceIdentity === built.sourceIdentity
    )
      return { status: 'ready' as const, source, sourceIdentity: built.sourceIdentity }
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
    view.setBounds({ x: 0, y: 0, width, height })
    owner.contentView.addChildView(view)
    view.setVisible(false)
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
            window.molly.setReadonly(true, ${JSON.stringify(kind === 'history' ? '历史版本 · 只读 / Version history · Read-only' : '未提交预览 · 只读 / Unsubmitted preview · Read-only')});
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
    } catch (error) {
      if (!owner.isDestroyed()) owner.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false })
      resource.dispose()
      throw error
    }
    const previous = views.get(hostId)
    if (previous) {
      owner.contentView.removeChildView(previous.view)
      previous.view.webContents.close({ waitForBeforeUnload: false })
      previous.dispose()
    }
    views.set(hostId, {
      owner,
      artworkId,
      source,
      kind,
      sourceIdentity: built.sourceIdentity,
      snapshot: { content: { doc: built.doc, assets: built.assets } },
      view,
      dispose: resource.dispose
    })
    return { status: 'ready' as const, source, sourceIdentity: built.sourceIdentity }
  } catch (error) {
    if (!current()) return { status: 'superseded' as const }
    return {
      status: 'waiting' as const,
      source: views.get(hostId)?.source ?? source,
      error: String(error),
      retained: views.has(hostId),
      sourceIdentity: views.get(hostId)?.sourceIdentity
    }
  }
}
