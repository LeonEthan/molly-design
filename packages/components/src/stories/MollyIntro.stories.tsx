import type { Meta, StoryObj } from '@storybook/react';
import { IntroSequence } from '@/components/onboarding/ceremony/intro-sequence';

const meta = {
  title: 'Onboarding/Molly opening',
  component: IntroSequence,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', minHeight: 600 }}>
        <Story />
      </div>
    ),
  ],
  args: { playing: false, onStart: () => {} },
} satisfies Meta<typeof IntroSequence>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Still: Story = {};
export const Sequence: Story = { args: { playing: true } };
