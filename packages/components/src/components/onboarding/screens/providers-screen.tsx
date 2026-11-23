import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import {
  decodeMollyModelOption,
  type HarnessModelCatalog,
  type ModelConnection,
  type ProtectedImageConnection,
} from '@molly/shared/embedded-harness';
import { Button } from '@/ui/button';
import { ArrowLeft, Check, Image as ImageIcon, Type, X } from '@/ui/icons';
import { cn } from '@/lib/utils';
import { getAllAgentConfigAtom } from '@/atoms/agents';
import { localMachineIdAtom } from '@/atoms/local-probe';
import { activeWorkspaceRuntimeAtom } from '@/atoms/runtime';
import { useMachineFlockAgentConfigsForMachineIds } from '@/hooks/use-machine-flock-agent-configs';
import { useVisibleMachineMetas } from '@/hooks/use-visible-machine-metas';
import { useAcpSelectorOptions } from '@/hooks/use-acp-selector-options';
import type { AcpSessionSelectOption } from '@/components/shared/acp-session-select';
import { ModelConnectionSetting } from '@/components/settings/model-connection-setting';
import {
  ImageConnectionSetting,
  imageProtocolLabelKey,
  type ReusableOpenAiKey,
} from '@/components/settings/image-connection-setting';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { agentDefaultsCache } from '@/lib/local-storage-cache';
import { readChatLandingDefaults, writeChatLandingDefaults } from '@/lib/chat-landing-defaults';
import { defaultComposerReasoning } from '@/lib/composer-provider-hierarchy';
import { getReadyModelConnections, isImageConnectionReady } from '@/lib/design-model-readiness';
import { OnboardingShell, OnboardingBackButton, OnboardingNextButton } from '../onboarding-shell';
import { getOnboardingMollyConfigs } from '../onboarding-agent';

