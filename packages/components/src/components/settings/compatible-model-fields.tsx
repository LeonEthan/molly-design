import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ModelThinkingLevelSchema,
  type CompatibleModelDefinition,
  type DiscoveredModel,
  type ModelMetadataSnapshot,
} from '@molly/shared/embedded-harness';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Check, LoaderCircle } from '@/ui/icons';
import { WithInfo } from './info-tip';

export type CompatibleModelDraft = Omit<CompatibleModelDefinition, 'contextWindow' | 'maxTokens'> & {
  contextWindow: string;
  maxTokens: string;
  /** Present on rows created by discovery; drives the "needs details" marker until complete. */
  discovered?: boolean;
  /** Stable React key assigned at creation; the editable modelId must not re-key the row. */
  rowId?: string;
};

let nextDraftRowId = 0;

export function compatibleModelDraft(model?: CompatibleModelDefinition): CompatibleModelDraft {
  const rowId = model?.modelId ? `model:${model.modelId}` : `draft:${nextDraftRowId++}`;
  return model
    ? {
        ...model,
        contextWindow: String(model.contextWindow),
        maxTokens: String(model.maxTokens),
        rowId,
      }
    : {
        modelId: '',
        name: '',
        input: ['text'],
        contextWindow: '',
        maxTokens: '',
        thinking: ['off'],
        toolCalls: false,
        maxTokensField: 'max_tokens',
        rowId,
      };
}

/** Modern OpenAI families reject the legacy field; proxies serving them need the new one. */
export function defaultMaxTokensField(modelId: string): CompatibleModelDraft['maxTokensField'] {
  return /(?:^|\/)o\d|gpt-[5-9]/i.test(modelId) ? 'max_completion_tokens' : 'max_tokens';
}

/** Minimal built-in fallback: the reasoning dialects a designer can hit through a
 *  compatible endpoint. Entries match by owner prefix. */
const REASONING_HINTS: Record<string, CompatibleModelDraft['thinking']> = {
  deepseek: ['off', 'high'],
  zai: ['off', 'high'],
  groq: ['off', 'high'],
  moonshotai: ['off', 'high'],
  'moonshotai-cn': ['off', 'high'],
  togetherai: ['off', 'high'],
  'fireworks-ai': ['off', 'high'],
};

function reasoningHintFor(modelId: string): CompatibleModelDraft['thinking'] | undefined {
  const owner = modelId.split('/')[0]?.toLowerCase();
  const levels = owner ? REASONING_HINTS[owner] : undefined;
  return levels ? [...levels] : undefined;
}

/** Discovery fills what the service told us; capability fields stay user-declared defaults. */
export function discoveredModelDraft(model: DiscoveredModel): CompatibleModelDraft {
  return enrichDiscoveredModel(model, null).draft;
}

function isComplete(draft: CompatibleModelDraft): boolean {
  const context = Number(draft.contextWindow);
  const output = Number(draft.maxTokens);
  return (
    draft.modelId.trim().length > 0 &&
    draft.name.trim().length > 0 &&
    Number.isInteger(context) &&
    context > 0 &&
    Number.isInteger(output) &&
    output > 0 &&
    output <= context &&
    draft.thinking.length > 0
  );
}

export type DiscoveryState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; models: DiscoveredModel[]; filteredNonChat: number }
  | { phase: 'failed' };

/** One discovered row after the offline metadata snapshot filled what the service omitted. */
export type EnrichedDiscoveredModel = {
  draft: CompatibleModelDraft;
  /** True when neither the service nor the snapshot could complete the draft. */
  incomplete: boolean;
};

/** Known service host → models.dev provider id, so enrichment prefers the right namespace. */
const HOST_PROVIDER_HINTS: Record<string, string> = {
  'api.deepseek.com': 'deepseek',
  'api.moonshot.ai': 'moonshotai',
  'api.moonshot.cn': 'moonshotai-cn',
  'api.x.ai': 'xai',
  'api.groq.com': 'groq',
  'api.together.ai': 'togetherai',
  'api.together.xyz': 'togetherai',
  'api.fireworks.ai': 'fireworks-ai',
  'api.mistral.ai': 'mistral',
  'api.z.ai': 'zai',
  'open.bigmodel.cn': 'zai',
  'openrouter.ai': 'openrouter',
  'api.siliconflow.cn': 'siliconflow',
  'api.siliconflow.com': 'siliconflow',
};

