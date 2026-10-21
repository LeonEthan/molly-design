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
  SaveProtectedImageConnectionSchema,
  type CheckImageConnection,
  type ConnectionCheckResult,
  type ProtectedImageConnection,
} from '@molly/shared/embedded-harness';
import { useTranslation } from 'react-i18next';
import { useAtom } from 'jotai';
import {
  IMAGE_CONNECTION_MAX_MODEL_LENGTH,
  IMAGE_CONNECTION_PROTOCOLS,
  ImageConnectionEndpointSchema,
  imageConnectionProtocol,
  type ImageConnectionProtocol,
} from '@molly/shared';
import { imageKeyMigrationNoticeDismissedAtom } from '@/atoms';
import { SegmentedControl } from '@/components/shared/segmented-control';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import {
  CircleCheck,
  ChevronDown,
  Ellipsis,
  Image as ImageIcon,
  LoaderCircle,
  Trash2,
  X,
} from '@/ui/icons';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible';
import { Input } from '@/ui/input';
import { Switch } from '@/ui/switch';
import { CompactSection } from './compact-layout';
import {
  CredentialStorageRecovery,
  isUnreadableCredentialStorage,
  useCredentialStorageRecoveryRevision,
} from './credential-storage-recovery';
import {
  ConnectionCheckBadge,
  ConnectionCheckError,
  useConnectionCheck,
  type ConnectionCheckState,
} from './connection-check';
import { Field } from './form-primitives';
import { InfoTip } from './info-tip';

/** Image settings use only the main-process vault's public metadata. */

type ImageConnectionView = Pick<
  ProtectedImageConnection,
  'enabled' | 'protocol' | 'baseUrl' | 'model' | 'hasApiKey'
>;

const PROTOCOL_COPY: Record<
  ImageConnectionProtocol,
  { label: string; baseUrlHint: string; defaultBaseUrl: string }
