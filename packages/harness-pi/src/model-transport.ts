/** The selected credential cannot follow an HTTP redirect to a new recipient. */
export function createBoundModelFetch(
  baseUrl: string,
  transport: typeof fetch = globalThis.fetch
): typeof fetch {
  const origin = new URL(baseUrl).origin;
  return async (request, options) => {
    const url = new URL(
      typeof request === 'string' ? request : request instanceof URL ? request.href : request.url
    );
    if (url.origin !== origin || url.username || url.password)
      throw new Error('harness_model_destination_changed');
    // Redirects require an explicit connection edit, even when a vendor's SDK
    // would otherwise forward its non-standard API-key header automatically.
    try {
      const response = await transport(request, { ...options, redirect: 'error' });
      if (response.ok) return response;
      // Vendor error bodies can echo request headers or keys. Preserve HTTP classification,
      // not the raw body, before the SDK can retain it in its native session JSONL.
      await response.body?.cancel();
      return new Response(
        JSON.stringify({ error: { message: `harness_provider_http_${response.status}` } }),
        { status: response.status, headers: { 'content-type': 'application/json' } }
      );
    } catch {
      const signal = options?.signal ?? (request instanceof Request ? request.signal : undefined);
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
      throw new Error('harness_model_transport_failed');
    }
  };
}
