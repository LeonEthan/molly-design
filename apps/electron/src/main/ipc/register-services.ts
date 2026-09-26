import { ipcMain } from 'electron'
import { createServices, type MergeIpcService } from 'electron-ipc-decorator'
import { IPC_SEND_CHANNELS } from '@molly/shared/electron-ipc'
import { LocalLoroDataPlaneClientMessageSchema } from '@molly/shared/local-loro-data-plane'
import { DesignIpc } from './services/design-ipc'
import { AppIpc, installNativeThemeWatch } from './services/app-ipc'
import { CliIpc } from './services/cli-ipc'
import { ImageIpc } from './services/image-ipc'
import { ModelConnectionsIpc } from './services/model-connections-ipc'
import { LocalPlatformIpc } from './services/local-platform-ipc'
import { LocalProjectsIpc } from './services/local-projects-ipc'
import { LoroIpc } from './services/loro-ipc'
import { MachineRpcIpc } from './services/machine-rpc-ipc'
import { NotificationsIpc } from './services/notifications-ipc'
import { PublicBrowserIpc } from './services/public-browser-ipc'
import { SessionControlIpc } from './services/session-control-ipc'
import { UpdaterIpc } from './services/updater-ipc'
import { setIpcServiceDeps, type IpcServiceDeps } from './ipc-service-deps'

export const IPC_SERVICE_CONSTRUCTORS = [
  DesignIpc,
  AppIpc,
  CliIpc,
  ImageIpc,
  ModelConnectionsIpc,
  LocalPlatformIpc,
  LocalProjectsIpc,
  LoroIpc,
  MachineRpcIpc,
  NotificationsIpc,
  PublicBrowserIpc,
  SessionControlIpc,
  UpdaterIpc
] as const

function createRegisteredIpcServices() {
  return createServices(IPC_SERVICE_CONSTRUCTORS)
}

export type ElectronIpcServices = MergeIpcService<ReturnType<typeof createRegisteredIpcServices>>

export function registerIpcServices(deps: IpcServiceDeps) {
  setIpcServiceDeps(deps)
  installNativeThemeWatch()

  ipcMain.on(IPC_SEND_CHANNELS.cliSubscribe, (event) => {
    deps.cliService.attachCliStateSender(event.sender)
  })
  ipcMain.on(IPC_SEND_CHANNELS.loroSubscribe, (event) => {
    deps.loroDataPlaneRelay.attachSender(event.sender)
  })
  ipcMain.on(IPC_SEND_CHANNELS.loroSend, (event, payload: unknown) => {
    const parsed = LocalLoroDataPlaneClientMessageSchema.safeParse(payload)
    if (parsed.success) {
      deps.loroDataPlaneRelay.send(parsed.data, event.sender)
    }
  })

  return createRegisteredIpcServices()
}
