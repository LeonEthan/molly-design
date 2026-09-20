import {
  getWorkspaceFlockDocId,
  getWorkspaceMcpCatalog,
  readWorkspaceFlockRowsFromFlock,
  resolveSessionMcpServers,
  type McpServerId,
  type ResolveSessionMcpServersResult,
  type ResolveSessionMcpServersInput,
  type SessionId,
  type WorkspaceFlockReadableFlock,
  type WorkspaceId,
  type ResolvedMcpServer,
} from '@molly/shared';
import { formatErrorMessage } from '@/utils/format-error';

/**
 * Applies the agent's advertised capabilities to an already-loaded catalog.
 * Pure, so it can run at the exact point ACP startup needs the server list.
 */
export type SessionMcpCatalogSelector = ((
  agentCapabilities: ResolveSessionMcpServersInput['agentCapabilities']
) => ResolveSessionMcpServersResult) & {
  guard?: {
    isCurrent(): boolean;
    subscribe(onInvalidated: () => void): () => void;
  };
};

export type LoadSessionMcpCatalogInput = {
  repo: {
    openFlockDoc(docId: string): Promise<{
      flock: WorkspaceFlockReadableFlock & { subscribe?: (callback: () => void) => () => void };
    }>;
  };
  syncFlockDoc?: (docId: string, options: { timeoutMs: number }) => Promise<void>;
  workspaceId: WorkspaceId;
  sessionId: SessionId;
  selectedIds: readonly McpServerId[];
  logger: { debug(message: string): void };
  env?: Readonly<Record<string, string | undefined>>;
  /** Embedded dispatch needs a live catalog fence, not a best-effort snapshot. */
  guarded?: boolean;
  protectedMcp?: ResolveSessionMcpServersInput['protectedMcp'];
};

const CATALOG_SYNC_TIMEOUT_MS = 5_000;

const EMPTY_SELECTION: SessionMcpCatalogSelector = () => ({ servers: [], problems: [] });

/**
 * Loads the workspace MCP catalog for an ACP session start.
 *
 * Deliberately split from selection: the only thing selection needs from the
 * agent is its advertised `http` capability, so this — a remote catalog sync
 * plus a document read — can overlap process spawn and the ACP handshake
 * instead of adding a round trip between `initialize` and `newSession`.
 *
 * Best effort. Configuration failures come back as problems on the selector so
 * the agent still starts with its built-in MCP.
 */
export const loadSessionMcpCatalog = async (
  input: LoadSessionMcpCatalogInput
): Promise<SessionMcpCatalogSelector> => {
  const { logger, selectedIds, sessionId } = input;
  if (selectedIds.length === 0) {
    return EMPTY_SELECTION;
  }

  const docId = getWorkspaceFlockDocId(input.workspaceId);
  if (input.syncFlockDoc) {
    try {
      await input.syncFlockDoc(docId, { timeoutMs: CATALOG_SYNC_TIMEOUT_MS });
    } catch (error) {
      logger.debug(
        `[${sessionId}] Workspace MCP catalog refresh failed; using local rows: ${input.guarded ? 'harness_mcp_catalog_refresh_failed' : formatErrorMessage(error)}`
      );
    }
  }

  try {
    const handle = await input.repo.openFlockDoc(docId);
    const catalog = getWorkspaceMcpCatalog(readWorkspaceFlockRowsFromFlock(handle.flock));
    // Embedded workers never expand ambient daemon secrets into ACP command/URL data.
    const env = input.guarded ? {} : { ...(input.env ?? process.env) };
    if (!input.guarded)
      return (agentCapabilities) =>
        resolveSessionMcpServers({ catalog, selectedIds, agentCapabilities, env });
    if (!handle.flock.subscribe) throw new Error('harness_mcp_catalog_watch_required');
    // This private comparison also catches old writers which fail to advance revision.
    const identity = (rows: typeof catalog) =>
      JSON.stringify(selectedIds.map((id) => rows[id] ?? null));
    const frozen = identity(catalog);
    let invalidated = false;
    const isCurrent = () => {
      try {
        invalidated ||=
          identity(getWorkspaceMcpCatalog(readWorkspaceFlockRowsFromFlock(handle.flock))) !==
          frozen;
      } catch {
        invalidated = true;
      }
      return !invalidated;
    };
    const selector: SessionMcpCatalogSelector = (agentCapabilities) => {
      if (!isCurrent()) throw new Error('harness_mcp_catalog_changed');
      const result = resolveSessionMcpServers({
        catalog,
        selectedIds,
        agentCapabilities,
        env,
        protectedMcp: input.protectedMcp,
      });
      const servers: ResolvedMcpServer[] = [];
      for (const server of result.servers) {
        const entry = selectedIds
          .map((id) => catalog[id])
          .find((candidate) => candidate?.name === server.name);
        if (!entry) throw new Error('harness_mcp_catalog_identity_mismatch');
        if (!entry.revision) {
          result.problems.push({
            kind: 'invalid_connection',
            mcpServerId: entry.id,
            name: server.name,
            reason:
              'Save this historical connection in Settings to establish its execution revision',
          });
          continue;
        }
        if ('type' in server ? server.headers.length > 0 : server.env.length > 0) {
          result.problems.push({
            kind: 'invalid_connection',
            mcpServerId: entry.id,
            name: server.name,
            reason:
              'Save credentials in Settings to use protected delivery; raw credentials cannot travel in ACP startup data',
          });
          continue;
        }
        if ('type' in server) {
          let publicEndpoint = false;
          try {
            const endpoint = new URL(server.url);
            publicEndpoint =
              ['https:', 'http:'].includes(endpoint.protocol) &&
              !endpoint.username &&
              !endpoint.password &&
              !endpoint.search &&
              !endpoint.hash;
          } catch {
            /* Invalid URLs never reach ACP or diagnostics. */
          }
          if (!publicEndpoint) {
            result.problems.push({
              kind: 'invalid_connection',
              mcpServerId: entry.id,
              name: server.name,
              reason:
                'Embedded MCP requires a public HTTP endpoint without URL credentials, query or fragment',
            });
            continue;
          }
        }
        servers.push({
          ...server,
          _meta: {
            ...server._meta,
            mollyConnection: { id: entry.id, revision: entry.revision },
            ...(entry.imageBinding ? { mollyImageBinding: entry.imageBinding } : {}),
          },
        });
      }
      return { ...result, servers };
    };
    selector.guard = {
      isCurrent,
      subscribe: (notify) => {
        let notified = false;
        const check = () => {
          if (!isCurrent() && !notified) {
            notified = true;
            notify();
          }
        };
        const unsubscribe = handle.flock.subscribe!(check);
        check();
        return unsubscribe;
      },
    };
    return selector;
  } catch (error) {
    const reason = input.guarded ? 'harness_mcp_catalog_unavailable' : formatErrorMessage(error);
    logger.debug(`[${sessionId}] Workspace MCP catalog read failed: ${reason}`);
    return () => ({ servers: [], problems: [{ kind: 'catalog_unavailable', reason }] });
  }
};
