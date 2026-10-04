import type { McpConnectionSpec, WorkspaceMcpServerMeta } from '@molly/shared';
import {
  McpCredentialBindingSchema,
  type McpCredentialDestination,
  type McpToolDiscoveryResult,
} from '@molly/shared/embedded-harness';
import type { IpcServices } from '@/lib/electron-ipc-client';

type CredentialWriter = Pick<IpcServices['modelConnections'], 'saveMcp' | 'deleteMcp'>;
type ToolLister = Pick<IpcServices['modelConnections'], 'listMcpTools'>;

function destination(connection: McpConnectionSpec): McpCredentialDestination {
  return connection.transport === 'http'
    ? { transport: 'http', url: connection.url }
    : { transport: 'stdio', command: connection.command, args: connection.args ?? [] };
}

/** Persist secrets first; the returned entry is the only value allowed into Flock. */
export async function protectMcpEntry(
  entry: WorkspaceMcpServerMeta,
  previous: WorkspaceMcpServerMeta | undefined,
  writer: CredentialWriter | null
): Promise<WorkspaceMcpServerMeta> {
  const connection = entry.connection;
  const prior = previous?.connection?.protectedCredentials;
  if (!connection) {
    if (prior) throw new Error('mcp_credential_destination_required');
    return entry;
  }
  if (connection.transport === 'stdio' && (connection.envPassthrough?.length ?? 0) > 0)
    throw new Error('mcp_credential_passthrough_unsupported');
  const values =
    connection.transport === 'stdio' ? { ...connection.env } : { ...connection.headers };
  if (
    connection.transport === 'http' &&
    connection.bearerToken !== undefined &&
    connection.bearerToken !== ''
  ) {
    if (Object.keys(values).some((key) => key.toLowerCase() === 'authorization'))
      throw new Error('invalid_mcp_credential');
    values.Authorization = `Bearer ${connection.bearerToken}`;
  }
  if (Object.values(values).some((value) => /\$\{[^}]+\}/.test(value)))
    throw new Error('mcp_credential_passthrough_unsupported');
  const target = destination(connection);
  const publicConnection: McpConnectionSpec =
    target.transport === 'http'
      ? target
      : { ...target, ...(target.args.length ? {} : { args: undefined }) };
  const reference = connection.protectedCredentials;
  if (Object.keys(values).length || reference) {
    // An unchanged reference is safe to keep without reading/decrypting its value.
    if (
      !Object.keys(values).length &&
      reference &&
      previous?.connection &&
      JSON.stringify(reference) === JSON.stringify(prior) &&
      JSON.stringify(target) === JSON.stringify(destination(previous.connection))
    ) {
      return { ...entry, connection: { ...publicConnection, protectedCredentials: reference } };
    }
    if (!writer) throw new Error('mcp_credential_storage_unavailable');
    const saved = McpCredentialBindingSchema.parse(
      await writer.saveMcp({
        serverId: entry.id,
        destination: target,
        expectedRevision: prior?.revision,
        ...(Object.keys(values).length ? { values } : {}),
      })
    );
    if (saved.serverId !== entry.id || JSON.stringify(saved.destination) !== JSON.stringify(target))
      throw new Error('mcp_credential_identity_mismatch');
    return {
      ...entry,
      connection: {
        ...publicConnection,
        protectedCredentials: { credentialRef: saved.credentialRef, revision: saved.revision },
      },
    };
  }
  if (prior) {
    if (!writer) throw new Error('mcp_credential_storage_unavailable');
    await writer.deleteMcp({ serverId: entry.id, expectedRevision: prior.revision });
  }
  return { ...entry, connection: publicConnection };
}

/**
 * Lists the saved entry's tools exactly as stored. Rows still holding values outside protected
 * storage (legacy `${VAR}` references or passthrough) are refused rather than resolved here.
 */
export async function listSavedMcpTools(
  entry: WorkspaceMcpServerMeta,
  lister: ToolLister | null
): Promise<McpToolDiscoveryResult> {
  const connection = entry.connection;
  if (!lister) return { ok: false, reason: 'unavailable' };
  if (
    !connection ||
    (connection.transport === 'stdio' &&
      (Object.keys(connection.env ?? {}).length > 0 ||
        (connection.envPassthrough?.length ?? 0) > 0)) ||
    (connection.transport === 'http' &&
      (Object.keys(connection.headers ?? {}).length > 0 || connection.bearerToken !== undefined))
  )
    return { ok: false, reason: 'unsupported' };
  return lister.listMcpTools({
    serverId: entry.id,
    destination: destination(connection),
    ...(connection.protectedCredentials
      ? { protectedCredentials: connection.protectedCredentials }
      : {}),
  });
}
