import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { ProvidersScreenView } from '@/components/onboarding';

const meta = {
  title: 'Onboarding/ProvidersScreen',
  component: ProvidersScreenView,
  parameters: { layout: 'fullscreen' },
  args: {
    languageReady: false,
    imageReady: false,
    modelReady: false,
    mollyAvailable: false,
    onBack: fn(),
    onSkip: fn(),
    onNext: fn(),
  },
} satisfies Meta<typeof ProvidersScreenView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const LanguageOnly: Story = { args: { languageReady: true, mollyAvailable: true } };
export const MollyUnavailable: Story = {
  args: { languageReady: true, imageReady: true, modelReady: true },
};
export const Ready: Story = {
  args: { languageReady: true, imageReady: true, modelReady: true, mollyAvailable: true },
};
