import { describe, expect, it } from 'vitest';

import {
  buildChatLandingPreSelectionKey,
  compareChatLandingLocalProjectByRecency,
  getChatLandingSelectionSearch,
  getChatLandingSelectionSyncDecision,
  getChatLandingHasAnyOnlineMachine,
  getChatLandingHintType,
  getChatLandingInitialDataLoading,
  getChatLandingProjectRecency,
  getChatLandingSelectedMachineProjectStatus,
  getChatLandingSubmitDisabled,
  getChatLandingVisibleComposerStatus,
  getSelectedLocalProjectKey,
  isChatLandingMachineReachable,
  parseChatLandingSearch,
} from '../src/components/chat/chat-landing-derived';

const onlineMachineIds = new Set(['github-runner']);
const isMachineOnline = (machineId: string) => onlineMachineIds.has(machineId);

describe('getChatLandingProjectRecency', () => {
  it('aggregates latest lastMessageAt by local project key while ignoring historical GitHub sessions', () => {
    const recency = getChatLandingProjectRecency([
      {
        machineId: 'machine-1',
        project: { kind: 'github', repoFullName: 'owner/beta' },
        lastMessageAt: 200,
      },
      {
        machineId: 'machine-1',
        project: { kind: 'github', repoFullName: 'owner/beta' },
        lastMessageAt: 250,
      },
      {
        machineId: 'machine-1',
        project: { kind: 'local', localProjectId: 'project-1' },
        lastMessageAt: 100,
      },
      {
        machineId: 'machine-2',
        project: { kind: 'local', localProjectId: 'project-1' },
        lastMessageAt: 300,
      },
      {
        machineId: 'machine-1',
        repoFullName: 'owner/legacy',
        lastMessageAt: 150,
      },
    ]);

    expect(recency.byProject.get('machine-1:project-1')).toBe(100);
    expect(recency.byProject.get('machine-2:project-1')).toBe(300);
  });

  it('ignores missing and non-finite lastMessageAt values', () => {
    const recency = getChatLandingProjectRecency([
      {
        machineId: 'machine-1',
        project: { kind: 'github', repoFullName: 'owner/alpha' },
      },
      {
        machineId: 'machine-1',
        project: { kind: 'local', localProjectId: 'project-1' },
        lastMessageAt: Number.NaN,
      },
    ]);

    expect(recency.byProject.has('machine-1:project-1')).toBe(false);
  });
});

describe('compareChatLandingLocalProjectByRecency', () => {
  const project = (
    key: string,
    name: string,
    meta: { lastOpenedAtMs?: number; createdAtMs?: number } = {}
  ) => ({ key, project: { name, ...meta } });

  it('sorts local projects by newest lastMessageAt and falls back to project name', () => {
    const latest = new Map([
      ['machine-1:project-beta', 200],
      ['machine-1:project-alpha', 300],
    ]);
    const projects = [
      project('machine-1:project-gamma', 'Gamma'),
      project('machine-1:project-beta', 'Beta'),
      project('machine-1:project-alpha', 'Alpha'),
      project('machine-1:project-delta', 'Delta'),
    ];

    expect(
      projects.sort((left, right) => compareChatLandingLocalProjectByRecency(left, right, latest))
    ).toEqual([
      project('machine-1:project-alpha', 'Alpha'),
      project('machine-1:project-beta', 'Beta'),
      project('machine-1:project-delta', 'Delta'),
      project('machine-1:project-gamma', 'Gamma'),
    ]);
  });

  it('falls back to project activity before project name', () => {
    const latest = new Map<string, number>();
    const projects = [
      project('machine-1:project-alpha', 'Alpha', { createdAtMs: 100 }),
      project('machine-1:project-beta', 'Beta', { lastOpenedAtMs: 300, createdAtMs: 50 }),
      project('machine-1:project-gamma', 'Gamma', { createdAtMs: 200 }),
      project('machine-1:project-delta', 'Delta'),
    ];

    expect(
      projects.sort((left, right) => compareChatLandingLocalProjectByRecency(left, right, latest))
    ).toEqual([
      project('machine-1:project-beta', 'Beta', { lastOpenedAtMs: 300, createdAtMs: 50 }),
      project('machine-1:project-gamma', 'Gamma', { createdAtMs: 200 }),
      project('machine-1:project-alpha', 'Alpha', { createdAtMs: 100 }),
      project('machine-1:project-delta', 'Delta'),
    ]);
  });

  it('uses the stable key when names and timestamps are equal', () => {
    const latest = new Map([
      ['machine-2:project-1', 200],
      ['machine-1:project-1', 200],
    ]);
    const projects = [
      project('machine-2:project-1', 'Same'),
      project('machine-1:project-1', 'Same'),
    ];

    expect(
      projects.sort((left, right) => compareChatLandingLocalProjectByRecency(left, right, latest))
    ).toEqual([project('machine-1:project-1', 'Same'), project('machine-2:project-1', 'Same')]);
  });
});

