import { atomWithProductStorage } from '@/lib/atom-with-product-storage';

import type { AgentConfigId, LocalProjectId, MachineId, ProviderSetupTask } from '@molly/shared';

export type DesktopOnboardingResumePhase =
  | 'ceremony'
  | 'login'
  | 'workspace'
  | 'providers'
  | 'projects'
  | 'firstTask'
  | 'summary';

export type DesktopOnboardingProjectSelection =
  | {
      kind: 'local';
      machineId: MachineId;
      localProjectId: LocalProjectId;
      name: string;
    }
  | {
      kind: 'github';
      repoFullName: string;
      name: string;
    };

export type DesktopOnboardingProviderSelection =
  | {
      kind: 'agentConfig';
      agentConfigId: AgentConfigId;
      agentName: string;
    }
  | {
      kind: 'providerSetup';
      providerSetupId: ProviderSetupTask['id'];
      agentName: string;
    };

export interface DesktopOnboardingDraft {
  provider: DesktopOnboardingProviderSelection | null;
  project: DesktopOnboardingProjectSelection | null;
}

/**
 * Last reached phase in the onboarding flow. Persisted so reload / external
 * redirect (GitHub install, OAuth) returns the user to the same screen.
 * `null` means the flow has not begun.
 */
export const desktopOnboardingPhaseAtom = atomWithProductStorage<DesktopOnboardingResumePhase | null>(
  'molly-desktop-onboarding-phase',
  null
);

export const desktopOnboardingDraftAtom = atomWithProductStorage<DesktopOnboardingDraft>(
  'molly-desktop-onboarding-draft',
  { provider: null, project: null }
);
