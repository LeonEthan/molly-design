import { useCallback, useMemo } from 'react';
import {
  isThoughtLevelSelector,
  resolveConfigOptionValue,
  type AcpConfigOptionSelector,
  type AcpConfigOptionValue,
  type AcpSelectConfigOptionSelector,
} from '@/components/shared/acp-selector-options';
import {
  composerProviderCycleTarget,
  pickComposerProvider,
  type ComposerModelOption,
} from '@/lib/composer-provider-hierarchy';
import type { ComposerCycleTarget } from '@/hooks/use-composer-cycle-commands';

const EMPTY_MODELS: readonly ComposerModelOption[] = [];

/**
 * `session.cycleProvider` walks the visible connection providers. The model
 * and reasoning that follow are the same ones a click on that provider writes.
 */
export function useComposerProviderCycle(input: {
  modelOptions: readonly ComposerModelOption[];
  selectedModelId: string | null;
  configOptionSelectors: readonly AcpConfigOptionSelector[];
  configOptionValues?: Record<string, AcpConfigOptionValue>;
  modelReasoningEfforts?: Record<string, readonly string[] | undefined>;
  onModelChange: (value: string) => void;
  onConfigOptionChange: (configId: string, value: AcpConfigOptionValue) => void;
}): ComposerCycleTarget | null {
  const modelSelector = useMemo(
    () =>
      input.configOptionSelectors.find(
        (selector): selector is AcpSelectConfigOptionSelector =>
          selector.type === 'select' && selector.category === 'model'
      ),
    [input.configOptionSelectors]
  );
  const thoughtSelector = useMemo(
    () =>
      input.configOptionSelectors.find(
        (selector): selector is AcpSelectConfigOptionSelector =>
          selector.type === 'select' && isThoughtLevelSelector(selector)
      ),
    [input.configOptionSelectors]
  );
  const pickerOptions = useMemo(
    () =>
      input.modelOptions.length > 0 ? input.modelOptions : (modelSelector?.options ?? EMPTY_MODELS),
    [input.modelOptions, modelSelector]
  );
  const modelValue =
    input.modelOptions.length > 0
      ? input.selectedModelId
      : modelSelector
        ? ((resolveConfigOptionValue(
            modelSelector,
            input.configOptionValues?.[modelSelector.configId]
          ) as string) ?? null)
        : null;
  const reasoningValue = thoughtSelector
    ? ((resolveConfigOptionValue(
        thoughtSelector,
        input.configOptionValues?.[thoughtSelector.configId]
      ) as string) ?? null)
    : null;
  const fallbackReasoningLevels = useMemo(
    () => thoughtSelector?.options.map((option) => option.value),
    [thoughtSelector]
  );
  const target = composerProviderCycleTarget({
    modelOptions: pickerOptions,
    selectedModelId: modelValue,
    reasoningValue,
    modelReasoningEfforts: input.modelReasoningEfforts,
    fallbackReasoningLevels,
  });
  const onModelChange = input.onModelChange;
  const onConfigOptionChange = input.onConfigOptionChange;
  const modelOptions = input.modelOptions;
  const modelReasoningEfforts = input.modelReasoningEfforts;
  const onSelect = useCallback(
    (providerId: string) => {
      const pick = pickComposerProvider({
        modelOptions: pickerOptions,
        selectedModelId: modelValue,
        reasoningValue,
        modelReasoningEfforts,
        fallbackReasoningLevels,
        providerId,
      });
      if (pick.modelId) {
        if (modelOptions.length > 0) onModelChange(pick.modelId);
        else if (modelSelector) onConfigOptionChange(modelSelector.configId, pick.modelId);
      }
      if (pick.reasoning && thoughtSelector) {
        onConfigOptionChange(thoughtSelector.configId, pick.reasoning);
      }
    },
    [
      fallbackReasoningLevels,
      modelOptions.length,
      modelReasoningEfforts,
      modelSelector,
      modelValue,
      onConfigOptionChange,
      onModelChange,
      pickerOptions,
      reasoningValue,
      thoughtSelector,
    ]
  );
  if (target.values.length === 0) return null;
  return { values: target.values, current: target.current, onSelect };
}
