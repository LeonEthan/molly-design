import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sanitizeDesignTurnOutcome } from '@molly/shared';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { redactDesignText } from '@/lib/design-file-diagnostics';

function visibleOutcome(rawOutcome: unknown) {
  const outcome = sanitizeDesignTurnOutcome(rawOutcome);
  if (!outcome) return null;
  const hasCandidate = outcome.status === 'candidate' && outcome.candidateId !== undefined;
  const hasDiagnostics = (outcome.diagnostics ?? []).length > 0;
  return outcome.status === 'committed' || hasCandidate || hasDiagnostics ? outcome : null;
}

export function hasDesignFileReceipt(rawOutcome: unknown): boolean {
  return visibleOutcome(rawOutcome) !== null;
}

/** Durable save facts and ordinary files; execution status belongs to the session. */
export function DesignFileReceipt({
  outcome: rawOutcome,
  onOpenFile,
}: {
  outcome: unknown;
  onOpenFile?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const outcome = visibleOutcome(rawOutcome);
  const [fileError, setFileError] = useState(false);
  if (!outcome) return null;
  const candidateId = outcome.status === 'candidate' ? outcome.candidateId : undefined;
  const diagnostics = outcome.diagnostics ?? [];

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

  return (
    <div className="text-xs text-muted-foreground">
      {outcome.status === 'committed' ? (
        <p title={outcome.revisionId}>{t('design.files.saved', 'Saved to the current artwork.')}</p>
      ) : null}
      {candidateId ? (
        <p>
          {t('design.files.notCommitted', "This change wasn't applied to the artwork.")}{' '}
          <button
            type="button"
            className="underline"
            disabled={!onOpenFile}
            onClick={() => void openFile()}
          >
            {t('design.files.openDraft', 'Open draft')}
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
        <p role="alert">{t('design.files.unavailable', 'The draft could not be opened.')}</p>
      ) : null}
    </div>
  );
}
