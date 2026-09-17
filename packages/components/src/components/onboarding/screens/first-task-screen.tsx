import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue, useStore } from 'jotai';
import { v4 as uuidv4 } from 'uuid';
import { Folder } from 'lucide-react';
import { toast } from 'sonner';
import {
  buildInitialHistoryEntry,
  getServerNow,
  type AgentConfigId,
  type AgentConfigMeta,
  type LocalProjectId,
  type ProjectRef,
  type SessionId,
} from '@molly/shared';
import { userAtom } from '@/atoms';
import { chatLandingSessionStateAtomFamily } from '@/atoms/local-storage-cache';
import {
  buildChatLandingDraftKey,
  chatLandingCanvasDraftAtomFamily,
  chatLandingDraftSessionIdAtomFamily,
  chatLandingSubmittingAtomFamily,
} from '@/atoms/chat-landing-draft';
import { agentDefaultsCache } from '@/lib/local-storage-cache';
import { readChatLandingDefaults, writeChatLandingDefaults } from '@/lib/chat-landing-defaults';
import { localMachineIdAtom } from '@/atoms/local-probe';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { isElectronRenderer } from '@/lib/electron';
import { flushDesignCanvasBeforeSend } from '@/lib/design-canvas-save-gate';
import { writeStoredLastActiveTabState } from '@/lib/session-draft-tabs';
import { getAllAgentConfigAtom } from '@/atoms/agents';
import type { DesktopOnboardingProjectSelection } from '@/atoms/onboarding';
import { activeWorkspaceRuntimeAtom } from '@/atoms/runtime';
import { useSessionActions } from '@/hooks/use-session-actions';
import { buildAgentPrompt } from '@/lib';
import { cn } from '@/lib/utils';
import { AgentIcon } from '@/components/icons/agent-icon';
import { Button } from '@/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Textarea } from '@/ui/textarea';
import { getFirstTaskPrimaryAction } from '../first-task-primary-action';
import { OnboardingBackButton, OnboardingNextButton, OnboardingShell } from '../onboarding-shell';
import { useOnboardingAnalytics } from '../onboarding-analytics';

