import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import {
  SaveProtectedImageConnectionSchema,
  type ProtectedImageConnection,
} from '@molly/shared/embedded-harness';
import { useTranslation } from 'react-i18next';
import { KeyRound, Link2, Loader2, Plug, Sparkles, Trash2 } from 'lucide-react';
import { IMAGE_CONNECTION_MAX_MODEL_LENGTH, normalizeImageConnectionBaseUrl } from '@molly/shared';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Switch } from '@/ui/switch';
import { Field, Section } from './form-primitives';

/** Image settings use only the main-process vault's public metadata. */

type ImageConnectionView = Pick<
  ProtectedImageConnection,
  'enabled' | 'baseUrl' | 'model' | 'hasApiKey'
>;

export type ImageConnectionFormDraft = {
  enabled: boolean;
  baseUrl: string;
  /**
   * What the user typed. Empty means "keep whatever is stored" — the stored key
   * is never prefilled, so an untouched field cannot silently replace it.
   */
  apiKey: string;
  /** Set by "Remove stored key": the next save stores an empty key. */
  clearApiKey: boolean;
  model: string;
};

export type ImageConnectionTestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'ok'; modelCount: number }
  | { phase: 'error'; message: string };

export function createImageConnectionFormDraft(
  stored: Pick<ImageConnectionView, 'enabled' | 'baseUrl' | 'model'> | undefined
): ImageConnectionFormDraft {
  return {
    enabled: stored?.enabled ?? true,
    baseUrl: stored?.baseUrl ?? '',
    apiKey: '',
    clearApiKey: false,
    model: stored?.model ?? '',
  };
}

/** Omit an unchanged credential; the renderer never retrieves the stored key. */
export function buildImageConnectionSave(
  draft: ImageConnectionFormDraft,
  stored?: ProtectedImageConnection
) {
  const parsed = SaveProtectedImageConnectionSchema.safeParse({
    expectedRevision: stored?.revision,
    enabled: draft.enabled,
    baseUrl: draft.baseUrl.trim(),
    model: draft.model.trim(),
    apiKey: draft.apiKey.trim() || undefined,
    clearApiKey: draft.clearApiKey,
  });
  return parsed.success ? parsed.data : undefined;
}

/** Which field the user still has to fix; the component maps these to copy. */
export function imageConnectionDraftIssues(draft: ImageConnectionFormDraft): {
  baseUrl: boolean;
  model: boolean;
} {
  return {
    baseUrl: normalizeImageConnectionBaseUrl(draft.baseUrl) === undefined,
    model:
      draft.model.trim().length === 0 ||
      draft.model.trim().length > IMAGE_CONNECTION_MAX_MODEL_LENGTH,
  };
}

const isDirty = (
  draft: ImageConnectionFormDraft,
  stored: ImageConnectionView | undefined
): boolean => {
  const initial = createImageConnectionFormDraft(stored);
  return (
    draft.enabled !== initial.enabled ||
    draft.model.trim() !== initial.model ||
    draft.baseUrl.trim() !== initial.baseUrl ||
    draft.clearApiKey ||
    draft.apiKey.trim().length > 0
  );
};

/**
 * The editor itself. Presentational: it owns the draft and its validation and
 * hands complete values to `onSave`, so the Storybook story and the container
 * exercise the same component the user sees.
 */