function hostHintFor(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  try {
    return HOST_PROVIDER_HINTS[new URL(baseUrl).hostname.toLowerCase()];
  } catch {
    return undefined;
  }
}

type SnapshotModel = ModelMetadataSnapshot['providers'][string]['models'][string];

function lookupMetadata(
  modelId: string,
  snapshot: ModelMetadataSnapshot | null,
  baseUrl?: string
): SnapshotModel | undefined {
  if (!snapshot) return undefined;
  const hint = hostHintFor(baseUrl);
  if (hint) {
    const provider = snapshot.providers[hint];
    const direct = provider?.models[modelId];
    if (direct) return direct;
    const stripped = provider?.models[modelId.split('/').pop() ?? ''];
    if (stripped) return stripped;
  }
  const slash = modelId.indexOf('/');
  if (slash > 0) {
    const owner = modelId.slice(0, slash).toLowerCase();
    const byOwner = snapshot.providers[owner]?.models[modelId.slice(slash + 1)];
    if (byOwner) return byOwner;
  }
  // Last resort: exact cross-provider match, only when unambiguous.
  let found: SnapshotModel | undefined;
  let hits = 0;
  for (const provider of Object.values(snapshot.providers)) {
    const hit = provider.models[modelId];
    if (hit) {
      found = hit;
      hits += 1;
    }
  }
  return hits === 1 ? found : undefined;
}

/**
 * Enrichment only fills blanks; values the service reported (and the user declaration they
 * become) always win. Snapshot metadata is models.dev-derived: packaged, reviewable, never
 * a live fetch from settings. Capability defaults stay conservative: an unknown model gets
 * `toolCalls: false` and the user turns it on, never a silent over-claim.
 */
export function enrichDiscoveredModel(
  model: DiscoveredModel,
  snapshot: ModelMetadataSnapshot | null,
  baseUrl?: string
): EnrichedDiscoveredModel {
  const metadata = lookupMetadata(model.modelId, snapshot, baseUrl);
  const draft: CompatibleModelDraft = {
    modelId: model.modelId,
    name: model.name ?? metadata?.name ?? model.modelId,
    input: metadata?.imageInput ? ['text', 'image'] : ['text'],
    contextWindow: model.contextWindow
      ? String(model.contextWindow)
      : metadata?.contextWindow
        ? String(metadata.contextWindow)
        : '',
    maxTokens: model.maxTokens
      ? String(model.maxTokens)
      : metadata?.maxTokens
        ? String(metadata.maxTokens)
        : '',
    thinking:
      metadata?.reasoning === true
        ? (reasoningHintFor(model.modelId) ?? ['off', 'high'])
        : ['off'],
    toolCalls: metadata?.toolCalls ?? false,
    maxTokensField: defaultMaxTokensField(model.modelId),
    discovered: true,
  };
  return { draft, incomplete: !isComplete(draft) };
}

