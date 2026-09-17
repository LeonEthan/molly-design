/**
 * The machine-scoped image connection (P2.4).
 *
 * One OpenAI-Images-compatible endpoint the owning machine may call to generate or edit
 * images for design work: base URL, API key, model, and an enable switch. It is
 * deliberately the minimum that makes the built-in image tools usable — no
 * per-request knobs, no advanced options.
 *
 * ## Where it lives
 *
 * Machine-scoped, not workspace-scoped: the credential belongs to one machine's
 * operator, exactly like the per-machine Agent config `env` it sits beside. The
 * row is stored on the per-machine Flock doc
 * (`machineFlockKeys.imageConnection()`), written by the Electron-side writer
 * seam and read by the daemon and the built-in MCP server, which are both on the
 * machine the key belongs to.
 *
 * ## Trust
 *
 * This is a *user-typed* configuration, so it is normalized fail-closed on
 * every read (`normalizeImageConnectionSettings`): the value arrives from a Loro
 * CRDT row that any client may have written, including a newer one. A shape this
 * build cannot use reads as absent, and absent means the tool is not registered
 * at all — never a half-configured call to a guessed endpoint.
 *
 * `apiKey` is a secret: it must never reach an agent-visible MCP server config,
 * a log line, a tool response, or a shared workspace row. `toPublicImageConnection`
 * is the only shape a UI or an RPC reply may carry, and it reports only whether a
 * key is present.
 */

import { z } from 'zod';

export const IMAGE_CONNECTION_VERSION = 1;

export const IMAGE_CONNECTION_MAX_URL_LENGTH = 2048;
export const IMAGE_CONNECTION_MAX_API_KEY_LENGTH = 8192;
export const IMAGE_CONNECTION_MAX_MODEL_LENGTH = 200;

/**
 * The durable row. `v` is the schema generation, so a future shape can be
 * recognized and refused instead of misread as this one.
 */
export type ImageConnectionSettings = {
  v: typeof IMAGE_CONNECTION_VERSION;
  enabled: boolean;
  /** OpenAI-Images-compatible API root, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  /** Secret. Never rendered, echoed, or logged. */
  apiKey: string;
  model: string;
  /** Epoch ms, stamped by the writer (`getServerNow()`). */
  updatedAt: number;
};

/**
 * What a settings surface edits: the same fields without the version or
 * timestamp, because the writer stamps those. `apiKey` is the one secret, and a
 * blank value is meaningful ("leave the stored key alone" in the UI, "no key" in
 * the durable row).
 */
export type ImageConnectionDraft = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
};

/**
 * The non-secret projection. The only shape allowed out of an RPC or into a UI:
 * a settings surface still has to render "a key is stored" without ever holding
 * the key, and an RPC reply has no reason to carry it.
 */
