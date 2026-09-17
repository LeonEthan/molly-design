import { contextBridge } from 'electron'
import { ipcBridge } from './ipc-bridge'
import { electronAPI } from '@electron-toolkit/preload'
import os from 'node:os'
import { readPreferredSystemLanguagesArgument } from '../system-language-argument'

const platformInfo = {
  os: process.platform,
  homeDir: os.homedir(),
  machineName: os.hostname(),
  preferredSystemLanguages: readPreferredSystemLanguagesArgument(process.argv)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('__MOLLY_ELECTRON__', true)
    contextBridge.exposeInMainWorld('__MOLLY_PLATFORM__', platformInfo)
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('ipc', ipcBridge)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.__MOLLY_ELECTRON__ = true
  // @ts-ignore (define in dts)
  window.__MOLLY_PLATFORM__ = platformInfo
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.ipc = ipcBridge
}
