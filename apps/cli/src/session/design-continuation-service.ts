import { v5 as uuidv5 } from 'uuid';
import {
  buildDesignContinuationReference,
  DesignContinuationRecordSchema,
  DesignContinuationSourceSchema,
  getSessionRoomId,
  isLoroRepoDocDeleted,
  getDesignContinuationSystemContext,
  type SessionFilePayload,
  type DesignContinuationAttachmentInspection,
  type AgentConfigId,
  type DesignContinuationRecord,
  type SessionId,
  type SessionMeta,
  type MachineId,
} from '@molly/shared';
import { readSessionHistory } from '@molly/shared/session-data';
import type { LoroDocumentManager } from '@/lib/loro/doc';
import { withForkOperationLock } from './session-fork-operation-store';
import {
  inspectDesignContinuationAttachments,
  readDesignContinuationAttachment,
} from './design-continuation-attachments';

/** Stable across explicit retries/restarts, without a second discovery/backup store. */
export function designContinuationTargetId(
  workspaceId: string,
  sourceSessionId: SessionId
): SessionId {
  return uuidv5(
    JSON.stringify(['molly-design-continuation', 1, workspaceId, sourceSessionId]),
    uuidv5.URL
  ) as SessionId;
}

/**
 * Prepares derived migration data and resolves first-turn attachment identities.
 * No target metadata, Agent, dispatch, native fork, file copy or source mutation.
 * Target publication remains a separate explicit operation.
 */
export class DesignContinuationService {
  constructor(
    private readonly deps: {
      workspaceDocument: Pick<
        LoroDocumentManager,
        'repo' | 'getOrCreateSessionDoc' | 'getAgentConfigById' | 'persistPendingChanges'
      >;
      workspaceId: string;
      machineId: string;
      now: () => number;
      isSourceBusy: (sessionId: SessionId) => boolean;
      attachmentHomeDir?: string;
    }
  ) {}

