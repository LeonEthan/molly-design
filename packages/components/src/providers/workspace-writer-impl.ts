import { HistoryEntryWriteSchema, parseHistoryWrite } from '@molly/shared';
import {
  applyPreviewVisualCommentMutation,
  getServerNow,
  getSessionRoomId,
  isWorkspaceMcpServerMeta,
  writeWorkspaceMcpServerToFlock,
  writeWorkspaceAgentRoleToFlock,
  normalizeAgentRole,
  parseMachineFlockRow,
  getMachineFlockAgentConfigs,
  serializeMachineFlockKey,
  getMachineFlockDocId,
  machineFlockKeys,
  DesignContinuationRecordSchema,
  DesignContinuationSourceSchema,
  buildDesignContinuationPublication,
  getDesignContinuationSystemContext,
  isLoroRepoDocDeleted,
  type SessionMeta,
  type MachineId,
  type AgentConfigId,
  type WorkspaceId,
  type MessageQueueItem,
  type PreviewVisualCommentDocInput,
} from '@molly/shared';
import type { SessionId } from '@molly/shared/ids';
import {
  getEmbeddedHarnessTargetError,
  validateMollyRunConfigProjection,
} from '@molly/shared/embedded-harness';
import type { LoroRepo } from 'loro-repo';
import type {
  PreviewVisualCommentDocStore,
  SessionDocDraft,
  SessionDocStore,
} from '../atoms/runtime';
import type { WorkspaceWriter } from './workspace-writer';

// # WorkspaceWriter implementation
//
// Dual-author: every client authors the mutation against its own repo / session
// stores (identical for Web, Mobile, and Electron; see `workspace-writer.ts`).
// A pure factory with injected deps so hooks stay agnostic to the runtime.

/** Deps the writer needs from the runtime (repo + session stores). */
export type DirectWorkspaceWriterDeps = {
  repo: LoroRepo;
  acquireSessionStore: (sessionId: SessionId) => Promise<SessionDocStore>;
  releaseSessionStoreRef: (sessionId: SessionId) => void;
  acquirePreviewVisualCommentStore: (sessionId: SessionId) => Promise<PreviewVisualCommentDocStore>;
  releasePreviewVisualCommentStoreRef: (sessionId: SessionId) => void;
};

/**
 * Direct-mode writer (web/cloud): applies each mutation to the renderer's own
 * repo / session stores. This is exactly what the hooks did before the seam, so
 * there is zero behavior change in cloud mode.
 */
