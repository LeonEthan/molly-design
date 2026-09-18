import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { KeyRound, Link2, Loader2, Plug, Sparkles, Trash2 } from 'lucide-react';
import {
  IMAGE_CONNECTION_VERSION,
  IMAGE_CONNECTION_MAX_MODEL_LENGTH,
  normalizeImageConnectionBaseUrl,
  ImageConnectionRpcResultSchema,
  getMachineFlockDocId,
  getMachineFlockImageConnection,
  getServerNow,
  isImageConnectionReady,
  machineFlockKeys,
  normalizeImageConnectionSettings,
  readMachineFlockRowsFromFlock,
  serializeMachineFlockKey,
  type ImageConnectionSettings,
  type MachineFlockImageConnectionKey,
  type MachineId,
} from '@molly/shared';
import { activeWorkspaceRuntimeAtom, type WorkspaceRuntime } from '@/atoms/runtime';
import { localMachineIdAtom } from '@/atoms/local-probe';
import {
  machineFlockRowsByWorkspaceAtom,
  setMachineFlockRowsForMachineAtom,
} from '@/atoms/machine-flock';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Switch } from '@/ui/switch';
import { Field, Section } from './form-primitives';

/**
 * The machine's image connection editor (P2.4).
 *
 * The row is machine-scoped and lives in this machine's Flock document, beside
 * the per-machine Agent config `env` it shares a trust boundary with: a
 * credential this machine's operator typed, used by this machine's daemon. The
 * section therefore edits **this machine** — the one whose local agent runs the
 * design sessions — and says so, instead of pretending to be a workspace-wide
 * default.
 *
 * Failure isolation is the load-bearing rule of this surface. A missing,
 * disabled, half-typed, or unreachable connection must never block editing,
 * saving, or exporting an existing design: nothing here is on any other
 * surface's path, every call is wrapped, and the worst outcome of a broken
 * connection is that `molly_generate_image` and `molly_edit_image` are not offered to design
 * sessions.
 *
 * The API key is write-only in this UI. It is never read back into a field —
 * the form reports "a key is stored" and accepts a replacement — so the secret
 * cannot be captured from a rendered settings panel, and `assertNoSecret`-style
 * discipline in the daemon is matched by not painting it here in the first
 * place.
 */

/** The probe answers in 15s; the RPC adds the local-control round trip on top. */
const IMAGE_CONNECTION_TEST_TIMEOUT_MS = 20_000;

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
  stored: ImageConnectionSettings | undefined
): ImageConnectionFormDraft {
  return {
    enabled: stored?.enabled ?? true,
    baseUrl: stored?.baseUrl ?? '',
    apiKey: '',
    clearApiKey: false,
    model: stored?.model ?? '',
  };
}

/** The key a save should store: an explicit removal, a typed replacement, or the stored one. */
export function resolveImageConnectionApiKey(
  draft: ImageConnectionFormDraft,
  stored: ImageConnectionSettings | undefined
): string {
  if (draft.clearApiKey) return '';
  const typed = draft.apiKey.trim();
  return typed.length > 0 ? typed : (stored?.apiKey ?? '');
}

/** `undefined` when the draft cannot become a row this build would trust. */
export function buildImageConnectionSettings(
  draft: ImageConnectionFormDraft,
  stored: ImageConnectionSettings | undefined,
  nowMs: number
): ImageConnectionSettings | undefined {
  return normalizeImageConnectionSettings({
    v: IMAGE_CONNECTION_VERSION,
    enabled: draft.enabled,
    baseUrl: draft.baseUrl,
    apiKey: resolveImageConnectionApiKey(draft, stored),
    model: draft.model,
    updatedAt: nowMs,
  });
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
  stored: ImageConnectionSettings | undefined
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
  stored: ImageConnectionSettings | undefined;
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
  const ready = isImageConnectionReady(stored);
  // Read the stored-key bit off the row itself: `ready` is a type predicate, so
  // reusing it in the JSX would narrow `stored` to `never` on its false branch.
  const hasStoredKey = Boolean(stored?.apiKey);
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
    if (invalid) return;
    void onSave(draft);
  };

  return (
    <form className={className} onSubmit={submit}>
      <div className="space-y-3">
        <Section
          title={t('settings.imageConnection.sectionConnection')}
          hint={t('settings.imageConnection.sectionConnectionHint')}
        >
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-card/60 px-3 py-2.5">
            <div className="min-w-0">
              <Label htmlFor={`${fieldId}-enabled`} className="text-sm">
                {t('settings.imageConnection.enabled')}
              </Label>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
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
                setDraft((current) => ({ ...current, baseUrl: event.target.value }))
              }
            />
          </Field>

          <Field
            htmlFor={`${fieldId}-api-key`}
            label={t('settings.imageConnection.apiKey')}
            icon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
            hint={
              hasStoredKey
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
              <p className="text-[11px] leading-snug text-muted-foreground">{testBlockedReason}</p>
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

        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] leading-snug text-muted-foreground">
            {ready
              ? t('settings.imageConnection.statusReady')
              : t('settings.imageConnection.statusNotReady')}
          </p>
          <Button type="submit" size="sm" disabled={saving || invalid || !dirty}>
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

/**
 * Persist the row through the writer seam, then reflect it in the shared
 * machine-Flock cache the way every other machine-scoped settings write does:
 * the local write is durable, the upload that follows is not something this
 * surface waits on, and a failed read-back must not turn a successful save into
 * an error the user has to retry.
 */