  /** Derive first-turn files from the accepted receipt, never replay old turns. */
  async readFirstTurnAttachments(args: {
    sessionId: SessionId;
    userTurnId: string;
    requesterUserId: string;
    agentConfigId: AgentConfigId | undefined;
  }): Promise<
    | {
        sourceSessionId: string;
        files: SessionFilePayload[];
        unavailable: DesignContinuationAttachmentInspection[];
      }
    | undefined
  > {
    const manager = this.deps.workspaceDocument;
    const targetRow = await manager.repo.getDocMeta(getSessionRoomId(args.sessionId));
    const meta = targetRow?.meta as SessionMeta | undefined;
    if (!meta?.designContinuation) return undefined;
    if (isLoroRepoDocDeleted(targetRow)) throw new Error('design_continuation_target_deleted');
    if (meta.userId !== args.requesterUserId || meta.machineId !== this.deps.machineId)
      throw new Error('design_continuation_access_denied');
    const target = await manager.getOrCreateSessionDoc(args.sessionId);
    const record = target.getDesignContinuation();
    if (
      record?.workspaceId !== this.deps.workspaceId ||
      args.agentConfigId !== record.target.agentConfigId
    )
      throw new Error('design_continuation_binding_mismatch');
    getDesignContinuationSystemContext(meta, record);
    const directory = target.sessionData.history.readDirectory(
      0,
      target.sessionData.history.count()
    );
    const first = directory.find((row) => row.scalars?.role === 'user');
    if (!first) throw new Error('design_continuation_first_turn_unavailable');
    if (first.turnId !== args.userTurnId) return undefined;
    const firstTurn = target.sessionData.history.readAt(first.position);
    if (firstTurn.state !== 'ready' || firstTurn.turn.userId !== args.requesterUserId)
      throw new Error('design_continuation_access_denied');
    if (record.reference.attachmentCandidates.length === 0) return undefined;

    const assertSource = async () => {
      const row = await manager.repo.getDocMeta(getSessionRoomId(record.source.id as SessionId));
      const source = DesignContinuationSourceSchema.safeParse(row?.meta);
      if (
        !row ||
        isLoroRepoDocDeleted(row) ||
        !source.success ||
        JSON.stringify({ ...source.data, title: undefined }) !==
          JSON.stringify({ ...record.source, title: undefined })
      )
        throw new Error('design_continuation_source_changed');
    };
    await assertSource();
    const sourceDoc = await manager.getOrCreateSessionDoc(record.source.id as SessionId);
    const turnIds = new Set(record.reference.attachmentCandidates.map((file) => file.sourceTurnId));
    const readCandidateHistory = () => {
      const history = sourceDoc.sessionData.history;
      // Directory identity reads expose duplicate IDs; only selected bodies are read.
      const rows = history
        .readDirectory(0, history.count())
        .filter((row) => row.turnId && turnIds.has(row.turnId));
      return readSessionHistory({
        readAll: () =>
          rows.flatMap((row) => {
            const read = history.readAt(row.position);
            return read.state === 'ready' ? [read.turn] : [];
          }),
      });
    };
    const inspections = await inspectDesignContinuationAttachments({
      record,
      readHistory: readCandidateHistory,
      homeDir: this.deps.attachmentHomeDir,
    });
    const current = readCandidateHistory();
    const files: SessionFilePayload[] = [];
    const unavailable: DesignContinuationAttachmentInspection[] = [];
    for (const [index, candidate] of record.reference.attachmentCandidates.entries()) {
      const inspected = inspections[index];
      const file = readDesignContinuationAttachment(record, candidate, current);
      if (inspected?.status === 'available' && file) files.push(file);
      else
        unavailable.push(
          inspected?.status === 'unavailable'
            ? inspected
            : {
                sourceTurnId: candidate.sourceTurnId,
                fileId: candidate.fileId,
                status: 'unavailable',
                reason: 'history_changed',
              }
        );
    }
    await assertSource();
    const latest = await manager.repo.getDocMeta(getSessionRoomId(args.sessionId));
    if (!latest?.meta || isLoroRepoDocDeleted(latest))
      throw new Error('design_continuation_target_deleted');
    getDesignContinuationSystemContext(latest.meta as SessionMeta, record);
    if (JSON.stringify(target.getDesignContinuation()) !== JSON.stringify(record))
      throw new Error('design_continuation_record_changed');
    const latestFirst = target.sessionData.history
      .readDirectory(0, target.sessionData.history.count())
      .find((row) => row.scalars?.role === 'user');
    if (latestFirst?.turnId !== args.userTurnId)
      throw new Error('design_continuation_first_turn_changed');
    const latestTurn = target.sessionData.history.readAt(latestFirst.position);
    if (latestTurn.state !== 'ready' || latestTurn.turn.userId !== args.requesterUserId)
      throw new Error('design_continuation_access_denied');
    return { sourceSessionId: record.source.id, files, unavailable };
  }

  /** Explicit preview of current local availability; never saved as lasting access authority. */
  async inspectAttachments(args: {
    sourceSessionId: SessionId;
    targetAgentConfigId: AgentConfigId;
    requestedByUserId: string;
  }) {
    const record = await this.prepare(args);
    const manager = this.deps.workspaceDocument;
    const sourceDoc = await manager.getOrCreateSessionDoc(args.sourceSessionId);
    const attachments = await inspectDesignContinuationAttachments({
      record,
      readHistory: () => readSessionHistory(sourceDoc.sessionData.history),
      homeDir: this.deps.attachmentHomeDir,
    });
    const latest = await manager.repo.getDocMeta(getSessionRoomId(args.sourceSessionId));
    const source = DesignContinuationSourceSchema.safeParse(latest?.meta);
    if (
      !latest ||
      isLoroRepoDocDeleted(latest) ||
      !source.success ||
      JSON.stringify({ ...source.data, title: undefined }) !==
        JSON.stringify({ ...record.source, title: undefined }) ||
      this.deps.isSourceBusy(args.sourceSessionId)
    )
      throw new Error('design_continuation_source_changed');
    return { record, attachments };
  }