> = {
  'openai-images': {
    label: 'settings.imageConnection.protocols.openaiImages',
    baseUrlHint: 'settings.imageConnection.baseUrlHint',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  dashscope: {
    label: 'settings.imageConnection.protocols.dashscope',
    baseUrlHint: 'settings.imageConnection.baseUrlHintDashscope',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  },
};

const isCustomBaseUrl = (protocol: ImageConnectionProtocol, baseUrl: string) => {
  const address = baseUrl.trim().replace(/\/+$/, '');
  return address !== '' && address !== PROTOCOL_COPY[protocol].defaultBaseUrl;
};

export const imageProtocolLabelKey = (connection: Pick<ImageConnectionView, 'protocol'>) =>
  PROTOCOL_COPY[imageConnectionProtocol(connection)].label;

export function applyImageProtocolChoice(
  draft: ImageConnectionFormDraft,
  protocol: ImageConnectionProtocol
): ImageConnectionFormDraft {
  if (draft.protocol === protocol) return draft;
  return { ...draft, protocol, apiKey: '' };
}

export function applyImageAddressEdit(
  addressWhenKeyTyped: string | null,
  nextUrl: string
): { addressWhenKeyTyped: string | null; clearTypedKey: boolean } {
  const stillEnteringFirstAddress =
    addressWhenKeyTyped === null || addressWhenKeyTyped.trim() === '';
  if (stillEnteringFirstAddress || addressWhenKeyTyped.trim() === nextUrl.trim()) {
    return { addressWhenKeyTyped, clearTypedKey: false };
  }
  return { addressWhenKeyTyped: null, clearTypedKey: true };
}

export function commitImageAddress(addressWhenKeyTyped: string | null, url: string): string | null {
  if (addressWhenKeyTyped !== null && addressWhenKeyTyped.trim() !== '') return addressWhenKeyTyped;
  if (url.trim() === '') return addressWhenKeyTyped;
  return url.trim();
}

export function addressForTypedKey(addressWhenKeyTyped: string | null, currentUrl: string): string {
  if (addressWhenKeyTyped !== null && addressWhenKeyTyped.trim() === '') return '';
  return currentUrl.trim();
}

export function typedKeyMatchesAddress(
  addressWhenKeyTyped: string | null,
  currentUrl: string
): boolean {
  const bound = addressWhenKeyTyped?.trim() ?? '';
  return bound !== '' && bound === currentUrl.trim();
}

export function imageConnectionUsesStoredKey(
  draft: Pick<ImageConnectionFormDraft, 'protocol' | 'baseUrl' | 'apiKey' | 'clearApiKey'>,
  stored: Pick<ImageConnectionView, 'protocol' | 'baseUrl' | 'hasApiKey'> | undefined
): boolean {
  return Boolean(
    stored?.hasApiKey &&
    !draft.clearApiKey &&
    draft.apiKey.trim().length === 0 &&
    imageConnectionProtocol(stored) === draft.protocol &&
    stored.baseUrl === draft.baseUrl.trim()
  );
}

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

const IMAGE_NOT_FOUND_STATUSES = new Set([404, 405, 501]);

/** Plain image-check copy. A missing optional model list stays silent. */
export function imageConnectionCheckMessageKey(
  result: Extract<ConnectionCheckResult, { ok: false }>
):
  | 'settings.imageConnection.check.keyRejected'
  | 'settings.imageConnection.check.notFound'
  | 'settings.imageConnection.check.unreachable'
  | null {
  if (result.reason === 'unsupported') return null;
  if (result.reason === 'key_rejected') return 'settings.imageConnection.check.keyRejected';
  if (result.status !== undefined && IMAGE_NOT_FOUND_STATUSES.has(result.status)) {
    return 'settings.imageConnection.check.notFound';
  }
  if (result.reason === 'unreachable') return 'settings.imageConnection.check.unreachable';
  return null;
}

export function imageConnectionCanSave(
  draft: ImageConnectionFormDraft,
  stored: Pick<ImageConnectionView, 'protocol' | 'baseUrl' | 'hasApiKey'> | undefined
): boolean {
  const issues = imageConnectionDraftIssues(draft);
  if (issues.baseUrl || issues.model) return false;
  if (draft.apiKey.trim().length > 0) return true;
  if (draft.clearApiKey) return Boolean(stored?.hasApiKey);
  return imageConnectionUsesStoredKey(draft, stored);
}

/** Which field the user still has to fix; the component maps these to copy. */
export function imageConnectionDraftIssues(draft: ImageConnectionFormDraft): {
  baseUrl: boolean;
  model: boolean;
} {
  return {
    baseUrl: !ImageConnectionEndpointSchema.safeParse(draft.baseUrl.trim()).success,
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
  onDelete,
  notice,
  className,
  pinActions = false,
}: {
  stored: (ImageConnectionView & { revision?: number }) | undefined;
  saving?: boolean;
  saveError?: string;
  onSave: (draft: ImageConnectionFormDraft, check?: ConnectionCheckState) => void | Promise<void>;
  onCancel?: () => void;
  onClearApiKey: () => void | Promise<void>;
  onCheck?: ImageConnectionCheck;
  onDelete?: () => void;
  /** Shown at the top of the editor, e.g. a key-rotation reminder. */
  notice?: ReactNode;
  className?: string;
  /** Keep Connect/Save visible and scroll the fields above it. */
  pinActions?: boolean;
}) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [draft, setDraft] = useState(() => createImageConnectionFormDraft(stored));
  const [addressWhenKeyTyped, setAddressWhenKeyTyped] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    isCustomBaseUrl(draft.protocol, draft.baseUrl)
  );

  useEffect(() => {
    setAddressWhenKeyTyped(null);
    setDraft(createImageConnectionFormDraft(stored));
  }, [stored]);

  const issues = useMemo(() => imageConnectionDraftIssues(draft), [draft]);
  const dirty = isDirty(draft, stored);
  const hasStoredKey = Boolean(stored?.hasApiKey);
  const baseUrl = draft.baseUrl.trim();
  const typedKey = draft.apiKey.trim();
  const usesStoredKey = imageConnectionUsesStoredKey(draft, stored);
  const destinationNeedsKey = Boolean(
    stored &&
    !usesStoredKey &&
    !draft.clearApiKey &&
    !typedKey &&
    (stored.baseUrl !== baseUrl || imageConnectionProtocol(stored) !== draft.protocol)
  );
  const protocolCopy = PROTOCOL_COPY[draft.protocol];
  const checkRequest = useMemo<CheckImageConnection | null>(() => {
    if (draft.protocol === 'dashscope' || !ImageConnectionEndpointSchema.safeParse(baseUrl).success)
      return null;
    if (typedKey && typedKeyMatchesAddress(addressWhenKeyTyped, baseUrl))
      return { protocol: draft.protocol, baseUrl, apiKey: typedKey };
    if (stored?.revision && imageConnectionUsesStoredKey(draft, stored))
      return { protocol: draft.protocol, baseUrl, expectedRevision: stored.revision };
    return null;
  }, [addressWhenKeyTyped, baseUrl, draft, stored, typedKey]);
  const check = useConnectionCheck(checkRequest, onCheck);
  const checkMessageKey =
    check.phase === 'done' && !check.result.ok
      ? imageConnectionCheckMessageKey(check.result)
      : null;
  const blockEmptyBaseUrl =
    baseUrl.length === 0 && (typedKey.length > 0 || (hasStoredKey && !draft.clearApiKey));
  const checkMessage = blockEmptyBaseUrl
    ? t('settings.imageConnection.check.enterBaseUrl')
    : checkMessageKey
      ? t(checkMessageKey)
      : undefined;
  const canSave = imageConnectionCanSave(draft, stored);
  const listed = check.phase === 'done' && check.result.ok ? (check.result.models ?? []) : [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || destinationNeedsKey || saving) return;
    setAddressWhenKeyTyped(null);
    setDraft((current) => ({ ...current, apiKey: '' }));
    void onSave(draft, check);
  };

  const saveErrorAlert = saveError ? (
    <p
      role="alert"
      className={`rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-snug text-destructive ${pinActions ? 'mt-3 shrink-0' : ''}`}
    >
      {t('settings.imageConnection.saveFailed', { message: saveError })}
    </p>
  ) : null;

  return (
    <form
      className={[pinActions ? 'flex h-full min-h-0 flex-1 flex-col' : 'space-y-5', className]
        .filter(Boolean)
        .join(' ')}
      onSubmit={submit}
    >
      <div
        data-drawer-body={pinActions ? '' : undefined}
        className={pinActions ? 'min-h-0 flex-1 space-y-5 overflow-y-auto' : 'space-y-5'}
      >
        {notice}
        <Field label={t('settings.imageConnection.protocol')}>
          <SegmentedControl
            ariaLabel={t('settings.imageConnection.protocol')}
            size="sm"
            value={draft.protocol}
            disabled={saving}
            options={IMAGE_CONNECTION_PROTOCOLS.map((protocol) => ({
              value: protocol,
              label: t(PROTOCOL_COPY[protocol].label),
            }))}
            onChange={(protocol) => {
              const next = applyImageProtocolChoice(draft, protocol);
              setAddressWhenKeyTyped(null);
              setDraft(next);
              if (isCustomBaseUrl(next.protocol, next.baseUrl)) setAdvancedOpen(true);
            }}
          />
        </Field>

        <Field
          htmlFor={`${fieldId}-api-key`}
          label={t('settings.imageConnection.apiKey')}
          hint={destinationNeedsKey ? t('settings.models.keyRequired') : undefined}
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
                onChange={(event) => {
                  setAddressWhenKeyTyped((current) => addressForTypedKey(current, draft.baseUrl));
                  setDraft((current) => ({
                    ...current,
                    apiKey: event.target.value,
                    clearApiKey: false,
                  }));
                }}
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
                    setAddressWhenKeyTyped(null);
                    setDraft((current) => ({ ...current, apiKey: '', clearApiKey: true }));
                    void onClearApiKey();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{t('settings.models.keyLocalHint')}</p>
            <ConnectionCheckError state={check} baseUrl={baseUrl} message={checkMessage} />
          </div>
        </Field>

        <Field
          htmlFor={`${fieldId}-model`}
          label={t('settings.imageConnection.model')}
          hint={
            issues.model && draft.model.trim().length > 0
              ? t('settings.imageConnection.invalidModel')
              : undefined
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

        <Collapsible
          open={advancedOpen || (issues.baseUrl && (baseUrl.length > 0 || blockEmptyBaseUrl))}
          onOpenChange={setAdvancedOpen}
        >
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              className="group gap-1.5 px-0 text-xs text-muted-foreground"
            >
              <ChevronDown
                aria-hidden
                className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180"
              />
              {t('settings.models.moreOptions')}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <Field
              htmlFor={`${fieldId}-base-url`}
              label={t('settings.imageConnection.baseUrl')}
              icon={
                <InfoTip>
                  {t(protocolCopy.baseUrlHint)}{' '}
                  {t('settings.imageConnection.endpointTransportHint')}
                </InfoTip>
              }
              hint={
                issues.baseUrl && baseUrl.length > 0
                  ? t('settings.imageConnection.invalidBaseUrl')
                  : undefined
              }
            >
              <Input
                id={`${fieldId}-base-url`}
                disabled={saving}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
                placeholder={t('settings.imageConnection.baseUrlPlaceholder')}
                value={draft.baseUrl}
                onBlur={() => {
                  setAddressWhenKeyTyped((current) => commitImageAddress(current, draft.baseUrl));
                }}
                onChange={(event) => {
                  const next = event.target.value;
                  const edited = applyImageAddressEdit(addressWhenKeyTyped, next);
                  setAdvancedOpen(true);
                  setAddressWhenKeyTyped(edited.addressWhenKeyTyped);
                  setDraft((current) => ({
                    ...current,
                    baseUrl: next,
                    apiKey: edited.clearTypedKey ? '' : current.apiKey,
                  }));
                }}
              />
            </Field>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {saveErrorAlert}

      <div
        data-drawer-footer={pinActions ? '' : undefined}
        className={`flex flex-wrap items-center gap-2 ${pinActions ? 'shrink-0 border-t border-border/40 pt-4' : ''}`}
      >
        {onDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={saving}
            onClick={onDelete}
          >
            {t('settings.imageConnection.delete')}
          </Button>
        ) : null}
        <div className="ml-auto flex gap-2">
          {onCancel ? (
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          ) : null}
          <Button
            type="submit"
            size="sm"
            disabled={saving || !dirty || !canSave || destinationNeedsKey}
          >
            {saving ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            {saving
              ? t('settings.imageConnection.saving')
              : stored
                ? t('common.save')
                : t('settings.models.connect')}
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
  onDelete,
}: {
  stored: ImageConnectionView;
  check?: ConnectionCheckState;
  busy?: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onCheck?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const protocol = imageConnectionProtocol(stored);
  const canTurnOn = stored.hasApiKey && stored.model.trim().length > 0;
  const canCheck = Boolean(onCheck) && protocol !== 'dashscope' && stored.hasApiKey;
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
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-1 text-sm">
            <span className="shrink-0">{t(PROTOCOL_COPY[protocol].label)}</span>
            <span aria-hidden>·</span>
            <span className="min-w-0 font-mono break-all" title={stored.model}>
              {stored.model}
            </span>
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
      {canCheck || onDelete ? (
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
            {canCheck ? (
              <DropdownMenuItem onSelect={onCheck}>{t('settings.check.run')}</DropdownMenuItem>
            ) : null}
            {canCheck && onDelete ? <DropdownMenuSeparator /> : null}
            {onDelete ? (
              <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
                {t('settings.imageConnection.delete')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function ImageConnectionSetting({
  onConnectionChange,
  variant = 'section',
  onDone,
}: {
  onConnectionChange?: (connection: ProtectedImageConnection | null) => void;
  variant?: 'section' | 'panel';
  onDone?: () => void;
} = {}) {
  const { t } = useTranslation();
  const ipc = useMemo(() => getIpcServices(), []);
  const [stored, setStored] = useState<ProtectedImageConnection>();
  const [ready, setReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [storageUnreadable, setStorageUnreadable] = useState(false);
  const recoveryRevision = useCredentialStorageRecoveryRevision();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [check, setCheck] = useState<{ revision: number; state: ConnectionCheckState }>();
  const [migrationNoticeDismissed, dismissMigrationNotice] = useAtom(
    imageKeyMigrationNoticeDismissedAtom
  );
  useEffect(() => {
    if (ready) onConnectionChange?.(stored ?? null);
  }, [onConnectionChange, ready, stored]);
  useEffect(() => {
    setReady(false);
    setLoadFailed(false);
    setStorageUnreadable(false);
    setEditing(false);
    setCheck(undefined);
  }, [recoveryRevision]);
  useEffect(() => {
    if (!ipc) return undefined;
    let live = true;
    void ipc.modelConnections
      .getImageSnapshot()
      .then((snapshot) => {
        if (live) {
          setStored(snapshot.connection ?? undefined);
          setLoadFailed(false);
          setSaveError(undefined);
          setReady(true);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to read the image connection', error);
        if (live) {
          setLoadFailed(true);
          setStorageUnreadable(isUnreadableCredentialStorage(error));
          setSaveError(t('settings.models.error'));
        }
      });
    return () => {
      live = false;
    };
  }, [ipc, loadAttempt, recoveryRevision, t]);
  const onCheck = useCallback<ImageConnectionCheck>(
    async (input) => {
      if (!ipc) return { ok: false, reason: 'unreachable' };
      return ipc.modelConnections.checkImage(input);
    },
    [ipc]
  );
  const remove = async (connection: ProtectedImageConnection) => {
    if (!ipc || !ready || saving) return;
    if (!window.confirm(t('settings.imageConnection.deleteConfirm', { model: connection.model })))
      return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await ipc.modelConnections.deleteImage({ expectedRevision: connection.revision });
      setStored(undefined);
      setCheck(undefined);
      setEditing(false);
    } catch {
      setSaveError(t('settings.models.error'));
    } finally {
      setSaving(false);
    }
  };
  const save = async (draft: ImageConnectionFormDraft, checked?: ConnectionCheckState) => {
    if (!ipc || !ready || saving) return false;
    setSaving(true);
    setSaveError(undefined);
    try {
      const input = buildImageConnectionSave(draft, stored);
      if (!input) {
        setSaveError(
          t(
            imageConnectionDraftIssues(draft).baseUrl
              ? 'settings.imageConnection.invalidBaseUrl'
              : 'settings.imageConnection.invalidFields'
          )
        );
        return false;
      }
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
  const formOpen = editing || (variant === 'panel' && !stored);
  const notice =
    stored?.legacyHistoryMayContainKey && !migrationNoticeDismissed ? (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-xl border border-border/60 px-4 py-3 text-xs leading-relaxed text-warning-foreground"
      >
        <p className="min-w-0 flex-1">{t('settings.imageConnection.legacyHistoryWarning')}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-1.5 -mt-1 h-6 w-6 shrink-0 text-warning-foreground/70 hover:text-warning-foreground"
          aria-label={t('common.dismiss')}
          onClick={() => dismissMigrationNotice(true)}
        >
          <X aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </div>
    ) : undefined;
  const body = (
    <div
      className={
        variant === 'panel' ? 'flex h-full min-h-0 flex-1 flex-col' : 'border-t border-border/40'
      }
    >
      {!ready ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p role="status" className="min-w-0 flex-1 text-xs text-muted-foreground">
            {storageUnreadable
              ? t('settings.credentials.unreadable')
              : (saveError ?? t('settings.models.loading'))}
          </p>
          {storageUnreadable ? <CredentialStorageRecovery /> : null}
          {loadFailed ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setLoadFailed(false);
                setSaveError(undefined);
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              {t('common.retry')}
            </Button>
          ) : null}
        </div>
      ) : formOpen ? (
        <ImageConnectionForm
          className={variant === 'panel' ? undefined : 'bg-foreground/[0.015] p-5'}
          pinActions={variant === 'panel'}
          stored={stored}
          saving={saving}
          saveError={saveError}
          notice={notice}
          onCheck={onCheck}
          onCancel={() => {
            setSaveError(undefined);
            setEditing(false);
            if (!stored) onDone?.();
          }}
          onSave={async (draft, checked) => {
            if (!(await save(draft, checked))) return;
            setEditing(false);
            onDone?.();
          }}
          onDelete={stored ? () => void remove(stored) : undefined}
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
            onDelete={() => void remove(stored)}
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
  );
  if (variant === 'panel') return body;
  return (
    <CompactSection
      title={t('settings.imageConnection.sectionConnection')}
      description={t('settings.imageConnection.sectionConnectionHint')}
      info={t('settings.imageConnection.intro')}
    >
      {body}
    </CompactSection>
  );
}
