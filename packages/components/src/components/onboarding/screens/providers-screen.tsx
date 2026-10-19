import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import {
  decodeMollyModelOption,
  type HarnessModelCatalog,
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
import { getIpcServices } from '@/lib/electron-ipc-client';
import { agentDefaultsCache } from '@/lib/local-storage-cache';
import { readChatLandingDefaults, writeChatLandingDefaults } from '@/lib/chat-landing-defaults';
import { getReadyModelConnections, isImageConnectionReady } from '@/lib/design-model-readiness';
import { OnboardingShell, OnboardingBackButton, OnboardingNextButton } from '../onboarding-shell';
import { getOnboardingMollyConfigs } from '../onboarding-agent';

/** Product default thinking for a first session: Medium whenever the model offers it. */
export function getOnboardingDefaultThinking(efforts: readonly string[] | undefined): string {
  return !efforts || efforts.includes('medium') ? 'medium' : (efforts[0] ?? 'medium');
}

type CatalogModel = HarnessModelCatalog['models'][number];

/**
 * Whether the connection's current configuration offers this model, by the same
 * rules the composer catalog projection uses (apps/cli embedded-harness-catalog).
 * A native preset cannot be checked before the packaged catalog is read.
 */
export function isModelOfferedByConnection(
  connection: ModelConnection,
  modelId: string,
  catalog: readonly CatalogModel[] | undefined
): boolean {
  if (connection.providerPresetId === 'openai-compatible') {
    return (connection.customModels ?? []).some((model) => model.modelId === modelId);
  }
  if (connection.models && !connection.models.includes(modelId)) return false;
  return (
    catalog?.some(
      (model) => model.providerPresetId === connection.providerPresetId && model.modelId === modelId
    ) ?? false
  );
}

/**
 * The first projected model that a ready connection's current configuration
 * offers; `null` until one is projected. A projection left over from before a
 * same-id edit is rejected rather than saved as the first-session default.
 */
export function getOnboardingDefaultModelId(
  modelOptions: readonly AcpSessionSelectOption[],
  readyConnections: readonly ModelConnection[],
  catalog: readonly CatalogModel[] | undefined
): string | null {
  const option = modelOptions.find((candidate) => {
    const decoded = decodeMollyModelOption(candidate.value);
    if (!decoded) return false;
    const connection = readyConnections.find((ready) => ready.id === decoded.connectionId);
    return (
      connection !== undefined && isModelOfferedByConnection(connection, decoded.modelId, catalog)
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
  /** The packaged model catalog could not be read; Retry reads it again. */
  onCatalogRetry?: () => void;
  connections?: ReactNode;
  imageConnection?: ReactNode;
};

export function ProvidersScreenView({
  languageReady,
  imageReady,
  modelReady,
  mollyAvailable,
  onCatalogRetry,
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
        {onCatalogRetry ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="min-w-0 flex-1">{t('onboarding.models.catalogError')}</p>
            <Button size="sm" variant="outline" onClick={onCatalogRetry}>
              {t('common.retry')}
            </Button>
          </div>
        ) : null}
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
  const [catalog, setCatalog] = useState<readonly CatalogModel[]>();
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const ipc = useMemo(() => getIpcServices(), []);

  useEffect(() => {
    if (!ipc) return undefined;
    let live = true;
    void Promise.resolve()
      .then(() => ipc.modelConnections.getModelCatalog())
      .then((value) => {
        if (live) setCatalog(value.models);
      })
      .catch((error: unknown) => {
        console.error('Failed to read the model catalog during onboarding', error);
        if (live) setCatalogFailed(true);
      });
    return () => {
      live = false;
    };
  }, [ipc, catalogAttempt]);

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
    readyConnections,
    catalog
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
      onCatalogRetry={
        catalogFailed
          ? () => {
              setCatalogFailed(false);
              setCatalogAttempt((attempt) => attempt + 1);
            }
          : undefined
      }
      connections={<ModelConnectionSetting onConnectionsChange={setConnections} />}
      imageConnection={<ImageConnectionSetting onConnectionChange={setImageConnection} />}
    />
  );
}
