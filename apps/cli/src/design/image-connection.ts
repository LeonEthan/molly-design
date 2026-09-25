/**
 * The daemon's view of the machine's image connection (P2.4).
 *
 * One module owns the two things the daemon does with the setting:
 *
 * - **Read it** from the per-machine Flock doc, where the settings surface wrote
 *   it. The daemon is the only reader that also has the document open for other
 *   reasons, so it resolves the row once and serves it to everyone who asks —
 *   the built-in MCP server over the local control socket, the design turn
 *   preparation, and the settings "test connection" action.
 * - **Probe it** against the upstream's non-billable discovery endpoint. The
 *   probe never generates: a test that cost money would make users avoid the
 *   button that tells them whether their credential works.
 *
 * The secret rules of `@molly/shared` `image-connection.ts` apply here: the
 * resolved settings carry the API key, so they may only travel over the
 * machine-local control socket, and every failure message this module produces
 * is built from the URL, the status, and the upstream's own text — never from a
 * request header.
 */

import {
  IMAGE_CONNECTION_MODELS_PATH,
  imageConnectionUrl,
  isImageConnectionReady,
  type ImageConnectionSettings,
  type ImageHttpRequest,
  type ImageHttpTransport,
} from '@molly/shared';
import {
  getMachineFlockDocId,
  getMachineFlockImageConnection,
  readMachineFlockRowsFromFlock,
} from '@molly/shared';
import type { MachineId, WorkspaceId } from '@molly/shared';
import type { LoroRepo } from 'loro-repo';

/** The subset of the repo this module needs, so a test can hand over a stand-in. */
export type ImageConnectionReader = Pick<LoroRepo, 'openFlockDoc'>;

/**
 * This machine's stored image connection, or `undefined` when none is stored or
 * the stored row is not a shape this build can use.
 *
 * Read-only and non-syncing on purpose: the row lives in the same document the
 * daemon already keeps open for agent config, and a settings write is a local
 * Flock write that is durable before its upload. A read that had to reach the
 * network would make tool registration fail whenever the machine is offline.
 */
export async function readMachineImageConnection(
  repo: ImageConnectionReader,
  workspaceId: WorkspaceId,
  machineId: MachineId
): Promise<ImageConnectionSettings | undefined> {
  const handle = await repo.openFlockDoc(getMachineFlockDocId(workspaceId, machineId));
  return getMachineFlockImageConnection(
    readMachineFlockRowsFromFlock(handle.flock, { families: ['imageConnection'] })
  );
}

export type ImageConnectionProbeResult =
  | { ok: true; modelCount: number }
  | { ok: false; error: string };

export const IMAGE_CONNECTION_PROBE_TIMEOUT_MS = 15_000;
/** A model list is small; anything larger is not a discovery response we trust. */
export const IMAGE_CONNECTION_PROBE_MAX_BYTES = 2 * 1024 * 1024;
const PROBE_ERROR_BODY_CHARS = 300;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const decodeBodyText = (bytes: Uint8Array): string =>
  new TextDecoder().decode(bytes).slice(0, PROBE_ERROR_BODY_CHARS);

/**
 * Remove the credential from text the upstream wrote.
 *
 * The base URL is user-typed, so the endpoint is not necessarily a party we
 * trust: a gateway that echoes request headers in its error body (or in a
 * redirect notice) would otherwise put the key into a message that the settings
 * panel shows, the MCP tool hands to the agent, and the daemon logs. Redacting
 * the exact credential we sent costs nothing and closes that echo.
 */
export function redactCredential(text: string, credential: string): string {
  if (credential.length === 0) return text;
  let out = text;
  for (const form of [credential, encodeURIComponent(credential)]) {
    if (form.length > 0 && out.includes(form)) out = out.split(form).join('[redacted]');
  }
  return out;
}

