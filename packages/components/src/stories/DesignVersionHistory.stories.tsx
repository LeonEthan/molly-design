import type { Meta, StoryObj } from '@storybook/react';
import { DesignVersionHistoryFeedback } from '@/components/sessions/design-version-history-feedback';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/ui/dropdown-menu';

const meta = {
  title: 'Design/VersionHistoryFeedback',
  component: DesignVersionHistoryFeedback,
  decorators: [
    (Story) => (
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger>Version history</DropdownMenuTrigger>
        <DropdownMenuContent className="w-80 max-w-[calc(100vw-32px)]">
          <Story />
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  ],
  args: { load: { phase: 'ready' }, empty: true, onRetry: () => undefined },
} satisfies Meta<typeof DesignVersionHistoryFeedback>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const Loading: Story = { args: { load: { phase: 'loading' } } };
export const Failed: Story = {
  args: { load: { phase: 'error', message: 'The background service is unavailable.' } },
};
