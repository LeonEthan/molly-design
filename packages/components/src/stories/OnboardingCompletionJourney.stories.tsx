import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { ProvidersScreenView } from '@/components/onboarding';

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
    />
  );
}

const meta = {
  title: 'Onboarding/CompletionJourney',
  component: ProviderSkipJourney,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ProviderSkipJourney>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ProviderSkip: Story = {};
export const ProviderNext: Story = { render: () => <ProviderNextJourney /> };