export function getFirstTaskAgentConfigs(
  configs: readonly AgentConfigMeta[],
  project: DesktopOnboardingProjectSelection
): AgentConfigMeta[] {
  if (project.kind !== 'local') return [];
  return configs
    .filter((candidate) => candidate.machineId === project.machineId)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function getSelectedFirstTaskAgentConfig(
  availableConfigs: readonly AgentConfigMeta[],
  agentConfigId: AgentConfigId
): AgentConfigMeta | null {
  return availableConfigs.find((candidate) => candidate.id === agentConfigId) ?? null;
}

export function FirstTaskScreen({
  agentConfigId,
  project,
  onBack,
  onAgentConfigChange,
  onSkip,
  onContinue,
}: {
  agentConfigId: AgentConfigId;
  project: DesktopOnboardingProjectSelection;
  onBack: () => void;
  onAgentConfigChange: (config: AgentConfigMeta) => void;
  onSkip: () => void;
  onContinue: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const analytics = useOnboardingAnalytics();
  const store = useStore();
  const user = useAtomValue(userAtom);
  const localMachineId = useAtomValue(localMachineIdAtom);
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const configs = useAtomValue(getAllAgentConfigAtom);
  const { startSession, requestSessionDispatch } = useSessionActions();
  const availableConfigs = useMemo(
    () => getFirstTaskAgentConfigs(configs, project),
    [configs, project]
  );
  const config: AgentConfigMeta | null = useMemo(
    () => getSelectedFirstTaskAgentConfig(availableConfigs, agentConfigId),
    [agentConfigId, availableConfigs]
  );
  const seedPrompts = useMemo(
    () => [
      t(
        'onboarding.firstTask.seedExplore',
        'Design an editable poster for a weekend flower market.'
      ),
      t('onboarding.firstTask.seedTests', 'Create a calm, minimal cover for a travel journal.'),
      t('onboarding.firstTask.seedReadme', 'Design a social post announcing a new coffee blend.'),
    ],
    [t]
  );
  const [prompt, setPrompt] = useState(seedPrompts[0] ?? '');
  const [startRequested, setStartRequested] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [draftSessionId] = useState(() => uuidv4() as SessionId);
  const canStartFirstTask =
    project.kind === 'local' &&
    config !== null &&
    config.machineId === project.machineId &&
    runtime !== null &&
    user !== null;
  const hasPrompt = prompt.trim().length > 0;
  const canCreateSession = canStartFirstTask && hasPrompt;
  const primaryAction = getFirstTaskPrimaryAction({
    canStartFirstTask,
    hasPrompt,
    startRequested,
  });

  const handleSubmit = useCallback(() => {
    if (!canCreateSession || startRequested || project.kind !== 'local' || !config || !user) {
      return;
    }
    const machineId = project.machineId;
    const trimmedPrompt = prompt.trim();
    setStartRequested(true);
    setStartError(null);

    void (async () => {
      const draftKey = buildChatLandingDraftKey(user.id, runtime!.workspaceSlug);
      const stateAtom = chatLandingSessionStateAtomFamily(draftKey);
      const idAtom = chatLandingDraftSessionIdAtomFamily(draftKey);
      const canvasAtom = chatLandingCanvasDraftAtomFamily(draftKey);
      const submittingAtom = chatLandingSubmittingAtomFamily(draftKey);
      const recoveryDraft = { prompt: trimmedPrompt, pastedTextDrafts: [], mentionRanges: [] };
      const association = {
        sessionId: draftSessionId,
        name: t('design.untitled'),
        userId: user.id,
        machineId,
        createdAt: new Date(getServerNow()).toISOString(),
      };
      store.set(stateAtom, recoveryDraft);
      store.set(idAtom, draftSessionId);
      store.set(canvasAtom, { mode: 'auto', width: 800, height: 600, association });
      store.set(submittingAtom, true);
      writeChatLandingDefaults(runtime!.workspaceId, {
        ...readChatLandingDefaults(runtime!.workspaceId),
        agentId: config.id,
        machineId,
        localMachineId: machineId,
        localProjectId: project.localProjectId,
        contextType: 'local',
        agentRoleId: null,
      });
      const sessionStartedAtMs = analytics.now();
      analytics.capture('onboarding/operation_started', {
        step: 'firstTask',
        operation: 'first_session_create',
      });
      try {
        // Completion and product navigation remain independent of creation.
        const entered = await onContinue();
        if (!entered) return;
        if (
          !store
            .get(getAllAgentConfigAtom)
            .some((candidate) => candidate.id === config.id && candidate.machineId === machineId)
        ) {
          throw new Error(t('onboarding.firstTask.agentUnavailable'));
        }
        const designService = isElectronRenderer() ? getIpcServices()?.design : undefined;
        if (isElectronRenderer() && (!designService || machineId !== localMachineId)) {
          throw new Error(t('design.saveFailedBeforeSend'));
        }
        if (designService) {
          await designService.create({ association });
          await flushDesignCanvasBeforeSend(draftSessionId);
        }
        const projectRef: ProjectRef = {
          kind: 'local',
          localProjectId: project.localProjectId as LocalProjectId,
        };
        const defaults = agentDefaultsCache.get(config.id);
        const entry = buildInitialHistoryEntry({
          userId: user.id,
          timestamp: new Date(getServerNow()).toISOString(),
          cliType: config.cliType,
          agentType: config.agentType,
          prompt: buildAgentPrompt(trimmedPrompt, config.prompt ?? ''),
          inputBlocks: undefined,
          modelId: defaults?.modelId ?? undefined,
          modeId: defaults?.modeId ?? undefined,
          configOptionValues: defaults?.configOptionValues,
        });
        if (!entry) throw new Error('Could not build the first turn');
        const result = await startSession(
          {
            sessionId: draftSessionId,
            ...(designService
              ? { design: { artworkId: draftSessionId, path: 'design.json' as const } }
              : {}),
            userId: user.id,
            cliType: config.cliType,
            agentType: config.agentType,
            customAcp: config.customAcp,
            runtimeOverrides: config.runtimeOverrides,
            machineId,
            agentConfigId: config.id,
            env: config.env,
            project: projectRef,
            title: trimmedPrompt.slice(0, 50),
            titleSource: 'draft',
          },
          entry
        );
        // Only clear this exact recovery draft; an independently changed draft survives.
        const currentDraft = store.get(stateAtom);
        if (
          store.get(idAtom) === draftSessionId &&
          currentDraft.prompt === recoveryDraft.prompt &&
          !currentDraft.pastedTextDrafts?.length &&
          !currentDraft.mentionRanges?.length
        ) {
          store.set(stateAtom, { prompt: '', pastedTextDrafts: [], mentionRanges: [] });
          store.set(idAtom, null);
          store.set(canvasAtom, { mode: 'auto', width: 800, height: 600 });
        }
        if (designService) {
          writeStoredLastActiveTabState(result.sessionId, {
            sessionTabId: result.sessionId,
            viewerTab: null,
            sidePanel: { open: true, tab: 'design', tabs: ['design'], sideSessionId: null },
          });
          void designService.acknowledge(result.sessionId).catch((error) => {
            console.error('Failed to acknowledge the first design session', error);
            toast.error(String(error));
          });
        }
        analytics.capture('onboarding/operation_succeeded', {
          step: 'firstTask',
          operation: 'first_session_create',
          duration_ms: analytics.durationSince(sessionStartedAtMs),
        });
        const dispatchStartedAtMs = analytics.now();
        analytics.capture('onboarding/operation_started', {
          step: 'firstTask',
          operation: 'first_session_dispatch',
        });
        void requestSessionDispatch(result.sessionId, result.historyEntry.id, {
          inputConfig: result.historyEntry.inputConfig,
          machineId,
        }).then(
          () => {
            analytics.capture('onboarding/operation_succeeded', {
              step: 'firstTask',
              operation: 'first_session_dispatch',
              duration_ms: analytics.durationSince(dispatchStartedAtMs),
            });
          },
          (dispatchError: unknown) => {
            console.error('Failed to accelerate the first onboarding session', dispatchError);
            analytics.capture('onboarding/operation_failed', {
              step: 'firstTask',
              operation: 'first_session_dispatch',
              failure_code: 'first_session_dispatch_failed',
              duration_ms: analytics.durationSince(dispatchStartedAtMs),
              retryable: false,
            });
          }
        );
      } catch (submitError) {
        console.error('Failed to start the first onboarding session', submitError);
        analytics.capture('onboarding/operation_failed', {
          step: 'firstTask',
          operation: 'first_session_create',
          failure_code: 'first_session_create_failed',
          duration_ms: analytics.durationSince(sessionStartedAtMs),
          retryable: false,
        });
        setStartError(submitError instanceof Error ? submitError.message : String(submitError));
        toast.error(t('onboarding.firstTask.startFailed', 'The first session could not start.'), {
          description: submitError instanceof Error ? submitError.message : String(submitError),
        });
      } finally {
        store.set(submittingAtom, false);
        setStartRequested(false);
      }
    })();
  }, [
    analytics,
    store,
    runtime,
    draftSessionId,
    localMachineId,
    canCreateSession,
    config,
    onContinue,
    project,
    prompt,
    requestSessionDispatch,
    startSession,
    startRequested,
    t,
    user,
  ]);

  return (
    <OnboardingShell
      stepKey="firstTask"
      title={
        primaryAction.kind === 'run'
          ? t('onboarding.firstTask.title', 'Start your first design session')
          : t('onboarding.firstTask.continueTitle', 'Continue to Molly')
      }
      description={
        primaryAction.kind === 'run'
          ? t(
              'onboarding.firstTask.description',
              'Describe your design. This starts a real session with the project and Agent you selected.'
            )
          : t(
              'onboarding.firstTask.continueDescription',
              'Your first task is not ready yet. You can finish setup later from Settings.'
            )
      }
      previewIdentity={{
        projectName: project.name,
        ...(config
          ? {
              agentName: config.name,
              agentType: config.agentType,
              agentCliType: config.cliType,
            }
          : {}),
      }}
      previewState={{
        agentStatus: config ? 'ready' : 'preparing',
        projectStatus: 'ready',
        promptValue: prompt,
        conversationStatus: startRequested ? 'starting' : prompt.trim() ? 'draft' : 'empty',
      }}
      secondaryAction={<OnboardingBackButton onClick={onBack} />}
      primaryAction={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="lg"
            onClick={onSkip}
            className="text-muted-foreground hover:text-foreground"
          >
            {t('onboarding.firstTask.skip', 'Skip for now')}
          </Button>
          <OnboardingNextButton
            finish
            onClick={primaryAction.kind === 'run' ? handleSubmit : onContinue}
            disabled={primaryAction.disabled}
            loading={primaryAction.loading}
            label={
              primaryAction.kind === 'run'
                ? t('onboarding.firstTask.run', 'Start design session')
                : t('onboarding.firstTask.enter', 'Enter Molly')
            }
          />
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
          <Folder className="size-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{project.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {t('onboarding.firstTask.project', 'Project')}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="onboarding-first-task-agent"
            className="text-xs font-medium text-slate-700"
          >
            {t('onboarding.firstTask.agent', 'Agent')}
          </label>
          <Select
            value={config?.id}
            onValueChange={(value) => {
              const next = availableConfigs.find((candidate) => candidate.id === value);
              if (!next) return;
              onAgentConfigChange(next);
            }}
            disabled={availableConfigs.length === 0}
          >
            <SelectTrigger
              id="onboarding-first-task-agent"
              aria-label={t('onboarding.firstTask.agent', 'Agent')}
              className="h-11"
            >
              <SelectValue placeholder={t('onboarding.firstTask.selectAgent', 'Select an Agent')}>
                {config ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <AgentIcon
                      cliType={config.cliType}
                      agentType={config.agentType}
                      brandId={config.brandId}
                      env={config.env}
                      className="size-4 shrink-0"
                    />
                    <span className="truncate">{config.name}</span>
                  </span>
                ) : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableConfigs.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  <span className="flex min-w-0 items-center gap-2">
                    <AgentIcon
                      cliType={candidate.cliType}
                      agentType={candidate.agentType}
                      brandId={candidate.brandId}
                      env={candidate.env}
                      className="size-4 shrink-0"
                    />
                    <span className="truncate">{candidate.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!config ? (
            <p className="text-xs text-muted-foreground">
              {t(
                'onboarding.firstTask.agentUnavailable',
                'The selected Agent is no longer available on this machine.'
              )}
            </p>
          ) : null}
        </div>
        {startError ? (
          <p role="alert" className="text-sm text-destructive">
            {t('onboarding.firstTask.startFailed')} {startError}
          </p>
        ) : null}
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={4}
          placeholder={t(
            'onboarding.firstTask.promptPlaceholder',
            'What would you like to design?'
          )}
        />
        <div className="flex flex-wrap gap-2">
          {seedPrompts.map((seed) => (
            <button
              key={seed}
              type="button"
              onClick={() => setPrompt(seed)}
              className={cn(
                'rounded-full border border-border px-3 py-1 text-xs text-muted-foreground',
                'hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring'
              )}
            >
              {seed}
            </button>
          ))}
        </div>
      </div>
    </OnboardingShell>
  );
}
