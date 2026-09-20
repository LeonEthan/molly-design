import {
  HarnessHostResultSchema,
  type HarnessCredentialReport,
  type HarnessMcpCredentialReport
} from '@molly/shared/embedded-harness'
import type { CliService } from './cli-service'
import { readLocalPlatformSnapshot } from '../platform'
import { getModelConnectionStore } from './model-connections'

/** Reuses the owner-only daemon control socket; no listener or renderer secret-read API. */
export function startHarnessCredentialHost(cliService: CliService): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let reports: HarnessCredentialReport[] = []
  let mcpReports: HarnessMcpCredentialReport[] = []
  let legacyImageAcknowledgement: string | undefined
  const tick = async () => {
    try {
      const machineId = await cliService.getLocalMachineId()
      const platform = await readLocalPlatformSnapshot()
      if (!machineId || !platform || stopped) return
      const store = getModelConnectionStore()
      const catalog = await store.snapshot().catch(() => ({ connections: [] }))
      const image = await store.imageSnapshot().catch(() => ({ connection: null }))
      const mcp = await store.mcpSnapshot().catch(() => ({ connections: [] }))
      const result = await cliService.sendLocalMachineRpc({
        machineId,
        workspaceId: platform.workspace.workspaceId,
        method: 'harness/host',
        params: {
          version: 1,
          connections: catalog.connections,
          reports,
          imageConnection: image.connection,
          mcpConnections: mcp.connections.filter(
            (entry) => entry.workspaceId === platform.workspace.workspaceId
          ),
          mcpReports,
          legacyImageAcknowledgement
        }
      })
      if (stopped || !result.ok) return
      const parsed = HarnessHostResultSchema.safeParse(result.result)
      if (!parsed.success) return
      reports = []
      mcpReports = []
      legacyImageAcknowledgement = undefined
      if (parsed.data.legacyImageMigration) {
        const migration = parsed.data.legacyImageMigration
        await store
          .importLegacyImage(migration.connection)
          .then(() => {
            legacyImageAcknowledgement = migration.requestId
          })
          .catch(() => {
            /* Keep the old row; image migration must not starve model grants. */
          })
      }
      for (const request of parsed.data.mcpRequests ?? []) {
        if (stopped) return
        const binding = request.connection
        const credentialResult = await (
          request.preparation.workspaceId === platform.workspace.workspaceId &&
          binding.workspaceId === platform.workspace.workspaceId
            ? store.acquireMcpForRun(binding)
            : Promise.reject(new Error('credential_unavailable'))
        )
          .then(({ values }) => ({ ok: true as const, values }))
          .catch(() => ({ ok: false as const, error: 'credential_unavailable' as const }))
        mcpReports.push({
          requestId: request.requestId,
          runId: request.preparation.runId,
          runtimeEpoch: request.preparation.runtimeEpoch,
          credentialRef: binding.credentialRef,
          credentialRevision: binding.revision,
          result: credentialResult
        })
      }
      for (const request of parsed.data.requests) {
        if (stopped) return
        const snapshot = request.snapshot
        const imageConnection = request.imageConnection
        const credentialResult = await (
          imageConnection
            ? store.acquireImageForRun(imageConnection.id, imageConnection.revision)
            : store.acquireForRun(snapshot.connection.id, snapshot.connection.revision)
        )
          .then(({ connection, apiKey }) =>
            JSON.stringify(connection) === JSON.stringify(imageConnection ?? snapshot.connection)
              ? { ok: true as const, apiKey }
              : { ok: false as const, error: 'credential_unavailable' as const }
          )
          .catch(() => ({ ok: false as const, error: 'credential_unavailable' as const }))
        reports.push({
          requestId: request.requestId,
          runId: snapshot.runId,
          runtimeEpoch: snapshot.runtimeEpoch,
          connectionId: snapshot.connection.id,
          connectionRevision: snapshot.connection.revision,
          ...(imageConnection
            ? {
                imageConnectionId: imageConnection.id,
                imageConnectionRevision: imageConnection.revision
              }
            : {}),
          result: credentialResult
        })
      }
    } catch {
      /* No raw transport/storage exception can become a credential diagnostic. */
    } finally {
      if (!stopped)
        timer = setTimeout(() => {
          void tick()
        }, 1000)
    }
  }
  void tick()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    reports = []
    mcpReports = []
  }
}
