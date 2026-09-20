import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { usePlatformCapability } from '@molly/platform/react';
import type { AgentConfigMeta, MachineId } from '@molly/shared';
import {
  desktopOnboardingDraftAtom,
  desktopOnboardingPhaseAtom,
  type DesktopOnboardingProviderSelection,
  type DesktopOnboardingResumePhase,
} from '@/atoms/onboarding';
import { getAllAgentConfigAtom } from '@/atoms/agents';
import { localMachineIdAtom } from '@/atoms/local-probe';
import { useMachineFlockAgentConfigsForMachineIds } from '@/hooks/use-machine-flock-agent-configs';
import { getDesktopOnboardingSteps, OnboardingStepsProvider } from './onboarding-steps';
import { OnboardingCeremony } from './ceremony/ceremony';
import { useOnboardingAudio } from './ceremony/use-onboarding-audio';
import { OnboardingShellHost } from './onboarding-shell';
import { WorkspaceScreen } from './screens/workspace-screen';
import { ProvidersScreen } from './screens/providers-screen';
import { ProjectsScreen } from './screens/projects-screen';
import { FirstTaskScreen } from './screens/first-task-screen';
import { SummaryScreen } from './screens/summary-screen';
import { isOnboardingMollyConfig } from './onboarding-agent';
import {
  useOnboardingAnalytics,
  type DesktopOnboardingTraceProperties,
} from './onboarding-analytics';
import { WindowDragStrip } from '@/ui/window-drag-region';

export type DesktopOnboardingCompletion = {
  sessionId?: string;
  workspaceSlug?: string;
  entryPoint?: 'first_task' | 'first_task_skip' | 'summary';
  sourceStep?: DesktopOnboardingResumePhase;
  sourceStepDurationMs?: number | null;
};

export function resolveDesktopOnboardingSummaryAgent(
  provider: DesktopOnboardingProviderSelection | null,
  agentConfigs: readonly AgentConfigMeta[],
  machineId: MachineId | null
): { state: 'ready' | 'retired' | 'missing'; name: string | undefined } {
  if (!provider) return { state: 'missing', name: undefined };
  if (provider.kind === 'providerSetup') return { state: 'retired', name: provider.agentName };
  const config = agentConfigs.find((candidate) => candidate.id === provider.agentConfigId);
  if (!config || machineId === null) return { state: 'missing', name: provider.agentName };
  return isOnboardingMollyConfig(config, machineId)
    ? { state: 'ready', name: config.name }
    : { state: 'retired', name: config.name };
}

export function resolveDesktopOnboardingPhase(
  phase: DesktopOnboardingResumePhase | null,
  input: { cloudAccount: boolean; multiWorkspace: boolean; hasAgent: boolean; hasProject: boolean }
): DesktopOnboardingResumePhase {
  if (!phase) return 'ceremony';
  if (phase === 'login' && !input.cloudAccount) return 'providers';
  if (phase === 'workspace' && !input.multiWorkspace) return 'providers';
  if (phase === 'firstTask' && !input.hasAgent) return 'providers';
  if (phase === 'firstTask' && !input.hasProject) return 'projects';
  return phase;
}

