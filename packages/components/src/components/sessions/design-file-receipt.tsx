import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DesignSourcePathResultSchema,
  sanitizeDesignTurnOutcome,
  type SessionId,
} from '@molly/shared';
import { useAtomValue } from 'jotai';
import { currentWorkspaceIdAtom } from '@/atoms';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { redactDesignText } from '@/lib/design-file-diagnostics';

/** Durable save facts and ordinary files; execution status belongs to the session. */
export function DesignFileReceipt({
  outcome: rawOutcome,
  sessionId,
  machineId,
  onOpenFile,
}: {
  outcome: unknown;
  sessionId?: SessionId;
  machineId?: string;
  onOpenFile?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const outcome = sanitizeDesignTurnOutcome(rawOutcome);
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const [fileError, setFileError] = useState(false);
  const candidateId = outcome?.status === 'candidate' ? outcome.candidateId : undefined;
  const diagnostics = outcome?.diagnostics ?? [];
  const hasDraft =
    sessionId &&
    machineId &&
    outcome &&
    ['candidate', 'invalid', 'failed', 'cancelled'].includes(outcome.status);
  if (
    !outcome ||
    (outcome.status !== 'committed' && !candidateId && !hasDraft && diagnostics.length === 0)
  )
    return null;

  const openFile = async () => {
    setFileError(false);
    try {
      const service = getIpcServices()?.design;
      if (!service || !candidateId || !onOpenFile) throw Error('File unavailable');
      const file = await service.candidateFile(outcome.artworkId, candidateId);
      onOpenFile(file.path);
    } catch {
      setFileError(true);
    }
  };

  const openDraft = async () => {
    setFileError(false);
    try {
      const service = getIpcServices();
      if (!service || !sessionId || !machineId || !workspaceId || !onOpenFile)
        throw Error('File unavailable');
      const response = await service.machineRpc.send({
        machineId,
        workspaceId,
        ownerSessionId: sessionId,
        method: 'design/source-path',
        params: { turnId: outcome.turnId },
      });
      if (!response.ok) throw Error('File unavailable');
      const source = DesignSourcePathResultSchema.parse(response.result);
      if (!source.ok) throw Error(source.error);
      onOpenFile(source.path);
    } catch {
      setFileError(true);
    }
  };

  return (
    <div className="text-xs text-muted-foreground">
      {outcome.status === 'committed' ? (
        <p title={outcome.revisionId}>{t('design.files.saved', 'Saved to the current artwork.')}</p>
      ) : null}
      {candidateId ? (
        <p>
          {t('design.files.notCommitted', 'This turn was not committed. Original file:')}{' '}
          <button
            type="button"
            className="break-all underline"
            disabled={!onOpenFile}
            onClick={() => void openFile()}
          >
            {`candidates/${candidateId}.json`}
          </button>
        </p>
      ) : null}
      {hasDraft ? (
        <p>
          {t('design.files.workingFile', 'Working file (may have changed since this turn):')}{' '}
          <button
            type="button"
            className="underline"
            disabled={!onOpenFile || !workspaceId}
            onClick={() => void openDraft()}
          >
            design.yaml
          </button>
        </p>
      ) : null}
      {diagnostics.length > 0 ? (
        <p>
          {t('design.files.diagnostics', 'The artwork was not updated:')}{' '}
          {diagnostics
            .map((item) => `${redactDesignText(item.code)}: ${redactDesignText(item.message)}`)
            .join('\n')}
        </p>
      ) : null}
      {fileError ? (
        <p role="alert">
          {t('design.files.unavailable', 'The original file could not be opened.')}
        </p>
      ) : null}
    </div>
  );
}
