import type { Meta, StoryObj } from '@storybook/react';
import { ModelConnectionForm } from '@/components/settings/model-connection-setting';

const meta = {
  title: 'Settings/ModelConnectionForm',
  component: ModelConnectionForm,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[420px]">
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
          usageInStreaming: true,
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
