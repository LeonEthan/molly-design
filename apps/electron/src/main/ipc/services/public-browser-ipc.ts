import { BrowserAccountError } from '../../services/browser-account-error'
import { getIpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import {
  ElectronPublicBrowserBoundsInputSchema,
  ElectronPublicBrowserCreateInputSchema,
  ElectronPublicBrowserIdInputSchema,
  ElectronPublicBrowserNavigateInputSchema,
  ElectronPublicBrowserVisibilityInputSchema,
  ElectronBrowserAccountImportInputSchema,
  ElectronBrowserImportProfilesInputSchema,
  ElectronBrowserImportOperationInputSchema,
  type ElectronPublicBrowserBoundsInput,
  type ElectronPublicBrowserCreateInput,
  type ElectronPublicBrowserIdInput,
  type ElectronPublicBrowserNavigateInput,
  type ElectronPublicBrowserVisibilityInput,
  type ElectronBrowserAccountImportInput,
  type AccountImportBrowserId,
  type ElectronBrowserImportResult,
  type ElectronBrowserProfilesResult
} from '@molly/shared/electron-ipc'
import { getIpcServiceDeps } from '../ipc-service-deps'
import { readLocalPlatformSnapshot } from '../../platform'
import {
  AgentBrowserRpcResultSchema,
  type AgentBrowserScope
} from '@molly/shared/browser-agent-rpc'

async function setBrowserTakeover(
  sessionId: AgentBrowserScope['sessionId'],
  runId: string,
  takeover: boolean
): Promise<void> {
  const deps = getIpcServiceDeps()
  const machineId = await deps.cliService.getLocalMachineId()
  const snapshot = await readLocalPlatformSnapshot()
  if (!machineId || !snapshot) throw new Error('Local Molly runtime is unavailable.')
  const answer = await deps.cliService.sendLocalMachineRpc({
    machineId,
    workspaceId: snapshot.workspace.workspaceId,
    ownerSessionId: sessionId,
    method: takeover ? 'browser/takeover' : 'browser/resume',
    params: { runId }
  })
  if (!answer.ok) throw new Error(answer.error)
  const parsed = AgentBrowserRpcResultSchema.safeParse(answer.result)
  if (!parsed.success || parsed.data.type !== 'browser/control' || !parsed.data.ok) {
    throw new Error('The active browser run has changed.')
  }
}

function assertTrustedSender(): void {
  const { event } = getIpcContext()
  const window = getIpcServiceDeps().getMainWindow()
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error('Rejected public browser IPC from an untrusted renderer.')
  }
}

export class PublicBrowserIpc extends IpcService {
  static override readonly groupName = 'publicBrowser'

  @IpcMethod()
  async create(raw: ElectronPublicBrowserCreateInput) {
    assertTrustedSender()
    const input = ElectronPublicBrowserCreateInputSchema.parse(raw)
    return getIpcServiceDeps().publicBrowserService.create(input.browserId, input.bounds)
  }

  @IpcMethod()
  getState(raw: ElectronPublicBrowserIdInput) {
    assertTrustedSender()
    const { browserId } = ElectronPublicBrowserIdInputSchema.parse(raw)
    return getIpcServiceDeps().publicBrowserService.getState(browserId)
  }

  @IpcMethod()
  async navigate(raw: ElectronPublicBrowserNavigateInput) {
    assertTrustedSender()
    const input = ElectronPublicBrowserNavigateInputSchema.parse(raw)
    return await getIpcServiceDeps().publicBrowserService.navigate(input.browserId, input.url)
  }

  @IpcMethod()
  async back(raw: ElectronPublicBrowserIdInput) {
    assertTrustedSender()
    const input = ElectronPublicBrowserIdInputSchema.parse(raw)
    return getIpcServiceDeps().publicBrowserService.goBack(input.browserId)
  }

  @IpcMethod()
  async forward(raw: ElectronPublicBrowserIdInput) {
    assertTrustedSender()
    const input = ElectronPublicBrowserIdInputSchema.parse(raw)
    return getIpcServiceDeps().publicBrowserService.goForward(input.browserId)
  }

  @IpcMethod()
  async reload(raw: ElectronPublicBrowserIdInput) {
    assertTrustedSender()
    const input = ElectronPublicBrowserIdInputSchema.parse(raw)
    return getIpcServiceDeps().publicBrowserService.reload(input.browserId)
  }

