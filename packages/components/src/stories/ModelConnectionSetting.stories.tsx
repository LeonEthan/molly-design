import type { Meta, StoryObj } from '@storybook/react';
import type { HarnessModelCatalog } from '@molly/shared/embedded-harness';
import { ModelConnectionForm } from '@/components/settings/model-connection-setting';

const catalog: HarnessModelCatalog['models'] = [
  ['gpt-5.5', 'GPT-5.5', true, 400_000, true],
  ['gpt-5.5-mini', 'GPT-5.5 mini', true, 400_000, true],
  ['gpt-5.5-nano', 'GPT-5.5 nano', false, 400_000, false],
  ['gpt-4.1', 'GPT-4.1', true, 1_047_576, false],
  ['o4-mini', 'o4-mini', true, 200_000, true],
].map(([modelId, name, image, contextWindow, thinks]) => ({
  providerPresetId: 'openai' as const,
  modelId: modelId as string,
  name: name as string,
  input: image ? ['text' as const, 'image' as const] : ['text' as const],
  contextWindow: contextWindow as number,
  thinking: thinks ? ['off' as const, 'low' as const, 'high' as const] : ['off' as const],
}));

const meta = {
  title: 'Settings/ModelConnectionForm',
  component: ModelConnectionForm,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[min(560px,calc(100vw-32px))] rounded-2xl border border-border/40 bg-card">
        <Story />
      </div>
    ),
  ],
  args: { onSave: async () => undefined, onCancel: () => undefined },
} satisfies Meta<typeof ModelConnectionForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const StoredSecret: Story = {
  args: {
    stored: {
      schemaVersion: 1,
      id: '00000000-0000-4000-8000-000000000001',
      revision: 1,
      providerPresetId: 'openai',
      displayName: 'Synthetic connection',
      baseUrl: 'https://example.invalid/v1',
      credentialRef: 'opaque-reference-not-a-secret',
      enabled: true,
    },
  },
};
export const Disabled: Story = {
  args: { stored: { ...StoredSecret.args!.stored!, enabled: false } },
};
export const Saving: Story = { args: { ...StoredSecret.args, busy: true } };
export const KimiCode: Story = {
  args: {
    stored: {
      ...StoredSecret.args!.stored!,
      providerPresetId: 'kimi-coding',
      baseUrl: 'https://api.kimi.com/coding/',
    },
  },
};
export const KimiCodeMisconfigured: Story = {
  args: {
    stored: {
      ...StoredSecret.args!.stored!,
      providerPresetId: 'moonshot',
      baseUrl: 'https://api.kimi.com/coding/',
    },
  },
};
export const Compatible: Story = {
  args: {
    stored: {
      ...StoredSecret.args!.stored!,
      providerPresetId: 'openai-compatible',
      customModels: [
        {
          modelId: 'vendor/custom',
          name: 'Custom model',
          input: ['text', 'image'],
          contextWindow: 32768,
          maxTokens: 4096,
          thinking: ['off', 'high'],
          toolCalls: true,
          maxTokensField: 'max_tokens',
        },
      ],
    },
  },
};
export const CompatibleMissingModels: Story = {
  args: { stored: { ...Compatible.args!.stored!, customModels: undefined } },
};
export const CompatibleSaving: Story = { args: { ...Compatible.args, busy: true } };
export const ProviderDefaultEndpoint: Story = {
  args: {
    stored: {
      ...StoredSecret.args!.stored!,
      providerPresetId: 'deepseek',
      displayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
    },
  },
};
export const ProviderShortcut: Story = {
  args: { initialProvider: 'deepseek' },
};
export const KeyWorksAllModels: Story = {
  args: {
    ...StoredSecret.args,
    catalog,
    onCheck: async () => ({ ok: true, models: ['gpt-5.5', 'gpt-5.5-mini', 'gpt-4.1'] }),
  },
};
export const ChosenModels: Story = {
  args: {
    stored: { ...StoredSecret.args!.stored!, models: ['gpt-5.5', 'o4-mini'] },
    catalog,
    onCheck: async () => ({ ok: true, models: ['gpt-5.5', 'gpt-5.5-mini', 'gpt-4.1'] }),
    onDelete: () => undefined,
  },
};
export const KeyRejected: Story = {
  args: {
    ...StoredSecret.args,
    catalog,
    onCheck: async () => ({ ok: false, reason: 'key_rejected', status: 401 }),
  },
};
export const CannotCheckForFree: Story = {
  args: {
    ...KimiCode.args,
    onCheck: async () => ({ ok: false, reason: 'unsupported', status: 404 }),
  },
};
