import type { Meta, StoryObj } from '@storybook/react';
import { IntroPage, IntroSequence } from '@/components/onboarding/ceremony/intro-sequence';
import { useTranslation } from 'react-i18next';
import { VolumeX } from '@/ui/icons';

function PreviewSoundControl() {
  const { t } = useTranslation();
  return (
    <button type="button" className="molly-intro-sound" aria-label={t('onboarding.audio.enable')}>
      <VolumeX className="size-4" />
    </button>
  );
}

const meta = {
  title: 'Onboarding/Molly opening',
  component: IntroPage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', minHeight: 600 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    scene: 'inspiration',
    onStart: () => {},
    onSelect: () => {},
    soundControl: <PreviewSoundControl />,
  },
  globals: { locale: 'en', theme: 'light' },
} satisfies Meta<typeof IntroPage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Inspiration: Story = {};
export const Creation: Story = { args: { scene: 'creation' } };
export const Expression: Story = { args: { scene: 'expression' } };
export const ChineseInspiration: Story = { globals: { locale: 'zh_CN' } };
export const ChineseCreation: Story = {
  args: { scene: 'creation' },
  globals: { locale: 'zh_CN' },
};
export const ChineseExpression: Story = {
  args: { scene: 'expression' },
  globals: { locale: 'zh_CN' },
};
export const Sequence: Story = {
  render: (args) => <IntroSequence onStart={args.onStart} soundControl={args.soundControl} />,
};
