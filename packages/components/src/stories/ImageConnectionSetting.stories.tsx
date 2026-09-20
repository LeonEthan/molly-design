import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import type { ProtectedImageConnection } from '@molly/shared/embedded-harness';
import {
  ImageConnectionForm,
  type ImageConnectionFormDraft,
  type ImageConnectionTestState,
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
  testState?: ImageConnectionTestState;
};

function StoryWrapper({
  stored,
  saving = false,
  saveError,
  testState = { phase: 'idle' },
}: StoryProps) {
  const [lastSaved, setLastSaved] = useState<ImageConnectionFormDraft | null>(null);
  return (
    <div className="w-[560px]">
      <ImageConnectionForm
        stored={stored}
        saving={saving}
        saveError={saveError}
        testState={testState}
        onSave={(draft) => setLastSaved(draft)}
        onTest={async () => undefined}
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

/** The non-billable probe answered. */
export const TestSucceeded: Story = {
  args: {
    stored: storedConnection(),
    testState: { phase: 'ok', modelCount: 12 },
  },
};

/** The upstream refused the credential. */
export const TestFailed: Story = {
  args: {
    stored: storedConnection(),
    testState: { phase: 'error', message: 'HTTP 401: invalid API key provided' },
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