export function createDirectWorkspaceWriter(deps: DirectWorkspaceWriterDeps): WorkspaceWriter {
  const withSessionStore = async <T>(
    sessionId: string,
    fn: (store: SessionDocStore) => T | Promise<T>
  ): Promise<T> => {
    const id = sessionId as SessionId;
    const store = await deps.acquireSessionStore(id);
    try {
      return await fn(store);
    } finally {
      deps.releaseSessionStoreRef(id);
    }
  };

  // Renderer-side, every message-queue mutation also bumps `messageQueueUpdatedAt`
  // so the CLI dispatch watcher re-evaluates.
  const bumpMessageQueueWatermark = async (sessionId: string): Promise<void> => {
    await deps.repo.upsertDocMeta(getSessionRoomId(sessionId as SessionId), {
      messageQueueUpdatedAt: getServerNow(),
    });
  };

  const withPreviewVisualCommentStore = async <T>(
    sessionId: SessionId,
    fn: (store: PreviewVisualCommentDocStore) => T | Promise<T>
  ): Promise<T> => {
    const store = await deps.acquirePreviewVisualCommentStore(sessionId);
    try {
      return await fn(store);
    } finally {
      deps.releasePreviewVisualCommentStoreRef(sessionId);
    }
  };

  return {
    async upsertDocMeta(roomId, patch) {
      await deps.repo.upsertDocMeta(roomId, patch as Parameters<LoroRepo['upsertDocMeta']>[1]);
    },

    async publishDesignContinuation(value, identity) {
      const parsed = DesignContinuationRecordSchema.safeParse(value);
      if (!parsed.success) throw new Error('invalid_design_continuation_record');
      const record = parsed.data;
      if (record.workspaceId !== identity.workspaceId || record.source.userId !== identity.userId)
        throw new Error('design_continuation_access_denied');
      const sessionId = record.target.sessionId as SessionId;
      const roomId = getSessionRoomId(sessionId);
      identity.signal?.throwIfAborted();
      return withSessionStore(sessionId, async (store) => {
        if (store.getState().designContinuation?.record === undefined) {
          const timeout = AbortSignal.timeout(20_000);
          await store.waitUntilSynced(
            identity.signal ? AbortSignal.any([identity.signal, timeout]) : timeout
          );
          identity.signal?.throwIfAborted();
        }
        const assertReceipt = () => {
          identity.signal?.throwIfAborted();
          const local = DesignContinuationRecordSchema.safeParse(
            store.getState().designContinuation?.record
          );
          if (!local.success) throw new Error('design_continuation_receipt_not_ready');
          if (JSON.stringify(local.data) !== JSON.stringify(record))
            throw new Error('design_continuation_record_changed');
        };
        assertReceipt();
        const machine = await deps.repo.openFlockDoc(
          getMachineFlockDocId(
            record.workspaceId as WorkspaceId,
            record.source.machineId as MachineId
          )
        );
        const configId = record.target.agentConfigId as AgentConfigId;
        const key = machineFlockKeys.agentConfig(configId);
        const sourceRow = await deps.repo.getDocMeta(
          getSessionRoomId(record.source.id as SessionId)
        );
        const existing = await deps.repo.getDocMeta(roomId);
        // Read the live catalog after asynchronous metadata lookups.
        const row = parseMachineFlockRow(key, machine.flock.get(key));
        const config = row
          ? getMachineFlockAgentConfigs({ [serializeMachineFlockKey(key)]: row })[configId]
          : undefined;
        if (
          !config ||
          config.id !== configId ||
          config.machineId !== record.source.machineId ||
          config.cliType !== 'builtin' ||
          config.agentType !== 'molly'
        )
          throw new Error('design_continuation_target_unavailable');
        const source = DesignContinuationSourceSchema.safeParse(sourceRow?.meta);
        if (
          isLoroRepoDocDeleted(sourceRow) ||
          !source.success ||
          JSON.stringify({ ...source.data, title: undefined }) !==
            JSON.stringify({ ...record.source, title: undefined })
        )
          throw new Error('design_continuation_source_changed');
        if (isLoroRepoDocDeleted(existing)) throw new Error('design_continuation_target_deleted');
        assertReceipt();
        if (existing?.meta && Object.keys(existing.meta).length > 0) {
          getDesignContinuationSystemContext(existing.meta as SessionMeta, record);
        } else {
          const publication = buildDesignContinuationPublication(record);
          // Immutable bindings only; preserve live metadata and tombstones.
          await deps.repo.upsertDocMeta(roomId, publication);
        }
        // upsert acknowledges memory, not disk. An explicit retry must also flush
        // a prior publication that survived only in memory after a failed barrier.
        await deps.repo.flush();
        assertReceipt();
        const published = await deps.repo.getDocMeta(roomId);
        if (!published || isLoroRepoDocDeleted(published))
          throw new Error('design_continuation_target_deleted');
        getDesignContinuationSystemContext(published.meta as SessionMeta, record);
        return published.meta as SessionMeta;
      });
    },

    async startSession(sessionId, meta, entry, dispatch) {
      // Reject invalid authored input before exposing metadata/dispatch.
      parseHistoryWrite(HistoryEntryWriteSchema, entry);
      await Promise.all([
        deps.repo.upsertDocMeta(
          getSessionRoomId(sessionId as SessionId),
          meta as Parameters<LoroRepo['upsertDocMeta']>[1]
        ),
        withSessionStore(sessionId, async (store) => {
          await store.sessionData.commands.appendTurn(entry);
        }),
      ]);
      void dispatch;
    },

    async deleteDoc(roomId) {
      await deps.repo.deleteDoc(roomId);
    },

    async flockRowPut(flockDocId, key, value) {
      const handle = await deps.repo.openFlockDoc(flockDocId);
      if (flockDocId.endsWith(':wf:workspace') && key[0] === 'mcpServer') {
        if (key.length !== 2 || !isWorkspaceMcpServerMeta(value) || value.id !== key[1])
          throw new Error('invalid_workspace_mcp_entry');
        writeWorkspaceMcpServerToFlock(handle.flock, value);
        return;
      }
      if (flockDocId.endsWith(':wf:workspace') && key[0] === 'agentRole') {
        const role = normalizeAgentRole(value);
        if (key.length !== 2 || !role || role.id !== key[1])
          throw new Error('invalid_workspace_agent_role');
        const previousValue = handle.flock.get([...key]);
        const previous = normalizeAgentRole(previousValue);
        const previousSnapshot = JSON.stringify(previousValue);
        if (previous?.embeddedMigration && !role.embeddedMigration)
          throw new Error('agent_role_migration_backup_immutable');
        const workspaceId = flockDocId.slice(0, -':wf:workspace'.length) as WorkspaceId;
        const machine = await deps.repo.openFlockDoc(
          getMachineFlockDocId(workspaceId, role.machineId)
        );
        const sourceMachine =
          previous && !role.embeddedMigration && previous.machineId !== role.machineId
            ? await deps.repo.openFlockDoc(getMachineFlockDocId(workspaceId, previous.machineId))
            : machine;
        const readConfig = (catalog: typeof machine, id: AgentConfigId) => {
          const configKey = machineFlockKeys.agentConfig(id);
          const row = parseMachineFlockRow(configKey, catalog.flock.get(configKey));
          return row
            ? getMachineFlockAgentConfigs({ [serializeMachineFlockKey(configKey)]: row })[id]
            : undefined;
        };
        // Re-read after all asynchronous catalog opens. No await remains before commit.
        const currentValue = handle.flock.get([...key]);
        const current = normalizeAgentRole(currentValue);
        if (
          JSON.stringify(currentValue) !== previousSnapshot &&
          JSON.stringify(current) !== JSON.stringify(role)
        )
          throw new Error(
            role.embeddedMigration
              ? 'agent_role_migration_source_changed'
              : 'agent_role_source_changed'
          );
        const config = readConfig(machine, role.agentConfigId);
        if (
          !config ||
          config.id !== role.agentConfigId ||
          config.machineId !== role.machineId ||
          getEmbeddedHarnessTargetError(config) !== undefined
        )
          throw new Error(
            role.embeddedMigration
              ? 'agent_role_migration_target_unavailable'
              : 'agent_role_target_unavailable'
          );
        if (previous && !role.embeddedMigration) {
          const sourceConfig = readConfig(sourceMachine, previous.agentConfigId);
          if (
            !sourceConfig ||
            sourceConfig.machineId !== previous.machineId ||
            getEmbeddedHarnessTargetError(sourceConfig) !== undefined
          )
            throw new Error('agent_role_migration_required');
        }
        validateMollyRunConfigProjection(role.runConfig);
        // Backup comparison and the single-row commit have no asynchronous gap.
        writeWorkspaceAgentRoleToFlock(handle.flock, role);
        return;
      }
      handle.flock.set([...key], value as Parameters<typeof handle.flock.set>[1]);
      handle.flock.commit();
    },

    async flockRowPutIfAbsent(
      flockDocId: string,
      key: readonly string[],
      value: unknown
    ): Promise<{ inserted: boolean; value: unknown }> {
      const handle = await deps.repo.openFlockDoc(flockDocId);
      if (flockDocId.endsWith(':wf:workspace') && key[0] === 'agentRole')
        throw new Error(
          normalizeAgentRole(value)?.embeddedMigration
            ? 'agent_role_migration_source_changed'
            : 'agent_role_insert_requires_validated_write'
        );
      return handle.flock.txn(() => {
        const existing = handle.flock.get([...key]);
        if (existing !== undefined) {
          return { inserted: false, value: existing };
        }

        handle.flock.put([...key], value as Parameters<typeof handle.flock.put>[1]);
        return { inserted: true, value };
      });
    },

    async flockRowDelete(flockDocId, key) {
      const handle = await deps.repo.openFlockDoc(flockDocId);
      handle.flock.delete([...key]);
      handle.flock.commit();
    },

    async appendSessionTurn(sessionId, entry, dispatch) {
      await withSessionStore(sessionId, async (store) => {
        await store.sessionData.commands.appendTurn(entry);
      });
      // Dispatch stays the caller's sibling side effect (Machine RPC / durable
      // pointer), matching the send hot path.
      void dispatch;
    },

    async appendSessionHistory(sessionId, entry) {
      await withSessionStore(sessionId, async (store) => {
        await store.sessionData.commands.appendTurn(entry);
      });
    },

    async updateSessionHistory(sessionId, entryId, entry) {
      await withSessionStore(sessionId, async (store) => {
        await store.sessionData.commands.replaceTurn(entryId, entry);
      });
    },

    async resolveSessionTaskProposal(sessionId, entryId, proposalId, resolution) {
      await withSessionStore(sessionId, async (store) => {
        const result = await store.sessionData.commands.resolveTaskProposal(
          entryId,
          proposalId,
          resolution
        );
        // The UI decision is best-effort: a proposal removed by a peer is not an
        // error, matching the previous silent no-op. A malformed decision still
        // throws the writer's validation diagnostic.
        if (!result) return;
      });
    },

    async respondSessionPermission(sessionId, requestId, outcome, options) {
      await withSessionStore(sessionId, async (store) => {
        if (!(await store.sessionData.commands.respondPermission(requestId, outcome, options)))
          throw new Error('Permission request not found');
      });
    },

    async enqueueSessionMessage(sessionId, item) {
      await withSessionStore(sessionId, (store) => {
        store.setState((draft: SessionDocDraft) => {
          const mq = (draft.mq ?? []) as MessageQueueItem[];
          draft.mq = [...mq, item as MessageQueueItem];
        });
      });
      await bumpMessageQueueWatermark(sessionId);
    },

    async removeSessionMessage(sessionId, itemId) {
      await withSessionStore(sessionId, (store) => {
        store.setState((draft: SessionDocDraft) => {
          const mq = (draft.mq ?? []) as MessageQueueItem[];
          draft.mq = mq.filter((item) => item.$cid !== itemId);
        });
      });
      await bumpMessageQueueWatermark(sessionId);
    },

    async updateSessionMessage(sessionId, itemId, patch) {
      await withSessionStore(sessionId, (store) => {
        store.setState((draft: SessionDocDraft) => {
          const mq = (draft.mq ?? []) as MessageQueueItem[];
          draft.mq = mq.map((item) =>
            item.$cid === itemId
              ? ({ ...item, ...patch, $cid: item.$cid } as MessageQueueItem)
              : item
          );
        });
      });
      await bumpMessageQueueWatermark(sessionId);
    },

    async reorderSessionMessages(sessionId, orderedItemIds) {
      await withSessionStore(sessionId, (store) => {
        store.setState((draft: SessionDocDraft) => {
          const mq = (draft.mq ?? []) as MessageQueueItem[];
          const byCid = new Map(mq.map((item) => [item.$cid, item] as const));
          const ordered: MessageQueueItem[] = [];
          for (const cid of orderedItemIds) {
            const item = byCid.get(cid);
            if (item) {
              ordered.push(item);
              byCid.delete(cid);
            }
          }
          for (const item of mq) {
            if (item.$cid !== undefined && byCid.has(item.$cid)) {
              ordered.push(item);
            }
          }
          draft.mq = ordered;
        });
      });
      await bumpMessageQueueWatermark(sessionId);
    },

    async mutatePreviewVisualComments(sessionId, mutation) {
      await withPreviewVisualCommentStore(sessionId, (store) => {
        store.setState((draft: PreviewVisualCommentDocInput) => {
          applyPreviewVisualCommentMutation(draft, mutation);
        });
      });
    },
  };
}
