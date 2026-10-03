import type { Meta, StoryObj } from '@storybook/react';
import {
  ConnectionCheckBadge,
  ConnectionCheckLine,
  type ConnectionCheckState,
} from '@/components/settings/connection-check';

function Both({ state }: { state: ConnectionCheckState }) {
  return (
    <div className="flex w-[480px] flex-col gap-3">
      <ConnectionCheckLine
        state={state}
        baseUrl="https://api.example.com/v1"
        onRecheck={() => undefined}
      />
      <ConnectionCheckBadge state={state} />
    </div>
  );
}

const meta = {
  title: 'Settings/ConnectionCheck',
  component: Both,
  parameters: { layout: 'centered' },
  args: { state: { phase: 'idle' } },
} satisfies Meta<typeof Both>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NotChecked: Story = {};
export const Checking: Story = { args: { state: { phase: 'checking' } } };
export const KeyWorksWithModels: Story = {
  args: { state: { phase: 'done', result: { ok: true, models: ['a', 'b', 'c'] } } },
};
export const KeyWorks: Story = { args: { state: { phase: 'done', result: { ok: true } } } };
export const KeyRejected: Story = {
  args: { state: { phase: 'done', result: { ok: false, reason: 'key_rejected', status: 401 } } },
};
export const CannotCheckForFree: Story = {
  args: { state: { phase: 'done', result: { ok: false, reason: 'unsupported', status: 404 } } },
};
export const Unreachable: Story = {
  args: { state: { phase: 'done', result: { ok: false, reason: 'unreachable' } } },
};
