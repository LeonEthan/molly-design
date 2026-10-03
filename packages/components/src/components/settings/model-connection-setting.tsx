import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ModelConnectionSchema,
  ModelEndpointSchema,
  PROVIDER_PRESET_DEFAULT_BASE_URLS,
  ProviderPresetIdSchema,
  SaveModelConnectionSchema,
  getModelConnectionConfigurationIssue,
  isProviderPresetDefaultEndpoint,
  type CheckModelConnection,
  type ConnectionCheckResult,
  type HarnessModelCatalog,
  type ModelConnection,
  type ProviderPresetId,
  type SaveModelConnection,
} from '@molly/shared/embedded-harness';
import { SegmentedControl } from '@/components/shared/segmented-control';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Ellipsis, Plus } from '@/ui/icons';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Switch } from '@/ui/switch';
import { CompactSection } from './compact-layout';
import { CompatibleModelFields, compatibleModelDraft } from './compatible-model-fields';
import {
  ConnectionCheckBadge,
  ConnectionCheckLine,
  useConnectionCheck,
  type ConnectionCheckState,
} from './connection-check';
import { ModelChecklist, type CatalogModel } from './model-checklist';

const providerLabelKeys: Record<ProviderPresetId, string> = {
  openai: 'settings.models.providers.openai',
  anthropic: 'settings.models.providers.anthropic',
  google: 'settings.models.providers.google',
  xai: 'settings.models.providers.xai',
  deepseek: 'settings.models.providers.deepseek',
  moonshot: 'settings.models.moonshot',
  'kimi-coding': 'settings.models.kimiCode',
  zai: 'settings.models.providers.zai',
  minimax: 'settings.models.providers.minimax',
  openrouter: 'settings.models.providers.openrouter',
  'openai-compatible': 'settings.models.compatible',
};

const providerMarks: Record<ProviderPresetId, string> = {
  openai: 'OA',
  anthropic: 'AN',
  google: 'GE',
  xai: 'XA',
  deepseek: 'DS',
  moonshot: 'MS',
  'kimi-coding': 'KC',
  zai: 'ZA',
  minimax: 'MM',
  openrouter: 'OR',
  'openai-compatible': '{ }',
};

const QUICK_PROVIDERS: ProviderPresetId[] = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'kimi-coding',
  'openrouter',
];

export function ProviderMark({
  preset,
  size = 'md',
}: {
  preset: ProviderPresetId;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center bg-foreground/[0.06] font-semibold tracking-tight text-foreground',
        size === 'sm' ? 'h-5 w-5 rounded-md text-[8px]' : 'h-8 w-8 rounded-lg text-[10px]'
      )}
    >
      {providerMarks[preset]}
    </span>
  );
}

const defaultEndpointFor = (preset: ProviderPresetId | ''): string | undefined =>
  preset === '' || preset === 'openai-compatible'
    ? undefined
    : PROVIDER_PRESET_DEFAULT_BASE_URLS[preset];

const withoutTrailingSlash = (url: string) => url.trim().replace(/\/+$/, '');

const isDefaultEndpoint = (endpoint: string, preset: ProviderPresetId | ''): boolean =>
  preset !== '' && isProviderPresetDefaultEndpoint(preset, endpoint);

export type ConnectionIdentityDraft = {
  provider: ProviderPresetId | '';
  name: string;
  endpoint: string;
};

/**
 * Picking a provider fills in its default endpoint and names the connection after it,
 * but never overwrites an endpoint or name the user typed themselves.
 */
export function applyProviderChoice(
  draft: ConnectionIdentityDraft,
  next: ProviderPresetId,
  labelOf: (preset: ProviderPresetId) => string
): ConnectionIdentityDraft {
  const typedEndpoint =
    draft.endpoint.trim() !== '' && !isDefaultEndpoint(draft.endpoint, draft.provider);
  const typedName =
    draft.name.trim() !== '' && (draft.provider === '' || draft.name !== labelOf(draft.provider));
  return {
    provider: next,
    endpoint: typedEndpoint ? draft.endpoint : (defaultEndpointFor(next) ?? ''),
    name: typedName ? draft.name : labelOf(next),
  };
}