async function writeImageConnectionRow(
  runtime: WorkspaceRuntime,
  machineId: MachineId,
  settings: ImageConnectionSettings
): Promise<MachineFlockImageConnectionKey> {
  const flockDocId = getMachineFlockDocId(runtime.workspaceId, machineId);
  const key = machineFlockKeys.imageConnection();
  await runtime.writer.flockRowPut(flockDocId, key, settings);
  return key;
}

export function ImageConnectionSetting() {
  const { t } = useTranslation();
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const machineId = useAtomValue(localMachineIdAtom);
  const rowsByWorkspace = useAtomValue(machineFlockRowsByWorkspaceAtom);
  const setMachineFlockRows = useSetAtom(setMachineFlockRowsForMachineAtom);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [testState, setTestState] = useState<ImageConnectionTestState>({ phase: 'idle' });

  const rows = useMemo(() => {
    if (!runtime || !machineId) return undefined;
    return rowsByWorkspace[String(runtime.workspaceId)]?.[String(machineId)];
  }, [rowsByWorkspace, runtime, machineId]);

  const stored = useMemo(() => (rows ? getMachineFlockImageConnection(rows) : undefined), [rows]);

  // Seed the shared cache from this machine's document. The settings modal can be
  // the first surface to touch this row family, so it must not depend on some
  // other hook having read it first; a failure here only means the form shows
  // "not configured".
  useEffect(() => {
    if (!runtime || !machineId) return undefined;
    let cancelled = false;
    const workspaceId = runtime.workspaceId;
    void (async () => {
      try {
        const handle = await runtime.repo.openFlockDoc(
          getMachineFlockDocId(workspaceId, machineId)
        );
        const localRows = readMachineFlockRowsFromFlock(handle.flock, {
          families: ['imageConnection'],
        });
        if (cancelled) return;
        setMachineFlockRows({ workspaceId, machineId, rows: localRows, mode: 'merge' });
      } catch {
        // Nothing stored is indistinguishable from "could not read" here, and both
        // mean the same thing to the user: no image tool until this is filled in.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runtime, machineId, setMachineFlockRows]);

  const persist = useCallback(
    async (settings: ImageConnectionSettings): Promise<void> => {
      if (!runtime || !machineId) return;
      setSaving(true);
      setSaveError(undefined);
      try {
        const key = await writeImageConnectionRow(runtime, machineId, settings);
        setMachineFlockRows({
          workspaceId: runtime.workspaceId,
          machineId,
          rows: { [serializeMachineFlockKey(key)]: { key, value: settings } },
          mode: 'merge',
        });
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : String(error));
      } finally {
        setSaving(false);
      }
    },
    [runtime, machineId, setMachineFlockRows]
  );

  const handleSave = useCallback(
    async (draft: ImageConnectionFormDraft) => {
      const settings = buildImageConnectionSettings(draft, stored, getServerNow());
      if (!settings) {
        setSaveError(t('settings.imageConnection.invalidSettings'));
        return;
      }
      await persist(settings);
    },
    [persist, stored, t]
  );

  const handleClearApiKey = useCallback(async () => {
    if (!stored) return;
    await persist({ ...stored, apiKey: '', updatedAt: getServerNow() });
  }, [persist, stored]);

  const handleTest = useCallback(async () => {
    const ipc = getIpcServices();
    if (!ipc || !runtime || !machineId) {
      setTestState({ phase: 'error', message: t('settings.imageConnection.errors.bridge') });
      return;
    }
    setTestState({ phase: 'testing' });
    try {
      const response = await ipc.machineRpc.send({
        machineId,
        workspaceId: runtime.workspaceId,
        method: 'design/image-connection-test',
        params: {},
        timeoutMs: IMAGE_CONNECTION_TEST_TIMEOUT_MS,
      });
      if (!response.ok) {
        setTestState({ phase: 'error', message: response.error });
        return;
      }
      const parsed = ImageConnectionRpcResultSchema.safeParse(response.result);
      if (!parsed.success || parsed.data.type !== 'design/image-connection-test') {
        setTestState({ phase: 'error', message: t('settings.imageConnection.errors.unexpected') });
        return;
      }
      if (parsed.data.ok) {
        setTestState({ phase: 'ok', modelCount: parsed.data.modelCount ?? 0 });
        return;
      }
      setTestState({
        phase: 'error',
        message:
          parsed.data.error === 'image_connection_incomplete'
            ? t('settings.imageConnection.testNeedsComplete')
            : (parsed.data.error ?? t('settings.imageConnection.errors.unexpected')),
      });
    } catch (error) {
      // A broken connection is a message, never a thrown error out of settings.
      setTestState({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [runtime, machineId, t]);

  if (!runtime || !machineId) {
    return (
      <Section title={t('settings.imageConnection.sectionConnection')}>
        <p className="text-xs leading-snug text-muted-foreground">
          {t('settings.imageConnection.unavailable')}
        </p>
      </Section>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-snug text-muted-foreground">
        {t('settings.imageConnection.intro')}
      </p>
      <ImageConnectionForm
        stored={stored}
        saving={saving}
        saveError={saveError}
        testState={testState}
        onSave={handleSave}
        onTest={handleTest}
        onClearApiKey={handleClearApiKey}
      />
    </div>
  );
}
