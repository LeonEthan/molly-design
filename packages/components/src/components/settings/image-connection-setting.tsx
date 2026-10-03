import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ModelEndpointSchema,
  SaveProtectedImageConnectionSchema,
  type CheckImageConnection,
  type ConnectionCheckResult,
  type ProtectedImageConnection,
} from '@molly/shared/embedded-harness';
import { useTranslation } from 'react-i18next';
import {
  IMAGE_CONNECTION_MAX_MODEL_LENGTH,
  IMAGE_CONNECTION_PROTOCOLS,
  imageConnectionProtocol,
  normalizeImageConnectionBaseUrl,
  type ImageConnectionProtocol,
} from '@molly/shared';
import { SegmentedControl } from '@/components/shared/segmented-control';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import {
  CircleCheck,
  CircleDashed,
  Ellipsis,
  Image as ImageIcon,
  KeyRound,
  Link2,
  LoaderCircle,
  Sparkles,
  Trash2,
} from '@/ui/icons';
import { Input } from '@/ui/input';
import { Switch } from '@/ui/switch';
import { CompactSection } from './compact-layout';
import {
  ConnectionCheckBadge,
  ConnectionCheckLine,
  useConnectionCheck,
  type ConnectionCheckState,
} from './connection-check';
import { Field } from './form-primitives';
import { WithInfo } from './info-tip';

/** Image settings use only the main-process vault's public metadata. */

type ImageConnectionView = Pick<
  ProtectedImageConnection,
  'enabled' | 'protocol' | 'baseUrl' | 'model' | 'hasApiKey'
>;

const PROTOCOL_COPY: Record<
  ImageConnectionProtocol,
  { label: string; baseUrlHint: string; placeholder: string }
> = {
  'openai-images': {
    label: 'settings.imageConnection.protocols.openaiImages',
    baseUrlHint: 'settings.imageConnection.baseUrlHint',
    placeholder: 'https://api.openai.com/v1',
  },
  dashscope: {
    label: 'settings.imageConnection.protocols.dashscope',
    baseUrlHint: 'settings.imageConnection.baseUrlHintDashscope',
    placeholder: 'https://dashscope.aliyuncs.com/api/v1',
  },
};