export function ImageConnectionForm({
  stored,
  saving = false,
  saveError,
  testState,
  onSave,
  onTest,
  onClearApiKey,
  className,
}: {
  stored: ImageConnectionView | undefined;
  saving?: boolean;
  saveError?: string;
  testState: ImageConnectionTestState;
  onSave: (draft: ImageConnectionFormDraft) => void | Promise<void>;
  onTest: () => void | Promise<void>;
  onClearApiKey: () => void | Promise<void>;
  className?: string;
}) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [draft, setDraft] = useState(() => createImageConnectionFormDraft(stored));

  // The stored row is the reset point: after a save, the container hands back the
  // row it wrote and the form shows exactly that.
  useEffect(() => {
    setDraft(createImageConnectionFormDraft(stored));
  }, [stored]);

  const issues = useMemo(() => imageConnectionDraftIssues(draft), [draft]);
  const dirty = isDirty(draft, stored);
  const invalid = issues.baseUrl || issues.model;
  const ready = Boolean(stored?.enabled && stored.hasApiKey && stored.baseUrl && stored.model);
  const hasStoredKey = Boolean(stored?.hasApiKey);
  const destinationNeedsKey = Boolean(
    stored && stored.baseUrl !== draft.baseUrl.trim() && !draft.clearApiKey && !draft.apiKey.trim()
  );
  const testing = testState.phase === 'testing';
  const testBlockedReason = !stored
    ? t('settings.imageConnection.testNeedsSaved')
    : dirty
      ? t('settings.imageConnection.testNeedsSave')
      : !ready
        ? t('settings.imageConnection.testNeedsComplete')
        : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (invalid || destinationNeedsKey || saving) return;
    setDraft((current) => ({ ...current, apiKey: '' }));
    void onSave(draft);
  };

  return (
    <form className={className} onSubmit={submit}>
      <div className="space-y-5">
        <Section
          title={t('settings.imageConnection.sectionConnection')}
          hint={t('settings.imageConnection.sectionConnectionHint')}
        >
          <div className="flex items-center justify-between gap-4 rounded-xl bg-foreground/[0.04] px-4 py-3">
            <div className="min-w-0">
              <Label htmlFor={`${fieldId}-enabled`} className="text-sm">
                {t('settings.imageConnection.enabled')}
              </Label>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t('settings.imageConnection.enabledHint')}
              </p>
            </div>
            <Switch
              id={`${fieldId}-enabled`}
              checked={draft.enabled}
              disabled={saving}
              onCheckedChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
            />
          </div>

          <Field
            htmlFor={`${fieldId}-base-url`}
            label={t('settings.imageConnection.baseUrl')}
            icon={<Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
            hint={
              issues.baseUrl && draft.baseUrl.trim().length > 0
                ? t('settings.imageConnection.invalidBaseUrl')
                : t('settings.imageConnection.baseUrlHint')
            }
          >
            <Input
              id={`${fieldId}-base-url`}
              disabled={saving}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-xs"
              placeholder="https://api.openai.com/v1"
              value={draft.baseUrl}
              onChange={(event) =>
                setDraft((current) => ({ ...current, baseUrl: event.target.value, apiKey: '' }))
              }
            />
          </Field>

          <Field
            htmlFor={`${fieldId}-api-key`}
            label={t('settings.imageConnection.apiKey')}
            icon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
            hint={
              destinationNeedsKey
                ? t('settings.models.keyRequired')
                : hasStoredKey
                  ? t('settings.imageConnection.apiKeyHintStored')
                  : t('settings.imageConnection.apiKeyHintNew')
            }
          >
            <div className="flex items-center gap-1.5">
              <Input
                id={`${fieldId}-api-key`}
                type="password"
                disabled={saving}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
                placeholder={
                  hasStoredKey ? t('settings.imageConnection.apiKeyPlaceholderStored') : 'sk-...'
                }
                value={draft.apiKey}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    apiKey: event.target.value,
                    clearApiKey: false,
                  }))
                }
              />
              {hasStoredKey ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={t('settings.imageConnection.removeApiKey')}
                  title={t('settings.imageConnection.removeApiKey')}
                  disabled={saving}
                  onClick={() => {
                    setDraft((current) => ({ ...current, apiKey: '', clearApiKey: true }));
                    void onClearApiKey();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          </Field>

          <Field
            htmlFor={`${fieldId}-model`}
            label={t('settings.imageConnection.model')}
            icon={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
            hint={
              issues.model
                ? t('settings.imageConnection.invalidModel')
                : t('settings.imageConnection.modelHint')
            }
          >
            <Input
              id={`${fieldId}-model`}
              disabled={saving}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-xs"
              required
              value={draft.model}
              onChange={(event) =>
                setDraft((current) => ({ ...current, model: event.target.value }))
              }
            />
          </Field>
        </Section>

        <Section
          title={t('settings.imageConnection.sectionTest')}
          hint={t('settings.imageConnection.sectionTestHint')}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || testing || testBlockedReason !== null}
              title={testBlockedReason ?? undefined}
              onClick={() => void onTest()}
            >
              {testing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Plug className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {testing ? t('settings.imageConnection.testing') : t('settings.imageConnection.test')}
            </Button>
            {testBlockedReason ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{testBlockedReason}</p>
            ) : null}
          </div>
          <ImageConnectionTestSummary state={testState} />
        </Section>

        {saveError ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-snug text-destructive"
          >
            {t('settings.imageConnection.saveFailed', { message: saveError })}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {ready
              ? t('settings.imageConnection.statusReady')
              : t('settings.imageConnection.statusNotReady')}
          </p>
          <Button
            type="submit"
            size="sm"
            disabled={saving || invalid || !dirty || destinationNeedsKey}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            {saving ? t('settings.imageConnection.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </form>
  );
}

function ImageConnectionTestSummary({ state }: { state: ImageConnectionTestState }) {
  const { t } = useTranslation();
  if (state.phase === 'idle' || state.phase === 'testing') return null;
  if (state.phase === 'ok') {
    return (
      <p
        role="status"
        className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs leading-snug text-emerald-700 dark:text-emerald-400"
      >
        {t('settings.imageConnection.testOk', { modelCount: state.modelCount })}
      </p>
    );
  }
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-snug text-destructive"
    >
      {t('settings.imageConnection.testFailed', { message: state.message })}
    </p>
  );
}

export function ImageConnectionSetting() {
  const { t } = useTranslation();
  const ipc = useMemo(() => getIpcServices(), []);
  const [stored, setStored] = useState<ProtectedImageConnection>();
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [testState, setTestState] = useState<ImageConnectionTestState>({ phase: 'idle' });
  useEffect(() => {
    if (!ipc) return undefined;
    let live = true;
    void ipc.modelConnections
      .getImageSnapshot()
      .then((snapshot) => {
        if (live) {
          setStored(snapshot.connection ?? undefined);
          setReady(true);
        }
      })
      .catch(() => {
        if (live) setSaveError(t('settings.models.error'));
      });
    return () => {
      live = false;
    };
  }, [ipc, t]);
  const save = async (draft: ImageConnectionFormDraft) => {
    if (!ipc || !ready || saving) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      const input = buildImageConnectionSave(draft, stored);
      if (!input) throw new Error('invalid_image_connection');
      const connection = await ipc.modelConnections.saveImage(input);
      setStored(connection);
      setTestState({ phase: 'idle' });
    } catch {
      setSaveError(t('settings.models.error'));
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    if (!ipc || !stored) return;
    setTestState({ phase: 'testing' });
    try {
      const result = await ipc.modelConnections.testImage({ expectedRevision: stored.revision });
      setTestState(
        result.ok
          ? { phase: 'ok', modelCount: result.modelCount }
          : { phase: 'error', message: result.error }
      );
    } catch {
      setTestState({ phase: 'error', message: t('settings.imageConnection.errors.unexpected') });
    }
  };
  if (!ipc) return <p>{t('settings.imageConnection.unavailable')}</p>;
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">{t('settings.imageConnection.intro')}</p>
      {stored?.legacyHistoryMayContainKey && (
        <p role="alert" className="text-xs text-warning-foreground">
          {t('settings.imageConnection.legacyHistoryWarning')}
        </p>
      )}
      <ImageConnectionForm
        stored={stored}
        saving={saving || !ready}
        saveError={saveError}
        testState={testState}
        onSave={save}
        onTest={test}
        onClearApiKey={() =>
          stored && save({ ...createImageConnectionFormDraft(stored), clearApiKey: true })
        }
      />
    </div>
  );
}
