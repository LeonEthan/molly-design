import { ElectronAPI } from '@electron-toolkit/preload'

type MollyPlatformInfo = {
  os: string
  homeDir: string
  machineName: string
  preferredSystemLanguages?: readonly string[]
}

type MollyNativeAppInfo = {
  version?: string
  build?: string
  native_platform?: string
  os_name?: string
  os_version?: string
  app_version?: string
  install_id?: string
}

type MollyIpcBridge = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, listener: (payload: unknown) => void) => () => void
  send: (channel: string, payload?: unknown) => void
}

declare global {
  interface Window {
    __MOLLY_ELECTRON__?: true
    __MOLLY_PLATFORM__?: MollyPlatformInfo
    __MOLLY_APP_INFO__?: MollyNativeAppInfo
    electron: ElectronAPI
    ipc: MollyIpcBridge
  }
}
