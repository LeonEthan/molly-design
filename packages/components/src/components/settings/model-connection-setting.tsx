import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ModelConnectionSchema,
  PROVIDER_PRESET_DEFAULT_BASE_URLS,
  ProviderPresetIdSchema,
  SaveModelConnectionSchema,
  getModelConnectionConfigurationIssue,
  isProviderPresetDefaultEndpoint,
  type ModelConnection,
  type ProviderPresetId,
  type SaveModelConnection,
} from '@molly/shared/embedded-harness';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Switch } from '@/ui/switch';
import { CompactSection } from './compact-layout';
import { CompatibleModelFields, compatibleModelDraft } from './compatible-model-fields';

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

export function ModelConnectionForm({
  stored,
  busy = false,
  onSave,
  onCancel,
}: {
  stored?: ModelConnection;
  busy?: boolean;
  onSave: (input: SaveModelConnection) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [name, setName] = useState(stored?.displayName ?? '');
  const [provider, setProvider] = useState<ModelConnection['providerPresetId'] | ''>(
    stored?.providerPresetId ?? ''
  );
  const [endpoint, setEndpoint] = useState(stored?.baseUrl ?? '');
  const [customEndpointOpen, setCustomEndpointOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(stored?.enabled ?? true);
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
  const labelOf = (preset: ProviderPresetId) => t(providerLabelKeys[preset]);
  const chooseProvider = (next: ProviderPresetId) => {
    const choice = applyProviderChoice({ provider, name, endpoint }, next, labelOf);
    setProvider(choice.provider);
    setName(choice.name);
    setEndpoint(choice.endpoint);
    setApiKey('');
  };
  const parsed = SaveModelConnectionSchema.safeParse({
    id: stored?.id,
    expectedRevision: stored?.revision,
    displayName: name,
    providerPresetId: provider,
    baseUrl: endpoint,
    enabled,
    apiKey: apiKey.trim() || undefined,
    ...(provider === 'openai-compatible' && customModels.length > 0
      ? {
          customModels: customModels.map((model) => ({
            ...model,
            contextWindow: Number(model.contextWindow),
            maxTokens: Number(model.maxTokens),
          })),
        }
      : {}),
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!parsed.success || (requiresKey && !apiKey.trim()) || busy) return;
    const input = parsed.data;
    setApiKey('');
    await onSave(input);
  };
  return (
    <form className="space-y-5 p-5" onSubmit={(event) => void submit(event)}>
      <div className="space-y-2">
        <Label htmlFor={`${id}-provider`}>{t('settings.models.provider')}</Label>
        <Select
          value={provider}
          disabled={busy}
          onValueChange={(value) => chooseProvider(ProviderPresetIdSchema.parse(value))}
        >
          <SelectTrigger id={`${id}-provider`}>
            <SelectValue placeholder={t('settings.models.chooseProvider')} />
          </SelectTrigger>
          <SelectContent>
            {ProviderPresetIdSchema.options.map((value) => (
              <SelectItem key={value} value={value}>
                {labelOf(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-key`}>{t('settings.models.apiKey')}</Label>
        <Input
          id={`${id}-key`}
          type="password"
          value={apiKey}
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setApiKey(event.target.value)}
          aria-describedby={`${id}-key-hint`}
        />
        <p id={`${id}-key-hint`} className="text-xs text-muted-foreground">
          {requiresKey ? t('settings.models.keyRequired') : t('settings.models.keyStored')}
        </p>
      </div>
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
      {provider === 'kimi-coding' && (
        <p className="text-xs text-muted-foreground">{t('settings.models.kimiCodeHint')}</p>
      )}
      {configurationIssue && (
        <p role="alert" className="text-xs text-destructive">
          {t(issueKeys[configurationIssue])}
        </p>
      )}
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
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${id}-enabled`}>{t('settings.models.enabled')}</Label>
        <Switch
          id={`${id}-enabled`}
          checked={enabled}
          disabled={busy}
          onCheckedChange={setEnabled}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('settings.models.storageHint')}</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" type="button" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy || !parsed.success || (requiresKey && !apiKey.trim())}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

export function ModelConnectionSetting() {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<ModelConnection[]>([]);
  const [editing, setEditing] = useState<ModelConnection | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const ipc = getIpcServices();
  const available = ipc !== null;
  useEffect(() => {
    if (!available) return undefined;
    let live = true;
    void getIpcServices()!
      .modelConnections.getSnapshot()
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
    return () => {
      live = false;
    };
  }, [available]);
  const save = async (input: SaveModelConnection) => {
    if (!ipc || busy) return;
    setBusy(true);
    setError(false);
    try {
      const saved = ModelConnectionSchema.parse(await ipc.modelConnections.save(input));
      setConnections((current) => [...current.filter((entry) => entry.id !== saved.id), saved]);
      setEditing(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
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
          {connections.map((connection) => (
            <ModelConnectionRow
              key={connection.id}
              connection={connection}
              busy={busy}
              onEdit={() => setEditing(connection)}
            />
          ))}
          {editing ? (
            <ModelConnectionForm
              key={editing === 'new' ? 'new' : `${editing.id}:${editing.revision}`}
              stored={editing === 'new' ? undefined : editing}
              busy={busy}
              onSave={save}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div className="px-5 pb-5 pt-4">
              {ready && connections.length === 0 && (
                <p className="mb-3 text-xs text-muted-foreground">{t('settings.models.empty')}</p>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={!ready || busy}
                onClick={() => setEditing('new')}
              >
                {t('settings.models.add')}
              </Button>
            </div>
          )}
        </>
      )}
    </CompactSection>
  );
}

export function ModelConnectionRow({
  connection,
  busy = false,
  onEdit,
}: {
  connection: ModelConnection;
  busy?: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const issue = getModelConnectionConfigurationIssue(connection);
  const provider = t(providerLabelKeys[connection.providerPresetId]);
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="truncate text-sm">{connection.displayName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {isDefaultEndpoint(connection.baseUrl, connection.providerPresetId)
            ? provider
            : `${provider} · ${endpointLabel(connection.baseUrl)}`}
        </p>
        {issue && <p className="text-xs text-destructive">{t(issueKeys[issue])}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-xs',
            connection.enabled ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              connection.enabled ? 'bg-foreground' : 'border border-muted-foreground'
            )}
          />
          {connection.enabled ? t('settings.models.statusOn') : t('settings.models.statusOff')}
        </span>
        <Button variant="outline" size="sm" disabled={busy} onClick={onEdit}>
          {t('common.edit')}
        </Button>
      </div>
    </div>
  );
}