describe('getChatLandingHintType', () => {
  it('prefers no-machine over no-agent-config', () => {
    expect(
      getChatLandingHintType({
        hasNoMachine: true,
        hasNoAgentConfig: true,
        isInitialDataLoading: false,
      })
    ).toBe('no-machine');
  });

  it('returns no-agent-config when machines exist but configs do not', () => {
    expect(
      getChatLandingHintType({
        hasNoMachine: false,
        hasNoAgentConfig: true,
        isInitialDataLoading: false,
      })
    ).toBe('no-agent-config');
  });

  it('returns null when both dependencies are available', () => {
    expect(
      getChatLandingHintType({
        hasNoMachine: false,
        hasNoAgentConfig: false,
        isInitialDataLoading: false,
      })
    ).toBeNull();
  });

  it('suppresses the no-machine hint while initial data is still loading', () => {
    expect(
      getChatLandingHintType({
        hasNoMachine: true,
        hasNoAgentConfig: false,
        isInitialDataLoading: true,
      })
    ).toBeNull();
  });

  it('suppresses the no-agent-config hint while initial data is still loading', () => {
    expect(
      getChatLandingHintType({
        hasNoMachine: false,
        hasNoAgentConfig: true,
        isInitialDataLoading: true,
      })
    ).toBeNull();
  });
});

describe('getChatLandingInitialDataLoading', () => {
  it('waits for local runtime and doc metadata prerequisites', () => {
    expect(
      getChatLandingInitialDataLoading({
        isRuntimeInitializing: true,
        isVisibleMachinesLoading: false,
        isDocMetaCacheReady: true,
        localMachineStateAttempted: true,
        hasSelectableMachine: true,
      })
    ).toBe(true);

    expect(
      getChatLandingInitialDataLoading({
        isRuntimeInitializing: false,
        isVisibleMachinesLoading: false,
        isDocMetaCacheReady: false,
        localMachineStateAttempted: true,
        hasSelectableMachine: true,
      })
    ).toBe(true);

    expect(
      getChatLandingInitialDataLoading({
        isRuntimeInitializing: false,
        isVisibleMachinesLoading: false,
        isDocMetaCacheReady: true,
        localMachineStateAttempted: false,
        hasSelectableMachine: true,
      })
    ).toBe(true);
  });

  it('continues initial loading while machine visibility is pending and no local option exists', () => {
    expect(
      getChatLandingInitialDataLoading({
        isRuntimeInitializing: false,
        isVisibleMachinesLoading: true,
        isDocMetaCacheReady: true,
        localMachineStateAttempted: true,
        hasSelectableMachine: false,
      })
    ).toBe(true);
  });

  it('does not mask locally selectable machines behind a stalled visibility query', () => {
    expect(
      getChatLandingInitialDataLoading({
        isRuntimeInitializing: false,
        isVisibleMachinesLoading: true,
        isDocMetaCacheReady: true,
        localMachineStateAttempted: true,
        hasSelectableMachine: true,
      })
    ).toBe(false);
  });
});

describe('getChatLandingSubmitDisabled', () => {
  it('disables submit when there is nothing to send', () => {
    expect(
      getChatLandingSubmitDisabled({
        submitting: false,
        hasBlockingImages: false,
        hasSendableContent: false,
        contextType: 'github',
        hasSelectedLocalProject: false,
        isRuntimeInitializing: false,
        isLoadingLocalGitState: false,
        hasLocalGitStateError: false,
      })
    ).toBe(true);
  });

  it('disables worktree submit while local git state is still loading', () => {
    expect(
      getChatLandingSubmitDisabled({
        submitting: false,
        hasBlockingImages: false,
        hasSendableContent: true,
        contextType: 'local',
        workdirMode: 'worktree',
        hasSelectedLocalProject: true,
        isRuntimeInitializing: false,
        isLoadingLocalGitState: true,
        hasLocalGitStateError: false,
      })
    ).toBe(true);
  });

  it('keeps direct local submit enabled while git state is loading or unavailable', () => {
    expect(
      getChatLandingSubmitDisabled({
        submitting: false,
        hasBlockingImages: false,
        hasSendableContent: true,
        contextType: 'local',
        workdirMode: 'local',
        hasSelectedLocalProject: true,
        isRuntimeInitializing: false,
        isLoadingLocalGitState: true,
        hasLocalGitStateError: true,
      })
    ).toBe(false);
  });

  it('keeps submit enabled for sendable github prompts', () => {
    expect(
      getChatLandingSubmitDisabled({
        submitting: false,
        hasBlockingImages: false,
        hasSendableContent: true,
        contextType: 'github',
        hasSelectedLocalProject: false,
        isRuntimeInitializing: false,
        isLoadingLocalGitState: false,
        hasLocalGitStateError: false,
      })
    ).toBe(false);
  });
});

