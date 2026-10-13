import {
  HarnessHostResultSchema,
  type HarnessCredentialReport,
  type HarnessMcpCredentialReport
} from '@molly/shared/embedded-harness'
import type { CliService } from './cli-service'
import type { ModelConnectionStore } from './model-connection-store.ts'
import { usableOAuthAccessToken } from './oauth-refresh.ts'
import type { OAuthProviderPresetId } from '@molly/shared/embedded-harness'

export function startHarnessCredentialHostCore(
  cliService: Pick<CliService, 'getLocalMachineId' | 'sendLocalMachineRpc'>,
  dependencies: {
    readPlatform: () => Promise<{ workspace: { workspaceId: string } } | null>
    getStore: () => ModelConnectionStore
    refresh?: typeof usableOAuthAccessToken
  }
): () => void {
  const refresh = dependencies.refresh ?? usableOAuthAccessToken
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let reports: HarnessCredentialReport[] = []
  let mcpReports: HarnessMcpCredentialReport[] = []
  let legacyImageAcknowledgement: string | undefined
  const pendingOAuthRequests = new Set<string>()
  const tick = async () => {
    let sentReports: HarnessCredentialReport[] = []
    let sentMcpReports: HarnessMcpCredentialReport[] = []
    try {
      const machineId = await cliService.getLocalMachineId()
      const platform = await dependencies.readPlatform()
      if (!machineId || !platform || stopped) return
      const store = dependencies.getStore()
      const catalog = await store.snapshot().catch(() => ({ connections: [] }))
      const image = await store.imageSnapshot().catch(() => ({ connection: null }))
      const mcp = await store.mcpSnapshot().catch(() => ({ connections: [] }))
      sentReports = reports
      sentMcpReports = mcpReports
      reports = []
      mcpReports = []
      const result = await cliService.sendLocalMachineRpc({
        machineId,
        workspaceId: platform.workspace.workspaceId,
        method: 'harness/host',
        params: {
          version: 1,
          connections: catalog.connections,
          reports: sentReports,
          imageConnection: image.connection,
          mcpConnections: mcp.connections.filter(
            (entry) => entry.workspaceId === platform.workspace.workspaceId
          ),
          mcpReports: sentMcpReports,
          legacyImageAcknowledgement
        }
      })
      if (stopped || !result.ok) return
      const parsed = HarnessHostResultSchema.safeParse(result.result)
      if (!parsed.success) return
      for (const report of sentReports) pendingOAuthRequests.delete(report.requestId)
      sentReports = []
      sentMcpReports = []
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
          request.session.workspaceId === platform.workspace.workspaceId &&
          binding.workspaceId === platform.workspace.workspaceId
            ? store.acquireMcpForRun(binding)
            : Promise.reject(new Error('credential_unavailable'))
        )
          .then(({ values }) => ({ ok: true as const, values }))
          .catch(() => ({ ok: false as const, error: 'credential_unavailable' as const }))
        mcpReports.push({
          requestId: request.requestId,
          sessionId: request.session.sessionId,
          runtimeEpoch: request.session.runtimeEpoch,
          credentialRef: binding.credentialRef,
          credentialRevision: binding.revision,
          result: credentialResult
        })
      }
      for (const request of parsed.data.requests) {
        if (stopped) return
        const snapshot = request.snapshot
        const imageConnection = request.imageConnection
        const credentialResult = await (async () => {
          if (imageConnection) {
            const { connection, apiKey } = await store.acquireImageForRun(
              imageConnection.id,
              imageConnection.revision
            )
            return JSON.stringify(connection) === JSON.stringify(imageConnection)
              ? { ok: true as const, apiKey }
              : { ok: false as const, error: 'credential_unavailable' as const }
          }
          const acquired = await store.acquireForRun(
            snapshot.connection.id,
            snapshot.connection.revision
          )
          if (JSON.stringify(acquired.connection) !== JSON.stringify(snapshot.connection))
            return { ok: false as const, error: 'credential_unavailable' as const }
          if ('oauth' in acquired) {
            if (pendingOAuthRequests.has(request.requestId)) return undefined
            pendingOAuthRequests.add(request.requestId)
            void refresh(
              store,
              snapshot.connection.id,
              snapshot.connection.providerPresetId as OAuthProviderPresetId,
              acquired.oauth,
              snapshot.connection.revision
            )
              .then((usable) => {
                if (stopped) return
                reports.push({
                  requestId: request.requestId,
                  runId: snapshot.runId,
                  runtimeEpoch: snapshot.runtimeEpoch,
                  connectionId: snapshot.connection.id,
                  connectionRevision: snapshot.connection.revision,
                  result: usable.ok
                    ? {
                        ok: true as const,
                        apiKey: usable.accessToken,
                        oauthConnectionId: snapshot.connection.id,
                        ...(usable.accountId ? { oauthAccountId: usable.accountId } : {})
                      }
                    : { ok: false as const, error: 'credential_unavailable' as const }
                })
              })
              .catch(() => undefined)
            return undefined
          }
          return { ok: true as const, apiKey: acquired.apiKey }
        })().catch(() => ({ ok: false as const, error: 'credential_unavailable' as const }))
        if (!credentialResult) continue
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
      if (!stopped) {
        reports = [...sentReports, ...reports]
        mcpReports = [...sentMcpReports, ...mcpReports]
        timer = setTimeout(() => {
          void tick()
        }, 1000)
      }
    }
  }
  void tick()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    reports = []
    mcpReports = []
    pendingOAuthRequests.clear()
  }
}
