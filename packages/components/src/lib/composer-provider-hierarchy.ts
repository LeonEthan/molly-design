import { MOLLY_UNSELECTED_MODEL, decodeMollyModelOption } from '@molly/shared/embedded-harness';

/**
 * Composer run-config hierarchy: Provider → Model → Reasoning.
 *
 * Providers are the connections already published on the model catalog
 * (`molly-model:<connection>/<model>`, or an ACP `group` when a catalog has
 * no Molly connection id). This does not read the connection-list API.
 *
 * A parent change keeps a child that is still valid and otherwise applies
 * {@link defaultComposerReasoning}. Visible `off` is the empty-provider row,
 * a configured model that publishes only `off`, and a configured model that
 * publishes no reasoning levels. That `off` value is what gets sent. A row
 * with no connection id and no group is never filed under another provider.
 */

export type ComposerModelOption = {
  value: string;
  label: string;
  group?: string;
  description?: string;
  disabled?: boolean;
};

export type ComposerProvider = {
  id: string;
  /** Connection display name. Empty for the synthetic single-catalog bucket. */
  name: string;
  kind: 'connection' | 'catalog';
};

export type ComposerProviderHierarchyMode = 'connections' | 'catalog' | 'empty';

const CATALOG_PROVIDER_ID = '__catalog__';
/** Synthetic bucket for catalog rows with no Molly connection id or ACP group. */
export const COMPOSER_UNGROUPED_PROVIDER_ID = '__ungrouped__';

export type ComposerProviderHierarchy = {
  mode: ComposerProviderHierarchyMode;
  providers: ComposerProvider[];
  providerId: string | null;
  providerName: string | null;
  modelId: string | null;
  models: ComposerModelOption[];
  reasoning: string;
  /** Levels the Reasoning row may list for the resolved model. */
  reasoningLevels: string[];
};

export function defaultComposerReasoning(
  levels: readonly string[] | undefined,
  hasProvider: boolean
): string {
  if (!hasProvider) return 'off';
  const published = (levels ?? []).filter((level) => level.length > 0);
  const offered = published.filter((level) => level !== 'off');
  if (offered.includes('high')) return 'high';
  if (offered.length > 0) return offered[0]!;
  if (published.length > 0) return published[0]!;
  return 'high';
}

function usableModels(modelOptions: readonly ComposerModelOption[]): ComposerModelOption[] {
  return modelOptions.filter((option) => option.value !== MOLLY_UNSELECTED_MODEL);
}

function connectionOf(option: ComposerModelOption): { id: string; name: string } | null {
  const decoded = decodeMollyModelOption(option.value);
  if (decoded) {
    return { id: decoded.connectionId, name: option.group ?? decoded.connectionId };
  }
  if (option.group) return { id: `group:${option.group}`, name: option.group };
  return null;
}

export function listComposerProviders(
  modelOptions: readonly ComposerModelOption[]
): ComposerProvider[] {
  const models = usableModels(modelOptions);
  const providers: ComposerProvider[] = [];
  const seen = new Set<string>();
  for (const option of models) {
    const connection = connectionOf(option);
    if (!connection || seen.has(connection.id)) continue;
    seen.add(connection.id);
    providers.push({ id: connection.id, name: connection.name, kind: 'connection' });
  }
  if (providers.length > 0) {
    if (models.some((option) => connectionOf(option) === null)) {
      providers.push({ id: COMPOSER_UNGROUPED_PROVIDER_ID, name: '', kind: 'connection' });
    }
    return providers;
  }
  if (models.length === 0) return [];
  return [{ id: CATALOG_PROVIDER_ID, name: '', kind: 'catalog' }];
}

function providerIdOf(option: ComposerModelOption): string {
  return connectionOf(option)?.id ?? COMPOSER_UNGROUPED_PROVIDER_ID;
}

function levelsForModel(
  modelId: string | null,
  originalModelId: string | null,
  efforts: Record<string, readonly string[] | undefined> | undefined,
  fallback: readonly string[] | undefined
): string[] {
  const mapped = modelId ? efforts?.[modelId] : undefined;
  if (mapped && mapped.length > 0) return [...mapped];
  const originalIsUnset =
    originalModelId === null || originalModelId === MOLLY_UNSELECTED_MODEL;
  if (
    fallback &&
    fallback.length > 0 &&
    (modelId === originalModelId || originalIsUnset)
  ) {
    return [...fallback];
  }
  return [];
}

function chooseReasoning(
  levels: readonly string[],
  current: string | null | undefined,
  hasProvider: boolean
): string {
  if (!hasProvider) return 'off';
  if (levels.length === 0) {
    return 'off';
  }
  const offered = levels.filter((level) => level !== 'off');
  if (current && current !== 'off' && levels.includes(current)) return current;
  if (current === 'off' && offered.length === 0 && levels.includes('off')) return 'off';
  return defaultComposerReasoning(levels, true);
}