function DiscoveryPanel({
  state,
  chosen,
  snapshot,
  baseUrl,
  busy,
  onToggle,
  onRetry,
}: {
  state: Exclude<DiscoveryState, { phase: 'idle' }>;
  chosen: ReadonlySet<string>;
  snapshot: ModelMetadataSnapshot | null;
  baseUrl: string;
  busy: boolean;
  onToggle: (model: DiscoveredModel, on: boolean) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (state.phase === 'loading')
    return (
      <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />
        {t('settings.models.discover.loading')}
      </p>
    );
  if (state.phase === 'failed')
    return (
      <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {t('settings.models.discover.failed')}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          disabled={busy}
          onClick={onRetry}
        >
          {t('settings.models.discover.retry')}
        </Button>
      </p>
    );
  if (state.models.length === 0)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {t('settings.models.discover.empty')}
      </p>
    );
  return (
    <div className="space-y-2">
      <p role="status" className="text-xs text-muted-foreground">
        {t('settings.models.discover.found', { count: state.models.length })}
        {state.filteredNonChat > 0
          ? ` ${t('settings.models.discover.filtered', { count: state.filteredNonChat })}`
          : ''}
      </p>
      <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-border/60 py-1">
        {state.models.map((model) => {
          const picked = chosen.has(model.modelId);
          const enriched = enrichDiscoveredModel(model, snapshot, baseUrl);
          return (
            <li key={model.modelId}>
              <button
                type="button"
                disabled={busy}
                aria-pressed={picked}
                onClick={() => onToggle(model, !picked)}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors',
                  picked ? 'bg-foreground/[0.04] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground'
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    picked
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border/80'
                  )}
                >
                  {picked ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {enriched.draft.name !== model.modelId ? (
                    <>
                      {enriched.draft.name}{' '}
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {model.modelId}
                      </span>
                    </>
                  ) : (
                    <span className="font-mono">{model.modelId}</span>
                  )}
                </span>
                {enriched.incomplete ? (
                  <span className="shrink-0 rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t('settings.models.discover.needsDetails')}
                  </span>
                ) : null}
                {enriched.draft.input.includes('image') ? (
                  <span className="shrink-0 rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t('settings.models.picker.seesImages')}
                  </span>
                ) : null}
                {enriched.draft.thinking.some((level) => level !== 'off') ? (
                  <span className="shrink-0 rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t('settings.models.picker.thinks')}
                  </span>
                ) : null}
                {enriched.draft.contextWindow ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {t('settings.models.discover.context', {
                      count: Number(enriched.draft.contextWindow),
                    })}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t('settings.models.discover.prefilled')}</p>
    </div>
  );
}

export function CompatibleModelFields({
  models,
  busy,
  discovery,
  snapshot = null,
  baseUrl,
  discoverable = false,
  onDiscover,
  onChange,
}: {
  models: CompatibleModelDraft[];
  busy: boolean;
  discovery?: DiscoveryState;
  /** Packaged models.dev projection; null while unread or unavailable. */
  snapshot?: ModelMetadataSnapshot | null;
  /** Connection endpoint; scopes snapshot lookups to the right provider namespace. */
  baseUrl?: string;
  /** The form has a valid endpoint, so discovery can run. */
  discoverable?: boolean;
  onDiscover?: () => void;
  onChange: (models: CompatibleModelDraft[]) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  // A discovered row is "picked" exactly while its declaration exists in the models list;
  // removing the fieldset (or the declaration) unpicks it, keeping both views consistent.
  const declaredIds = new Set(models.map((model) => model.modelId));
  const chosen = new Set(
    discovery?.phase === 'done'
      ? discovery.models.filter((model) => declaredIds.has(model.modelId)).map((m) => m.modelId)
      : []
  );
  const update = (index: number, patch: Partial<CompatibleModelDraft>) =>
    onChange(models.map((model, current) => (current === index ? { ...model, ...patch } : model)));
  const toggleDiscovered = (model: DiscoveredModel, on: boolean) => {
    if (on) {
      if (declaredIds.has(model.modelId)) return;
      onChange([...models, enrichDiscoveredModel(model, snapshot, baseUrl).draft]);
    } else {
      onChange(models.filter((existing) => existing.modelId !== model.modelId));
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        <WithInfo
          text={t('settings.models.compatibleLead')}
          info={t('settings.models.compatibleHint')}
        />
      </p>
      {onDiscover ? (
        <div className="space-y-2">
          {discovery && discovery.phase !== 'idle' ? (
            <DiscoveryPanel
              state={discovery}
              chosen={chosen}
              snapshot={snapshot}
              baseUrl={baseUrl ?? ''}
              busy={busy}
              onToggle={toggleDiscovered}
              onRetry={onDiscover}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !discoverable}
              onClick={onDiscover}
            >
              {t('settings.models.discover.button')}
            </Button>
          )}
        </div>
      ) : null}
      {models.map((model, index) => (
        <fieldset
          key={model.rowId ?? `row-${index}`}
          disabled={busy}
          className="space-y-3 rounded-lg border p-3"
        >
          <legend className="flex items-center gap-2 px-1 text-sm">
            {t('settings.models.customModel', { number: index + 1 })}
            {model.discovered === true && !isComplete(model) ? (
              <span className="text-xs font-normal text-muted-foreground">
                {t('settings.models.customModelIncomplete')}
              </span>
            ) : null}
          </legend>
          {(
            [
              ['modelId', 'settings.models.customModelId', 200],
              ['name', 'settings.models.customModelName', 300],
            ] as const
          ).map(([key, label, maxLength]) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`${id}-${index}-${key}`}>{t(label)}</Label>
              <Input
                id={`${id}-${index}-${key}`}
                value={model[key]}
                maxLength={maxLength}
                onChange={(event) => update(index, { [key]: event.target.value })}
              />
            </div>
          ))}
          {(
            [
              ['contextWindow', 'settings.models.contextWindow'],
              ['maxTokens', 'settings.models.maxOutputTokens'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`${id}-${index}-${key}`}>{t(label)}</Label>
              <Input
                id={`${id}-${index}-${key}`}
                type="number"
                min={1}
                max={16_777_216}
                step={1}
                value={model[key]}
                onChange={(event) => update(index, { [key]: event.target.value })}
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor={`${id}-${index}-token-field`}>
              {t('settings.models.maxTokensField')}
            </Label>
            <Select
              value={model.maxTokensField}
              disabled={busy}
              onValueChange={(value) => {
                if (value === 'max_tokens' || value === 'max_completion_tokens')
                  update(index, { maxTokensField: value });
              }}
            >
              <SelectTrigger id={`${id}-${index}-token-field`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="max_tokens">max_tokens</SelectItem>
                <SelectItem value="max_completion_tokens">max_completion_tokens</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(
            [
              ['image', 'settings.models.imageInput', model.input.includes('image')],
              ['toolCalls', 'settings.models.toolCalls', model.toolCalls],
            ] as const
          ).map(([key, label, checked]) => (
            <div key={key} className="flex items-center gap-2">
              <Checkbox
                id={`${id}-${index}-${key}`}
                disabled={busy}
                checked={checked}
                onCheckedChange={(value) => {
                  if (key === 'image')
                    update(index, { input: value === true ? ['text', 'image'] : ['text'] });
                  else update(index, { [key]: value === true });
                }}
              />
              <Label htmlFor={`${id}-${index}-${key}`}>{t(label)}</Label>
            </div>
          ))}
          {!model.toolCalls && (
            <p className="text-xs text-muted-foreground">
              {t('settings.models.toolsRequiredHint')}
            </p>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm">{t('settings.models.thinkingLevels')}</legend>
            <div className="flex flex-wrap gap-3">
              {ModelThinkingLevelSchema.options.map((level) => (
                <div key={level} className="flex items-center gap-1">
                  <Checkbox
                    id={`${id}-${index}-thinking-${level}`}
                    disabled={busy}
                    checked={model.thinking.includes(level)}
                    onCheckedChange={(value) =>
                      update(index, {
                        thinking: ModelThinkingLevelSchema.options.filter((candidate) =>
                          candidate === level ? value === true : model.thinking.includes(candidate)
                        ),
                      })
                    }
                  />
                  <Label htmlFor={`${id}-${index}-thinking-${level}`}>{level}</Label>
                </div>
              ))}
            </div>
          </fieldset>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onChange(models.filter((_, current) => current !== index))}
          >
            {t('settings.models.removeCustomModel', { number: index + 1 })}
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy || models.length >= 32}
        onClick={() => onChange([...models, compatibleModelDraft()])}
      >
        {t('settings.models.addCustomModel')}
      </Button>
    </div>
  );
}