  @IpcMethod()
  async stop(raw: ElectronPublicBrowserIdInput) {
    assertTrustedSender()
    const input = ElectronPublicBrowserIdInputSchema.parse(raw)
    return getIpcServiceDeps().publicBrowserService.stop(input.browserId)
  }

  @IpcMethod()
  async setBounds(raw: ElectronPublicBrowserBoundsInput) {
    assertTrustedSender()
    const input = ElectronPublicBrowserBoundsInputSchema.parse(raw)
    return getIpcServiceDeps().publicBrowserService.setBounds(input.browserId, input.bounds)
  }

  @IpcMethod()
  async setVisible(raw: ElectronPublicBrowserVisibilityInput) {
    assertTrustedSender()
    const input = ElectronPublicBrowserVisibilityInputSchema.parse(raw)
    return getIpcServiceDeps().publicBrowserService.setVisible(input.browserId, input.visible)
  }

  @IpcMethod()
  async destroy(raw: ElectronPublicBrowserIdInput) {
    assertTrustedSender()
    const input = ElectronPublicBrowserIdInputSchema.parse(raw)
    return getIpcServiceDeps().publicBrowserService.destroy(input.browserId)
  }

  @IpcMethod()
  async importBrowserAccount(
    raw: ElectronBrowserAccountImportInput
  ): Promise<ElectronBrowserImportResult> {
    assertTrustedSender()
    const input = ElectronBrowserAccountImportInputSchema.parse(raw)
    try {
      const report = await getIpcServiceDeps().publicBrowserService.importBrowserAccount(input)
      return { ok: true, report }
    } catch (error) {
      return { ok: false, error: error instanceof BrowserAccountError ? error.code : 'unavailable' }
    }
  }

  @IpcMethod()
  cancelAccountImport(raw: { operationId: string }) {
    assertTrustedSender()
    const { operationId } = ElectronBrowserImportOperationInputSchema.parse(raw)
    return getIpcServiceDeps().publicBrowserService.cancelAccountImport(operationId)
  }

  @IpcMethod()
  async getImportProfiles(raw: {
    browserId: AccountImportBrowserId
    operationId: string
  }): Promise<ElectronBrowserProfilesResult> {
    assertTrustedSender()
    const { browserId, operationId } = ElectronBrowserImportProfilesInputSchema.parse(raw)
    try {
      const profiles = await getIpcServiceDeps().publicBrowserService.getImportProfiles(
        browserId,
        operationId
      )
      return { ok: true, profiles }
    } catch (error) {
      return { ok: false, error: error instanceof BrowserAccountError ? error.code : 'unavailable' }
    }
  }

  @IpcMethod()
  async getAccountSummary() {
    assertTrustedSender()
    return await getIpcServiceDeps().publicBrowserService.getAccountSummary()
  }

  @IpcMethod()
  async getImportSources() {
    assertTrustedSender()
    return await getIpcServiceDeps().publicBrowserService.getImportSources()
  }

  @IpcMethod()
  async clearAccountData() {
    assertTrustedSender()
    return { removed: await getIpcServiceDeps().publicBrowserService.clearAccountData() }
  }

  @IpcMethod()
  async takeAgentControl(raw: ElectronPublicBrowserIdInput) {
    assertTrustedSender()
    const { browserId } = ElectronPublicBrowserIdInputSchema.parse(raw)
    const scope = await getIpcServiceDeps().publicBrowserService.takeHumanAccountControl(browserId)
    if (!scope) return { ok: false, error: 'No Agent currently controls this page.' }
    await setBrowserTakeover(scope.sessionId, scope.runId, true)
    return { ok: true }
  }

  @IpcMethod()
  async resumeAgentControl(raw: ElectronPublicBrowserIdInput) {
    assertTrustedSender()
    const { browserId } = ElectronPublicBrowserIdInputSchema.parse(raw)
    const scope = getIpcServiceDeps().publicBrowserService.takeoverScope(browserId)
    if (!scope) return { ok: false, error: 'This page is not in user takeover mode.' }
    if (!getIpcServiceDeps().publicBrowserService.canResumeAgentControl(browserId, scope.runId)) {
      return { ok: false, error: 'This page was closed. Start a new task to browse again.' }
    }
    await setBrowserTakeover(scope.sessionId, scope.runId, false)
    getIpcServiceDeps().publicBrowserService.resumeAgentControl(browserId, scope.runId)
    return { ok: true }
  }
}
