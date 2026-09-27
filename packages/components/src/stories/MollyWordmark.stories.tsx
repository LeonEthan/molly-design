import type { Meta, StoryObj } from '@storybook/react';
import { MollyWordmark } from '@/components/molly-wordmark';

const SIZES = ['text-[13px]', 'text-[15px]', 'text-[22px]', 'text-5xl'] as const;

function WordmarkScale() {
  return (
    <div className="flex flex-col items-start gap-6 bg-background p-8 text-foreground">
      {SIZES.map((size) => (
        <MollyWordmark key={size} className={size} />
      ))}
      <MollyWordmark className="text-[13px] text-muted-foreground" />
    </div>
  );
}

const meta = {
  title: 'Brand/Molly wordmark',
  component: WordmarkScale,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof WordmarkScale>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Light: Story = { globals: { theme: 'light' } };
export const Dark: Story = { globals: { theme: 'dark' } };