/** First-session reasoning: `high` when the model offers it, otherwise its first non-off level. */
export function getOnboardingDefaultThinking(efforts: readonly string[] | undefined): string {
  return defaultComposerReasoning(efforts, true);
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

type PanelId = 'language' | 'image';

/**
 * Only auto-open the first incomplete panel in the two-column desktop layout.
 * Below 1080px the panel overlays the single column, so leaving it closed keeps
 * the two-step overview and Skip for now reachable on compact displays.
 */
export function resolveInitialAutoOpenPanel({
  languageReady,
  imageReady,
  compactOverlay,
}: {
  languageReady: boolean;
  imageReady: boolean;
  compactOverlay: boolean;
}): PanelId | null {
  if (compactOverlay) return null;
  if (!languageReady) return 'language';
  if (!imageReady) return 'image';
  return null;
}

export type ProvidersScreenViewProps = ProvidersScreenProps & {
  languageReady: boolean;
  imageReady: boolean;
  /** The connected LLM's models are projected and a default can be bound. */
  modelReady: boolean;
  /** An eligible published built-in Molly exists on this machine. */
  mollyAvailable: boolean;
  /** The packaged model catalog could not be read; Retry reads it again. */
  onCatalogRetry?: () => void;
  languageSummary?: string;
  imageSummary?: ReactNode;
  /** Which panel starts open; defaults to null (editorial artwork visible). */
  initialOpen?: PanelId | null;
  /** Controlled open panel override when host auto-opens the first incomplete step. */
  openPanel?: PanelId | null;
  onOpenPanelChange?: (panel: PanelId | null) => void;
  /** Panels receive `done(outcome)`; both model panels stay mounted while closed. */
  languagePanel?: (done: (outcome?: 'saved' | 'cancelled') => void) => ReactNode;
  imagePanel?: (done: (outcome?: 'saved' | 'cancelled') => void) => ReactNode;
};

function ConnectRow({
  icon,
  title,
  summary,
  hint,
  done,
  action,
  active,
  onOpen,
}: {
  icon: ReactNode;
  title: string;
  summary?: ReactNode;
  hint: string;
  done: boolean;
  action: string;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={active}
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-colors',
        active
          ? 'border-[#141413]/40 bg-white/70'
          : 'border-[#141413]/10 bg-white/40 hover:border-[#141413]/25 hover:bg-white/60'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full',
          done ? 'bg-[#141413] text-[#f4f1ea]' : 'bg-[#141413]/[0.06] text-[#6b6963]'
        )}
      >
        {done ? <Check className="h-4 w-4" /> : icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium text-[#141413]">{title}</span>
        <span className="block min-w-0 text-xs text-[#6b6963]">
          {done && summary ? (
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1">{summary}</span>
          ) : (
            hint
          )}
        </span>
      </span>
      <span className="shrink-0 text-xs font-medium text-[#141413]">{action}</span>
    </button>
  );
}

function PanelCard({
  title,
  hidden,
  onClose,
  children,
}: {
  title: string;
  hidden?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section
      hidden={hidden}
      aria-label={title}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#141413]/10 bg-[#fbfaf7] p-6 shadow-[0_18px_48px_-28px_rgba(20,20,19,0.35)]"
    >
      <div className="mb-5 flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 gap-1.5 min-[1080px]:hidden"
          onClick={onClose}
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
          {t('common.back')}
        </Button>
        <h2 className="font-editorial flex-1 text-[22px] leading-tight text-[#141413] max-[1080px]:sr-only">
          {title}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 max-[1080px]:hidden"
          aria-label={t('common.close')}
          onClick={onClose}
        >
          <X aria-hidden className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </section>
  );
}

export function ProvidersScreenView({
  languageReady,
  imageReady,
  modelReady,
  mollyAvailable,
  onCatalogRetry,
  languageSummary,
  imageSummary,
  initialOpen = null,
  openPanel,
  onOpenPanelChange,
  languagePanel,
  imagePanel,
  onBack,
  onSkip,
  onNext,
}: ProvidersScreenViewProps) {
  const { t } = useTranslation();
  const [uncontrolledOpen, setUncontrolledOpen] = useState<PanelId | null>(initialOpen);
  const open = openPanel !== undefined ? openPanel : uncontrolledOpen;
  const setOpen = (next: PanelId | null | ((current: PanelId | null) => PanelId | null)) => {
    const resolved = typeof next === 'function' ? next(open) : next;
    if (openPanel === undefined) setUncontrolledOpen(resolved);
    onOpenPanelChange?.(resolved);
  };
  const canNext = languageReady && imageReady && modelReady && mollyAvailable;
  const close = () => setOpen(null);
  const finishLanguage = (outcome?: 'saved' | 'cancelled') => {
    setOpen(outcome === 'saved' && !imageReady ? 'image' : null);
  };
  const finishImage = (outcome?: 'saved' | 'cancelled') => {
    setOpen(outcome === 'saved' && !languageReady ? 'language' : null);
  };
  const toggle = (panel: PanelId) => {
    setOpen((current) => (current === panel ? null : panel));
  };
  const titles: Record<PanelId, string> = {
    language: t('onboarding.models.rows.language.title'),
    image: t('onboarding.models.rows.image.title'),
  };
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
      asideOpen={open !== null}
      aside={
        <>
          {languagePanel ? (
            <PanelCard title={titles.language} hidden={open !== 'language'} onClose={close}>
              {languagePanel(finishLanguage)}
            </PanelCard>
          ) : null}
          {imagePanel ? (
            <PanelCard title={titles.image} hidden={open !== 'image'} onClose={close}>
              {imagePanel(finishImage)}
            </PanelCard>
          ) : null}
        </>
      }
    >
      <div className="space-y-2.5">
        <ConnectRow
          icon={<Type className="h-4 w-4" />}
          title={titles.language}
          summary={languageSummary}
          hint={t('onboarding.models.rows.language.hint')}
          done={languageReady}
          action={t(languageReady ? 'onboarding.models.change' : 'onboarding.models.setUp')}
          active={open === 'language'}
          onOpen={() => toggle('language')}
        />
        <ConnectRow
          icon={<ImageIcon className="h-4 w-4" />}
          title={titles.image}
          summary={imageSummary}
          hint={t('onboarding.models.rows.image.hint')}
          done={imageReady}
          action={t(imageReady ? 'onboarding.models.change' : 'onboarding.models.setUp')}
          active={open === 'image'}
          onOpen={() => toggle('image')}
        />
        {onCatalogRetry ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 pt-2 text-sm"
          >
            <p className="min-w-0 flex-1">{t('onboarding.models.catalogError')}</p>
            <Button size="sm" variant="outline" onClick={onCatalogRetry}>
              {t('common.retry')}
            </Button>
          </div>
        ) : null}
        {!mollyAvailable ? (
          <p role="status" className="pt-2 text-sm">
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
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  const autoOpenedRef = useRef(false);
  const ephemeralOpenAiKeyRef = useRef<string | null>(null);
  const [hasReusableOpenAiKey, setHasReusableOpenAiKey] = useState(false);
  const ipc = useMemo(() => getIpcServices(), []);
  const { t } = useTranslation();

  const clearEphemeralOpenAiKey = useCallback(() => {
    ephemeralOpenAiKeyRef.current = null;
    setHasReusableOpenAiKey(false);
  }, []);

  useEffect(() => clearEphemeralOpenAiKey, [clearEphemeralOpenAiKey]);

  const reusableOpenAiKey = useMemo<ReusableOpenAiKey>(
    () => ({
      available: hasReusableOpenAiKey,
      read: () => ephemeralOpenAiKeyRef.current,
      clear: clearEphemeralOpenAiKey,
    }),
    [clearEphemeralOpenAiKey, hasReusableOpenAiKey]
  );

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

  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (connections === undefined || imageConnection === undefined) return;
    autoOpenedRef.current = true;
    const compactOverlay =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 1080px)').matches;
    const next = resolveInitialAutoOpenPanel({ languageReady, imageReady, compactOverlay });
    if (next) setOpenPanel(next);
  }, [connections, imageConnection, imageReady, languageReady]);

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

  const defaultModel = defaultModelId ? decodeMollyModelOption(defaultModelId) : null;
  const summaryConnection =
    readyConnections.find((connection) => connection.id === defaultModel?.connectionId) ??
    readyConnections[0];
  const languageSummary = summaryConnection
    ? [summaryConnection.displayName, defaultModel?.modelId].filter(Boolean).join(' · ')
    : undefined;

  const handleSkip = () => {
    clearEphemeralOpenAiKey();
    props.onSkip();
  };

  const handleNext = () => {
    if (!mollyConfig || !defaultModelId) return;
    clearEphemeralOpenAiKey();
    // Bind the first session so the landing composer needs no second pick:
    // the connected LLM's first offered model, reasoning = high when offered.
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
      onSkip={handleSkip}
      onNext={handleNext}
      openPanel={openPanel}
      onOpenPanelChange={(next) => {
        autoOpenedRef.current = true;
        setOpenPanel(next);
      }}
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
      languageSummary={languageSummary}
      imageSummary={
        imageConnection ? (
          <>
            <span className="shrink-0">{t(imageProtocolLabelKey(imageConnection))}</span>
            <span aria-hidden>·</span>
            <span className="min-w-0 font-mono break-all" title={imageConnection.model}>
              {imageConnection.model}
            </span>
          </>
        ) : undefined
      }
      languagePanel={(done) => (
        <ModelConnectionSetting
          variant="panel"
          surface="onboarding"
          onConnectionsChange={setConnections}
          onSavedOpenAiDefaultKey={(apiKey) => {
            ephemeralOpenAiKeyRef.current = apiKey;
            setHasReusableOpenAiKey(true);
          }}
          onOpenAiConnectionChanged={clearEphemeralOpenAiKey}
          onDone={done}
        />
      )}
      imagePanel={(done) => (
        <ImageConnectionSetting
          variant="panel"
          surface="onboarding"
          reusableOpenAiKey={reusableOpenAiKey}
          onConnectionChange={setImageConnection}
          onDone={done}
        />
      )}
    />
  );
}
