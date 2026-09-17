import type { Meta, StoryObj } from '@storybook/react';
import { DesignFileReceipt } from '@/components/sessions/design-file-receipt';
const meta = { title: 'Sessions/Design file receipt', component: DesignFileReceipt } satisfies Meta<
  typeof DesignFileReceipt
>;
export default meta;
type Story = StoryObj<typeof meta>;
const base = {
  version: 1,
  artworkId: 'aacdd4fb-a160-4c25-9c15-02297145a521',
  turnId: 'synthetic-turn',
  timestamp: '2026-09-11T00:00:00.000Z',
};
export const Saved: Story = {
  args: { outcome: { ...base, status: 'committed', revisionId: 'a'.repeat(64) } },
};
export const Invalid: Story = {
  args: {
    outcome: {
      ...base,
      status: 'invalid',
      diagnostics: [{ code: 'MOLLY-E001', message: 'Canvas width must be positive.' }],
    },
  },
};
export const OriginalFile: Story = {
  args: { outcome: { ...base, status: 'candidate', candidateId: 'b'.repeat(64) } },
};
