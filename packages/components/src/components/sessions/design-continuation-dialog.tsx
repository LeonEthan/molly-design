import { useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type {
  AgentConfigId,
  AgentConfigMeta,
  DesignContinuationPreparationResult,
  SessionMeta,
} from '@molly/shared';
import { userAtom } from '@/atoms';
import { activeWorkspaceRuntimeAtom } from '@/atoms/runtime';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';

export type DesignContinuationDialogViewProps = {
  configs: readonly AgentConfigMeta[];
  selectedConfigId: string;
  preview?: DesignContinuationPreparationResult;
  busy: boolean;
  error?: string;
  onSelect: (id: string) => void;
  onPreview: () => void;
  onConfirm: () => void;
  onClose: () => void;
};

/** Plain text only: historical data is reviewable, never interpreted as UI markup. */
export function DesignContinuationDialogView(props: DesignContinuationDialogViewProps) {
  const { t } = useTranslation();
  const {
    configs,
    selectedConfigId,
    preview,
    busy,
    error,
    onSelect,
    onPreview,
    onConfirm,
    onClose,
  } = props;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogTitle>
          {t('design.continuation.title', 'Continue this design with Molly')}
        </DialogTitle>
        <DialogDescription>
          {t(
            'design.continuation.description',
            'Create an independent Molly conversation for the same artwork. The old conversation, drafts, assets and design versions stay in place. No model request is sent by this action.'
          )}
        </DialogDescription>
        <label className="grid gap-2 text-sm">
          {t('design.continuation.agent', 'Molly Agent on this machine')}
          <select
            className="rounded-md border bg-input-field p-2 disabled:bg-muted"
            value={selectedConfigId}
            disabled={busy || !!preview}
            onChange={(event) => onSelect(event.target.value)}
          >
            <option value="">{t('design.continuation.selectAgent', 'Select Molly')}</option>
            {configs.map((config) => (
              <option key={config.id} value={config.id}>
                {config.name}
              </option>
            ))}
          </select>
        </label>
        {configs.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t(
              'design.continuation.unavailable',
              'No built-in Molly Agent is available on this machine. Configure a model connection and wait for the local Agent catalog before trying again.'
            )}
          </p>
        ) : null}
        {preview ? (
          <section
            className="grid gap-3 text-sm"
            aria-label={t('design.continuation.preview', 'Historical context preview')}
          >
            <p>
              {t(
                'design.continuation.reviewNotice',
                'Review the excerpts below before confirming. They may contain sensitive text you previously entered. Old tool calls, permissions and runtime settings are not replayed.'
              )}
            </p>
            <p className="text-muted-foreground">
              {t(
                'design.continuation.omitted',
                'Omitted: {{turns}} turns, {{items}} non-text items, {{attachments}} attachments.',
                preview.record.reference.omitted
              )}
            </p>
            {preview.record.reference.messages.length === 0 ? (
              <p>{t('design.continuation.noText', 'No eligible historical text.')}</p>
            ) : (
              <div className="max-h-56 space-y-3 overflow-y-auto rounded-md border p-3">
                {preview.record.reference.messages.map((message, index) => (
                  <div key={`${message.sourceTurnId}-${index}`}>
                    <p className="font-medium">
                      {message.role === 'user'
                        ? t('design.continuation.user', 'User')
                        : t('design.continuation.assistant', 'Assistant')}
                      {message.truncated
                        ? ` · ${t('design.continuation.truncated', 'truncated')}`
                        : ''}
                    </p>
                    <pre className="whitespace-pre-wrap break-words font-sans">{message.text}</pre>
                  </div>
                ))}
              </div>
            )}
            {preview.record.reference.attachmentCandidates.length > 0 ? (
              <ul className="space-y-1">
                {preview.record.reference.attachmentCandidates.map((file, index) => {
                  const status = preview.attachments[index];
                  return (
                    <li key={`${file.sourceTurnId}-${file.fileId}`} className="break-words">
                      {file.fileName} —{' '}
                      {status?.status === 'available'
                        ? t(
                            'design.continuation.fileAvailable',
                            'available locally; rechecked on first send'
                          )
                        : t(
                            'design.continuation.fileUnavailable',
                            'unavailable; reattach if needed'
                          )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <p>
              {t(
                'design.continuation.nextStep',
                'After opening the new conversation, explicitly select a connection and model, then send your next request. Historical files are considered only on the first new send; current attachments take priority within the normal limits.'
              )}
            </p>
          </section>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          {preview ? (
            <Button disabled={busy} onClick={onConfirm}>
              {busy
                ? t('design.continuation.working', 'Working…')
                : t('design.continuation.confirm', 'Confirm and open Molly conversation')}
            </Button>
          ) : (
            <Button disabled={busy || !selectedConfigId} onClick={onPreview}>
              {busy
                ? t('design.continuation.working', 'Working…')
                : t('design.continuation.prepare', 'Preview migration')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DesignContinuationDialog({
  source,
  configs,
  onClose,
  onPublished,
}: {
  source: SessionMeta;
  configs: readonly AgentConfigMeta[];
  onClose: () => void;
  onPublished: (session: SessionMeta) => void;
}) {
  const { t } = useTranslation();
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const user = useAtomValue(userAtom);
  const [selectedConfigId, setSelectedConfigId] = useState('');
  const [preview, setPreview] = useState<DesignContinuationPreparationResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    generation.current = controller;
    setBusy(false);
    setPreview(undefined);
    setError(undefined);
    setSelectedConfigId('');
    return () => controller.abort();
  }, [runtime, user?.id, source.id]);

  const perform = async (confirm: boolean) => {
    const controller = generation.current;
    if (
      !runtime ||
      !user?.id ||
      !selectedConfigId ||
      !controller ||
      controller.signal.aborted ||
      busy
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      const prepared = await runtime.requestDesignContinuationPreparation(source.machineId, {
        version: 1,
        sourceSessionId: source.id,
        targetAgentConfigId: selectedConfigId as AgentConfigId,
        requestedByUserId: user.id,
      });
      controller.signal.throwIfAborted();
      if (!confirm) {
        setPreview(prepared);
        return;
      }
      if (!preview || JSON.stringify(prepared) !== JSON.stringify(preview)) {
        setPreview(prepared);
        setError(
          t(
            'design.continuation.changed',
            'The migration preview changed. Review the updated content and confirm again.'
          )
        );
        return;
      }
      const published = await runtime.writer.publishDesignContinuation(prepared.record, {
        workspaceId: runtime.workspaceId,
        userId: user.id,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      onPublished(published);
    } catch (cause) {
      if (controller.signal.aborted) return;
      const code = cause instanceof Error ? cause.message : '';
      setError(
        code === 'design_continuation_source_busy'
          ? t(
              'design.continuation.sourceBusy',
              'The old conversation is still active. Wait for it to finish or explicitly stop it before migrating.'
            )
          : code === 'design_continuation_receipt_not_ready'
            ? t(
                'design.continuation.syncPending',
                'The prepared record has not reached this window yet. Keep this preview and explicitly retry confirmation shortly.'
              )
            : t(
                'design.continuation.failed',
                'Migration could not be completed. Check the local machine and selected Molly Agent, then retry. The source is unchanged and no model request was sent.'
              )
      );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const close = () => {
    generation.current?.abort();
    onClose();
  };
  return (
    <DesignContinuationDialogView
      configs={configs}
      selectedConfigId={selectedConfigId}
      preview={preview}
      busy={busy}
      error={error}
      onSelect={setSelectedConfigId}
      onClose={close}
      onPreview={() => void perform(false)}
      onConfirm={() => void perform(true)}
    />
  );
}
