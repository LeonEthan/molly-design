import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { ModelChecklist, type CatalogModel } from '@/components/settings/model-checklist';

const models: CatalogModel[] = [
  ['claude-opus-5-5', 'Claude Opus 5.5', 1_000_000],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5', 1_000_000],
  ['claude-haiku-4-5', 'Claude Haiku 4.5', 200_000],
  ['claude-opus-4-8', 'Claude Opus 4.8', 200_000],
  ['claude-sonnet-4-6', 'Claude Sonnet 4.6', 200_000],
].map(([modelId, name, contextWindow]) => ({
  providerPresetId: 'anthropic',
  modelId: modelId as string,
  name: name as string,
  input: ['text', 'image'],
  contextWindow: contextWindow as number,
  thinking: ['off', 'high'],
}));

function Interactive({
  initial,
  listed,
  disabled,
}: {
  initial: string[];
  listed?: string[];
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState(initial);
  return (
    <div className="w-[520px]">
      <ModelChecklist
        models={models}
        selected={selected}
        listed={listed ? new Set(listed) : undefined}
        disabled={disabled}
        onChange={setSelected}
      />
    </div>
  );
}

const meta = {
  title: 'Settings/ModelChecklist',
  component: Interactive,
  parameters: { layout: 'centered' },
  args: { initial: ['claude-opus-5-5', 'claude-sonnet-5-5'] },
} satisfies Meta<typeof Interactive>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Chosen: Story = {};
export const ListedForThisKey: Story = {
  args: { listed: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'] },
};
export const NothingChosen: Story = { args: { initial: [] } };
export const Disabled: Story = { args: { disabled: true } };