function visibleReasoningLevels(levels: readonly string[], hasProvider: boolean): string[] {
  if (!hasProvider) return ['off'];
  if (levels.length === 0) return ['off'];
  const offered = levels.filter((level) => level !== 'off');
  if (offered.length > 0) return offered;
  return [...levels];
}

export function resolveComposerProviderHierarchy(input: {
  modelOptions: readonly ComposerModelOption[];
  selectedModelId: string | null;
  reasoningValue?: string | null;
  modelReasoningEfforts?: Record<string, readonly string[] | undefined>;
  /** Levels already normalized for `selectedModelId`, before a parent change. */
  fallbackReasoningLevels?: readonly string[];
  /** Set when the user picks a provider. Invalid ids are ignored. */
  providerId?: string | null;
}): ComposerProviderHierarchy {
  const models = usableModels(input.modelOptions);
  const providers = listComposerProviders(input.modelOptions);
  const mode: ComposerProviderHierarchyMode =
    providers.length === 0 ? 'empty' : providers[0]?.kind === 'catalog' ? 'catalog' : 'connections';

  if (mode === 'empty') {
    return {
      mode,
      providers,
      providerId: null,
      providerName: null,
      modelId: null,
      models: [],
      reasoning: 'off',
      reasoningLevels: ['off'],
    };
  }

  if (mode === 'catalog') {
    const provider = providers[0]!;
    const selected =
      input.selectedModelId && models.some((option) => option.value === input.selectedModelId)
        ? input.selectedModelId
        : (models[0]?.value ?? null);
    const catalogLevels = input.fallbackReasoningLevels ? [...input.fallbackReasoningLevels] : [];
    const catalogReasoning =
      input.reasoningValue ??
      (catalogLevels.length > 0 ? defaultComposerReasoning(catalogLevels, false) : 'off');
    return {
      mode,
      providers,
      providerId: provider.id,
      providerName: null,
      modelId: selected,
      models,
      reasoning: catalogReasoning,
      reasoningLevels: catalogLevels.length > 0 ? catalogLevels : ['off'],
    };
  }

  const requested =
    input.providerId && providers.some((provider) => provider.id === input.providerId)
      ? input.providerId
      : null;
  const selectedOption = models.find((option) => option.value === input.selectedModelId);
  const providerId = requested ?? (selectedOption ? providerIdOf(selectedOption) : providers[0]!.id);
  const provider = providers.find((entry) => entry.id === providerId) ?? providers[0]!;
  const scoped = models.filter((option) => providerIdOf(option) === provider.id);
  const modelId =
    input.selectedModelId && scoped.some((option) => option.value === input.selectedModelId)
      ? input.selectedModelId
      : (scoped[0]?.value ?? null);
  const levels = levelsForModel(
    modelId,
    input.selectedModelId,
    input.modelReasoningEfforts,
    input.fallbackReasoningLevels
  );
  const reasoning = chooseReasoning(levels, input.reasoningValue, true);
  return {
    mode,
    providers,
    providerId: provider.id,
    providerName: provider.name,
    modelId,
    models: scoped,
    reasoning,
    reasoningLevels: visibleReasoningLevels(levels, true),
  };
}

/** Connection providers the composer cycle command walks, in menu order. */
export function composerProviderCycleTarget(input: {
  modelOptions: readonly ComposerModelOption[];
  selectedModelId: string | null;
  reasoningValue?: string | null;
  modelReasoningEfforts?: Record<string, readonly string[] | undefined>;
  fallbackReasoningLevels?: readonly string[];
}): { values: string[]; current: string | null } {
  const hierarchy = resolveComposerProviderHierarchy(input);
  if (hierarchy.mode !== 'connections') return { values: [], current: null };
  return {
    values: hierarchy.providers.map((provider) => provider.id),
    current: hierarchy.providerId,
  };
}

/**
 * Model and reasoning to write when the cycle command lands on `providerId`.
 * A null field means that value already matches.
 */
export function pickComposerProvider(input: {
  modelOptions: readonly ComposerModelOption[];
  selectedModelId: string | null;
  reasoningValue?: string | null;
  modelReasoningEfforts?: Record<string, readonly string[] | undefined>;
  fallbackReasoningLevels?: readonly string[];
  providerId: string;
}): { modelId: string | null; reasoning: string | null } {
  const next = resolveComposerProviderHierarchy(input);
  return {
    modelId: next.modelId && next.modelId !== input.selectedModelId ? next.modelId : null,
    reasoning:
      next.mode === 'connections' && next.reasoning !== (input.reasoningValue ?? null)
        ? next.reasoning
        : null,
  };
}
