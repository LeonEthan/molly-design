import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeMollyModelOption, MOLLY_UNSELECTED_MODEL } from '@molly/shared/embedded-harness';
import {
  COMPOSER_UNGROUPED_PROVIDER_ID,
  composerProviderCycleTarget,
  defaultComposerReasoning,
  pickComposerProvider,
  resolveComposerProviderHierarchy,
} from '../src/lib/composer-provider-hierarchy';
import {
  readComposerProviderSelection,
  writeComposerProviderSelection,
} from '../src/lib/local-storage-cache';

const studio = encodeMollyModelOption('studio', 'aurora/1');
const review = encodeMollyModelOption('review', 'nimbus/2');
const models = [
  { value: MOLLY_UNSELECTED_MODEL, label: 'Select a connection and model' },
  { value: studio, label: 'Aurora 1', group: 'Studio' },
  { value: review, label: 'Nimbus 2', group: 'Review' },
];

describe('composer provider hierarchy', () => {
  it('defaults to the first provider, its first model, and high', () => {
    const resolved = resolveComposerProviderHierarchy({
      modelOptions: models,
      selectedModelId: MOLLY_UNSELECTED_MODEL,
      reasoningValue: 'off',
      modelReasoningEfforts: {
        [studio]: ['off', 'low', 'high'],
        [review]: ['low', 'max'],
      },
    });
    expect(resolved.mode).toBe('connections');
    expect(resolved.providerName).toBe('Studio');
    expect(resolved.modelId).toBe(studio);
    expect(resolved.models.map((option) => option.value)).toEqual([studio]);
    expect(resolved.reasoning).toBe('high');
    expect(resolved.reasoningLevels).toEqual(['low', 'high']);
  });

  it('keeps a valid child and replaces an invalid one with the first non-high level', () => {
    const kept = resolveComposerProviderHierarchy({
      modelOptions: models,
      selectedModelId: studio,
      reasoningValue: 'low',
      providerId: 'review',
      modelReasoningEfforts: {
        [studio]: ['low', 'high'],
        [review]: ['low', 'max'],
      },
    });
    expect(kept.modelId).toBe(review);
    expect(kept.reasoning).toBe('low');

    const replaced = resolveComposerProviderHierarchy({
      modelOptions: models,
      selectedModelId: studio,
      reasoningValue: 'high',
      providerId: 'review',
      modelReasoningEfforts: {
        [review]: ['max', 'low'],
      },
    });
    expect(replaced.modelId).toBe(review);
    expect(replaced.reasoning).toBe('max');
  });

  it('shows off and sends off when that is the only published level', () => {
    const resolved = resolveComposerProviderHierarchy({
      modelOptions: models,
      selectedModelId: studio,
      reasoningValue: 'off',
      modelReasoningEfforts: { [studio]: ['off'] },
    });
    expect(resolved.mode).toBe('connections');
    expect(resolved.reasoning).toBe('off');
    expect(resolved.reasoningLevels).toEqual(['off']);
  });

  it('uses off only when no provider is configured', () => {
    expect(defaultComposerReasoning(['high', 'low'], false)).toBe('off');
    const empty = resolveComposerProviderHierarchy({
      modelOptions: [{ value: MOLLY_UNSELECTED_MODEL, label: 'Select' }],
      selectedModelId: MOLLY_UNSELECTED_MODEL,
      reasoningValue: 'high',
    });
    expect(empty.mode).toBe('empty');
    expect(empty.providerName).toBeNull();
    expect(empty.modelId).toBeNull();
    expect(empty.reasoning).toBe('off');
  });

  it('places a non-connection row after the real providers', () => {
    const plain = { value: 'plain-gpt', label: 'Plain' };
    const onStudio = resolveComposerProviderHierarchy({
      modelOptions: [...models, plain],
      selectedModelId: studio,
    });
    expect(onStudio.models.map((option) => option.value)).toEqual([studio]);
    expect(onStudio.providers.at(-1)?.id).not.toBe(onStudio.providerId);
    const trailingId = onStudio.providers.at(-1)?.id;
    expect(trailingId).toBe(COMPOSER_UNGROUPED_PROVIDER_ID);
    const onPlain = resolveComposerProviderHierarchy({
      modelOptions: [...models, plain],
      selectedModelId: plain.value,
    });
    expect(onPlain.providerId).toBe(trailingId);
    expect(onPlain.models.map((option) => option.value)).toEqual([plain.value]);
    expect(onPlain.providers.map((provider) => provider.id)).toEqual(
      onStudio.providers.map((provider) => provider.id)
    );
  });

  it('uses off when a configured model publishes no reasoning levels', () => {
    const resolved = resolveComposerProviderHierarchy({
      modelOptions: models,
      selectedModelId: studio,
      reasoningValue: 'high',
      modelReasoningEfforts: { [studio]: [] },
    });
    expect(resolved.reasoning).toBe('off');
    expect(resolved.reasoningLevels).toEqual(['off']);
  });

  it('cycles connection providers and applies the next provider model', () => {
    const current = composerProviderCycleTarget({
      modelOptions: models,
      selectedModelId: studio,
      reasoningValue: 'high',
      modelReasoningEfforts: {
        [studio]: ['high'],
        [review]: ['max'],
      },
    });
    expect(current.values).toEqual(['studio', 'review']);
    expect(current.current).toBe('studio');
    expect(
      pickComposerProvider({
        modelOptions: models,
        selectedModelId: studio,
        reasoningValue: 'high',
        modelReasoningEfforts: {
          [studio]: ['high'],
          [review]: ['max'],
        },
        providerId: 'review',
      })
    ).toEqual({ modelId: review, reasoning: 'max' });
  });

  it('leaves an ungrouped catalog unscoped and keeps its reasoning', () => {
    const resolved = resolveComposerProviderHierarchy({
      modelOptions: [{ value: 'gpt-5.5', label: '5.5' }],
      selectedModelId: 'gpt-5.5',
      reasoningValue: 'medium',
      fallbackReasoningLevels: ['low', 'medium', 'high'],
    });
    expect(resolved.mode).toBe('catalog');
    expect(resolved.providerName).toBeNull();
    expect(resolved.models).toHaveLength(1);
    expect(resolved.reasoning).toBe('medium');
  });
});

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

describe('composer provider selection persistence', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return store.size;
      },
      clear() {
        store.clear();
      },
      getItem(key: string) {
        return store.get(key) ?? null;
      },
      key(index: number) {
        return Array.from(store.keys())[index] ?? null;
      },
      removeItem(key: string) {
        store.delete(key);
      },
      setItem(key: string, value: string) {
        store.set(key, value);
      },
    };
    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('restores a selection for the same revision and drops it after a new turn', () => {
    writeComposerProviderSelection('session-1', {
      modelId: review,
      reasoningConfigId: 'reasoning_effort',
      reasoning: 'low',
      revision: 'turn-1',
    });
    expect(readComposerProviderSelection('session-1', 'turn-1')).toMatchObject({
      modelId: review,
      reasoning: 'low',
    });
    expect(readComposerProviderSelection('session-1', 'turn-2')).toBeNull();
  });
});
