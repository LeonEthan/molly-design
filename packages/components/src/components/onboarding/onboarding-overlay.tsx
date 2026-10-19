import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useAtom } from 'jotai';
import { usePlatformCapability } from '@molly/platform/react';
import {
  desktopOnboardingPhaseAtom,
  type DesktopOnboardingActivePhase,
  type DesktopOnboardingResumePhase,
} from '@/atoms/onboarding';
import { getDesktopOnboardingSteps, OnboardingStepsProvider } from './onboarding-steps';
import { OnboardingCeremony } from './ceremony/ceremony';
import { useOnboardingAudio } from './ceremony/use-onboarding-audio';
import { OnboardingShellHost } from './onboarding-shell';
import { WorkspaceScreen } from './screens/workspace-screen';
import { ProvidersScreen } from './screens/providers-screen';
import { WindowDragStrip } from '@/ui/window-drag-region';

export type DesktopOnboardingCompletion = {
  sessionId?: string;
  workspaceSlug?: string;
};

export function resolveDesktopOnboardingPhase(
  phase: DesktopOnboardingResumePhase | null,
  input: { cloudAccount: boolean; multiWorkspace: boolean }
): DesktopOnboardingActivePhase {
  if (!phase) return 'ceremony';
  if (phase === 'login' && !input.cloudAccount) return 'providers';
  if (phase === 'workspace' && !input.multiWorkspace) return 'providers';
  // Legacy persisted phases (#168): the standalone project/first-task/summary
  // steps no longer exist; resume at Connect your models.
  if (phase === 'projects' || phase === 'firstTask' || phase === 'summary') return 'providers';
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
  const onboardingAudio = useOnboardingAudio();
  const { stop: stopOnboardingAudio } = onboardingAudio;
  const audioHandoffStoppedRef = useRef(false);

  const steps = useMemo(
    () => getDesktopOnboardingSteps({ cloudAccount, multiWorkspace }),
    [cloudAccount, multiWorkspace]
  );
  const phase = resolveDesktopOnboardingPhase(persistedPhase, { cloudAccount, multiWorkspace });
  const advanceTo = useCallback(
    (next: DesktopOnboardingResumePhase) => {
      setPersistedPhase(next);
    },
    [setPersistedPhase]
  );
  const goAfterCeremony = useCallback(() => {
    stopOnboardingAudio();
    advanceTo(cloudAccount ? 'login' : multiWorkspace ? 'workspace' : 'providers');
  }, [advanceTo, cloudAccount, multiWorkspace, stopOnboardingAudio]);
  const goBeforeProviders = useCallback(
    () => advanceTo(multiWorkspace ? 'workspace' : cloudAccount ? 'login' : 'ceremony'),
    [advanceTo, cloudAccount, multiWorkspace]
  );

  const completeOnboarding = useCallback(() => onCompleted({}), [onCompleted]);

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

  const screens: Record<DesktopOnboardingActivePhase, ReactNode> = {
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
        onBack={() => advanceTo(cloudAccount ? 'login' : 'ceremony')}
        onNext={() => advanceTo('providers')}
      />
    ),
    providers: (
      <ProvidersScreen
        key="providers"
        onBack={goBeforeProviders}
        onSkip={() => {
          void completeOnboarding();
        }}
        onNext={() => {
          void completeOnboarding();
        }}
      />
    ),
  };

  return (
    <OnboardingStepsProvider steps={steps}>
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
