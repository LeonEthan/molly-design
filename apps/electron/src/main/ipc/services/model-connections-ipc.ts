import { getIpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import {
  CheckImageConnectionSchema,
  CheckModelConnectionSchema,
  DiscoverModelConnectionSchema,
  SaveModelConnectionSchema,
  DeleteModelConnectionSchema,
  SaveProtectedImageConnectionSchema,
  DeleteImageConnectionSchema,
  SaveMcpCredentialSettingsSchema,
  DeleteMcpCredentialSchema,
  OpenAiAuthSessionSchema,
  type CheckImageConnection,
  type CheckModelConnection,
  type DiscoverModelConnection,
  type SaveMcpCredential,
  type SaveProtectedImageConnection,
  type SaveModelConnection,
  type DeleteImageConnection
} from '@molly/shared/embedded-harness'
import { shell } from 'electron'
import { getModelConnectionStore } from '../../services/model-connections'
import { checkImageConnection, checkModelConnection } from '../../services/connection-check'
import { discoverModelConnection } from '../../services/model-discovery'
import { OpenAiAuthService } from '../../services/openai-oauth'
import { listMcpTools } from '../../services/mcp-tool-discovery'
import { McpCatalogEntryResultSchema } from '@molly/shared/local-machine-rpc'
import { getIpcServiceDeps } from '../ipc-service-deps'
import { readLocalPlatformSnapshot } from '../../platform'
import { resolveBundledCliEntry } from '../../services/cli-service'
import {
  readBundledCapabilities,
  readBundledModelCatalog,
  readBundledModelMetadataSnapshot
} from '../../services/bundled-capabilities'

async function localWorkspaceId(): Promise<string> {
  const platform = await readLocalPlatformSnapshot()
  if (!platform) throw new Error('local_workspace_unavailable')
  return platform.workspace.workspaceId
}

let openAiAuthService: OpenAiAuthService | undefined
function getOpenAiAuthService(): OpenAiAuthService {
  return (openAiAuthService ??= new OpenAiAuthService(getModelConnectionStore(), (url) =>
    shell.openExternal(url)
  ))
}

export class ModelConnectionsIpc extends IpcService {
  static override readonly groupName = 'modelConnections'

  @IpcMethod()
  async getBundledCapabilities() {
    return readBundledCapabilities(resolveBundledCliEntry())
  }

  @IpcMethod()
  async getSnapshot() {
    return getModelConnectionStore().snapshot()
  }

  @IpcMethod()
  async getImageSnapshot() {
    return getModelConnectionStore().imageSnapshot()
  }

  @IpcMethod()
  async getMcpSnapshot() {
    const workspaceId = await localWorkspaceId()
    const snapshot = await getModelConnectionStore().mcpSnapshot()
    return {
      connections: snapshot.connections.filter((entry) => entry.workspaceId === workspaceId)
    }
  }

  @IpcMethod()
  async saveMcp(input: Omit<SaveMcpCredential, 'workspaceId'>) {
    const parsed = SaveMcpCredentialSettingsSchema.safeParse(input)
    if (!parsed.success) throw new Error('invalid_mcp_credential')
    return getModelConnectionStore().saveMcp({
      ...parsed.data,
      workspaceId: await localWorkspaceId()
    })
  }

  @IpcMethod()
  async deleteMcp(input: { serverId: string; expectedRevision: number }) {
    const parsed = DeleteMcpCredentialSchema.omit({ workspaceId: true }).safeParse(input)
    if (!parsed.success) throw new Error('invalid_mcp_credential')
    return getModelConnectionStore().deleteMcp({
      ...parsed.data,
      workspaceId: await localWorkspaceId()
    })
  }

  /** Explicit Settings action: starts the saved server once, lists its tools, then stops it. */
  @IpcMethod()
  async listMcpTools(input: unknown) {
    const { cliService } = getIpcServiceDeps()
    const { sender } = getIpcContext().event
    const closed = new AbortController()
    const abort = () => closed.abort()
    sender.once('destroyed', abort)
    try {
      const workspaceId = await localWorkspaceId()
      return await listMcpTools(input, {
        workspaceId,
        store: getModelConnectionStore(),
        signal: closed.signal,
        readCatalogEntry: async (serverId) => {
          const machineId = await cliService.getLocalMachineId()
          if (!machineId) return undefined
          const answer = await cliService.sendLocalMachineRpc({
            machineId,
            workspaceId,
            method: 'mcp/catalog-entry',
            params: { serverId }
          })
          if (!answer.ok) return undefined
          const parsed = McpCatalogEntryResultSchema.safeParse(answer.result)
          return parsed.success ? parsed.data.connection : undefined
        },
        runHelper: (request, limits) =>
          cliService.runPrivateHelper(['__internal', 'mcp-list-tools'], request, limits)
      })
    } finally {
      sender.off('destroyed', abort)
    }
  }

  @IpcMethod()
  async saveImage(input: SaveProtectedImageConnection) {
    const parsed = SaveProtectedImageConnectionSchema.safeParse(input)
    if (!parsed.success) throw new Error('invalid_image_connection')
    return getModelConnectionStore().saveImage(parsed.data)
  }

  @IpcMethod()
  async deleteImage(input: DeleteImageConnection) {
    const parsed = DeleteImageConnectionSchema.safeParse(input)
    if (!parsed.success) throw new Error('invalid_image_connection')
    return getModelConnectionStore().deleteImage(parsed.data)
  }

  @IpcMethod()
  async checkImage(input: CheckImageConnection) {
    const parsed = CheckImageConnectionSchema.safeParse(input)
    if (!parsed.success) throw new Error('invalid_image_connection_check')
    return checkImageConnection(getModelConnectionStore(), parsed.data)
  }

  @IpcMethod()
  async check(input: CheckModelConnection) {
    const parsed = CheckModelConnectionSchema.safeParse(input)
    if (!parsed.success) throw new Error('invalid_model_connection_check')
    return checkModelConnection(getModelConnectionStore(), parsed.data)
  }

  /** Explicit Settings action: list the chat models a compatible connection serves. */
  @IpcMethod()
  async discover(input: DiscoverModelConnection) {
    const parsed = DiscoverModelConnectionSchema.safeParse(input)
    if (!parsed.success) throw new Error('invalid_model_connection_discovery')
    return discoverModelConnection(getModelConnectionStore(), parsed.data)
  }

  /**
   * Explicit Settings action: open the OpenAI account sign-in flow. One flow at a time;
   * beginning cancels any prior pending flow. The renderer only receives the URL to open.
   */
  @IpcMethod()
  async beginOpenAiAuth() {
    const result = await getOpenAiAuthService().begin()
    return OpenAiAuthSessionSchema.safeParse(result).success
      ? result
      : { ok: false as const, reason: 'unavailable' as const }
  }

  /** Resolves when the flow completes (browser callback), times out or is cancelled. */
  @IpcMethod()
  async completeOpenAiAuth(input: { sessionId: string }) {
    return getOpenAiAuthService().complete(input.sessionId)
  }

  @IpcMethod()
  async cancelOpenAiAuth(input: { sessionId: string }) {
    getOpenAiAuthService().cancel(input.sessionId)
  }

  /** Sign-out: deletes the local connection and its tokens. */
  @IpcMethod()
  async signOutOpenAiAuth(input: { id: string; expectedRevision: number }) {
    const parsed = DeleteModelConnectionSchema.safeParse(input)
    if (!parsed.success) throw new Error('invalid_model_connection')
    const store = getModelConnectionStore()
    await store.oauthForCheck(parsed.data.id, parsed.data.expectedRevision)
    return store.delete(parsed.data)
  }

  @IpcMethod()
  async getModelCatalog() {
    return readBundledModelCatalog(resolveBundledCliEntry())
  }

  @IpcMethod()
  async getModelMetadataSnapshot() {
    return readBundledModelMetadataSnapshot(resolveBundledCliEntry())
  }

  @IpcMethod()
  async save(input: SaveModelConnection) {
    const parsed = SaveModelConnectionSchema.safeParse(input)
    if (!parsed.success) throw new Error('invalid_model_connection')
    return getModelConnectionStore().save(parsed.data)
  }

  @IpcMethod()
  async delete(input: { id: string; expectedRevision: number }) {
    const parsed = DeleteModelConnectionSchema.safeParse(input)
    if (!parsed.success) throw new Error('invalid_model_connection')
    return getModelConnectionStore().delete(parsed.data)
  }
}