export function OnboardingOverlay({
  onCompleted,
}: {
  /** Resolves to whether product navigation succeeded; native persistence never gates it. */
  onCompleted: (completion: DesktopOnboardingCompletion) => Promise<boolean>;
}) {
  const cloudAccount = usePlatformCapability('cloudAccount');
  const multiWorkspace = usePlatformCapability('multiWorkspace');
  const [persistedPhase, setPersistedPhase] = useAtom(desktopOnboardingPhaseAtom);
  const [draft, setDraft] = useAtom(desktopOnboardingDraftAtom);
  const onboardingAudio = useOnboardingAudio();
  const analytics = useOnboardingAnalytics();
  const { stop: stopOnboardingAudio } = onboardingAudio;
  const audioHandoffStoppedRef = useRef(false);

  const steps = useMemo(
    () => getDesktopOnboardingSteps({ cloudAccount, multiWorkspace }),
    [cloudAccount, multiWorkspace]
  );
  const agentConfigs = useAtomValue(getAllAgentConfigAtom);
  const localMachineId = useAtomValue(localMachineIdAtom);
  const machineIds = useMemo(
    () => (localMachineId === null ? [] : [localMachineId]),
    [localMachineId]
  );
  useMachineFlockAgentConfigsForMachineIds(machineIds, { syncRemote: false });
  const summaryAgent = resolveDesktopOnboardingSummaryAgent(
    draft.provider,
    agentConfigs,
    localMachineId
  );
  const phase = resolveDesktopOnboardingPhase(persistedPhase, {
    cloudAccount,
    multiWorkspace,
    hasAgent: summaryAgent.state === 'ready',
    hasProject: draft.project !== null,
  });
  const visibleSteps = useMemo(
    () =>
      phase === 'summary' || draft.provider?.kind === 'providerSetup'
        ? steps.map((step) => (step === 'firstTask' ? 'summary' : step))
        : steps,
    [draft.provider?.kind, phase, steps]
  );
  const stepStartedAtRef = useRef(analytics.now());
  const flowStartedCapturedRef = useRef(false);
  const viewedPhaseRef = useRef<DesktopOnboardingResumePhase | null>(null);
  const captureStepExit = useCallback(
    (
      action: 'continue' | 'back' | 'skip' | 'authenticated' | 'complete',
      nextStep: DesktopOnboardingResumePhase | 'product',
      properties?: DesktopOnboardingTraceProperties
    ) => {
      analytics.capture('onboarding/step_exited', {
        step: phase,
        next_step: nextStep,
        action,
        duration_ms: analytics.durationSince(stepStartedAtRef.current),
        ...properties,
      });
    },
    [analytics, phase]
  );
  const advanceTo = useCallback(
    (
      next: DesktopOnboardingResumePhase,
      action: 'continue' | 'back' | 'skip' | 'authenticated' = 'continue',
      properties?: DesktopOnboardingTraceProperties
    ) => {
      captureStepExit(action, next, properties);
      setPersistedPhase(next);
    },
    [captureStepExit, setPersistedPhase]
  );
  const goAfterCeremony = useCallback(
    () =>
      advanceTo(cloudAccount ? 'login' : multiWorkspace ? 'workspace' : 'providers', 'continue'),
    [advanceTo, cloudAccount, multiWorkspace]
  );
  const goBeforeProviders = useCallback(
    () => advanceTo(multiWorkspace ? 'workspace' : cloudAccount ? 'login' : 'ceremony', 'back'),
    [advanceTo, cloudAccount, multiWorkspace]
  );

  useEffect(() => {
    if (!flowStartedCapturedRef.current) {
      flowStartedCapturedRef.current = true;
      analytics.capture(
        persistedPhase === null ? 'onboarding/flow_started' : 'onboarding/flow_resumed',
        {
          initial_step: phase,
          resumed: persistedPhase !== null,
          cloud_account: cloudAccount,
          multi_workspace: multiWorkspace,
        }
      );
    }
    if (viewedPhaseRef.current === phase) return;
    viewedPhaseRef.current = phase;
    stepStartedAtRef.current = analytics.now();
    const stepIndex = visibleSteps.indexOf(phase);
    analytics.capture('onboarding/step_viewed', {
      step: phase,
      step_index: stepIndex === -1 ? null : stepIndex + 1,
      step_count: visibleSteps.length,
      provider_selection_kind: draft.provider?.kind ?? 'none',
      project_kind: draft.project?.kind ?? 'none',
      agent_state: phase === 'summary' ? summaryAgent.state : undefined,
    });
  }, [
    analytics,
    cloudAccount,
    draft.project?.kind,
    draft.provider?.kind,
    multiWorkspace,
    persistedPhase,
    phase,
    summaryAgent.state,
    visibleSteps,
  ]);

  const completeOnboarding = useCallback(
    async (entryPoint: NonNullable<DesktopOnboardingCompletion['entryPoint']>) => {
      return onCompleted({
        entryPoint,
        sourceStep: phase,
        sourceStepDurationMs: analytics.durationSince(stepStartedAtRef.current),
      });
    },
    [analytics, onCompleted, phase]
  );

  useEffect(() => {
    if (phase === 'ceremony') {
      audioHandoffStoppedRef.current = false;
      return undefined;
    }
    if (audioHandoffStoppedRef.current) return undefined;
    audioHandoffStoppedRef.current = true;
    stopOnboardingAudio();
    return undefined;
  }, [phase, stopOnboardingAudio]);

  const screens: Record<DesktopOnboardingResumePhase, ReactNode> = {
    ceremony: (
      <OnboardingCeremony
        key="ceremony"
        audio={onboardingAudio}
        playing
        onFinish={goAfterCeremony}
      />
    ),
    // Persisted legacy phase is normalized before rendering on the local platform.
    login: null,
    workspace: (
      <WorkspaceScreen
        key="workspace"
        onBack={() => advanceTo(cloudAccount ? 'login' : 'ceremony', 'back')}
        onNext={() => advanceTo('providers')}
      />
    ),
    providers: (
      <ProvidersScreen
        key="providers"
        onBack={goBeforeProviders}
        onSkip={() => {
          setDraft({ provider: null, project: null });
          advanceTo('summary', 'skip', { provider_selection_kind: 'none' });
        }}
        onNext={(provider) => {
          setDraft({ provider, project: null });
          advanceTo('projects', 'continue', { provider_selection_kind: provider.kind });
        }}
      />
    ),
    projects: (
      <ProjectsScreen
        key="projects"
        onBack={() => advanceTo('providers', 'back')}
        onSkip={() => {
          setDraft((previous) => ({ ...previous, project: null }));
          advanceTo('summary', 'skip', { project_kind: 'none' });
        }}
        onComplete={(project) => {
          setDraft((previous) => ({ ...previous, project }));
          advanceTo(
            project.kind === 'local' && draft.provider?.kind === 'agentConfig'
              ? 'firstTask'
              : 'summary',
            'continue',
            { project_kind: project.kind }
          );
        }}
      />
    ),
    firstTask:
      draft.provider?.kind === 'agentConfig' && draft.project ? (
        <FirstTaskScreen
          key="firstTask"
          agentConfigId={draft.provider.agentConfigId}
          project={draft.project}
          onBack={() => advanceTo('projects', 'back')}
          onAgentConfigChange={(config) => {
            setDraft((previous) => ({
              ...previous,
              provider: {
                kind: 'agentConfig',
                agentConfigId: config.id,
                agentName: config.name,
              },
            }));
          }}
          onSkip={() => {
            void completeOnboarding('first_task_skip');
          }}
          onContinue={() => {
            return completeOnboarding('first_task');
          }}
        />
      ) : null,
    summary: (
      <SummaryScreen
        key="summary"
        agentState={summaryAgent.state}
        agentName={summaryAgent.name}
        projectName={draft.project?.name}
        onBack={() => advanceTo(draft.project ? 'projects' : 'providers', 'back')}
        onComplete={() => {
          void completeOnboarding('summary');
        }}
      />
    ),
  };

  return (
    <OnboardingStepsProvider steps={visibleSteps}>
      <div className="fixed inset-0 z-40 overflow-hidden bg-[#f7f5f2] text-slate-950">
        <WindowDragStrip className="z-30" />
        {phase === 'ceremony' ? (
          <div className="absolute inset-0 z-10">{screens[phase]}</div>
        ) : (
          <div className="absolute inset-0 z-10">
            <OnboardingShellHost>{screens[phase]}</OnboardingShellHost>
          </div>
        )}
      </div>
    </OnboardingStepsProvider>
  );
}
