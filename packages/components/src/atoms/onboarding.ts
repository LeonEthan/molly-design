import { atomWithProductStorage } from '@/lib/atom-with-product-storage';

/**
 * Phase persisted by earlier versions. `projects`, `firstTask` and `summary`
 * are legacy values: they may still appear in stored state and are normalized
 * to `providers` by `resolveDesktopOnboardingPhase`.
 */
export type DesktopOnboardingResumePhase =
  | 'ceremony'
  | 'login'
  | 'workspace'
  | 'providers'
  | 'projects'
  | 'firstTask'
  | 'summary';

/** Phases the current flow can actually render. */
export type DesktopOnboardingActivePhase = 'ceremony' | 'login' | 'workspace' | 'providers';

/**
 * Last reached phase in the onboarding flow. Persisted so reload / external
 * redirect (GitHub install, OAuth) returns the user to the same screen.
 * `null` means the flow has not begun.
 */
export const desktopOnboardingPhaseAtom =
  atomWithProductStorage<DesktopOnboardingResumePhase | null>(
    'molly-desktop-onboarding-phase',
    null
  );
