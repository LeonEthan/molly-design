import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import { usePlatformWorkspaces } from '@molly/platform/react';
import type { WorkspaceId } from '@molly/shared';
import { setWorkspaceContextAtom } from '@/atoms/workspace-context';
import {
  OnboardingBackButton,
  OnboardingNextButton,
  OnboardingShell,
} from '../onboarding-shell';

interface WorkspaceScreenProps {
  onBack: () => void;
  onNext: () => void;
}

/** The desktop installation has one implicit workspace owned by the local daemon. */
export function WorkspaceScreen({ onBack, onNext }: WorkspaceScreenProps) {
  const { t } = useTranslation();
  const state = usePlatformWorkspaces();
  const setWorkspaceContext = useSetAtom(setWorkspaceContextAtom);
  const workspace =
    state.status === 'ready'
      ? state.workspaces.find((entry) => entry.id === state.activeWorkspaceId) ??
        state.workspaces[0] ??
        null
      : null;

  const handleContinue = useCallback(() => {
    if (!workspace) return;
    setWorkspaceContext({
      slug: workspace.slug ?? null,
      workspaceId: workspace.id as WorkspaceId,
    });
    onNext();
  }, [onNext, setWorkspaceContext, workspace]);

  return (
    <OnboardingShell
      stepKey="workspace"
      title={t('onboarding.workspace.localTitle', 'Your local workspace')}
      description={t(
        'onboarding.workspace.localDescription',
        'Molly keeps this workspace on your computer.'
      )}
      previewIdentity={workspace ? { workspaceName: workspace.name } : undefined}
      previewState={{ workspaceStatus: workspace ? 'ready' : 'missing' }}
      secondaryAction={<OnboardingBackButton onClick={onBack} />}
      primaryAction={<OnboardingNextButton onClick={handleContinue} disabled={!workspace} />}
    >
      <div className="rounded-lg border border-border/70 bg-card/60 px-5 py-4">
        <div className="text-sm font-medium">
          {workspace?.name ?? t('onboarding.workspace.loadingDescription', 'Loading your workspace…')}
        </div>
        {workspace?.slug ? (
          <div className="mt-1 text-xs text-muted-foreground">/{workspace.slug}</div>
        ) : null}
      </div>
    </OnboardingShell>
  );
}
