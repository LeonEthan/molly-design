import { WebContentsView, webContents } from 'electron'
import { z } from 'zod'
import { BrowserAccountError } from './browser-account-error.ts'
import {
  browserCookieParam,
  storedCookieSchema,
  type BrowserCookieStore
} from './browser-account-import.ts'

const registrationSchema = z.object({
  registrationId: z.string(),
  scopeURL: z.string(),
  isDeleted: z.boolean()
})
const versionSchema = z.object({
  versionId: z.string(),
  registrationId: z.string(),
  status: z.string(),
  runningStatus: z.string(),
  targetId: z.string().optional()
})
const targetSchema = z.object({
  targetId: z.string(),
  type: z.string(),
  browserContextId: z.string(),
  attached: z.boolean()
})

export type BrowserAccountIsolation = { store: BrowserCookieStore; release: () => Promise<void> }

export async function isolateBrowserAccounts(
  browserSession: Electron.Session
): Promise<BrowserAccountIsolation> {
  const probe = new WebContentsView({
    webPreferences: {
      session: browserSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const debuggerClient = probe.webContents.debugger
  const tasks: Array<{ end: () => void }> = []
  const attachments = new Map<string, string>()
  const paused = new Set<string>()
  const waiters = new Set<() => void>()
  const registrations = new Map<string, z.infer<typeof registrationSchema>>()
  const versions = new Map<string, z.infer<typeof versionSchema>>()
  let contextId = '',
    targetId = '',
    initialized = false,
    sealed = false,
    released = false,
    failed = false
  const assertIsolated = (): void => {
    if (failed || released || probe.webContents.isDestroyed() || !debuggerClient.isAttached())
      throw new BrowserAccountError('isolation-failed')
  }
  const onMessage = (
    _event: Electron.Event,
    method: string,
    params: unknown,
    sessionId?: string
  ): void => {
    try {
      if (method === 'ServiceWorker.workerRegistrationUpdated') {
        for (const entry of z.object({ registrations: z.array(registrationSchema) }).parse(params)
          .registrations) {
          if (sealed) failed = true
          if (entry.isDeleted) registrations.delete(entry.registrationId)
          else registrations.set(entry.registrationId, entry)
        }
      } else if (method === 'ServiceWorker.workerVersionUpdated') {
        for (const entry of z.object({ versions: z.array(versionSchema) }).parse(params).versions) {
          if (
            sealed &&
            entry.status !== 'redundant' &&
            (!entry.targetId ||
              !attachments.has(entry.targetId) ||
              entry.runningStatus !== 'running')
          )
            failed = true
          versions.set(entry.versionId, entry)
        }
        initialized = true
      } else if (method === 'Debugger.paused' && sessionId) {
        paused.add(sessionId)
      } else if (method === 'Debugger.resumed' && sessionId) {
        paused.delete(sessionId)
        if (sealed) failed = true
      } else if (sealed && method === 'Target.targetCreated') {
        const target = z.object({ targetInfo: targetSchema }).parse(params).targetInfo
        if (
          target.browserContextId === contextId &&
          target.targetId !== targetId &&
          !attachments.has(target.targetId)
        )
          failed = true
      } else if (sealed && method === 'Target.detachedFromTarget') {
        const detached = z.object({ sessionId: z.string() }).parse(params)
        if (paused.has(detached.sessionId)) failed = true
      }
    } catch {
      failed = true
    }
    for (const wake of waiters) wake()
  }
  const onDetached = (): void => {
    failed = true
    for (const wake of waiters) wake()
  }
  const until = (predicate: () => boolean): Promise<void> =>
    new Promise((resolve, reject) => {
      const finish = (): void => {
        if (!failed && !predicate()) return
        clearTimeout(timer)
        waiters.delete(finish)
        if (failed) reject(new BrowserAccountError('isolation-failed'))
        else resolve()
      }
      const timer = setTimeout(() => {
        failed = true
        finish()
      }, 15_000)
      waiters.add(finish)
      finish()
    })
  const release = async (): Promise<void> => {
    if (released) return
    sealed = false
    released = true
    debuggerClient.off('message', onMessage)
    debuggerClient.off('detach', onDetached)
    for (const sessionId of attachments.values()) {
      try {
        await debuggerClient.sendCommand('Debugger.resume', {}, sessionId)
      } catch {}
      try {
        await debuggerClient.sendCommand('Target.detachFromTarget', { sessionId })
      } catch {}
    }
    for (const task of tasks) task.end()
    if (!probe.webContents.isDestroyed()) probe.webContents.close()
  }
  try {
    await probe.webContents.loadURL('about:blank')
    if (
      webContents
        .getAllWebContents()
        .some((contents) => contents !== probe.webContents && contents.session === browserSession)
    )
      throw new BrowserAccountError('isolation-failed')
    debuggerClient.attach('1.3')
    debuggerClient.on('message', onMessage)
    debuggerClient.on('detach', onDetached)
    const own = z
      .object({ targetInfo: targetSchema })
      .parse(await debuggerClient.sendCommand('Target.getTargetInfo')).targetInfo
    contextId = own.browserContextId
    targetId = own.targetId
    await debuggerClient.sendCommand('Target.setDiscoverTargets', { discover: true })
    await debuggerClient.sendCommand('ServiceWorker.enable')
    await until(() => initialized)
    const scopes = new Set<string>()
    for (const registration of registrations.values()) {
      if (scopes.has(registration.scopeURL)) throw new BrowserAccountError('isolation-failed')
      scopes.add(registration.scopeURL)
      const worker = await browserSession.serviceWorkers.startWorkerForScope(registration.scopeURL)
      tasks.push(worker.startTask())
      await until(() =>
        [...versions.values()].some(
          (version) =>
            version.registrationId === registration.registrationId &&
            version.versionId === String(worker.versionId) &&
            version.runningStatus === 'running' &&
            Boolean(version.targetId)
        )
      )
    }
    const getTargets = async (): Promise<Array<z.infer<typeof targetSchema>>> =>
      z
        .object({ targetInfos: z.array(targetSchema) })
        .parse(await debuggerClient.sendCommand('Target.getTargets'))
        .targetInfos.filter(
          (target) => target.browserContextId === contextId && target.targetId !== targetId
        )
    for (const target of await getTargets()) {
      if (!['service_worker', 'shared_worker'].includes(target.type) || target.attached)
        throw new BrowserAccountError('isolation-failed')
      const { sessionId } = z.object({ sessionId: z.string() }).parse(
        await debuggerClient.sendCommand('Target.attachToTarget', {
          targetId: target.targetId,
          flatten: true
        })
      )
      attachments.set(target.targetId, sessionId)
      await debuggerClient.sendCommand('Debugger.enable', {}, sessionId)
      await debuggerClient.sendCommand('Debugger.pause', {}, sessionId)
      void debuggerClient
        .sendCommand('Runtime.evaluate', { expression: 'void 0' }, sessionId)
        .catch(() => {
          if (sealed) failed = true
        })
      await until(() => paused.has(sessionId))
    }
    for (const version of versions.values()) {
      if (version.status === 'redundant' && version.runningStatus === 'stopped') continue
      if (version.status !== 'activated' || !version.targetId || !attachments.has(version.targetId))
        throw new BrowserAccountError('isolation-failed')
    }
    if ((await getTargets()).some((target) => !attachments.has(target.targetId)))
      throw new BrowserAccountError('isolation-failed')
    await browserSession.closeAllConnections()
    sealed = true
    assertIsolated()
    const store: BrowserCookieStore = {
      assertIsolated,
      snapshot: async () => {
        assertIsolated()
        const snapshot = z
          .object({ cookies: z.array(storedCookieSchema) })
          .safeParse(await debuggerClient.sendCommand('Network.getAllCookies'))
        if (!snapshot.success) throw new BrowserAccountError('destination-unsupported')
        return snapshot.data.cookies
      },
      set: async (cookie) => {
        const result = z
          .object({ success: z.boolean() })
          .parse(await debuggerClient.sendCommand('Network.setCookie', browserCookieParam(cookie)))
        if (!result.success) throw new Error('Cookie write was rejected')
      },
      remove: async (cookie) => {
        await debuggerClient.sendCommand('Network.deleteCookies', {
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path
        })
      },
      flush: async () => {
        await browserSession.cookies.flushStore()
      }
    }
    return { store, release }
  } catch {
    await release()
    throw new BrowserAccountError('isolation-failed')
  }
}
