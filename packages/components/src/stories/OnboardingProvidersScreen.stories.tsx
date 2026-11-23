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
import { ModelConnectionForm } from '@/components/settings/model-connection-setting';
import { ImageConnectionForm } from '@/components/settings/image-connection-setting';

const meta = {
  title: 'Onboarding/ProvidersScreen',
  component: ProvidersScreenView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <PlatformContext.Provider value={localPlatform}>
        <Story />
      </PlatformContext.Provider>
    ),
  ],
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
  args: {
    languageReady: true,
    imageReady: true,
    modelReady: true,
    mollyAvailable: true,
    languageSummary: 'DeepSeek · deepseek-chat',
    imageSummary: 'OpenAI Images · gpt-image-1',
  },
};
export const WithPanels: Story = {
  args: {
    languagePanel: (done) => (
      <ModelConnectionForm surface="onboarding" onSave={async () => done('saved')} />
    ),
    imagePanel: (done) => (
      <ImageConnectionForm
        surface="onboarding"
        stored={undefined}
        onSave={() => done('saved')}
        onCancel={() => done('cancelled')}
        onClearApiKey={async () => undefined}
      />
    ),
  },
};
