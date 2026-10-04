import {
  isMcpExposure,
  isMcpToolExposureRules,
  type McpExposure,
  type McpToolExposureRule,
} from './embedded-harness';
import type { McpConnectionSpec } from './workspace-mcp';

/**
 * One server parsed from the `mcpServers` shape shared by Pi, Claude Desktop/Code and Cursor
 * (Pi docs, "Migrate configuration from another client"). It prefills the Settings form, so
 * secrets still reach the vault through the ordinary save path.
 */
export type McpJsonImportedServer = {
  name?: string;
  description?: string;
  exposure?: McpExposure;
  toolExposure?: McpToolExposureRule[];
  connection: McpConnectionSpec;
};

export type McpJsonImportResult =
  | {
      ok: true;
      server: McpJsonImportedServer;
      ignoredFields: string[];
      /** Credential fields holding `${NAME}` references; protected storage keeps them literal. */
      referenceFields: string[];
    }
  | {
      ok: false;
      reason: 'invalid_json' | 'no_server' | 'multiple_servers' | 'unsupported_transport';
      names?: string[];
    }
  | { ok: false; reason: 'invalid_field'; field: string };

const STDIO_FIELDS = new Set(['type', 'command', 'args', 'env']);
const HTTP_FIELDS = new Set(['type', 'url', 'headers']);
const PRESENTATION_FIELDS = new Set(['description', 'exposure', 'toolExposure']);
const HTTP_TYPES = new Set(['http', 'streamable-http', 'streamableHttp']);
const BEARER_PREFIX = /^Bearer\s+/i;
const ENVIRONMENT_REFERENCE = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((item) => typeof item === 'string');

const canonicalExposure = (value: unknown): unknown =>
  value === 'codemode-deferred' ? 'codemode' : value;

function pickServer(
  root: Record<string, unknown>
): { name?: string; entry: unknown } | McpJsonImportResult {
  if ('command' in root || 'url' in root) return { entry: root };
  const map = isRecord(root.mcpServers)
    ? root.mcpServers
    : isRecord(root.servers)
      ? root.servers
      : root;
  const names = Object.keys(map);
  if (names.length === 0) return { ok: false, reason: 'no_server' };
  if (names.length > 1) return { ok: false, reason: 'multiple_servers', names };
  return { name: names[0], entry: map[names[0]!] };
}

export function parseMcpJsonImport(text: string): McpJsonImportResult {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  if (!isRecord(root)) return { ok: false, reason: 'no_server' };
  const picked = pickServer(root);
  if ('ok' in picked) return picked;
  const { name, entry } = picked;
  if (!isRecord(entry)) return { ok: false, reason: 'no_server' };

  const type = entry.type;
  const isStdio = typeof entry.command === 'string' && (type === undefined || type === 'stdio');
  const isHttp =
    typeof entry.url === 'string' &&
    (type === undefined || (typeof type === 'string' && HTTP_TYPES.has(type)));
  if (!isStdio && !isHttp)
    return 'command' in entry || 'url' in entry
      ? { ok: false, reason: 'unsupported_transport' }
      : { ok: false, reason: 'no_server' };

  const exposure = canonicalExposure(entry.exposure);
  if (exposure !== undefined && !isMcpExposure(exposure))
    return { ok: false, reason: 'invalid_field', field: 'exposure' };
  let toolExposure: McpToolExposureRule[] | undefined;
  if (entry.toolExposure !== undefined) {
    const rules = isRecord(entry.toolExposure)
      ? Object.entries(entry.toolExposure).map(([pattern, value]) => ({
          pattern: pattern.trim(),
          exposure: canonicalExposure(value),
        }))
      : undefined;
    if (!isMcpToolExposureRules(rules))
      return { ok: false, reason: 'invalid_field', field: 'toolExposure' };
    toolExposure = rules;
  }
  if (entry.description !== undefined && typeof entry.description !== 'string')
    return { ok: false, reason: 'invalid_field', field: 'description' };

  let connection: McpConnectionSpec;
  if (isStdio) {
    if (entry.args !== undefined && !(Array.isArray(entry.args) && entry.args.every((arg) => typeof arg === 'string')))
      return { ok: false, reason: 'invalid_field', field: 'args' };
    if (entry.env !== undefined && !isStringRecord(entry.env))
      return { ok: false, reason: 'invalid_field', field: 'env' };
    const args = entry.args as string[] | undefined;
    connection = {
      transport: 'stdio',
      command: entry.command as string,
      ...(args?.length ? { args: [...args] } : {}),
      ...(entry.env && Object.keys(entry.env).length ? { env: { ...entry.env } } : {}),
    };
  } else {
    if (entry.headers !== undefined && !isStringRecord(entry.headers))
      return { ok: false, reason: 'invalid_field', field: 'headers' };
    const headers = { ...(entry.headers ?? {}) };
    const authorizationKey = Object.keys(headers).find(
      (key) => key.toLowerCase() === 'authorization'
    );
    const authorization = authorizationKey ? headers[authorizationKey]! : undefined;
    const bearerToken =
      authorization && BEARER_PREFIX.test(authorization)
        ? authorization.replace(BEARER_PREFIX, '')
        : undefined;
    if (bearerToken !== undefined) delete headers[authorizationKey!];
    connection = {
      transport: 'http',
      url: entry.url as string,
      ...(bearerToken ? { bearerToken } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
    };
  }

  const known = isStdio ? STDIO_FIELDS : HTTP_FIELDS;
  const ignoredFields = Object.keys(entry)
    .filter((field) => !known.has(field) && !PRESENTATION_FIELDS.has(field))
    .sort();
  const credentials =
    connection.transport === 'stdio'
      ? Object.entries(connection.env ?? {})
      : [
          ...Object.entries(connection.headers ?? {}),
          ...(connection.bearerToken ? [['Authorization', connection.bearerToken] as const] : []),
        ];
  const referenceFields = credentials
    .filter(([, value]) => ENVIRONMENT_REFERENCE.test(value))
    .map(([field]) => field);
  const description = typeof entry.description === 'string' ? entry.description.trim() : '';
  return {
    ok: true,
    server: {
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
      ...(exposure !== undefined ? { exposure: exposure as McpExposure } : {}),
      ...(toolExposure?.length ? { toolExposure } : {}),
      connection,
    },
    ignoredFields,
    referenceFields,
  };
}
