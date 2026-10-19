import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { createLocalPlatformProvider, createStaticStore } from '@molly/platform';
import { PlatformContext } from '@molly/platform/react';
import { ProvidersScreenView } from '@/components/onboarding';

const localPlatform = createLocalPlatformProvider({
  session: createStaticStore({
    status: 'authenticated',
    user: { id: 'user-storybook-onboarding', name: 'Storybook user' },
  }),
  workspaces: createStaticStore({
    status: 'ready',
    workspaces: [
      { id: 'workspace-storybook', name: 'Storybook Workspace', slug: null, role: 'owner' },
    ],
    activeWorkspaceId: 'workspace-storybook',
  }),
});

function ProviderSkipJourney() {
  const [complete, setComplete] = useState(false);
  if (complete) return <div data-testid="onboarding-complete">Onboarding complete</div>;
  return (
    <ProvidersScreenView
      languageReady={false}
      imageReady={false}
      modelReady={false}
      mollyAvailable={false}
      onBack={fn()}
      onSkip={() => setComplete(true)}
      onNext={fn()}
    />
  );
}

function ProviderNextJourney() {
  const [complete, setComplete] = useState(false);
  if (complete) return <div data-testid="onboarding-complete">Onboarding complete</div>;
  return (
    <ProvidersScreenView
      languageReady
      imageReady
      modelReady
      mollyAvailable
      onBack={fn()}
      onSkip={fn()}
      onNext={() => setComplete(true)}
      browserPanel={(close) => (
        <button type="button" onClick={close}>
          Browser import
        </button>
      )}
    />
  );
}

const meta = {
  title: 'Onboarding/CompletionJourney',
  component: ProviderSkipJourney,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <PlatformContext.Provider value={localPlatform}>
        <Story />
      </PlatformContext.Provider>
    ),
  ],
} satisfies Meta<typeof ProviderSkipJourney>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ProviderSkip: Story = {};
export const ProviderNext: Story = { render: () => <ProviderNextJourney /> };
