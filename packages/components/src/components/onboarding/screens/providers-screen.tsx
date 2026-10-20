import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import {
  decodeMollyModelOption,
  type HarnessModelCatalog,
  type ModelConnection,
  type ProtectedImageConnection,
} from '@molly/shared/embedded-harness';
import { Button } from '@/ui/button';
import { ArrowLeft, Check, Globe, Image as ImageIcon, Type, X } from '@/ui/icons';
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
} from '@/components/settings/image-connection-setting';
import { BrowserAccountImportPanel } from '@/components/settings/browser-account-import-dialog';
import { getIpcServices, getPublicBrowserBridge } from '@/lib/electron-ipc-client';
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

type PanelId = 'language' | 'image' | 'browser';

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
  /** Websites with saved sign-ins; browser sign-ins never gate Finish. */
  browserSummary?: string;
  /** Panels receive `close`; the language and image panels stay mounted while closed. */
  languagePanel?: (close: () => void) => ReactNode;
  imagePanel?: (close: () => void) => ReactNode;
  browserPanel?: (close: () => void) => ReactNode;
  /** Called after the browser panel closes, so its row can re-read what was imported. */
  onBrowserPanelClosed?: () => void;
};

function ConnectRow({
  icon,
  title,
  summary,
  hint,
  done,
  optional,
  action,
  active,
  onOpen,
}: {
  icon: ReactNode;
  title: string;
  summary?: ReactNode;
  hint: string;
  done: boolean;
  optional?: boolean;
  action: string;
  active: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
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
        <span className="flex items-center gap-2 text-sm font-medium text-[#141413]">
          {title}
          {optional ? (
            <span className="rounded-full bg-[#141413]/[0.06] px-2 py-0.5 text-[11px] font-normal text-[#6b6963]">
              {t('onboarding.models.optional')}
            </span>
          ) : null}
        </span>
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
      className="rounded-2xl border border-[#141413]/10 bg-[#fbfaf7] p-6 shadow-[0_18px_48px_-28px_rgba(20,20,19,0.35)]"
    >
      <div className="mb-5 flex items-center gap-2">
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
        <h2 className="flex-1 text-base font-medium text-[#141413] max-[1080px]:sr-only">
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
      {children}
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
  browserSummary,
  languagePanel,
  imagePanel,
  browserPanel,
  onBrowserPanelClosed,
  onBack,
  onSkip,
  onNext,
}: ProvidersScreenViewProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<PanelId | null>(null);
  const canNext = languageReady && imageReady && modelReady && mollyAvailable;
  const close = () => {
    if (open === 'browser') onBrowserPanelClosed?.();
    setOpen(null);
  };
  const toggle = (panel: PanelId) => {
    if (open === 'browser' && panel !== 'browser') onBrowserPanelClosed?.();
    setOpen((current) => (current === panel ? null : panel));
  };
  const titles: Record<PanelId, string> = {
    language: t('onboarding.models.rows.language.title'),
    image: t('onboarding.models.rows.image.title'),
    browser: t('onboarding.models.rows.browser.title'),
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
              {languagePanel(close)}
            </PanelCard>
          ) : null}
          {imagePanel ? (
            <PanelCard title={titles.image} hidden={open !== 'image'} onClose={close}>
              {imagePanel(close)}
            </PanelCard>
          ) : null}
          {browserPanel && open === 'browser' ? (
            <PanelCard title={titles.browser} onClose={close}>
              {browserPanel(close)}
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
        <ConnectRow
          icon={<Globe className="h-4 w-4" />}
          title={titles.browser}
          summary={browserSummary}
          hint={t('onboarding.models.rows.browser.hint')}
          done={browserSummary !== undefined}
          optional
          action={t('onboarding.models.import')}
          active={open === 'browser'}
          onOpen={() => toggle('browser')}
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
  const ipc = useMemo(() => getIpcServices(), []);
  const { t } = useTranslation();
  const [savedSites, setSavedSites] = useState<number>();

  const readSavedSites = useCallback(() => {
    const bridge = getPublicBrowserBridge();
    if (!bridge) return;
    void bridge.getAccountSummary().then(
      (summary) => setSavedSites(summary.sites.filter((site) => site.cookieCount > 0).length),
      (error: unknown) => console.error('Failed to read saved browser sign-ins', error)
    );
  }, []);
  useEffect(readSavedSites, [readSavedSites]);

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

  const defaultModel = defaultModelId ? decodeMollyModelOption(defaultModelId) : null;
  const summaryConnection =
    readyConnections.find((connection) => connection.id === defaultModel?.connectionId) ??
    readyConnections[0];
  const languageSummary = summaryConnection
    ? [summaryConnection.displayName, defaultModel?.modelId].filter(Boolean).join(' · ')
    : undefined;

  const handleNext = () => {
    if (!mollyConfig || !defaultModelId) return;
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
      languageSummary={languageSummary}
      imageSummary={
        imageConnection
          ? (
              <>
                <span className="shrink-0">{t(imageProtocolLabelKey(imageConnection))}</span>
                <span aria-hidden>·</span>
                <span className="min-w-0 font-mono break-all" title={imageConnection.model}>
                  {imageConnection.model}
                </span>
              </>
            )
          : undefined
      }
      browserSummary={
        savedSites ? t('onboarding.models.rows.browser.saved', { count: savedSites }) : undefined
      }
      languagePanel={(close) => (
        <ModelConnectionSetting
          variant="panel"
          onConnectionsChange={setConnections}
          onDone={close}
        />
      )}
      imagePanel={(close) => (
        <ImageConnectionSetting
          variant="panel"
          onConnectionChange={setImageConnection}
          onDone={close}
        />
      )}
      browserPanel={(close) => <BrowserAccountImportPanel onClose={close} />}
      onBrowserPanelClosed={readSavedSites}
    />
  );
}
