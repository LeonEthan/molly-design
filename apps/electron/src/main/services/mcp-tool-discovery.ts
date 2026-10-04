import type { McpConnectionSpec } from '@molly/shared'
import {
  hasUnprotectedMcpValues,
  mcpConnectionDestination,
  sameMcpDestination,
  ListMcpToolsSchema,
  McpToolDiscoveryResultSchema,
  type McpToolDiscoveryRequest,
  type McpToolDiscoveryResult
} from '@molly/shared/embedded-harness'
import type { PrivateHelperResult } from './cli-service'
import type { ModelConnectionStore } from './model-connection-store'

const DISCOVERY_TIMEOUT_MS = 25_000
const MAX_HELPER_OUTPUT_BYTES = 1024 * 1024

export type DiscoveryHelper = (
  input: string,
  limits: { timeoutMs: number; maxOutputBytes: number; signal?: AbortSignal }
) => Promise<PrivateHelperResult>

const HELPER_FAILURES = {
  timed_out: 'timed_out',
  limit_exceeded: 'limit_exceeded',
  cancelled: 'unavailable',
  unavailable: 'unavailable'
} as const

/**
 * Settings-only and explicit: list one saved MCP server's tools through the bundled CLI helper.
 * The daemon's catalog row, not the caller, names what runs; vault values go only to that exact
 * binding, and the reply is secret-free.
 */
export async function listMcpTools(
  input: unknown,
  deps: {
    workspaceId: string
    store: Pick<ModelConnectionStore, 'mcpValuesForDiscovery'>
    /** The saved catalog row's connection; null when absent, undefined when unreadable. */
    readCatalogEntry: (serverId: string) => Promise<McpConnectionSpec | null | undefined>
    runHelper: DiscoveryHelper
    signal?: AbortSignal
  }
): Promise<McpToolDiscoveryResult> {
  const parsed = ListMcpToolsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'unsupported' }
  const { serverId, destination: requested, protectedCredentials: expected } = parsed.data
  const saved = await deps.readCatalogEntry(serverId)
  if (saved === undefined) return { ok: false, reason: 'unavailable' }
  if (saved === null) return { ok: false, reason: 'changed' }
  if (hasUnprotectedMcpValues(saved)) return { ok: false, reason: 'unsupported' }
  const destination = mcpConnectionDestination(saved)
  const protectedCredentials = saved.protectedCredentials
  if (
    !sameMcpDestination(destination, requested) ||
    protectedCredentials?.credentialRef !== expected?.credentialRef ||
    protectedCredentials?.revision !== expected?.revision
  )
    return { ok: false, reason: 'changed' }
  let request: McpToolDiscoveryRequest = { destination }
  if (protectedCredentials) {
    const values = await deps.store.mcpValuesForDiscovery({
      workspaceId: deps.workspaceId,
      serverId,
      credentialRef: protectedCredentials.credentialRef,
      revision: protectedCredentials.revision,
      destination
    })
    if (!values) return { ok: false, reason: 'changed' }
    request = { destination, values }
  }
  const outcome = await deps.runHelper(JSON.stringify(request), {
    timeoutMs: DISCOVERY_TIMEOUT_MS,
    maxOutputBytes: MAX_HELPER_OUTPUT_BYTES,
    signal: deps.signal
  })
  if (outcome.kind !== 'exited') return { ok: false, reason: HELPER_FAILURES[outcome.kind] }
  try {
    const result = McpToolDiscoveryResultSchema.safeParse(JSON.parse(outcome.stdout.trim()))
    return result.success ? result.data : { ok: false, reason: 'invalid_response' }
  } catch {
    return { ok: false, reason: 'invalid_response' }
  }
}
