import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import {
  decodeMollyModelOption,
  type ModelConnection,
  type ProtectedImageConnection,
} from '@molly/shared/embedded-harness';
import { Button } from '@/ui/button';
import { getAllAgentConfigAtom } from '@/atoms/agents';
import { localMachineIdAtom } from '@/atoms/local-probe';
import { activeWorkspaceRuntimeAtom } from '@/atoms/runtime';
import { useMachineFlockAgentConfigsForMachineIds } from '@/hooks/use-machine-flock-agent-configs';
import { useVisibleMachineMetas } from '@/hooks/use-visible-machine-metas';
import { useAcpSelectorOptions } from '@/hooks/use-acp-selector-options';
import type { AcpSessionSelectOption } from '@/components/shared/acp-session-select';
import { ModelConnectionSetting } from '@/components/settings/model-connection-setting';
import { ImageConnectionSetting } from '@/components/settings/image-connection-setting';
import { agentDefaultsCache } from '@/lib/local-storage-cache';
import { readChatLandingDefaults, writeChatLandingDefaults } from '@/lib/chat-landing-defaults';
import { getReadyModelConnections, isImageConnectionReady } from '@/lib/design-model-readiness';
import { OnboardingShell, OnboardingBackButton, OnboardingNextButton } from '../onboarding-shell';
import { getOnboardingMollyConfigs } from '../onboarding-agent';

/** Product default thinking for a first session: Medium whenever the model offers it. */
export function getOnboardingDefaultThinking(efforts: readonly string[] | undefined): string {
  return !efforts || efforts.includes('medium') ? 'medium' : (efforts[0] ?? 'medium');
}

/** The first offered model of a ready connection; `null` until one is projected. */
export function getOnboardingDefaultModelId(
  modelOptions: readonly AcpSessionSelectOption[],
  readyConnectionIds: ReadonlySet<string>
): string | null {
  const option = modelOptions.find((candidate) => {
    const decoded = decodeMollyModelOption(candidate.value);
    return (
      decoded !== null && decoded !== undefined && readyConnectionIds.has(decoded.connectionId)
    );
  });
  return option?.value ?? null;
}

type ProvidersScreenProps = {
  onBack: () => void;
  onSkip: () => void;
  onNext: () => void;
};

export type ProvidersScreenViewProps = ProvidersScreenProps & {
  languageReady: boolean;
  imageReady: boolean;
  /** The connected LLM's models are projected and a default can be bound. */
  modelReady: boolean;
  /** An eligible published built-in Molly exists on this machine. */
  mollyAvailable: boolean;
  connections?: ReactNode;
  imageConnection?: ReactNode;
};

export function ProvidersScreenView({
  languageReady,
  imageReady,
  modelReady,
  mollyAvailable,
  connections,
  imageConnection,
  onBack,
  onSkip,
  onNext,
}: ProvidersScreenViewProps) {
  const { t } = useTranslation();
  const canNext = languageReady && imageReady && modelReady && mollyAvailable;
  return (
    <OnboardingShell
      stepKey="providers"
      title={t('onboarding.models.title')}
      description={t('onboarding.models.description')}
      secondaryAction={<OnboardingBackButton onClick={onBack} />}
      primaryAction={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onSkip}>
            {t('onboarding.models.skip')}
          </Button>
          <OnboardingNextButton finish disabled={!canNext} onClick={onNext} />
        </div>
      }
    >
      <div className="space-y-4">
        {connections}
        {imageConnection}
        {!mollyAvailable ? (
          <p role="status" className="text-sm">
            {t('onboarding.models.unavailable')}
          </p>
        ) : null}
      </div>
    </OnboardingShell>
  );
}

export function ProvidersScreen(props: ProvidersScreenProps) {
  const localMachineId = useAtomValue(localMachineIdAtom);
  const machineIds = useMemo(
    () => (localMachineId === null ? [] : [localMachineId]),
    [localMachineId]
  );
  useMachineFlockAgentConfigsForMachineIds(machineIds);
  const configs = useAtomValue(getAllAgentConfigAtom);
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const { machines } = useVisibleMachineMetas({ syncMachineFlock: false });
  const [connections, setConnections] = useState<readonly ModelConnection[]>();
  const [imageConnection, setImageConnection] = useState<ProtectedImageConnection | null>();

  const mollyConfig = getOnboardingMollyConfigs(configs, localMachineId)[0] ?? null;
  const readyConnections = connections ? getReadyModelConnections(connections) : [];
  const languageReady = connections !== undefined && readyConnections.length > 0;
  const imageReady = isImageConnectionReady(imageConnection);

  const selectorOptions = useAcpSelectorOptions(
    mollyConfig
      ? {
          configId: mollyConfig.id,
          cliType: mollyConfig.cliType,
          agentType: mollyConfig.agentType,
          machine: machines.get(mollyConfig.machineId) ?? null,
        }
      : undefined
  );

  // A saved connection only becomes usable once the machine catalog projects
  // its models; completing earlier would persist an empty model default.
  const defaultModelId = getOnboardingDefaultModelId(
    selectorOptions.modelOptions,
    new Set(readyConnections.map((connection) => connection.id))
  );

  const handleNext = () => {
    if (!mollyConfig || !defaultModelId) return;
    // Bind the first session so the landing composer needs no second pick:
    // Agent = auto-selected Molly, model = the connected LLM's first offered
    // model, thinking = product default (Medium where the model offers it).
    const thinking = getOnboardingDefaultThinking(
      selectorOptions.modelReasoningEfforts?.[defaultModelId]
    );
    agentDefaultsCache.set(mollyConfig.id, {
      modelId: defaultModelId,
      modeId: null,
      configOptionValues: { reasoning_effort: thinking },
    });
    if (runtime) {
      writeChatLandingDefaults(runtime.workspaceId, {
        ...readChatLandingDefaults(runtime.workspaceId),
        agentId: mollyConfig.id,
        machineId: mollyConfig.machineId,
        localMachineId: mollyConfig.machineId,
        localProjectId: null,
        contextType: 'chat',
        agentRoleId: null,
      });
    }
    props.onNext();
  };

  return (
    <ProvidersScreenView
      onBack={props.onBack}
      onSkip={props.onSkip}
      onNext={handleNext}
      languageReady={languageReady}
      imageReady={imageReady}
      modelReady={defaultModelId !== null}
      mollyAvailable={mollyConfig !== null}
      connections={<ModelConnectionSetting onConnectionsChange={setConnections} />}
      imageConnection={<ImageConnectionSetting onConnectionChange={setImageConnection} />}
    />
  );
}