describe('getChatLandingSelectedMachineProjectStatus', () => {
  const baseArgs = {
    contextType: 'local' as const,
    selectedMachineId: 'machine-1',
    hasSelectedLocalProject: false,
    hasAnyVisibleLocalProject: true,
    selectedMachineHasVisibleLocalProject: false,
    isVisibleLocalProjectsLoading: false,
    isDocMetaCacheReady: true,
  };

  it('warns when a selected local machine has no visible projects', () => {
    expect(getChatLandingSelectedMachineProjectStatus(baseArgs)).toBe(
      'no-projects-on-selected-machine'
    );
  });

  it('distinguishes an entirely empty local-project workspace', () => {
    expect(
      getChatLandingSelectedMachineProjectStatus({
        ...baseArgs,
        hasAnyVisibleLocalProject: false,
      })
    ).toBe('no-local-projects');
  });

  it('does not warn while local-project visibility is still loading', () => {
    expect(
      getChatLandingSelectedMachineProjectStatus({
        ...baseArgs,
        isVisibleLocalProjectsLoading: true,
      })
    ).toBeNull();
  });

  it('does not warn once a matching project is selected or available', () => {
    expect(
      getChatLandingSelectedMachineProjectStatus({
        ...baseArgs,
        hasSelectedLocalProject: true,
      })
    ).toBeNull();

    expect(
      getChatLandingSelectedMachineProjectStatus({
        ...baseArgs,
        selectedMachineHasVisibleLocalProject: true,
      })
    ).toBeNull();
  });
});

describe('getChatLandingVisibleComposerStatus', () => {
  it('does not surface infrastructure errors in the landing composer', () => {
    expect(
      getChatLandingVisibleComposerStatus({
        contextType: 'chat',
        composerStatus: null,
        localGitStateError: 'Failed to append to stream: connect timeout',
      })
    ).toBeNull();

    expect(
      getChatLandingVisibleComposerStatus({
        contextType: 'local',
        composerStatus: null,
        localGitStateError: 'Failed to append to stream: connect timeout',
      })
    ).toBeNull();
  });

  it('surfaces explicit actionable composer status', () => {
    expect(
      getChatLandingVisibleComposerStatus({
        contextType: 'local',
        composerStatus: { message: 'Ready', tone: 'info' },
        localGitStateError: 'Failed to append to stream: connect timeout',
      })
    ).toEqual({ message: 'Ready', tone: 'info' });
  });

  it('surfaces selected-machine project warnings only in local context', () => {
    const selectedMachineProjectStatus = {
      message: 'No local projects from this machine have been added to the workspace',
      tone: 'warning' as const,
    };

    expect(
      getChatLandingVisibleComposerStatus({
        contextType: 'local',
        composerStatus: null,
        localGitStateError: null,
        selectedMachineProjectStatus,
      })
    ).toEqual(selectedMachineProjectStatus);

    expect(
      getChatLandingVisibleComposerStatus({
        contextType: 'github',
        composerStatus: null,
        localGitStateError: null,
        selectedMachineProjectStatus,
      })
    ).toBeNull();
  });
});

describe('chat landing machine online state', () => {
  it('trusts the local desktop machine for a preselected local project before machine meta syncs', () => {
    expect(
      getChatLandingHasAnyOnlineMachine({
        localMachineId: 'local-machine',
        machines: new Map(),
        isMachineOnline,
      })
    ).toBe(true);
  });

  it('accepts an online machine even when the selected local project is on a different machine', () => {
    expect(
      getChatLandingHasAnyOnlineMachine({
        localMachineId: 'github-runner',
        machines: new Map([
          ['github-runner', { id: 'github-runner' }],
          ['project-machine', { id: 'project-machine' }],
        ]),
        isMachineOnline,
      })
    ).toBe(true);
  });

  it('uses the local desktop machine to keep known machines reachable when presence is stale', () => {
    const machines = new Map([['local-machine', { id: 'local-machine' }]]);

    expect(
      isChatLandingMachineReachable({
        machineId: 'local-machine',
        localMachineId: 'local-machine',
        machines,
        isMachineOnline,
      })
    ).toBe(true);
  });

  it('counts a desktop-known machine as online before machine meta is known', () => {
    expect(
      getChatLandingHasAnyOnlineMachine({
        localMachineId: 'local-machine',
        machines: new Map(),
        isMachineOnline,
      })
    ).toBe(true);
  });
});

