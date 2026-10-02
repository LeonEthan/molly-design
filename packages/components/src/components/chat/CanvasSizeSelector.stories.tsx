import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CanvasFormatTiles, CanvasSizeSelector } from './canvas-size-selector';

const meta = {
  title: 'Chat/Canvas size',
  component: CanvasSizeSelector,
  args: { mode: 'auto', width: 800, height: 600, disabled: false, onChange: () => {} },
  render: function CanvasSizeStory(args) {
    const [size, setSize] = useState({ mode: args.mode, width: args.width, height: args.height });
    return (
      <div className="min-h-[520px] p-8">
        <CanvasSizeSelector {...args} {...size} onChange={setSize} />
      </div>
    );
  },
} satisfies Meta<typeof CanvasSizeSelector>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const PresetSelected: Story = { args: { mode: 'custom', width: 1080, height: 1350 } };
export const CustomSelected: Story = { args: { mode: 'custom', width: 1200, height: 628 } };
export const Disabled: Story = { args: { disabled: true } };
export const PresetsOpen: Story = {
  play: async ({ canvasElement }) => {
    canvasElement.querySelector('button')?.click();
  },
};
export const WithFormatTiles: Story = {
  args: { mode: 'custom', width: 1080, height: 1350 },
  render: function FormatTilesStory(args) {
    const [size, setSize] = useState({ mode: args.mode, width: args.width, height: args.height });
    return (
      <div className="flex min-h-[520px] flex-col items-center gap-8 p-8">
        <CanvasFormatTiles disabled={args.disabled} {...size} onChange={setSize} />
        <CanvasSizeSelector disabled={args.disabled} {...size} onChange={setSize} />
      </div>
    );
  },
};
