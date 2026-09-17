import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import {
  OnboardingBackdrop,
  ProjectsScreenView,
  type ProjectsScreenLocalEntry,
} from '@/components/onboarding';

function ProjectsPreviewWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-[760px] w-full">
      <OnboardingBackdrop />
      <div className="relative z-10 flex min-h-[760px] items-center justify-center p-8">
        {children}
      </div>
    </div>
  );
}

const localProjects: ProjectsScreenLocalEntry[] = [
  {
    key: 'm1:lody',
    machineId: 'm1' as never,
    localProjectId: 'lody' as never,
    name: 'lody',
    detail: '/Users/dev/code/lody',
  },
  {
    key: 'm1:notes',
    machineId: 'm1' as never,
    localProjectId: 'notes' as never,
    name: 'notes',
    detail: '/Users/dev/work/notes',
  },
];

const manyLocalProjects: ProjectsScreenLocalEntry[] = Array.from({ length: 5 }, (_, i) => ({
  key: `m1:proj-${i}`,
  machineId: 'm1' as never,
  localProjectId: `proj-${i}` as never,
  name: `project-${i}`,
  detail: `/Users/dev/code/project-${i}`,
}));

const meta = {
  title: 'Onboarding/ProjectsScreen',
  component: ProjectsScreenView,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  args: {
    loadingRepos: false,
    onAddLocal: fn(),
    onConnectGitHub: fn(),
    onBack: fn(),
    onSkip: fn(),
    onComplete: fn(),
  },
  decorators: [
    (Story) => (
      <ProjectsPreviewWrapper>
        <Story />
      </ProjectsPreviewWrapper>
    ),
  ],
} satisfies Meta<typeof ProjectsScreenView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyDesktop: Story = {
  args: {
    local: [],
    github: [],
    importing: false,
    connectingGitHub: false,
    canImportLocal: true,
    canConnectGitHub: false,
  },
};



export const ImportingLocal: Story = {
  args: {
    local: [],
    github: [],
    importing: true,
    connectingGitHub: false,
    canImportLocal: true,
    canConnectGitHub: false,
  },
};



export const WithLocalProjects: Story = {
  args: {
    local: localProjects,
    github: [],
    importing: false,
    connectingGitHub: false,
    canImportLocal: true,
    canConnectGitHub: false,
  },
};





export const ScrollsWhenLong: Story = {
  args: {
    local: manyLocalProjects,
    github: [],
    importing: false,
    connectingGitHub: false,
    canImportLocal: true,
    canConnectGitHub: false,
  },
};

export const WorkspaceNotReady: Story = {
  args: {
    local: [],
    github: [],
    importing: false,
    connectingGitHub: false,
    canImportLocal: true,
    canConnectGitHub: false,
  },
};
