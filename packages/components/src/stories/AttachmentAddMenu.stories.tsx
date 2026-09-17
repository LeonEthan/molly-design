import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import type { McpServerId, WorkspaceMcpServerMeta } from '@molly/shared';
import { AttachmentAddMenu } from '@/components/chat/attachment-add-menu';

const meta = {
  title: 'Chat/AttachmentAddMenu',
  component: AttachmentAddMenu,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AttachmentAddMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

const mcpServers: WorkspaceMcpServerMeta[] = [
  {
    id: 'files' as McpServerId,
    name: 'Workspace files',
    transport: 'stdio',
    connection: {
      transport: 'stdio',
      command: '/usr/local/bin/mcp-files',
      args: ['--root', '${PROJECT_ROOT}'],
    },
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'search' as McpServerId,
    name: 'Search',
    description: 'Company-wide document search.',
    transport: 'http',
    connection: { transport: 'http', url: 'https://mcp.example.com/mcp' },
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'issues' as McpServerId,
    name: 'Issue tracker',
    transport: 'stdio',
    createdAt: 1,
    updatedAt: 1,
  },
];

/* Live selection so the multi-select second level actually toggles. */
function WithMcp(args: React.ComponentProps<typeof AttachmentAddMenu>) {
  const [selectedIds, setSelectedIds] = useState<McpServerId[]>([mcpServers[0].id]);
  return (
    <AttachmentAddMenu
      {...args}
      mcp={{ ...args.mcp!, selectedIds, onSelectedIdsChange: setSelectedIds }}
    />
  );
}

// Frame that mimics the bottom-left position of the composer footer so the
// menu opens against a realistic anchor.
const Frame = ({ children, dark }: { children: React.ReactNode; dark?: boolean }) => (
  <div className={dark ? 'dark' : ''}>
    <div className="flex min-h-[420px] items-end bg-background p-4">
      <div className="flex w-full items-center gap-2 rounded-xl border border-input-border bg-input/40 p-2">
        {children}
        <span className="text-sm text-muted-foreground">Message…</span>
      </div>
    </div>
  </div>
);

export const DesktopLight: Story = {
  args: { isMobile: false, onAddAttachment: noop },
  render: (args) => (
    <Frame>
      <AttachmentAddMenu {...args} />
    </Frame>
  ),
};

export const DesktopDark: Story = {
  args: { isMobile: false, onAddAttachment: noop },
  render: (args) => (
    <Frame dark>
      <AttachmentAddMenu {...args} />
    </Frame>
  ),
};

export const Disabled: Story = {
  args: { isMobile: false, disabled: true, onAddAttachment: noop },
  render: (args) => (
    <Frame>
      <AttachmentAddMenu {...args} />
    </Frame>
  ),
};

export const DesktopWithMcp: Story = {
  args: {
    isMobile: false,
    onAddAttachment: noop,
    mcp: { servers: mcpServers, selectedIds: [], onSelectedIdsChange: noop },
  },
  render: (args) => (
    <Frame>
      <WithMcp {...args} />
    </Frame>
  ),
};

export const McpOnly: Story = {
  args: {
    isMobile: false,
    mcp: { servers: mcpServers, selectedIds: [], onSelectedIdsChange: noop },
  },
  render: (args) => (
    <Frame>
      <WithMcp {...args} />
    </Frame>
  ),
};
