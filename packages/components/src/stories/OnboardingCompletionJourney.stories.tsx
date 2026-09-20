import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { ProvidersScreenView, SummaryScreen } from '@/components/onboarding';

function ProviderSkipJourney() {
  const [step, setStep] = useState<'providers' | 'summary' | 'complete'>('providers');
  if (step === 'complete') return <div data-testid="onboarding-complete">Onboarding complete</div>;
  if (step === 'summary')
    return (
      <SummaryScreen
        agentState="missing"
        onBack={() => setStep('providers')}
        onComplete={() => setStep('complete')}
      />
    );
  return (
    <ProvidersScreenView
      configs={[]}
      localMachineId={null}
      onBack={fn()}
      onSkip={() => setStep('summary')}
      onNext={fn()}
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
export const RetiredSetup: Story = {
  render: () => (
    <SummaryScreen
      agentState="retired"
      agentName="Previous Codex setup"
      onBack={fn()}
      onComplete={fn()}
    />
  ),
};
