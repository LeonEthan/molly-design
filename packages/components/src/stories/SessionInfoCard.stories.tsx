import type { Meta, StoryObj } from '@storybook/react';

import {
  SessionInfoCard,
  SessionInfoHoverCard,
  type SessionInfoCardProps,
} from '@/components/session-info-hover-card';

const now = new Date('2026-07-13T21:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const hoursAgo = (h: number) => minutesAgo(h * 60);
const daysAgo = (d: number) => hoursAgo(d * 24);

const meta = {
  title: 'Sessions/SessionInfoCard',
  component: SessionInfoCard,
  parameters: { layout: 'centered' },
  args: {
    title: 'Fix data persistence race',
    latestMessageAt: hoursAgo(2),
    now,
  },
} satisfies Meta<typeof SessionInfoCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const githubArgs = {
  kind: 'github',
  isWorktree: true,
  repoFullName: 'loro-dev/lody',
  machineName: 'Studio Mac',
  branchName: 'feat/persistence-race',
  addedLines: 312,
  deletedLines: 47,
} satisfies Partial<SessionInfoCardProps>;

export const HistoricalGithubWorktree: Story = {
  args: { ...githubArgs },
};

export const LocalWorktree: Story = {
  args: {
    kind: 'local',
    title: 'Refactor persistence layer',
    isWorktree: true,
    folderName: 'lody',
    machineName: 'Studio Mac',
    branchName: 'feat/persistence-refactor',
    latestMessageAt: hoursAgo(5),
  },
};

export const LocalPlain: Story = {
  args: {
    kind: 'local',
    title: 'Tidy up logging output',
    isWorktree: false,
    folderName: 'loro',
    machineName: 'MacBook Pro',
    branchName: 'main',
    latestMessageAt: daysAgo(1),
  },
};

export const ChatMinimal: Story = {
  args: {
    kind: 'chat',
    title: 'Brainstorm onboarding copy',
    latestMessageAt: minutesAgo(30),
  },
};

export const LongBranchName: Story = {
  args: {
    ...githubArgs,
    branchName: 'feature/extremely-long-branch-name-that-should-truncate-inside-the-card',
  },
};

/**
 * Interactive: hover the row to open the card, then move the cursor into the card —
 * it stays open (hoverable), and the branch is copyable / the PR is clickable.
 */
export const HoverInteraction: Story = {
  render: (args) => (
    <div className="w-64 rounded-lg border border-border p-2">
      <SessionInfoHoverCard {...args} {...githubArgs}>
        <div
          role="button"
          tabIndex={0}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-hover"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
          <span className="min-w-0 flex-1 truncate">{args.title}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-code-added">+312</span>
        </div>
      </SessionInfoHoverCard>
    </div>
  ),
};
