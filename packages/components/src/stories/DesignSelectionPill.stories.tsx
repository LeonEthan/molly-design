import type { Meta, StoryObj } from '@storybook/react';
import type { DesignSelectionSummary } from '@molly/shared/design-selection-commands';
import { useEffect } from 'react';
import { createSelectionToolbar } from '../../../design-bento/src/selection-toolbar';
function NativeToolbar({
  selection,
  busy = false,
}: {
  selection: DesignSelectionSummary;
  busy?: boolean;
}) {
  useEffect(() => {
    const toolbar = createSelectionToolbar({
      request: () => (busy ? new Promise(() => {}) : Promise.resolve({ ok: true })),
    });
    toolbar.present({
      dark: document.documentElement.classList.contains('dark'),
      actionsEnabled: true,
      labels: {},
    });
    toolbar.setReadonly(false);
    toolbar.update(selection, ['story-selection'], 1);
    return () => toolbar.dispose();
  }, [selection, busy]);
  return (
    <div className="ed-stage-scale">
      <div
        data-el-id="story-selection"
        style={{
          position: 'absolute',
          left: 120,
          top: 160,
          width: 550,
          height: 200,
          border: '1px solid #6195ed',
          padding: 24,
        }}
      >
        Selected artwork
      </div>
    </div>
  );
}

const textSelection: DesignSelectionSummary = {
  count: 1,
  kinds: ['text'],
  fonts: ['Inter', 'Noto Sans SC'],
  elements: [
    {
      id: 'el-1',
      kind: 'text',
      width: 320,
      height: 80,
      color: '#000000',
      fontFamily: 'Inter',
      fontSize: 48,
      bold: false,
      italic: false,
      alignH: 'left',
    },
  ],
};
const shapeSelection: DesignSelectionSummary = {
  count: 1,
  kinds: ['shape'],
  elements: [
    {
      id: 'el-2',
      kind: 'shape',
      width: 240,
      height: 160,
      fill: '#f97316',
      borderColor: '#000000',
      borderWidth: 2,
    },
  ],
};
const imageSelection: DesignSelectionSummary = {
  count: 1,
  kinds: ['image'],
  elements: [{ id: 'el-3', kind: 'image', width: 512, height: 512, fit: 'cover' }],
};
const mixedSelection: DesignSelectionSummary = { count: 3, kinds: ['text', 'shape'] };

const meta = {
  title: 'Sessions/Native selection toolbar',
  component: NativeToolbar,
  args: { busy: false },
  decorators: [
    (Story) => (
      <div className="flex h-12 items-center justify-center bg-[#f5f7fa] dark:bg-[#1b1f26]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NativeToolbar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Text: Story = { args: { selection: textSelection } };
export const Shape: Story = { args: { selection: shapeSelection } };
export const Image: Story = { args: { selection: imageSelection } };
export const Mixed: Story = { args: { selection: mixedSelection } };
export const Busy: Story = { args: { selection: textSelection, busy: true } };
