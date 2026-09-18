import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Cable, Globe } from 'lucide-react';
import { SegmentedControl } from '@/components/shared/segmented-control';

const meta = {
  title: 'Shared/SegmentedControl',
  component: SegmentedControl,
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

function AllSizes() {
  const [transport, setTransport] = useState('streamable-http');
  const [behavior, setBehavior] = useState('queue');
  return (
    <div className="grid gap-6 text-foreground">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">md — with icons</h3>
        <SegmentedControl
          ariaLabel="Transport"
          value={transport}
          onChange={setTransport}
          options={[
            { value: 'stdio', label: 'STDIO', icon: <Cable className="h-3.5 w-3.5" /> },
            { value: 'streamable-http', label: 'HTTP', icon: <Globe className="h-3.5 w-3.5" /> },
          ]}
        />
      </div>
      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">sm — text only</h3>
        <SegmentedControl
          ariaLabel="Queued message behavior"
          size="sm"
          value={behavior}
          onChange={setBehavior}
          options={[
            { value: 'queue', label: 'Queue' },
            { value: 'guide', label: 'Steer' },
          ]}
        />
      </div>
    </div>
  );
}

export const Sizes: Story = {
  // Props are exercised by the interactive preview below; args satisfies the
  // required-prop story type.
  args: { value: 'queue', onChange: () => {}, options: [], ariaLabel: 'Preview' },
  render: () => <AllSizes />,
};