  async prepare(args: {
    sourceSessionId: SessionId;
    targetAgentConfigId: AgentConfigId;
    requestedByUserId: string;
  }): Promise<DesignContinuationRecord> {
    const targetId = designContinuationTargetId(this.deps.workspaceId, args.sourceSessionId);
    return withForkOperationLock(targetId, async () => {
      const manager = this.deps.workspaceDocument;
      const sourceMeta = await manager.repo.getDocMeta(getSessionRoomId(args.sourceSessionId));
      if (!sourceMeta || isLoroRepoDocDeleted(sourceMeta))
        throw new Error('design_continuation_source_unavailable');
      const source = DesignContinuationSourceSchema.safeParse(sourceMeta.meta);
      if (!source.success || source.data.id !== args.sourceSessionId)
        throw new Error('design_continuation_source_unavailable');
      if (
        source.data.machineId !== this.deps.machineId ||
        source.data.userId !== args.requestedByUserId
      )
        throw new Error('design_continuation_access_denied');
      if (source.data.cliType === 'builtin' && source.data.agentType === 'molly')
        throw new Error('design_continuation_source_already_molly');
      if (this.deps.isSourceBusy(args.sourceSessionId))
        throw new Error('design_continuation_source_busy');
      if (source.data.parentSessionId) {
        const parent = await manager.repo.getDocMeta(
          getSessionRoomId(source.data.parentSessionId as SessionId)
        );
        const meta = parent?.meta as SessionMeta | undefined;
        if (
          !parent ||
          isLoroRepoDocDeleted(parent) ||
          !meta ||
          meta.parentSessionId ||
          meta.machineId !== source.data.machineId ||
          meta.userId !== args.requestedByUserId
        )
          throw new Error('design_continuation_parent_unavailable');
      }
      const config = await manager.getAgentConfigById(
        args.targetAgentConfigId,
        source.data.machineId as MachineId
      );
      if (
        !config ||
        config.id !== args.targetAgentConfigId ||
        config.machineId !== source.data.machineId ||
        config.cliType !== 'builtin' ||
        config.agentType !== 'molly'
      )
        throw new Error('design_continuation_target_unavailable');

      const targetMeta = await manager.repo.getDocMeta(getSessionRoomId(targetId));
      if (targetMeta && isLoroRepoDocDeleted(targetMeta))
        throw new Error('design_continuation_target_deleted');
      const target = await manager.getOrCreateSessionDoc(targetId);
      const existing = target.getDesignContinuation();
      if (existing) {
        if (
          existing.workspaceId !== this.deps.workspaceId ||
          existing.target.sessionId !== targetId ||
          existing.source.id !== source.data.id ||
          existing.source.userId !== args.requestedByUserId ||
          existing.source.machineId !== this.deps.machineId ||
          existing.target.agentConfigId !== args.targetAgentConfigId ||
          JSON.stringify({ ...existing.source, title: undefined }) !==
            JSON.stringify({ ...source.data, title: undefined })
        )
          throw new Error('design_continuation_target_conflict');
        // A prior write may exist only in memory after a failed disk barrier.
        await manager.persistPendingChanges('design-continuation-prepare');
        return existing;
      }
      if (
        targetMeta ||
        readSessionHistory(target.sessionData.history).length > 0 ||
        target.getForkOperation()
      )
        throw new Error('design_continuation_target_conflict');

      const sourceDoc = await manager.getOrCreateSessionDoc(args.sourceSessionId);
      const record = DesignContinuationRecordSchema.safeParse({
        version: 1,
        workspaceId: this.deps.workspaceId,
        source: source.data,
        target: {
          sessionId: targetId,
          agentConfigId: args.targetAgentConfigId,
          createdAt: new Date(this.deps.now()).toISOString(),
        },
        reference: buildDesignContinuationReference({
          source: {
            sessionId: source.data.id,
            artworkId: source.data.design.artworkId,
            machineId: source.data.machineId,
          },
          history: readSessionHistory(sourceDoc.sessionData.history),
        }),
      });
      if (!record.success) throw new Error('invalid_design_continuation_record');
      // The source may have been deleted/rebound while its document was opening.
      const latest = await manager.repo.getDocMeta(getSessionRoomId(args.sourceSessionId));
      const latestSource = DesignContinuationSourceSchema.safeParse(latest?.meta);
      if (
        !latest ||
        isLoroRepoDocDeleted(latest) ||
        !latestSource.success ||
        JSON.stringify(latestSource.data) !== JSON.stringify(source.data) ||
        this.deps.isSourceBusy(args.sourceSessionId)
      )
        throw new Error('design_continuation_source_changed');
      target.setDesignContinuation(record.data);
      await manager.persistPendingChanges('design-continuation-prepare');
      return record.data;
    });
  }
}
