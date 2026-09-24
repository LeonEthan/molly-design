import { ipcRenderer } from 'electron'
import { IPC_PUSH_CHANNELS, isIpcPushChannel, isIpcSendChannel } from '@molly/shared/electron-ipc'
import { isIpcInvokeChannel } from './ipc-invoke-policy'

const pendingDeepLinks: unknown[] = []
const deepLinkHandlers = new Set<(payload: unknown) => void>()
let windowForeground: boolean | null = null
const windowForegroundHandlers = new Set<(payload: unknown) => void>()

ipcRenderer.on(IPC_PUSH_CHANNELS.appDeepLink, (_event, url: unknown) => {
  if (deepLinkHandlers.size === 0) {
    pendingDeepLinks.push(url)
    return
  }
  for (const handler of deepLinkHandlers) {
    handler(url)
  }
})

ipcRenderer.on(IPC_PUSH_CHANNELS.appWindowForeground, (_event, value: unknown) => {
  if (typeof value !== 'boolean') return
  windowForeground = value
  for (const handler of windowForegroundHandlers) {
    handler(value)
  }
})

export const ipcBridge = {
  invoke: async (channel: string, ...args: unknown[]) => {
    if (!isIpcInvokeChannel(channel)) {
      throw new Error(`Blocked IPC invoke: ${channel}`)
    }
    return await ipcRenderer.invoke(channel, ...args)
  },
  on: (channel: string, listener: (payload: unknown) => void) => {
    if (!isIpcPushChannel(channel)) {
      throw new Error(`Blocked IPC on: ${channel}`)
    }
    if (channel === IPC_PUSH_CHANNELS.appDeepLink) {
      deepLinkHandlers.add(listener)
      while (pendingDeepLinks.length > 0) {
        const pending = pendingDeepLinks.shift()
        if (pending !== undefined) listener(pending)
      }
      return () => {
        deepLinkHandlers.delete(listener)
      }
    }
    if (channel === IPC_PUSH_CHANNELS.appWindowForeground) {
      windowForegroundHandlers.add(listener)
      if (windowForeground !== null) listener(windowForeground)
      return () => {
        windowForegroundHandlers.delete(listener)
      }
    }
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  send: (channel: string, payload?: unknown) => {
    if (!isIpcSendChannel(channel)) {
      throw new Error(`Blocked IPC send: ${channel}`)
    }
    ipcRenderer.send(channel, payload)
  }
}
