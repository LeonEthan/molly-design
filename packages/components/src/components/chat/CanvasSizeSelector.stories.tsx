import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CanvasSizeSelector } from './canvas-size-selector';

const meta = {
  title: 'Chat/Canvas size',
  component: CanvasSizeSelector,
  args: { mode: 'auto', width: 800, height: 600, disabled: false, onChange: () => {} },
  render: function CanvasSizeStory(args) {
    const [size, setSize] = useState({ mode: args.mode, width: args.width, height: args.height });
    return <CanvasSizeSelector {...args} {...size} onChange={setSize} />;
  },
} satisfies Meta<typeof CanvasSizeSelector>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