const endpointLabel = (url: string) => withoutTrailingSlash(url).replace(/^https?:\/\//, '');
const issueKeys = {
  kimi_code_requires_own_provider: 'settings.models.kimiCodeProviderRequired',
  kimi_code_requires_anthropic_base: 'settings.models.kimiCodeEndpointRequired',
} as const;

export type ModelConnectionCheck = (input: CheckModelConnection) => Promise<ConnectionCheckResult>;

function ProviderPicker({
  value,
  disabled,
  onChange,
}: {
  value: ProviderPresetId | '';
  disabled: boolean;
  onChange: (next: ProviderPresetId) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="radiogroup"
      aria-label={t('settings.models.provider')}
      className="grid grid-cols-2 gap-1.5 sm:grid-cols-3"
    >
      {ProviderPresetIdSchema.options.map((preset) => (
        <button
          key={preset}
          type="button"
          role="radio"
          aria-checked={value === preset}
          disabled={disabled}
          onClick={() => onChange(preset)}
          className={cn(
            'flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors',
            value === preset
              ? 'border-foreground bg-foreground/[0.04] text-foreground'
              : 'border-border/60 text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground'
          )}
        >
          <ProviderMark preset={preset} size="sm" />
          <span className="min-w-0 truncate">{t(providerLabelKeys[preset])}</span>
        </button>
      ))}
    </div>
  );
}

export function ModelConnectionForm({
  stored,
  initialProvider,
  catalog,
  busy = false,
  onSave,
  onCancel,
  onCheck,
  onDelete,
}: {
  stored?: ModelConnection;
  initialProvider?: ProviderPresetId;
  /** Packaged catalog models for every native preset; undefined while unread or unavailable. */
  catalog?: readonly CatalogModel[];
  busy?: boolean;
  onSave: (input: SaveModelConnection, check?: ConnectionCheckState) => Promise<void>;
  onCancel: () => void;
  onCheck?: ModelConnectionCheck;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const labelOf = (preset: ProviderPresetId) => t(providerLabelKeys[preset]);
  const initial = initialProvider
    ? applyProviderChoice({ provider: '', name: '', endpoint: '' }, initialProvider, labelOf)
    : undefined;
  const [name, setName] = useState(stored?.displayName ?? initial?.name ?? '');
  const [provider, setProvider] = useState<ModelConnection['providerPresetId'] | ''>(
    stored?.providerPresetId ?? initial?.provider ?? ''
  );
  const [endpoint, setEndpoint] = useState(stored?.baseUrl ?? initial?.endpoint ?? '');
  const [pickingProvider, setPickingProvider] = useState(!stored && !initialProvider);
  const [customEndpointOpen, setCustomEndpointOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [chooseModels, setChooseModels] = useState(stored?.models !== undefined);
  const [selectedModels, setSelectedModels] = useState<string[]>(stored?.models ?? []);
  const enabled = stored?.enabled ?? true;
  const [customModels, setCustomModels] = useState(
    () =>
      stored?.customModels?.map(compatibleModelDraft) ??
      (stored?.providerPresetId === 'openai-compatible' ? [] : [compatibleModelDraft()])
  );
  const configurationIssue = getModelConnectionConfigurationIssue({
    providerPresetId: provider,
    baseUrl: endpoint,
  });
  const requiresKey =
    !stored || stored.providerPresetId !== provider || stored.baseUrl !== endpoint;
  const defaultEndpoint = defaultEndpointFor(provider);
  const showEndpointField =
    provider !== '' && (customEndpointOpen || !isDefaultEndpoint(endpoint, provider));
  const native = provider !== '' && provider !== 'openai-compatible';
  const providerModels = useMemo(
    () => (native ? catalog?.filter((model) => model.providerPresetId === provider) : undefined),
    [catalog, native, provider]
  );
  const typedKey = apiKey.trim();
  const checkRequest = useMemo<CheckModelConnection | null>(() => {
    if (provider === '' || configurationIssue || !ModelEndpointSchema.safeParse(endpoint).success)
      return null;
    if (typedKey) return { providerPresetId: provider, baseUrl: endpoint, apiKey: typedKey };
    if (stored && !requiresKey)
      return {
        providerPresetId: provider,
        baseUrl: endpoint,
        stored: { id: stored.id, revision: stored.revision },
      };
    return null;
  }, [configurationIssue, endpoint, provider, requiresKey, stored, typedKey]);
  const { state: check, recheck } = useConnectionCheck(checkRequest, onCheck);
  const listed =
    check.phase === 'done' && check.result.ok && check.result.models
      ? new Set(check.result.models)
      : undefined;
  const chooseProvider = (next: ProviderPresetId) => {
    const choice = applyProviderChoice({ provider, name, endpoint }, next, labelOf);
    setProvider(choice.provider);
    setName(choice.name);
    setEndpoint(choice.endpoint);
    setApiKey('');
    setChooseModels(false);
    setSelectedModels([]);
    setPickingProvider(false);
  };
  const startChoosing = () => {
    const ids = (providerModels ?? []).map((model) => model.modelId);
    const fromListing = listed ? ids.filter((modelId) => listed.has(modelId)) : [];
    setSelectedModels(
      selectedModels.length > 0 ? selectedModels : fromListing.length > 0 ? fromListing : ids
    );
    setChooseModels(true);
  };
  const catalogIds = providerModels ? new Set(providerModels.map((model) => model.modelId)) : null;
  const models =
    native && chooseModels
      ? catalogIds
        ? selectedModels.filter((modelId) => catalogIds.has(modelId))
        : selectedModels
      : undefined;
  const parsed = SaveModelConnectionSchema.safeParse({
    id: stored?.id,
    expectedRevision: stored?.revision,
    displayName: name,
    providerPresetId: provider,
    baseUrl: endpoint,
    enabled,
    apiKey: typedKey || undefined,
    ...(provider === 'openai-compatible' && customModels.length > 0
      ? {
          customModels: customModels.map((model) => ({
            ...model,
            contextWindow: Number(model.contextWindow),
            maxTokens: Number(model.maxTokens),
          })),
        }
      : {}),
    ...(models ? { models } : {}),
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!parsed.success || (requiresKey && !typedKey) || busy) return;
    const input = parsed.data;
    setApiKey('');
    await onSave(input, check);
  };
  return (
    <form className="space-y-5 p-5" onSubmit={(event) => void submit(event)}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>
            {pickingProvider ? t('settings.models.chooseProvider') : t('settings.models.provider')}
          </Label>
          {!pickingProvider ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={busy}
              onClick={() => setPickingProvider(true)}
            >
              {t('settings.models.changeProvider')}
            </Button>
          ) : null}
        </div>
        {pickingProvider ? (
          <ProviderPicker value={provider} disabled={busy} onChange={chooseProvider} />
        ) : provider !== '' ? (
          <div className="flex items-center gap-2.5">
            <ProviderMark preset={provider} />
            <span className="text-sm text-foreground">{labelOf(provider)}</span>
          </div>
        ) : null}
        {provider === 'kimi-coding' && (
          <p className="text-xs text-muted-foreground">{t('settings.models.kimiCodeHint')}</p>
        )}
      </div>
      {provider !== '' ? (
        <>
          <div className="space-y-2">
            <Label htmlFor={`${id}-key`}>{t('settings.models.apiKey')}</Label>
            <Input
              id={`${id}-key`}
              type="password"
              value={apiKey}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              placeholder={requiresKey ? undefined : t('settings.models.keyStoredPlaceholder')}
              onChange={(event) => setApiKey(event.target.value)}
              aria-describedby={`${id}-key-hint`}
            />
            <ConnectionCheckLine state={check} baseUrl={endpoint} onRecheck={recheck} />
            <p id={`${id}-key-hint`} className="text-xs text-muted-foreground">
              {requiresKey ? t('settings.models.keyRequired') : t('settings.models.keyStored')}
            </p>
          </div>
          {showEndpointField ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`${id}-endpoint`}>{t('settings.models.endpoint')}</Label>
                {defaultEndpoint ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={busy}
                    onClick={() => {
                      setEndpoint(defaultEndpoint);
                      setApiKey('');
                      setCustomEndpointOpen(false);
                    }}
                  >
                    {t('settings.models.useDefaultEndpoint')}
                  </Button>
                ) : null}
              </div>
              <Input
                id={`${id}-endpoint`}
                value={endpoint}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setEndpoint(event.target.value);
                  setApiKey('');
                }}
              />
            </div>
          ) : defaultEndpoint ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 break-all text-xs text-muted-foreground">
                {t('settings.models.endpointDefault', { url: defaultEndpoint })}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={busy}
                onClick={() => setCustomEndpointOpen(true)}
              >
                {t('settings.models.useCustomEndpoint')}
              </Button>
            </div>
          ) : null}
          {configurationIssue && (
            <p role="alert" className="text-xs text-destructive">
              {t(issueKeys[configurationIssue])}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${id}-name`}>{t('settings.models.name')}</Label>
            <Input
              id={`${id}-name`}
              value={name}
              disabled={busy}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              aria-describedby={`${id}-name-hint`}
            />
            <p id={`${id}-name-hint`} className="text-xs text-muted-foreground">
              {t('settings.models.nameHint')}
            </p>
          </div>
          {native && (providerModels || stored?.models) ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>{t('settings.models.picker.title')}</Label>
                {providerModels ? (
                  <SegmentedControl
                    ariaLabel={t('settings.models.picker.title')}
                    size="sm"
                    value={chooseModels ? 'choose' : 'all'}
                    disabled={busy}
                    options={[
                      {
                        value: 'all',
                        label: t('settings.models.picker.all', { count: providerModels.length }),
                      },
                      { value: 'choose', label: t('settings.models.picker.choose') },
                    ]}
                    onChange={(value) =>
                      value === 'all' ? setChooseModels(false) : startChoosing()
                    }
                  />
                ) : null}
              </div>
              {providerModels && chooseModels ? (
                <ModelChecklist
                  models={providerModels}
                  selected={selectedModels}
                  listed={listed}
                  disabled={busy}
                  onChange={setSelectedModels}
                />
              ) : null}
              <p className="text-xs text-muted-foreground">
                {!providerModels
                  ? t('settings.models.picker.unavailable')
                  : chooseModels && models?.length === 0
                    ? t('settings.models.picker.chooseOne')
                    : t('settings.models.picker.hint')}
              </p>
            </div>
          ) : null}
          {provider === 'openai-compatible' && (
            <>
              <CompatibleModelFields models={customModels} busy={busy} onChange={setCustomModels} />
              {!parsed.success && (
                <p role="status" className="text-xs text-muted-foreground">
                  {t('settings.models.customModelsInvalid')}
                </p>
              )}
            </>
          )}
        </>
      ) : null}
      <p className="text-xs text-muted-foreground">{t('settings.models.storageHint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        {onDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={busy}
            onClick={onDelete}
          >
            {t('settings.models.delete')}
          </Button>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" type="button" disabled={busy} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy || !parsed.success || (requiresKey && !typedKey)}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </form>
  );
}

type Editing = ModelConnection | { kind: 'new'; provider?: ProviderPresetId } | null;
const isNew = (editing: Editing): editing is { kind: 'new'; provider?: ProviderPresetId } =>
  editing !== null && 'kind' in editing;

export function ModelConnectionSetting({
  onConnectionsChange,
}: {
  onConnectionsChange?: (connections: readonly ModelConnection[]) => void;
} = {}) {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<ModelConnection[]>([]);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [catalog, setCatalog] = useState<HarnessModelCatalog['models']>();
  const [checks, setChecks] = useState<
    Record<string, { revision: number; state: ConnectionCheckState }>
  >({});
  const ipc = useMemo(() => getIpcServices(), []);
  const available = ipc !== null;
  useEffect(() => {
    if (ready) onConnectionsChange?.(connections);
  }, [connections, onConnectionsChange, ready]);
  useEffect(() => {
    if (!ipc) return undefined;
    let live = true;
    void ipc.modelConnections
      .getSnapshot()
      .then((snapshot) => {
        const parsed = ModelConnectionSchema.array().parse(snapshot.connections);
        if (live) {
          setConnections(parsed);
          setReady(true);
        }
      })
      .catch(() => {
        if (live) setError(true);
      });
    void Promise.resolve()
      .then(() => ipc.modelConnections.getModelCatalog())
      .then((value) => {
        if (live) setCatalog(value.models);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ipc]);
  const onCheck = useCallback<ModelConnectionCheck>(
    async (input) => {
      if (!ipc) return { ok: false, reason: 'unreachable' };
      return ipc.modelConnections.check(input);
    },
    [ipc]
  );
  const recordCheck = (connection: ModelConnection, state: ConnectionCheckState) =>
    setChecks((current) => ({
      ...current,
      [connection.id]: { revision: connection.revision, state },
    }));
  const checkRow = (connection: ModelConnection) => {
    recordCheck(connection, { phase: 'checking' });
    void onCheck({
      providerPresetId: connection.providerPresetId,
      baseUrl: connection.baseUrl,
      stored: { id: connection.id, revision: connection.revision },
    }).then(
      (result) => recordCheck(connection, { phase: 'done', result }),
      () => recordCheck(connection, { phase: 'done', result: { ok: false, reason: 'unreachable' } })
    );
  };
  const persist = async (input: SaveModelConnection) => {
    if (!ipc || busy) return undefined;
    setBusy(true);
    setError(false);
    try {
      const saved = ModelConnectionSchema.parse(await ipc.modelConnections.save(input));
      setConnections((current) =>
        current.some((entry) => entry.id === saved.id)
          ? current.map((entry) => (entry.id === saved.id ? saved : entry))
          : [...current, saved]
      );
      return saved;
    } catch {
      setError(true);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const save = async (input: SaveModelConnection, check?: ConnectionCheckState) => {
    const saved = await persist(input);
    if (!saved) return;
    if (check?.phase === 'done') recordCheck(saved, check);
    setEditing(null);
  };
  const remove = async (connection: ModelConnection) => {
    if (!ipc || busy) return;
    if (!window.confirm(t('settings.models.deleteConfirm', { name: connection.displayName })))
      return;
    setBusy(true);
    setError(false);
    try {
      await ipc.modelConnections.delete({
        id: connection.id,
        expectedRevision: connection.revision,
      });
      setConnections((current) => current.filter((entry) => entry.id !== connection.id));
      setEditing(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const rowCheck = (connection: ModelConnection) => {
    const entry = checks[connection.id];
    return entry && entry.revision === connection.revision ? entry.state : undefined;
  };
  return (
    <CompactSection
      title={t('settings.models.title')}
      description={t('settings.models.notVerified')}
      info={t('settings.models.notVerifiedDetail')}
    >
      {!available ? (
        <p className="p-5 text-xs text-muted-foreground">{t('settings.models.unavailable')}</p>
      ) : (
        <>
          {error && (
            <p role="alert" className="p-5 text-xs text-destructive">
              {t('settings.models.error')}
            </p>
          )}
          {!ready && !error && (
            <p role="status" className="p-5 text-xs text-muted-foreground">
              {t('settings.models.loading')}
            </p>
          )}
          <div className="divide-y divide-border/40 border-t border-border/40 empty:border-t-0">
            {connections.map((connection) =>
              !isNew(editing) && editing?.id === connection.id ? (
                <div key={connection.id} className="bg-foreground/[0.015]">
                  <ModelConnectionForm
                    key={`${editing.id}:${editing.revision}`}
                    stored={editing}
                    catalog={catalog}
                    busy={busy}
                    onSave={save}
                    onCancel={() => setEditing(null)}
                    onCheck={onCheck}
                    onDelete={() => void remove(connection)}
                  />
                </div>
              ) : (
                <ModelConnectionRow
                  key={connection.id}
                  connection={connection}
                  check={rowCheck(connection)}
                  busy={busy}
                  onEdit={() => setEditing(connection)}
                  onToggle={(input) => void persist(input)}
                  onCheck={() => checkRow(connection)}
                  onDelete={() => void remove(connection)}
                />
              )
            )}
          </div>
          {isNew(editing) ? (
            <div className="border-t border-border/40 bg-foreground/[0.015]">
              <ModelConnectionForm
                key={`new:${editing.provider ?? ''}`}
                initialProvider={editing.provider}
                catalog={catalog}
                busy={busy}
                onSave={save}
                onCancel={() => setEditing(null)}
                onCheck={onCheck}
              />
            </div>
          ) : ready && connections.length === 0 ? (
            <div className="space-y-3 px-5 pb-5 pt-1">
              <p className="text-xs text-muted-foreground">{t('settings.models.empty')}</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_PROVIDERS.map((preset) => (
                  <Button
                    key={preset}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={busy}
                    onClick={() => setEditing({ kind: 'new', provider: preset })}
                  >
                    <ProviderMark preset={preset} size="sm" />
                    {t(providerLabelKeys[preset])}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setEditing({ kind: 'new' })}
                >
                  {t('settings.models.moreProviders')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="border-t border-border/40 px-5 py-3">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 gap-1.5"
                disabled={!ready || busy || editing !== null}
                onClick={() => setEditing({ kind: 'new' })}
              >
                <Plus aria-hidden className="h-3.5 w-3.5" />
                {t('settings.models.add')}
              </Button>
            </div>
          )}
        </>
      )}
    </CompactSection>
  );
}

const toggledConnection = (connection: ModelConnection) =>
  SaveModelConnectionSchema.safeParse({
    id: connection.id,
    expectedRevision: connection.revision,
    displayName: connection.displayName,
    providerPresetId: connection.providerPresetId,
    baseUrl: connection.baseUrl,
    enabled: !connection.enabled,
    ...(connection.customModels ? { customModels: connection.customModels } : {}),
    ...(connection.models ? { models: connection.models } : {}),
  });

export function ModelConnectionRow({
  connection,
  check,
  busy = false,
  onEdit,
  onToggle,
  onCheck,
  onDelete,
}: {
  connection: ModelConnection;
  check?: ConnectionCheckState;
  busy?: boolean;
  onEdit: () => void;
  onToggle: (input: SaveModelConnection) => void;
  onCheck?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const provider = t(providerLabelKeys[connection.providerPresetId]);
  const toggled = toggledConnection(connection);
  const modelCount = connection.customModels?.length ?? connection.models?.length;
  const where = isDefaultEndpoint(connection.baseUrl, connection.providerPresetId)
    ? provider
    : `${provider} · ${endpointLabel(connection.baseUrl)}`;
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <ProviderMark preset={connection.providerPresetId} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm">{connection.displayName}</p>
          <ConnectionCheckBadge state={check} />
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {where} ·{' '}
          {modelCount === undefined
            ? t('settings.models.summary.all')
            : t('settings.models.summary.count', { count: modelCount })}
        </p>
      </div>
      <Switch
        aria-label={t('settings.models.useConnection', { name: connection.displayName })}
        checked={connection.enabled}
        disabled={busy || !toggled.success}
        onCheckedChange={() => {
          if (toggled.success) onToggle(toggled.data);
        }}
      />
      <Button variant="outline" size="sm" disabled={busy} onClick={onEdit}>
        {t('common.edit')}
      </Button>
      {onCheck || onDelete ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full"
              disabled={busy}
              aria-label={t('settings.models.moreActions', { name: connection.displayName })}
            >
              <Ellipsis aria-hidden className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onCheck ? (
              <DropdownMenuItem onSelect={onCheck}>{t('settings.check.run')}</DropdownMenuItem>
            ) : null}
            {onCheck && onDelete ? <DropdownMenuSeparator /> : null}
            {onDelete ? (
              <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
                {t('settings.models.delete')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
