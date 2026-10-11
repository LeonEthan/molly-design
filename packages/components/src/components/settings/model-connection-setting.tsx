import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
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
  type DiscoverModelConnection,
  type DiscoverModelConnectionResult,
  type HarnessModelCatalog,
  type ModelConnection,
  type ModelMetadataSnapshot,
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
import { ChevronDown, Ellipsis, Plus } from '@/ui/icons';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible';
import { InfoTip } from './info-tip';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Switch } from '@/ui/switch';
import { CompactSection } from './compact-layout';
import {
  CompatibleModelFields,
  compatibleModelDraft,
  type DiscoveryState,
} from './compatible-model-fields';
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
export type ModelConnectionDiscover = (
  input: DiscoverModelConnection
) => Promise<DiscoverModelConnectionResult>;

/** Renderer-side handle for the main-owned subscription sign-in flow. */
export type OpenAiAuthFlow = {
  begin: (provider?: 'openai' | 'kimi-coding') => Promise<
    | {
        sessionId: string;
        authorizeUrl?: string;
        deviceCode?: { userCode: string; verificationUri: string };
        expiresAt: number;
      }
    | { ok: false; reason: 'unavailable' }
  >;
  complete: (
    sessionId: string
  ) => Promise<
    | { ok: true; connection: ModelConnection }
    | { ok: false; reason: 'cancelled' | 'timed_out' | 'denied' | 'unreachable' | 'invalid_response' }
  >;
  cancel: (sessionId: string) => Promise<void>;
  signOut: (input: { id: string; expectedRevision: number }) => Promise<void>;
};

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
  metadataSnapshot = null,
  busy = false,
  onSave,
  onCancel,
  onCheck,
  onDiscover,
  onOpenAiAuth,
  onDelete,
}: {
  stored?: ModelConnection;
  initialProvider?: ProviderPresetId;
  /** Packaged catalog models for every native preset; undefined while unread or unavailable. */
  catalog?: readonly CatalogModel[];
  /** Packaged models.dev projection for compatible discovery enrichment. */
  metadataSnapshot?: ModelMetadataSnapshot | null;
  busy?: boolean;
  onSave: (input: SaveModelConnection, check?: ConnectionCheckState) => Promise<void>;
  onCancel: () => void;
  onCheck?: ModelConnectionCheck;
  onDiscover?: ModelConnectionDiscover;
  /** Main-owned OpenAI sign-in flow; present only where the desktop bridge exists. */
  onOpenAiAuth?: OpenAiAuthFlow;
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
      (provider === 'openai-compatible' ? [] : [compatibleModelDraft()])
  );
  const [discovery, setDiscovery] = useState<DiscoveryState>({ phase: 'idle' });
  const [authFlow, setAuthFlow] = useState<
    | { phase: 'idle' }
    | { phase: 'waiting'; sessionId: string; deviceCode?: { userCode: string; verificationUri: string } }
    | { phase: 'failed'; reason: 'denied' | 'timed_out' | 'unreachable' | 'invalid_response' | 'unavailable' }
  >({ phase: 'idle' });
  const isOAuthConnection = stored?.authType === 'openai_oauth';
  // Presets with an official subscription sign-in flow.
  const oauthProvider =
    provider === 'openai' || provider === 'kimi-coding'
      ? (provider as 'openai' | 'kimi-coding')
      : undefined;

  const cancelSignIn = useCallback(() => {
    if (authFlow.phase === 'waiting') void onOpenAiAuth?.cancel(authFlow.sessionId);
    setAuthFlow({ phase: 'idle' });
  }, [authFlow, onOpenAiAuth]);

  // Cancelling or unmounting the form cancels any pending sign-in flow it started.
  const cancelForm = useCallback(() => {
    cancelSignIn();
    onCancel();
  }, [cancelSignIn, onCancel]);

  const authFlowRef = useRef(authFlow);
  authFlowRef.current = authFlow;
  const onOpenAiAuthRef = useRef(onOpenAiAuth);
  onOpenAiAuthRef.current = onOpenAiAuth;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const current = authFlowRef.current;
      if (current.phase === 'waiting') void onOpenAiAuthRef.current?.cancel(current.sessionId);
    };
  }, []);

  const beginSignIn = useCallback(async () => {
    if (!onOpenAiAuth || !oauthProvider) return;
    const started = await onOpenAiAuth.begin(oauthProvider);
    if (!('sessionId' in started)) {
      if (mountedRef.current) setAuthFlow({ phase: 'failed', reason: started.reason });
      return;
    }
    // The form may have been closed while the browser was still launching; the flow
    // this orphaned component started must not continue.
    if (!mountedRef.current) {
      void onOpenAiAuth.cancel(started.sessionId);
      return;
    }
    setAuthFlow({
      phase: 'waiting',
      sessionId: started.sessionId,
      ...(started.deviceCode ? { deviceCode: started.deviceCode } : {})
    });
    const result = await onOpenAiAuth.complete(started.sessionId);
    if (!mountedRef.current) return;
    if (result.ok) {
      // The flow saved the connection; the parent list refresh replaces this form.
      cancelForm();
      return;
    }
    if (result.reason === 'cancelled') {
      setAuthFlow({ phase: 'idle' });
      return;
    }
    setAuthFlow({ phase: 'failed', reason: result.reason });
  }, [onOpenAiAuth, oauthProvider, cancelForm]);
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
  const providerModels = useMemo(() => {
    if (!native) return undefined;
    return catalog?.filter((model) => model.providerPresetId === provider);
  }, [catalog, native, provider]);
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
  const discoverable =
    provider === 'openai-compatible' &&
    !configurationIssue &&
    ModelEndpointSchema.safeParse(endpoint).success &&
    (typedKey.length > 0 || (stored !== undefined && !requiresKey));
  const discover = useCallback(() => {
    if (!onDiscover || !discoverable) return;
    const input: DiscoverModelConnection = typedKey
      ? { providerPresetId: 'openai-compatible', baseUrl: endpoint, apiKey: typedKey }
      : {
          providerPresetId: 'openai-compatible',
          baseUrl: endpoint,
          stored: { id: stored!.id, revision: stored!.revision },
        };
    setDiscovery({ phase: 'loading' });
    void onDiscover(input).then(
      (result) =>
        setDiscovery(
          result.ok
            ? { phase: 'done', models: result.models, filteredNonChat: result.filteredNonChat }
            : { phase: 'failed' }
        ),
      () => setDiscovery({ phase: 'failed' })
    );
  }, [discoverable, endpoint, onDiscover, stored, typedKey]);
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
    setCustomModels([]);
    setDiscovery({ phase: 'idle' });
  };
  const startChoosing = () => {
    // Listed IDs only inform the checklist (not-listed tags). Never pre-select
    // from the key-check listing: a membership key that reports one model (Kimi
    // Code often lists only `k3`) would otherwise collapse the home picker to
    // that single catalog entry after Save.
    const ids = (providerModels ?? []).map((model) => model.modelId);
    setSelectedModels(selectedModels.length > 0 ? selectedModels : ids);
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
          customModels: customModels.map((model) => {
            const { discovered: _, rowId: _rowId, ...rest } = model;
            void _;
            void _rowId;
            return {
              ...rest,
              contextWindow: Number(model.contextWindow),
              maxTokens: Number(model.maxTokens),
            };
          }),
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
          {oauthProvider && onOpenAiAuth ? (
            <div className="space-y-2">
              {isOAuthConnection && stored?.oauth ? (
                <div className="space-y-2 rounded-lg border border-border/60 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {stored.oauth.email ?? stored.displayName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {stored.oauth.denied
                          ? t('settings.models.oauth.denied')
                          : stored.oauth.plan
                            ? t('settings.models.oauth.plan', { plan: stored.oauth.plan })
                            : t('settings.models.oauth.signedIn')}
                      </p>
                    </div>
                    {stored.oauth.denied ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          // Keep the denied row alive and start a fresh sign-in; the
                          // completed flow replaces it (one OAuth row per provider).
                          // Deleting first would unmount this form and cancel the flow.
                          void beginSignIn();
                        }}
                      >
                        {t('settings.models.oauth.signInAgain')}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          if (!onOpenAiAuth || !stored) return;
                          void onOpenAiAuth
                            .signOut({ id: stored.id, expectedRevision: stored.revision })
                            .then(() => onCancel());
                        }}
                      >
                        {t('settings.models.oauth.signOut')}
                      </Button>
                    )}
                  </div>
                  {stored.oauth.denied ? (
                    <p className="text-xs text-muted-foreground">
                      {t('settings.models.oauth.deniedDetail')}
                    </p>
                  ) : null}
                </div>
              ) : authFlow.phase === 'waiting' ? (
                <div className="space-y-2 rounded-lg border border-border/60 px-3 py-2.5">
                  {authFlow.deviceCode ? (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">
                        {t('settings.models.oauth.deviceCodePrompt')}
                      </p>
                      <p className="select-all font-mono text-lg tracking-widest">
                        {authFlow.deviceCode.userCode}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          window.open(authFlow.deviceCode!.verificationUri, '_blank')
                        }
                      >
                        {t('settings.models.oauth.openVerification')}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t('settings.models.oauth.waiting')}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={cancelSignIn}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void beginSignIn()}
                  >
                    {t('settings.models.oauth.signIn', {
                      provider: oauthProvider === 'kimi-coding' ? 'Kimi Code' : 'ChatGPT',
                    })}
                  </Button>
                  {authFlow.phase === 'failed' ? (
                    <p role="alert" className="text-xs text-destructive">
                      {t(`settings.models.oauth.failed.${authFlow.reason}`)}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {oauthProvider === 'kimi-coding'
                      ? t('settings.models.oauth.hintKimi')
                      : t('settings.models.oauth.hint')}
                  </p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t('settings.models.oauth.orKey')}
              </p>
            </div>
          ) : null}
          {!(oauthProvider && onOpenAiAuth && isOAuthConnection) ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor={`${id}-key`}>{t('settings.models.apiKey')}</Label>
              <InfoTip>{t('settings.models.keyHelp')}</InfoTip>
            </div>
            <Input
              id={`${id}-key`}
              type="password"
              value={apiKey}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              placeholder={requiresKey ? undefined : t('settings.models.keyStoredPlaceholder')}
              onChange={(event) => setApiKey(event.target.value)}
              aria-describedby={requiresKey ? `${id}-key-hint` : undefined}
            />
            <ConnectionCheckLine state={check} baseUrl={endpoint} onRecheck={recheck} />
            {requiresKey ? (
              <p id={`${id}-key-hint`} className="text-xs text-muted-foreground">
                {t('settings.models.keyRequired')}
              </p>
            ) : null}
          </div>
          ) : null}
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
                        label: t('settings.models.picker.all', {
                          count: providerModels.length,
                        }),
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
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                className="group gap-1.5 px-0 text-xs text-muted-foreground"
              >
                <ChevronDown
                  aria-hidden
                  className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180"
                />
                {t('settings.models.moreOptions')}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-5 pt-3">
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
            </CollapsibleContent>
          </Collapsible>
          {provider === 'openai-compatible' && (
            <>
              <CompatibleModelFields
                models={customModels}
                busy={busy}
                discovery={discovery}
                snapshot={metadataSnapshot}
                baseUrl={endpoint}
                discoverable={discoverable}
                onDiscover={onDiscover ? discover : undefined}
                onChange={setCustomModels}
              />
              {!parsed.success && (
                <p role="status" className="text-xs text-muted-foreground">
                  {t('settings.models.customModelsInvalid')}
                </p>
              )}
            </>
          )}
        </>
      ) : null}
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
          <Button variant="outline" type="button" disabled={busy} onClick={cancelForm}>
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
  const [metadataSnapshot, setMetadataSnapshot] = useState<ModelMetadataSnapshot | null>(null);
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
    void Promise.resolve()
      .then(() => ipc.modelConnections.getModelMetadataSnapshot())
      .then((value) => {
        if (live) setMetadataSnapshot(value);
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
  const onDiscover = useCallback<ModelConnectionDiscover>(
    async (input) => {
      if (!ipc) return { ok: false, reason: 'unreachable' };
      return ipc.modelConnections.discover(input);
    },
    [ipc]
  );
  const onOpenAiAuth = useMemo<OpenAiAuthFlow | undefined>(() => {
    if (!ipc) return undefined;
    return {
      begin: (provider) => ipc.modelConnections.beginOpenAiAuth({ provider }),
      complete: async (sessionId) => {
        const result = await ipc.modelConnections.completeOpenAiAuth({ sessionId });
        if (result.ok) {
          // The flow saved the connection in main; refresh the list so it appears now.
          const snapshot = await ipc.modelConnections.getSnapshot();
          setConnections(ModelConnectionSchema.array().parse(snapshot.connections));
        }
        return result;
      },
      cancel: (sessionId) => ipc.modelConnections.cancelOpenAiAuth({ sessionId }),
      signOut: async (input) => {
        await ipc.modelConnections.signOutOpenAiAuth(input);
        setConnections((current) => current.filter((entry) => entry.id !== input.id));
      },
    };
  }, [ipc]);
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
                    metadataSnapshot={metadataSnapshot}
                    busy={busy}
                    onSave={save}
                    onCancel={() => setEditing(null)}
                    onCheck={onCheck}
                    onDiscover={onDiscover}
                    onOpenAiAuth={onOpenAiAuth}
                    onDelete={() => void remove(connection)}
                  />
                </div>
              ) : (
                <ModelConnectionRow
                  key={connection.id}
                  connection={connection}
                  check={rowCheck(connection)}
                  catalogCount={
                    connection.providerPresetId === 'openai-compatible'
                      ? undefined
                      : catalog?.filter(
                          (model) => model.providerPresetId === connection.providerPresetId
                        ).length
                  }
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
                metadataSnapshot={metadataSnapshot}
                busy={busy}
                onSave={save}
                onCancel={() => setEditing(null)}
                onCheck={onCheck}
                onDiscover={onDiscover}
                onOpenAiAuth={onOpenAiAuth}
              />
            </div>
          ) : ready && connections.length === 0 ? (
            <div className="space-y-4 px-5 pb-5 pt-1">
              <div className="space-y-1">
                <p className="text-sm font-medium">{t('settings.models.emptyTitle')}</p>
                <p className="text-xs text-muted-foreground">{t('settings.models.empty')}</p>
              </div>
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
  catalogCount,
  busy = false,
  onEdit,
  onToggle,
  onCheck,
  onDelete,
}: {
  connection: ModelConnection;
  check?: ConnectionCheckState;
  /** Packaged catalog size for this connection's preset; lets the row say "8 of 57". */
  catalogCount?: number;
  busy?: boolean;
  onEdit: () => void;
  onToggle: (input: SaveModelConnection) => void;
  onCheck?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const provider = t(providerLabelKeys[connection.providerPresetId]);
  const toggled = toggledConnection(connection);
  const chosenCount = connection.customModels?.length ?? connection.models?.length;
  const where = isDefaultEndpoint(connection.baseUrl, connection.providerPresetId)
    ? provider
    : `${provider} · ${endpointLabel(connection.baseUrl)}`;
  const summary =
    chosenCount === undefined
      ? t('settings.models.summary.all')
      : catalogCount !== undefined && connection.customModels === undefined
        ? t('settings.models.summary.countOf', { count: chosenCount, total: catalogCount })
        : t('settings.models.summary.count', { count: chosenCount });
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <ProviderMark preset={connection.providerPresetId} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm">{connection.displayName}</p>
          <ConnectionCheckBadge state={check} />
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {where} · {summary}
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
