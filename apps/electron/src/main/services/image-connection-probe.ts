import type { ModelConnectionStore } from './model-connection-store'

/** Explicit settings-only discovery. Never generate, retry, redirect or return upstream diagnostics. */
export async function probeProtectedImageConnection(
  store: ModelConnectionStore,
  expectedRevision: number,
  transport: typeof fetch = fetch
): Promise<{ ok: true; modelCount: number } | { ok: false; error: string }> {
  try {
    const { connection } = await store.imageSnapshot()
    if (!connection || connection.revision !== expectedRevision)
      return { ok: false, error: 'image_connection_revision_conflict' }
    const { apiKey } = await store.acquireImageForRun(connection.id, connection.revision)
    const response = await transport(`${connection.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) {
      await response.body?.cancel()
      return { ok: false, error: `image_connection_http_${response.status}` }
    }
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 2 * 1024 * 1024) {
          await reader.cancel()
          return { ok: false, error: 'image_connection_response_too_large' }
        }
        chunks.push(value)
      }
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const modelCount =
      data && typeof data === 'object' && 'data' in data && Array.isArray(data.data)
        ? data.data.length
        : 0
    return { ok: true, modelCount }
  } catch {
    return { ok: false, error: 'image_connection_probe_failed' }
  }
}