export type ImageConnectionFormDraft = {
  enabled: boolean;
  protocol: ImageConnectionProtocol;
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

export type ImageConnectionCheck = (input: CheckImageConnection) => Promise<ConnectionCheckResult>;

export function createImageConnectionFormDraft(
  stored: Pick<ImageConnectionView, 'enabled' | 'protocol' | 'baseUrl' | 'model'> | undefined
): ImageConnectionFormDraft {
  return {
    enabled: stored?.enabled ?? true,
    protocol: imageConnectionProtocol(stored ?? {}),
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
    protocol: draft.protocol,
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
    draft.protocol !== initial.protocol ||
    draft.model.trim() !== initial.model ||
    draft.baseUrl.trim() !== initial.baseUrl ||
    draft.clearApiKey ||
    draft.apiKey.trim().length > 0
  );
};

const SUGGESTION_LIMIT = 12;

/** Model IDs the service listed, narrowed by what is typed; picking one fills the field. */
function ModelSuggestions({
  models,
  value,
  disabled,
  onPick,
}: {
  models: readonly string[];
  value: string;
  disabled: boolean;
  onPick: (model: string) => void;
}) {
  const { t } = useTranslation();
  const typed = value.trim();
  const needle = typed.toLowerCase();
  const matches = needle
    ? models.filter((model) => model.toLowerCase().includes(needle) && model !== typed)
    : models;
  if (models.length === 0) return null;
  if (models.includes(typed) && matches.length === 0)
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <CircleCheck aria-hidden className="h-3 w-3 shrink-0" />
        {t('settings.imageConnection.modelListed', { count: models.length })}
      </p>
    );
  if (matches.length === 0)
    return (
      <p className="text-[11px] text-muted-foreground">
        {t('settings.imageConnection.modelNotListed', { count: models.length })}
      </p>
    );
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-muted-foreground">
        {t('settings.imageConnection.suggestions', { count: models.length })}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {matches.slice(0, SUGGESTION_LIMIT).map((model) => (
          <button
            key={model}
            type="button"
            disabled={disabled}
            onClick={() => onPick(model)}
            className="max-w-full truncate rounded-full border border-border/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            {model}
          </button>
        ))}
        {matches.length > SUGGESTION_LIMIT ? (
          <span className="px-1 py-0.5 text-[11px] text-muted-foreground">
            {t('settings.imageConnection.moreSuggestions', {
              count: matches.length - SUGGESTION_LIMIT,
            })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The editor itself. Presentational: it owns the draft and its validation and
 * hands complete values to `onSave`, so the Storybook story and the container
 * exercise the same component the user sees.
 */
export function ImageConnectionForm({
  stored,
  saving = false,
  saveError,
  onSave,
  onCancel,
  onClearApiKey,
  onCheck,
  notice,
  className,
}: {
  stored: (ImageConnectionView & { revision?: number }) | undefined;
  saving?: boolean;
  saveError?: string;
  onSave: (draft: ImageConnectionFormDraft, check?: ConnectionCheckState) => void | Promise<void>;
  onCancel?: () => void;
  onClearApiKey: () => void | Promise<void>;
  onCheck?: ImageConnectionCheck;
  /** Shown at the top of the editor, e.g. a key-rotation reminder. */
  notice?: ReactNode;
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
  const hasStoredKey = Boolean(stored?.hasApiKey);
  const baseUrl = draft.baseUrl.trim();
  const typedKey = draft.apiKey.trim();
  const destinationNeedsKey = Boolean(
    stored && stored.baseUrl !== baseUrl && !draft.clearApiKey && !typedKey
  );
  const protocolCopy = PROTOCOL_COPY[draft.protocol];
  const checkRequest = useMemo<CheckImageConnection | null>(() => {
    if (draft.protocol === 'dashscope' || !ModelEndpointSchema.safeParse(baseUrl).success)
      return null;
    if (typedKey) return { protocol: draft.protocol, baseUrl, apiKey: typedKey };
    if (stored?.revision && hasStoredKey && !draft.clearApiKey && stored.baseUrl === baseUrl)
      return { protocol: draft.protocol, baseUrl, expectedRevision: stored.revision };
    return null;
  }, [baseUrl, draft.clearApiKey, draft.protocol, hasStoredKey, stored, typedKey]);
  const { state: check, recheck } = useConnectionCheck(checkRequest, onCheck);
  const listed = check.phase === 'done' && check.result.ok ? (check.result.models ?? []) : [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (invalid || destinationNeedsKey || saving) return;
    setDraft((current) => ({ ...current, apiKey: '' }));
    void onSave(draft, check);
  };

  return (
    <form className={className} onSubmit={submit}>
      <div className="space-y-5">
        {notice}
        <Field
          htmlFor={`${fieldId}-protocol`}
          label={t('settings.imageConnection.protocol')}
          hint={
            <WithInfo
              text={t('settings.imageConnection.protocolHint')}
              info={t('settings.imageConnection.protocolDetail')}
            />
          }
        >
          <SegmentedControl
            ariaLabel={t('settings.imageConnection.protocol')}
            size="sm"
            value={draft.protocol}
            disabled={saving}
            options={IMAGE_CONNECTION_PROTOCOLS.map((protocol) => ({
              value: protocol,
              label: t(PROTOCOL_COPY[protocol].label),
            }))}
            onChange={(protocol) => setDraft((current) => ({ ...current, protocol }))}
          />
        </Field>

        <Field
          htmlFor={`${fieldId}-base-url`}
          label={t('settings.imageConnection.baseUrl')}
          icon={<Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
          hint={
            issues.baseUrl && baseUrl.length > 0
              ? t('settings.imageConnection.invalidBaseUrl')
              : t(protocolCopy.baseUrlHint)
          }
        >
          <Input
            id={`${fieldId}-base-url`}
            disabled={saving}
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
            placeholder={protocolCopy.placeholder}
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
          <div className="space-y-1.5">
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
            {draft.protocol === 'dashscope' ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CircleDashed aria-hidden className="h-3.5 w-3.5 shrink-0" />
                {t('settings.imageConnection.testUnsupportedDashscope')}
              </p>
            ) : (
              <ConnectionCheckLine state={check} baseUrl={baseUrl} onRecheck={recheck} />
            )}
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
          <div className="space-y-2">
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
            <ModelSuggestions
              models={listed}
              value={draft.model}
              disabled={saving}
              onPick={(model) => setDraft((current) => ({ ...current, model }))}
            />
          </div>
        </Field>

        {saveError ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-snug text-destructive"
          >
            {t('settings.imageConnection.saveFailed', { message: saveError })}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {onCancel ? (
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          ) : null}
          <Button
            type="submit"
            size="sm"
            disabled={saving || invalid || !dirty || destinationNeedsKey}
          >
            {saving ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            {saving ? t('settings.imageConnection.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </form>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** The saved image connection at a glance, switched on or off in place. */
export function ImageConnectionSummary({
  stored,
  check,
  busy = false,
  onToggle,
  onEdit,
  onCheck,
}: {
  stored: ImageConnectionView;
  check?: ConnectionCheckState;
  busy?: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onCheck?: () => void;
}) {
  const { t } = useTranslation();
  const protocol = imageConnectionProtocol(stored);
  const canTurnOn = stored.hasApiKey && stored.model.trim().length > 0;
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06]"
      >
        <ImageIcon className="h-4 w-4 text-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm">
            {t(PROTOCOL_COPY[protocol].label)} · <span className="font-mono">{stored.model}</span>
          </p>
          <ConnectionCheckBadge state={check} />
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {hostOf(stored.baseUrl)}
          {stored.hasApiKey ? '' : ` · ${t('settings.readiness.keyMissing')}`}
        </p>
      </div>
      <Switch
        aria-label={t('settings.imageConnection.enabled')}
        checked={stored.enabled}
        disabled={busy || (!stored.enabled && !canTurnOn)}
        onCheckedChange={onToggle}
      />
      <Button variant="outline" size="sm" disabled={busy} onClick={onEdit}>
        {t('common.edit')}
      </Button>
      {onCheck && protocol !== 'dashscope' && stored.hasApiKey ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full"
              disabled={busy}
              aria-label={t('settings.imageConnection.moreActions')}
            >
              <Ellipsis aria-hidden className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onCheck}>{t('settings.check.run')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function ImageConnectionSetting({
  onConnectionChange,
}: {
  onConnectionChange?: (connection: ProtectedImageConnection | null) => void;
} = {}) {
  const { t } = useTranslation();
  const ipc = useMemo(() => getIpcServices(), []);
  const [stored, setStored] = useState<ProtectedImageConnection>();
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [check, setCheck] = useState<{ revision: number; state: ConnectionCheckState }>();
  useEffect(() => {
    if (ready) onConnectionChange?.(stored ?? null);
  }, [onConnectionChange, ready, stored]);
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
  const onCheck = useCallback<ImageConnectionCheck>(
    async (input) => {
      if (!ipc) return { ok: false, reason: 'unreachable' };
      return ipc.modelConnections.checkImage(input);
    },
    [ipc]
  );
  const save = async (draft: ImageConnectionFormDraft, checked?: ConnectionCheckState) => {
    if (!ipc || !ready || saving) return false;
    setSaving(true);
    setSaveError(undefined);
    try {
      const input = buildImageConnectionSave(draft, stored);
      if (!input) throw new Error('invalid_image_connection');
      const connection = await ipc.modelConnections.saveImage(input);
      setStored(connection);
      setCheck(
        checked?.phase === 'done' ? { revision: connection.revision, state: checked } : undefined
      );
      return true;
    } catch {
      setSaveError(t('settings.models.error'));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const checkSaved = (connection: ProtectedImageConnection) => {
    setCheck({ revision: connection.revision, state: { phase: 'checking' } });
    void onCheck({
      protocol: connection.protocol,
      baseUrl: connection.baseUrl,
      expectedRevision: connection.revision,
    }).then(
      (result) => setCheck({ revision: connection.revision, state: { phase: 'done', result } }),
      () =>
        setCheck({
          revision: connection.revision,
          state: { phase: 'done', result: { ok: false, reason: 'unreachable' } },
        })
    );
  };
  if (!ipc) return <p>{t('settings.imageConnection.unavailable')}</p>;
  const notice = stored?.legacyHistoryMayContainKey ? (
    <p
      role="alert"
      className="rounded-xl border border-border/60 px-4 py-3 text-xs leading-relaxed text-warning-foreground"
    >
      {t('settings.imageConnection.legacyHistoryWarning')}
    </p>
  ) : undefined;
  return (
    <CompactSection
      title={t('settings.imageConnection.sectionConnection')}
      description={t('settings.imageConnection.sectionConnectionHint')}
      info={t('settings.imageConnection.intro')}
    >
      <div className="border-t border-border/40">
        {!ready ? (
          <p role="status" className="px-5 py-4 text-xs text-muted-foreground">
            {saveError ?? t('settings.models.loading')}
          </p>
        ) : editing ? (
          <ImageConnectionForm
            className="bg-foreground/[0.015] p-5"
            stored={stored}
            saving={saving}
            saveError={saveError}
            notice={notice}
            onCheck={onCheck}
            onCancel={() => {
              setSaveError(undefined);
              setEditing(false);
            }}
            onSave={async (draft, checked) => {
              if (await save(draft, checked)) setEditing(false);
            }}
            onClearApiKey={async () => {
              if (stored)
                await save({ ...createImageConnectionFormDraft(stored), clearApiKey: true });
            }}
          />
        ) : stored ? (
          <>
            {notice ? <div className="px-5 pt-4">{notice}</div> : null}
            <ImageConnectionSummary
              stored={stored}
              check={check?.revision === stored.revision ? check.state : undefined}
              busy={saving}
              onEdit={() => setEditing(true)}
              onCheck={() => checkSaved(stored)}
              onToggle={(enabled) =>
                void save({ ...createImageConnectionFormDraft(stored), enabled })
              }
            />
            {saveError ? (
              <p role="alert" className="px-5 pb-4 text-xs text-destructive">
                {saveError}
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
              {t('settings.imageConnection.statusNotReady')}
            </p>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t('settings.imageConnection.setUp')}
            </Button>
          </div>
        )}
      </div>
    </CompactSection>
  );
}