export const PublicImageConnectionSchema = z
  .object({
    enabled: z.boolean(),
    baseUrl: z.string().min(1),
    model: z.string().min(1),
    hasApiKey: z.boolean(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export type PublicImageConnection = z.infer<typeof PublicImageConnectionSchema>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return undefined;
  return trimmed;
};

/**
 * An endpoint URL we are willing to send a credential to.
 *
 * http and https only, and no embedded credentials: `${scheme}://user:pass@host`
 * would put a second secret in a field that is stored and displayed in the
 * clear. A trailing slash is dropped so `baseUrl + '/models'` never doubles it.
 */
export function normalizeImageConnectionBaseUrl(value: unknown): string | undefined {
  const raw = boundedString(value, IMAGE_CONNECTION_MAX_URL_LENGTH);
  if (raw === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (url.username !== '' || url.password !== '') return undefined;
  if (url.search !== '' || url.hash !== '') return undefined;
  const pathname = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${pathname === '/' ? '' : pathname}`;
}

/**
 * Read a stored row. Returns `undefined` — not a defaulted value — for anything
 * this build cannot use, so callers branch on absence instead of on a sentinel.
 * An empty `model` is not repaired: the user must choose it explicitly.
 */
export function normalizeImageConnectionSettings(
  value: unknown
): ImageConnectionSettings | undefined {
  if (!isRecord(value)) return undefined;
  if (value.v !== IMAGE_CONNECTION_VERSION) return undefined;
  if (typeof value.enabled !== 'boolean') return undefined;
  const baseUrl = normalizeImageConnectionBaseUrl(value.baseUrl);
  if (baseUrl === undefined) return undefined;
  const model = boundedString(value.model, IMAGE_CONNECTION_MAX_MODEL_LENGTH);
  if (model === undefined) return undefined;
  const updatedAt = value.updatedAt;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) {
    return undefined;
  }
  // An empty key is a legal stored state (the user cleared it, or pasted the URL
  // before the key). It is simply not `ready`, so the tool stays unregistered.
  const apiKey =
    typeof value.apiKey === 'string' && value.apiKey.length <= IMAGE_CONNECTION_MAX_API_KEY_LENGTH
      ? value.apiKey.trim()
      : undefined;
  if (apiKey === undefined) return undefined;
  return {
    v: IMAGE_CONNECTION_VERSION,
    enabled: value.enabled,
    baseUrl,
    apiKey,
    model,
    updatedAt,
  };
}

/**
 * The one predicate that decides whether image capability exists.
 *
 * Everything that gates on the connection — tool registration, skill
 * materialization, the settings test button — asks exactly this, so "capability
 * presence matches env presence" is one rule rather than three that drift.
 */
export function isImageConnectionReady(
  settings: ImageConnectionSettings | undefined | null
): settings is ImageConnectionSettings {
  return (
    settings != null &&
    settings.enabled &&
    settings.apiKey.trim().length > 0 &&
    normalizeImageConnectionSettings(settings) !== undefined
  );
}

/** Drop the secret before the value leaves the machine's own processes. */
export function toPublicImageConnection(
  settings: ImageConnectionSettings | undefined
): PublicImageConnection | null {
  if (!settings) return null;
  return {
    enabled: settings.enabled,
    baseUrl: settings.baseUrl,
    model: settings.model,
    hasApiKey: settings.apiKey.length > 0,
    updatedAt: settings.updatedAt,
  };
}

/**
 * Join a configured base URL with an API path.
 *
 * The base URL is stored without a trailing slash, so this is string
 * concatenation over a normalized root; it never re-parses the path, which keeps
 * a caller-supplied path from being able to escape the configured origin.
 */
export const imageConnectionUrl = (settings: ImageConnectionSettings, apiPath: string): string =>
  `${settings.baseUrl}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;

/** The non-billable discovery endpoint the settings "test connection" action uses. */
export const IMAGE_CONNECTION_MODELS_PATH = '/models';

/** The generation endpoint. Paid; only `molly_generate_image` calls it. */
export const IMAGE_CONNECTION_GENERATIONS_PATH = '/images/generations';
export const IMAGE_CONNECTION_EDITS_PATH = '/images/edits';

/**
 * The one network seam both callers use.
 *
 * Declared here — as an interface, not an implementation — because the same
 * shape is driven from two places on the machine: the settings "test connection"
 * probe in the daemon and the paid generation call in the built-in MCP server.
 * Naming it once means the bearer header, the timeout, and the response cap are
 * built by one function and asserted by one fake in tests; no test ever opens a
 * socket, and no production path can reach an upstream without going through a
 * transport someone explicitly handed in.
 *
 * `timeoutMs` and `maxBytes` are part of the request (not the transport's own
 * configuration) so a transport cannot silently pick weaker limits than the
 * caller that needs them.
 */
export type ImageHttpRequest = {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  /** JSON request body, already serialized. Absent for GET. */
  body?: string;
  /** Multipart edits: the transport owns encoding and its boundary header. */
  multipart?: {
    fields: Record<string, string>;
    files: Array<{ field: string; filename: string; mimeType: string; bytes: Uint8Array }>;
  };
  timeoutMs: number;
  /** Caller cancellation, combined with `timeoutMs` by the production transport. */
  signal?: AbortSignal;
  /** Hard cap on the response body; exceeding it is an error, never a truncation. */
  maxBytes: number;
};

export type ImageHttpResponse = {
  status: number;
  bytes: Uint8Array;
};

export type ImageHttpTransport = (request: ImageHttpRequest) => Promise<ImageHttpResponse>;
