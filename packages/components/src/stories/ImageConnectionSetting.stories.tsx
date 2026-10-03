import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import type {
  ConnectionCheckResult,
  ProtectedImageConnection,
} from '@molly/shared/embedded-harness';
import {
  ImageConnectionForm,
  type ImageConnectionFormDraft,
} from '@/components/settings/image-connection-setting';

/* The stored row is a machine credential, so the form is exercised the way the
   settings panel renders it: the key is present in the stored value and never in
   the field. `StoredKey` is the story that pins that property — its stored row
   carries a key and the API-key input must still render empty. */

const storedConnection = (
  overrides: Partial<ProtectedImageConnection> = {}
): ProtectedImageConnection => ({
  id: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  enabled: true,
  baseUrl: 'https://api.openai.com/v1',
  hasApiKey: true,
  model: 'gpt-image-2',
  legacyHistoryMayContainKey: false,
  ...overrides,
});

type StoryProps = {
  stored?: ProtectedImageConnection;
  saving?: boolean;
  saveError?: string;
  /** What the free model-list check answers; omitted means no check runs. */
  checkResult?: ConnectionCheckResult;
};

function StoryWrapper({ stored, saving = false, saveError, checkResult }: StoryProps) {
  const [lastSaved, setLastSaved] = useState<ImageConnectionFormDraft | null>(null);
  return (
    <div className="w-[560px]">
      <ImageConnectionForm
        stored={stored}
        saving={saving}
        saveError={saveError}
        onSave={(draft) => setLastSaved(draft)}
        onCancel={() => undefined}
        onCheck={checkResult ? async () => checkResult : undefined}
        onClearApiKey={async () => undefined}
      />
      {lastSaved ? (
        <p className="mt-3 font-mono text-[10px] text-muted-foreground">
          saved draft: {JSON.stringify({ ...lastSaved, apiKey: '<redacted>' })}
        </p>
      ) : null}
    </div>
  );
}

const meta = {
  title: 'Settings/ImageConnectionForm',
  component: StoryWrapper,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof StoryWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing stored yet: the create form, with the default model prefilled. */
export const Empty: Story = {
  args: {},
};

/** A complete, enabled connection. The key is stored and the field stays empty. */
export const StoredKey: Story = {
  args: { stored: storedConnection() },
};

/** Enabled but missing its key: saved, and honestly reported as not ready. */
export const MissingKey: Story = {
  args: { stored: storedConnection({ hasApiKey: false }) },
};

/** Switched off: the row survives, the design tool does not. */
export const Disabled: Story = {
  args: { stored: storedConnection({ enabled: false }) },
};

/** The free check answered with the service's models, offered as suggestions. */
export const CheckListedModels: Story = {
  args: {
    stored: storedConnection({ model: '' }),
    checkResult: {
      ok: true,
      models: ['gpt-image-2', 'gpt-image-1', 'dall-e-3', 'gpt-4.1', 'gpt-4.1-mini'],
    },
  },
};

/** The upstream refused the credential. */
export const CheckRejected: Story = {
  args: {
    stored: storedConnection(),
    checkResult: { ok: false, reason: 'key_rejected', status: 401 },
  },
};

/** DashScope has no free check, so the form says so instead of probing. */
export const DashScope: Story = {
  args: {
    stored: storedConnection({
      protocol: 'dashscope',
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      model: 'qwen-image-2.0',
    }),
  },
};

/** Mid-save: the only state where the controls lock. */
export const Saving: Story = {
  args: { stored: storedConnection(), saving: true },
};

/** A save the local writer refused; the form keeps the user's input. */
export const SaveFailed: Story = {
  args: {
    stored: storedConnection(),
    saveError: 'local machine RPC is not available',
  },
};
