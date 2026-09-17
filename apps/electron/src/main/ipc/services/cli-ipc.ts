import { getIpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import { getIpcServiceDeps } from '../ipc-service-deps'

export class CliIpc extends IpcService {
  static override readonly groupName = 'cli'

  @IpcMethod()
  async getOutputBacklog() {
    return getIpcServiceDeps().cliService.getOutputBacklog()
  }

  @IpcMethod()
  async getState() {
    const { event } = getIpcContext()
    const { cliService } = getIpcServiceDeps()
    cliService.attachCliStateSender(event.sender)
    return cliService.getCliState()
  }

  @IpcMethod()
  async restart() {
    const { event } = getIpcContext()
    const { cliService } = getIpcServiceDeps()
    cliService.attachCliStateSender(event.sender)
    return await cliService.restartAutoStart()
  }

  @IpcMethod()
  async terminate() {
    const { event } = getIpcContext()
    const { cliService } = getIpcServiceDeps()
    cliService.attachCliStateSender(event.sender)
    return await cliService.terminateAutoStart()
  }
}