describe('buildChatLandingPreSelectionKey', () => {
  const projectIntent = {
    context: 'local' as const,
    machine: 'machine-1',
    project: 'local-project-1',
  };

  it('is stable while the URL names the same target', () => {
    expect(buildChatLandingPreSelectionKey(projectIntent)).toBe(
      buildChatLandingPreSelectionKey({ ...projectIntent })
    );
  });

  it('separates different targets', () => {
    expect(buildChatLandingPreSelectionKey(projectIntent)).not.toBe(
      buildChatLandingPreSelectionKey({ ...projectIntent, project: 'local-project-2' })
    );
  });
});

describe('parseChatLandingSearch', () => {
  it('keeps selection params without reviving the removed draft-reset command', () => {
    expect(
      parseChatLandingSearch({
        context: 'local',
        machine: 'machine-1',
        project: 'local-project-1',
        resetDraftKey: 'r1',
      })
    ).toEqual({
      context: 'local',
      machine: 'machine-1',
      project: 'local-project-1',
    });
  });

  it('drops unknown contexts and non-string values', () => {
    expect(
      parseChatLandingSearch({
        context: 'remote',
        machine: 7,
        project: null,
        resetDraftKey: ['r1'],
      })
    ).toEqual({
      context: undefined,
      machine: undefined,
      project: undefined,
    });
  });
});

describe('getSelectedLocalProjectKey', () => {
  it('reads the chat route search under the workspace prefix', () => {
    expect(
      getSelectedLocalProjectKey('/acme/chat', 'acme', {
        context: 'local',
        machine: 'machine-1',
        project: 'local-project-1',
      })
    ).toBe('machine-1:local-project-1');
  });

  it('reads the legacy local project route', () => {
    expect(getSelectedLocalProjectKey('/acme/local/machine-1/local-project-1', 'acme')).toBe(
      'machine-1:local-project-1'
    );
  });

  it('names no project for other locations', () => {
    expect(getSelectedLocalProjectKey('/acme/chat', 'acme', { context: 'github' })).toBeNull();
    expect(getSelectedLocalProjectKey('/acme/sessions/s1', 'acme')).toBeNull();
  });
});

describe('getChatLandingSelectionSearch', () => {
  it('names a complete local project selection', () => {
    expect(
      getChatLandingSelectionSearch({
        contextType: 'local',
        machineId: 'machine-1',
        localProjectId: 'local-project-1',
      })
    ).toEqual({ context: 'local', machine: 'machine-1', project: 'local-project-1' });
  });

  it('names the chats-only context', () => {
    expect(
      getChatLandingSelectionSearch({
        contextType: 'chat',
        machineId: 'machine-1',
        localProjectId: null,
      })
    ).toEqual({ context: 'chat' });
  });

  it('maps incomplete selections to a URL that names nothing', () => {
    expect(
      getChatLandingSelectionSearch({
        contextType: 'local',
        machineId: 'machine-1',
        localProjectId: null,
      })
    ).toEqual({});
    expect(
      getChatLandingSelectionSearch({
        contextType: 'local',
        machineId: null,
        localProjectId: null,
      })
    ).toEqual({});
  });
});

describe('getChatLandingSelectionSyncDecision', () => {
  const drifted = { urlKey: 'url-selection', selectionKey: 'composer-selection' };

  it('never touches a URL that names nothing', () => {
    expect(
      getChatLandingSelectionSyncDecision({
        ...drifted,
        urlNamesSelection: false,
        intentApplied: true,
        armed: true,
      })
    ).toBe('skip');
  });

  it('waits while the current URL intent has not been applied yet', () => {
    expect(
      getChatLandingSelectionSyncDecision({
        ...drifted,
        urlNamesSelection: true,
        intentApplied: false,
        armed: true,
      })
    ).toBe('skip');
  });

  it('arms on the commit that applied an intent instead of racing it', () => {
    expect(
      getChatLandingSelectionSyncDecision({
        ...drifted,
        urlNamesSelection: true,
        intentApplied: true,
        armed: false,
      })
    ).toBe('arm');
  });

  it('syncs composer drift once armed', () => {
    expect(
      getChatLandingSelectionSyncDecision({
        ...drifted,
        urlNamesSelection: true,
        intentApplied: true,
        armed: true,
      })
    ).toBe('sync');
  });

  it('leaves a truthful URL alone', () => {
    expect(
      getChatLandingSelectionSyncDecision({
        urlNamesSelection: true,
        intentApplied: true,
        armed: true,
        urlKey: 'same-selection',
        selectionKey: 'same-selection',
      })
    ).toBe('skip');
  });
});
