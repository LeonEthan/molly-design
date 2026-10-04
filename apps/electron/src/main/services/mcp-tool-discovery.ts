import {
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
 * Vault values go only to the exact binding the renderer named; the reply is secret-free.
 */
export async function listMcpTools(
  input: unknown,
  deps: {
    workspaceId: string
    store: Pick<ModelConnectionStore, 'mcpValuesForDiscovery'>
    runHelper: DiscoveryHelper
    signal?: AbortSignal
  }
): Promise<McpToolDiscoveryResult> {
  const parsed = ListMcpToolsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'unsupported' }
  const { serverId, destination, protectedCredentials } = parsed.data
  let request: McpToolDiscoveryRequest = { destination }
  if (protectedCredentials) {
    const values = await deps.store.mcpValuesForDiscovery({
      workspaceId: deps.workspaceId,
      serverId,
      ...protectedCredentials,
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
