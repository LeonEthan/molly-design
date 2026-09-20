import { IpcMethod, IpcService } from 'electron-ipc-decorator'
import {
  SaveModelConnectionSchema,
  DeleteModelConnectionSchema,
  SaveProtectedImageConnectionSchema,
  SaveMcpCredentialSettingsSchema,
  DeleteMcpCredentialSchema,
  type SaveMcpCredential,
  type SaveProtectedImageConnection,
  type SaveModelConnection
} from '@molly/shared/embedded-harness'
import { getModelConnectionStore } from '../../services/model-connections'
import { probeProtectedImageConnection } from '../../services/image-connection-probe'
import { z } from 'zod'
import { readLocalPlatformSnapshot } from '../../platform'
import { resolveBundledCliEntry } from '../../services/cli-service'
import { readBundledCapabilities } from '../../services/bundled-capabilities'

async function localWorkspaceId(): Promise<string> {
  const platform = await readLocalPlatformSnapshot()
  if (!platform) throw new Error('local_workspace_unavailable')
  return platform.workspace.workspaceId
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

  @IpcMethod()
  async saveImage(input: SaveProtectedImageConnection) {
    const parsed = SaveProtectedImageConnectionSchema.safeParse(input)
    if (!parsed.success) throw new Error('invalid_image_connection')
    return getModelConnectionStore().saveImage(parsed.data)
  }

  @IpcMethod()
  async testImage(input: { expectedRevision: number }) {
    const parsed = z
      .object({ expectedRevision: z.number().int().positive() })
      .strict()
      .safeParse(input)
    if (!parsed.success) throw new Error('invalid_image_connection_probe')
    return probeProtectedImageConnection(getModelConnectionStore(), parsed.data.expectedRevision)
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
