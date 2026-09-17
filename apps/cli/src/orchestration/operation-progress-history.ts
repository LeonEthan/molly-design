import { getServerNow, type StoredMollyOperation } from '@molly/shared';
import { type SessionData } from '@molly/shared/session-data';
import type { OperationProgressStatusByTarget } from '@molly/shared/session-data';
export {
  getOperationProgressTurnId,
  getOperationProgressTargetKey,
  buildOperationProgressContent,
  mergeOperationProgressContent,
} from '@molly/shared/session-data';
export type { OperationProgressStatusByTarget } from '@molly/shared/session-data';
export type OperationProgressHistoryDocument = { sessionData: SessionData };
export const upsertOperationProgressHistory = async (
  sessionDoc: OperationProgressHistoryDocument,
  operation: StoredMollyOperation,
  now: () => number = getServerNow,
  statusByTarget?: OperationProgressStatusByTarget
): Promise<void> => {
  await sessionDoc.sessionData.commands.applyHistoryAction({
    kind: 'operation-progress',
    operation,
    timestamp: new Date(now()).toISOString(),
    statuses: statusByTarget ? [...statusByTarget] : undefined,
  });
};