/** The upstream's own explanation when it has one, else the raw body, else nothing. */
function upstreamMessage(bytes: Uint8Array, credential: string): string {
  const text = decodeBodyText(bytes);
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    const message = parsed?.error?.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return redactCredential(message.trim(), credential).slice(0, PROBE_ERROR_BODY_CHARS);
    }
  } catch {
    // Not JSON; the raw snippet below is the honest answer.
  }
  return redactCredential(text.trim(), credential);
}

/**
 * Check that the configured credential can reach the configured endpoint.
 *
 * Hits `GET {baseUrl}/models`, a common OpenAI-compatible discovery endpoint.
 * This probe does not verify image generation or edit support. An incomplete
 * connection is refused before any request is built, so an "enabled but no key"
 * row cannot turn into an unauthenticated call to someone's server.
 */
export async function probeImageConnection(
  settings: ImageConnectionSettings | undefined,
  transport: ImageHttpTransport
): Promise<ImageConnectionProbeResult> {
  if (!isImageConnectionReady(settings)) {
    return { ok: false, error: 'image_connection_incomplete' };
  }
  let response: { status: number; bytes: Uint8Array };
  try {
    response = await transport(buildImageModelsRequest(settings));
  } catch (error) {
    return { ok: false, error: redactCredential(errorText(error), settings.apiKey) };
  }
  if (response.status < 200 || response.status >= 300) {
    const detail = upstreamMessage(response.bytes, settings.apiKey);
    return {
      ok: false,
      error: `HTTP ${response.status}${detail.length > 0 ? `: ${detail}` : ''}`,
    };
  }
  return { ok: true, modelCount: countModels(response.bytes) };
}

/**
 * The discovery request. Exported so the paid generation path and the probe
 * cannot drift: both build their headers here, and the tests assert this exact
 * shape rather than a mock's recollection of it.
 */
export function buildImageModelsRequest(settings: ImageConnectionSettings): ImageHttpRequest {
  return {
    url: imageConnectionUrl(settings, IMAGE_CONNECTION_MODELS_PATH),
    method: 'GET',
    headers: {
      authorization: `Bearer ${settings.apiKey}`,
      accept: 'application/json',
    },
    timeoutMs: IMAGE_CONNECTION_PROBE_TIMEOUT_MS,
    maxBytes: IMAGE_CONNECTION_PROBE_MAX_BYTES,
  };
}

/** `{ data: [...] }` is the OpenAI shape; anything else counts as "reachable, unknown count". */
function countModels(bytes: Uint8Array): number {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { data?: unknown };
    return Array.isArray(parsed?.data) ? parsed.data.length : 0;
  } catch {
    return 0;
  }
}

/**
 * The production transport: one `fetch` per call with an explicit deadline.
 *
 * The body is read through the response stream so `maxBytes` is enforced while
 * the bytes arrive — a cap applied after `arrayBuffer()` would already have
 * buffered the whole thing. An aborted or oversized response is an error with a
 * message a user can act on, never a partial success.
 */
export const fetchImageHttpTransport: ImageHttpTransport = async (request) => {
  request.signal?.throwIfAborted();
  const deadline = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    deadline.abort();
  }, request.timeoutMs);
  const cancelDeadline = () => clearTimeout(timer);
  request.signal?.addEventListener('abort', cancelDeadline, { once: true });
  const signal = request.signal
    ? AbortSignal.any([request.signal, deadline.signal])
    : deadline.signal;
  try {
    const body = request.body;
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(body === undefined ? {} : { body }),
      signal,
      redirect: 'error',
    });
    const bytes = await readBoundedBody(response, request.maxBytes);
    return { status: response.status, bytes };
  } catch (error) {
    // `cause` keeps the transport failure for diagnostics without letting it
    // rewrite the message: only the bounded text below reaches the user.
    if (timedOut) {
      throw new Error(`request timed out after ${request.timeoutMs}ms`, { cause: error });
    }
    request.signal?.throwIfAborted();
    throw new Error(errorText(error), { cause: error });
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', cancelDeadline);
  }
};

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`);
    return new Uint8Array(buffer);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
