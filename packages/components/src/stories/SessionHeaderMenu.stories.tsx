import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import type { SessionMeta } from '@molly/shared';

import { SessionHeaderMenu } from '@/components/sessions/session-chat-interface';

const githubWorktreeSession = {
  id: 'session-header-menu-story',
  machineId: 'machine-header-menu-story',
  userId: 'user-story',
  cliType: 'builtin',
  agentType: 'codex',
  createdAt: '2026-07-13T00:00:00.000Z',
  project: {
    kind: 'github',
    repoFullName: 'zxch3n/test-readme',
    branch: 'main',
  },
  repoFullName: 'zxch3n/test-readme',
  baseBranch: 'main',
  branchName: 'docs/append-line-to-readmemd',
  isWorktree: true,
} as SessionMeta;

const meta = {
  title: 'Sessions/SessionHeaderMenu',
  component: SessionHeaderMenu,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-dvh min-w-[32rem] items-start justify-center bg-background pt-24 text-foreground">
        <Story />
      </div>
    ),
  ],
  args: {
    session: githubWorktreeSession,
    workspacePath: '/Users/developer/Code/test-readme',
    machineName: 'Rems-MacBook-Pro.local',
    onCopyConversationHistory: fn(),
    onCopyUrl: fn(),
    onOpenSearch: fn(),
    onFork: fn(),
    forkWorktreeAvailability: 'available',
    onRename: fn(),
    onArchive: fn(),
    t: (_key, fallback, options) =>
      Object.entries(options ?? {}).reduce(
        (message, [name, value]) => message.replaceAll(`{{${name}}}`, String(value)),
        fallback
      ),
  },
} satisfies Meta<typeof SessionHeaderMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GitHubWorktree: Story = {
  globals: { theme: 'dark' },
};
