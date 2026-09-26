import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Globe2, Loader2, ShieldAlert } from 'lucide-react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { ElectronBrowserAccountSiteInputSchema } from '@molly/shared/electron-ipc';
import {
  BrowserAddressError,
  formatPreviewTargetUrl,
  getSessionPreviewLegacyFields,
  parseBrowserAddress,
  type BrowserAddress,
  type ElectronPublicBrowserState,
  type ManagedBrowserCommand,
  type ManagedBrowserStateMessage,
  type PreviewTarget,
  type SessionMeta,
  type SessionPreviewDocState,
  type SessionPreviewEndpoint,
  type VisualAnnotationReferencePayload,
} from '@molly/shared';

import {
  activeWorkspaceRuntimeAtom,
  currentWorkspaceSlugAtom,
  settingsActiveTabAtom,
  settingsDialogOpenAtom,
  userAtom,
} from '@/atoms';
import { Button } from '@/ui/button';
import { isElectronRenderer } from '@/lib/electron';
import { useIsMobile } from '@/hooks/use-mobile';
import { getPlatform } from '@/lib/commands/platform';
import { getPublicBrowserBridge } from '@/lib/electron-ipc-client';
import { useSessionDoc } from '@/hooks/use-session-doc';
import { samePreviewTargetOrigin } from '@/lib/session-browser-url';
import { cn } from '@/lib/utils';
import { ManagedPreviewSurface } from './managed-preview-surface';
import { PublicBrowserSurface } from './public-browser-surface';
import {
  readSessionBrowserResumeState,
  rememberSessionBrowserResumeState,
  type SessionBrowserNavigationHistory,
} from './session-browser-resume-state';
import { clearManagedPreviewFrame } from './managed-preview-frame-cache';
import { SessionBrowserToolbar } from './session-browser-toolbar';

type SessionBrowserPanelProps = {
  session: SessionMeta;
  active?: boolean;
  className?: string;
  leadingSlot?: ReactNode;
  candidateNavigationRequestId?: number;
  onCandidateNavigationRequestHandled?: (requestId: number) => void;
  visualAnnotationReferenceKeys?: readonly string[];
  onAddVisualAnnotationToChat?: (reference: VisualAnnotationReferencePayload) => boolean | void;
  onToggleVisualAnnotationInChat?: (reference: VisualAnnotationReferencePayload) => boolean | void;
};

type ManagedNavigationPhase = 'resolving-machine' | 'opening-local';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function SessionBrowserPanel(props: SessionBrowserPanelProps) {
  return <SessionBrowserPanelController key={props.session.id} {...props} />;
}

function SessionBrowserPanelController({
  session,
  active = true,
  className,
  leadingSlot,
  candidateNavigationRequestId = 0,
  onCandidateNavigationRequestHandled,
  visualAnnotationReferenceKeys,
  onAddVisualAnnotationToChat,
  onToggleVisualAnnotationInChat,
}: SessionBrowserPanelProps) {
  const { t } = useTranslation();
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const workspaceSlug = useAtomValue(currentWorkspaceSlugAtom);
  const user = useAtomValue(userAtom);
  const isMobile = useIsMobile();
  const routeNavigate = useNavigate();
  const setSettingsTab = useSetAtom(settingsActiveTabAtom);
  const setSettingsOpen = useSetAtom(settingsDialogOpenAtom);
  const sessionDoc = useSessionDoc(session.id);
  const legacyPreview = getSessionPreviewLegacyFields(session);
  const suggestedAddress = useMemo(() => {
    const preview = sessionDoc.doc.preview as SessionPreviewDocState | undefined;
    const candidate = preview?.candidate ?? legacyPreview.previewCandidate;
    return candidate?.status === 'available' && candidate.target
      ? formatPreviewTargetUrl(candidate.target)
      : '';
  }, [legacyPreview.previewCandidate, sessionDoc.doc.preview]);
  // Session meta carries only the candidate STATUS; its target lives in the
  // session doc `preview` state. The two planes sync independently, so a click
  // can land after the status is visible but before the doc write arrives.
  const metaCandidateAvailable = session.previewCandidate?.status === 'available';

  const [address, setAddress] = useState(suggestedAddress);
  const [currentAddress, setCurrentAddress] = useState<BrowserAddress | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [, setLocalEndpoint] = useState<SessionPreviewEndpoint | null>(null);
  const localEndpointRef = useRef<SessionPreviewEndpoint | null>(null);
  const [history, setHistory] = useState<SessionBrowserNavigationHistory>({
    entries: [],
    index: -1,
  });
  const [publicState, setPublicState] = useState<ElectronPublicBrowserState | null>(null);
  const publicAddressRef = useRef<string | null>(null);
  const [publicNavigationRequestId, setPublicNavigationRequestId] = useState<number | null>(null);
  const [annotationEnabled, setAnnotationEnabled] = useState(false);
  const [annotationAvailable, setAnnotationAvailable] = useState(false);
  const [managedLoading, setManagedLoading] = useState(false);
  const [managedState, setManagedState] = useState<ManagedBrowserStateMessage['payload'] | null>(
    null
  );
  const [managedCommand, setManagedCommand] = useState<{
    id: number;
    action: ManagedBrowserCommand;
  }>();
  const [busy, setBusy] = useState(false);
  const [managedNavigationPhase, setManagedNavigationPhase] =
    useState<ManagedNavigationPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resumeAddress, setResumeAddress] = useState<BrowserAddress | null>(null);
  const navigationSequenceRef = useRef(0);
  const restoreAttemptKeyRef = useRef<string | null>(null);
  const handledCandidateNavigationRequestRef = useRef(0);

  const releaseLocalEndpoint = useCallback(async () => {
    const endpoint = localEndpointRef.current;
    localEndpointRef.current = null;
    setLocalEndpoint(null);
    if (!endpoint) return;
    if (!runtime) {
      console.error('Cannot release managed preview endpoint because the runtime is unavailable', {
        endpointId: endpoint.endpointId,
        sessionId: session.id,
      });
      return;
    }
    const response = await runtime.requestSessionPreviewEndpointRelease(
      session.machineId,
      session.id,
      endpoint.endpointId
    );
    if (!response?.success) {
      console.error('Failed to release managed preview endpoint', {
        endpointId: endpoint.endpointId,
        sessionId: session.id,
        response,
      });
    }
  }, [runtime, session.id, session.machineId]);

  // A cached frame keeps its viewer URL — and the capability token in it — alive
  // in this renderer. Once an address is open without a managed viewer URL, that
  // capability is no longer the session's current one, so the frame must go.
  // Derived from state rather than cleared at each release site.
  useEffect(() => {
    if (!currentAddress || viewerUrl) return;
    clearManagedPreviewFrame(session.id);
  }, [currentAddress, session.id, viewerUrl]);

  useEffect(() => {
    const resumeState = readSessionBrowserResumeState(session.id);
    navigationSequenceRef.current += 1;
    localEndpointRef.current = null;
    restoreAttemptKeyRef.current = null;
    handledCandidateNavigationRequestRef.current = 0;
    setAddress(resumeState?.currentAddress.logicalUrl ?? '');
    setCurrentAddress(null);
    setViewerUrl(null);
    setLocalEndpoint(null);
    setHistory(resumeState?.history ?? { entries: [], index: -1 });
    setPublicState(null);
    publicAddressRef.current = null;
    setPublicNavigationRequestId(null);
    setManagedState(null);
    setManagedCommand(undefined);
    setAnnotationEnabled(false);
    setAnnotationAvailable(false);
    setBusy(false);
    setManagedNavigationPhase(null);
    setError(null);
    setResumeAddress(resumeState?.currentAddress ?? null);
  }, [session.id]);

  useEffect(() => {
    if (suggestedAddress && !address && !currentAddress) setAddress(suggestedAddress);
  }, [address, currentAddress, suggestedAddress]);

  useEffect(() => {
    if (!currentAddress) return;
    rememberSessionBrowserResumeState(session.id, { currentAddress, history });
  }, [currentAddress, history, session.id]);

  // Local previews require the Electron bridge and a session on this host.
  const resolveMachinePlane = useCallback(
    async (workspaceRuntime: NonNullable<typeof runtime>): Promise<'local' | 'cloud'> =>
      isElectronRenderer()
        ? await workspaceRuntime.resolveMachineTargetPlane(session.machineId)
        : 'cloud',
    [session.machineId]
  );

  const commitHistory = useCallback((logicalUrl: string, historyIndex?: number) => {
    setHistory((current) => {
      if (historyIndex !== undefined) return { ...current, index: historyIndex };
      if (current.entries[current.index] === logicalUrl) return current;
      if (current.index > 0 && current.entries[current.index - 1] === logicalUrl) {
        return { ...current, index: current.index - 1 };
      }
      if (
        current.index >= 0 &&
        current.index < current.entries.length - 1 &&
        current.entries[current.index + 1] === logicalUrl
      ) {
        return { ...current, index: current.index + 1 };
      }
      const entries = [...current.entries.slice(0, current.index + 1), logicalUrl].slice(-50);
      return { entries, index: entries.length - 1 };
    });
  }, []);

  const commitOpenedAddress = useCallback(
    (next: BrowserAddress, nextViewerUrl: string | null, historyIndex?: number) => {
      publicAddressRef.current = next.engine === 'public-web' ? next.logicalUrl : null;
      setCurrentAddress(next);
      setAddress(next.logicalUrl);
      setViewerUrl(nextViewerUrl);
      setAnnotationEnabled(false);
      setAnnotationAvailable(false);
      setManagedState(null);
      setError(null);
      commitHistory(next.logicalUrl, historyIndex);
    },
    [commitHistory]
  );

  const openAddress = useCallback(
    async (
      next: BrowserAddress,
      options?: {
        historyIndex?: number;
        restore?: boolean;
        /** The destination came from page content, not from the person. */
        fromPageContent?: boolean;
      }
    ) => {
      const sequence = ++navigationSequenceRef.current;
      setError(null);
      // A page inside Managed Preview is served by the agent machine, so a navigation
      // request it posts up is agent-authored, not a user gesture. Public destinations
      // are ordinary external links, and loopback still lands in the managed branch
      // below where it needs its own approval — but a private-LAN address would open
      // silently in the user's own browser, on the user's own network, which no page
      // has any business asking for. Only the address bar can reach one.
      if (options?.fromPageContent && next.targetClass === 'private-lan') {
        setError(
          t(
            'sessions.browser.errors.pagePrivateNetworkBlocked',
            'The page asked to open a private network address. Only you can enter one, from the address bar.'
          )
        );
        return;
      }
      if (next.engine === 'public-web') {
        await releaseLocalEndpoint();
        if (sequence !== navigationSequenceRef.current) return;
        commitOpenedAddress(next, null, options?.historyIndex);
        setPublicNavigationRequestId((current) => (options?.restore ? null : (current ?? 0) + 1));
        return;
      }
      if (!next.target) {
        setError('Managed preview address did not include a target.');
        return;
      }
      const managedAddress = next as BrowserAddress & {
        engine: 'managed-preview';
        target: PreviewTarget;
      };
      if (!runtime || !user?.id) {
        setError(
          t(
            'sessions.browser.errors.runtimeUnavailable',
            'The session runtime is unavailable. The page was not opened.'
          )
        );
        return;
      }
      setManagedNavigationPhase('resolving-machine');
      let resolvedPlane: 'local' | 'cloud';
      try {
        resolvedPlane = await resolveMachinePlane(runtime);
      } catch (routeError) {
        setError(
          t(
            'sessions.browser.errors.machineIdentityUnavailable',
            'The desktop client could not resolve the session machine route: {{error}}',
            { error: errorMessage(routeError) }
          )
        );
        setManagedNavigationPhase(null);
        return;
      }
      if (sequence !== navigationSequenceRef.current) return;
      if (resolvedPlane !== 'local' || !isElectronRenderer()) {
        setError(t('sessions.browser.localOnly', 'Remote host previews are unavailable.'));
        setManagedNavigationPhase(null);
        return;
      }
      setBusy(true);
      setManagedNavigationPhase('opening-local');
      try {
        const previousEndpoint = localEndpointRef.current;
        const response = await runtime.requestSessionPreviewEndpointAcquire(
          session.machineId,
          session.id,
          user.id,
          managedAddress.target
        );
        if (sequence !== navigationSequenceRef.current) {
          if (response?.success && response.endpoint) {
            void runtime.requestSessionPreviewEndpointRelease(
              session.machineId,
              session.id,
              response.endpoint.endpointId
            );
          }
          return;
        }
        if (!response) {
          setError(t('sessions.browser.errors.timeout', 'Managed preview request timed out.'));
          return;
        }
        if (!response.success || !response.endpoint) {
          setError(
            response.message ??
              t('sessions.browser.errors.localPreviewFailed', 'Local preview could not be opened.')
          );
          return;
        }
        if (
          response.endpoint.kind !== 'local-proxy' ||
          !samePreviewTargetOrigin(response.endpoint.target, managedAddress.target) ||
          response.endpoint.capabilities.visualAnnotation !== true
        ) {
          setError(
            t(
              'sessions.browser.errors.invalidLocalEndpoint',
              'The local preview endpoint did not provide the required annotation capability.'
            )
          );
          void runtime.requestSessionPreviewEndpointRelease(
            session.machineId,
            session.id,
            response.endpoint.endpointId
          );
          return;
        }
        localEndpointRef.current = response.endpoint;
        setLocalEndpoint(response.endpoint);
        if (previousEndpoint && previousEndpoint.endpointId !== response.endpoint.endpointId) {
          void runtime.requestSessionPreviewEndpointRelease(
            session.machineId,
            session.id,
            previousEndpoint.endpointId
          );
        }
        commitOpenedAddress(managedAddress, response.endpoint.viewerUrl, options?.historyIndex);
      } catch (navigationError) {
        if (sequence === navigationSequenceRef.current) {
          setError(
            t('sessions.browser.errors.navigationFailed', 'Page could not be opened') +
              `: ${errorMessage(navigationError)}`
          );
        }
      } finally {
        if (sequence === navigationSequenceRef.current) {
          setManagedNavigationPhase(null);
          setBusy(false);
        }
      }
    },
    [
      commitOpenedAddress,
      releaseLocalEndpoint,
      resolveMachinePlane,
      runtime,
      session.id,
      session.machineId,
      t,
      user?.id,
    ]
  );

  useEffect(() => {
    if (
      !active ||
      currentAddress ||
      busy ||
      managedNavigationPhase !== null ||
      candidateNavigationRequestId > handledCandidateNavigationRequestRef.current
    ) {
      return;
    }

    const next = resumeAddress;
    if (!next) return;

    const restoreKey = `${session.id}:renderer:${next.logicalUrl}`;
    if (restoreAttemptKeyRef.current === restoreKey) return;
    restoreAttemptKeyRef.current = restoreKey;
    setResumeAddress(null);
    void openAddress(next, { restore: true });
  }, [
    active,
    busy,
    candidateNavigationRequestId,
    currentAddress,
    managedNavigationPhase,
    openAddress,
    resumeAddress,
    session.id,
  ]);

  useEffect(() => {
    if (
      !active ||
      candidateNavigationRequestId <= handledCandidateNavigationRequestRef.current ||
      busy ||
      managedNavigationPhase !== null
    ) {
      return;
    }
    if (!suggestedAddress) {
      // Hold the request while a reported candidate is still on its way: meta
      // knows one exists, the doc has not delivered its target yet. Consuming it
      // here would open an empty panel and drop the user's intent for good.
      if (sessionDoc.ready && !(metaCandidateAvailable && !sessionDoc.synced)) {
        handledCandidateNavigationRequestRef.current = candidateNavigationRequestId;
        onCandidateNavigationRequestHandled?.(candidateNavigationRequestId);
      }
      return;
    }

    handledCandidateNavigationRequestRef.current = candidateNavigationRequestId;
    onCandidateNavigationRequestHandled?.(candidateNavigationRequestId);
    try {
      const next = parseBrowserAddress(suggestedAddress);
      void openAddress(next);
    } catch (candidateError) {
      setError(errorMessage(candidateError));
    }
  }, [
    active,
    busy,
    candidateNavigationRequestId,
    managedNavigationPhase,
    metaCandidateAvailable,
    openAddress,
    onCandidateNavigationRequestHandled,
    sessionDoc.ready,
    sessionDoc.synced,
    suggestedAddress,
  ]);

  const navigate = useCallback(() => {
    let parsed: BrowserAddress;
    try {
      parsed = parseBrowserAddress(address);
    } catch (parseError) {
      setError(
        parseError instanceof BrowserAddressError
          ? parseError.message
          : t('sessions.browser.errors.invalidAddress', 'Enter a valid HTTP(S) URL.')
      );
      return;
    }
    void openAddress(parsed);
  }, [address, openAddress, t]);

  const navigateHistory = useCallback(
    (index: number) => {
      const entry = history.entries[index];
      if (!entry) return;
      try {
        void openAddress(parseBrowserAddress(entry), { historyIndex: index });
      } catch (parseError) {
        setError(errorMessage(parseError));
      }
    },
    [history.entries, openAddress]
  );

  const handleBack = useCallback(() => {
    if (
      currentAddress?.engine === 'public-web' &&
      publicState?.canGoBack &&
      getPublicBrowserBridge()
    ) {
      void getPublicBrowserBridge()
        ?.back(`session-browser-${session.id}`)
        .then(
          (result) => {
            if (!result.ok) setError(result.error);
          },
          (commandError: unknown) => setError(errorMessage(commandError))
        );
      return;
    }
    if (currentAddress?.engine === 'managed-preview' && managedState?.canGoBack) {
      setManagedCommand((current) => ({ id: (current?.id ?? 0) + 1, action: 'back' }));
      return;
    }
    navigateHistory(history.index - 1);
  }, [
    currentAddress?.engine,
    history.index,
    managedState?.canGoBack,
    navigateHistory,
    publicState?.canGoBack,
    session.id,
  ]);

  const handleForward = useCallback(() => {
    if (
      currentAddress?.engine === 'public-web' &&
      publicState?.canGoForward &&
      getPublicBrowserBridge()
    ) {
      void getPublicBrowserBridge()
        ?.forward(`session-browser-${session.id}`)
        .then(
          (result) => {
            if (!result.ok) setError(result.error);
          },
          (commandError: unknown) => setError(errorMessage(commandError))
        );
      return;
    }
    if (currentAddress?.engine === 'managed-preview' && managedState?.canGoForward) {
      setManagedCommand((current) => ({ id: (current?.id ?? 0) + 1, action: 'forward' }));
      return;
    }
    navigateHistory(history.index + 1);
  }, [
    currentAddress?.engine,
    history.index,
    managedState?.canGoForward,
    navigateHistory,
    publicState?.canGoForward,
    session.id,
  ]);

  const handleReload = useCallback(() => {
    if (currentAddress?.engine === 'public-web' && getPublicBrowserBridge()) {
      void getPublicBrowserBridge()
        ?.reload(`session-browser-${session.id}`)
        .then(
          (result) => {
            if (!result.ok) setError(result.error);
          },
          (commandError: unknown) => setError(errorMessage(commandError))
        );
      return;
    }
    if (viewerUrl) {
      setManagedLoading(true);
      setManagedCommand((current) => ({ id: (current?.id ?? 0) + 1, action: 'reload' }));
      return;
    }
    if (currentAddress?.engine === 'managed-preview' && currentAddress.target) {
      // The endpoint is gone (released or never acquired): reopen the address.
      void openAddress(currentAddress);
    }
  }, [currentAddress, openAddress, session.id, viewerUrl]);

  const handleStop = useCallback(() => {
    if (currentAddress?.engine === 'public-web' && getPublicBrowserBridge()) {
      void getPublicBrowserBridge()
        ?.stop(`session-browser-${session.id}`)
        .then(
          (result) => {
            if (!result.ok) setError(result.error);
          },
          (commandError: unknown) => setError(errorMessage(commandError))
        );
      return;
    }
    if (currentAddress?.engine === 'managed-preview' && annotationAvailable) {
      setManagedCommand((current) => ({ id: (current?.id ?? 0) + 1, action: 'stop' }));
      setManagedLoading(false);
    }
  }, [annotationAvailable, currentAddress?.engine, session.id]);

  const handlePublicState = useCallback(
    (state: ElectronPublicBrowserState) => {
      setPublicState(state);
      if (state.url) {
        try {
          const parsed = parseBrowserAddress(state.url);
          if (parsed.engine !== 'public-web') {
            setError('Public browser attempted to navigate outside its public-network boundary.');
            return;
          }
          if (publicAddressRef.current !== parsed.logicalUrl) {
            publicAddressRef.current = parsed.logicalUrl;
            setAddress(parsed.logicalUrl);
          }
          setCurrentAddress(parsed);
          commitHistory(parsed.logicalUrl);
        } catch (stateError) {
          setError(errorMessage(stateError));
          return;
        }
      }
      if (state.error) setError(state.error);
      else setError(null);
    },
    [commitHistory]
  );

  // An Agent may create and navigate this page before the Browser panel is
  // opened. Observe that existing page without issuing a second navigation.
  useEffect(() => {
    const bridge = getPublicBrowserBridge();
    if (!bridge) return undefined;
    const browserId = `session-browser-${session.id}`;
    let live = true;
    const off = bridge.onState((state) => {
      if (live && state.browserId === browserId) handlePublicState(state);
    });
    void bridge.getState(browserId).then(
      (state) => {
        if (live && state) handlePublicState(state);
      },
      (stateError: unknown) => {
        if (live) setError(errorMessage(stateError));
      }
    );
    return () => {
      live = false;
      off();
    };
  }, [handlePublicState, session.id]);

  const handleManagedState = useCallback(
    (state: ManagedBrowserStateMessage['payload']) => {
      setManagedState(state);
      setAddress(state.url);
      try {
        const parsed = parseBrowserAddress(state.url);
        if (parsed.engine !== 'managed-preview') {
          setError('Managed preview attempted to navigate outside its private-network boundary.');
          return;
        }
        setCurrentAddress(parsed);
        commitHistory(parsed.logicalUrl);
        setError(null);
      } catch (stateError) {
        setError(errorMessage(stateError));
      }
    },
    [commitHistory]
  );

  const handleManagedNavigationRequest = useCallback(
    (url: string) => {
      try {
        void openAddress(parseBrowserAddress(url), { fromPageContent: true });
      } catch (navigationError) {
        setError(errorMessage(navigationError));
      }
    },
    [openAddress]
  );

  const loading =
    currentAddress?.engine === 'public-web' ? publicState?.phase === 'loading' : managedLoading;
  const publicHost =
    currentAddress?.engine === 'public-web'
      ? new URL(currentAddress.logicalUrl).hostname.toLowerCase()
      : '';
  const importSite = isElectronRenderer()
    ? ElectronBrowserAccountSiteInputSchema.shape.site.options.find(
        (site) => publicHost === site || publicHost.endsWith(`.${site}`)
      )
    : undefined;

  const openAccountSettings = () => {
    if (isMobile && workspaceSlug) {
      void routeNavigate({
        to: '/$workspaceName/settings/browser-accounts',
        params: { workspaceName: workspaceSlug },
      });
      return;
    }
    setSettingsTab('browser-accounts');
    setSettingsOpen(true);
  };
  const changeAgentBrowserControl = async (take: boolean) => {
    const bridge = getPublicBrowserBridge();
    if (!bridge) return;
    try {
      const result = take
        ? await bridge.takeAgentControl(`session-browser-${session.id}`)
        : await bridge.resumeAgentControl(`session-browser-${session.id}`);
      if (!result.ok) throw new Error(result.error);
    } catch (controlError) {
      setError(errorMessage(controlError));
    }
  };
  const navigationBusy = busy || managedNavigationPhase !== null;
  const canGoBack =
    (currentAddress?.engine === 'public-web' && publicState?.canGoBack === true) ||
    (currentAddress?.engine === 'managed-preview' && managedState?.canGoBack === true) ||
    history.index > 0;
  const canGoForward =
    (currentAddress?.engine === 'public-web' && publicState?.canGoForward === true) ||
    (currentAddress?.engine === 'managed-preview' && managedState?.canGoForward === true) ||
    (history.index >= 0 && history.index < history.entries.length - 1);

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-background', className)}>
      <SessionBrowserToolbar
        leadingSlot={leadingSlot}
        focusAddress={active && currentAddress === null}
        address={address}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        loading={loading}
        annotationEnabled={annotationEnabled}
        annotationAvailable={annotationAvailable}
        busy={navigationBusy}
        onAddressChange={setAddress}
        onRestoreAddress={() => setAddress(currentAddress?.logicalUrl ?? suggestedAddress)}
        onNavigate={navigate}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        onStop={handleStop}
        onToggleAnnotation={() => setAnnotationEnabled((current) => !current)}
      />
      {currentAddress?.engine === 'public-web' && publicState?.agentControl === 'agent' ? (
        <div className="border-b px-3 py-2 text-xs">
          <span className="mr-2">
            {t('sessions.browser.agentControlling', 'Agent is controlling this page.')}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void changeAgentBrowserControl(true)}
          >
            {t('sessions.browser.takeControl', 'Take control')}
          </Button>
        </div>
      ) : null}
      {currentAddress?.engine === 'public-web' && publicState?.agentControl === 'human-takeover' ? (
        <div className="border-b px-3 py-2 text-xs">
          <span className="mr-2">
            {t(
              'sessions.browser.humanControlling',
              'Agent page access is paused while you control this page.'
            )}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void changeAgentBrowserControl(false)}
          >
            {t('sessions.browser.resumeAgent', 'Resume Agent')}
          </Button>
        </div>
      ) : null}
      {importSite ? (
        <div className="border-b px-3 py-2 text-xs">
          <p className="mb-2 text-muted-foreground">
            {t(
              'sessions.browser.accountChoices',
              'Use this site anonymously, sign in on the page, or import its Chrome cookies in Molly settings. The Agent pauses while you take control.'
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {getPlatform() === 'mac' ? (
              <Button type="button" variant="outline" size="sm" onClick={openAccountSettings}>
                {t('sessions.browser.importChrome', 'Import from Chrome in Molly settings')}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={openAccountSettings}>
              {t('sessions.browser.manageAccounts', 'Manage website accounts')}
            </Button>
          </div>
          {publicState?.accountImport?.site === importSite ? (
            <p className="mt-2 text-muted-foreground">
              {t(
                'sessions.browser.cookiesImported',
                'Molly now stores {{count}} cookies for this site. Check the website to verify sign-in.',
                { count: publicState.accountImport.imported }
              )}
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive"
        >
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2"
            onClick={() => setError(null)}
          >
            {t('common.dismiss', 'Dismiss')}
          </Button>
        </div>
      ) : null}

      {managedNavigationPhase ? (
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-0 flex-1 items-center justify-center gap-2 bg-background text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>
            {managedNavigationPhase === 'resolving-machine'
              ? t('sessions.browser.resolvingMachine', 'Resolving the session machine…')
              : t('sessions.browser.openingLocal', 'Opening the local preview…')}
          </span>
        </div>
      ) : currentAddress?.engine === 'public-web' ? (
        <PublicBrowserSurface
          browserId={`session-browser-${session.id}`}
          url={currentAddress.logicalUrl}
          navigationRequestId={publicNavigationRequestId}
          active={active && !error}
          onStateChange={handlePublicState}
        />
      ) : currentAddress?.engine === 'managed-preview' && viewerUrl ? (
        <ManagedPreviewSurface
          session={session}
          viewerUrl={viewerUrl}
          annotationEnabled={annotationEnabled}
          logicalUrl={currentAddress.logicalUrl}
          command={managedCommand}
          visualAnnotationReferenceKeys={visualAnnotationReferenceKeys}
          onAnnotationAvailabilityChange={setAnnotationAvailable}
          onRuntimeError={setError}
          onLoadingChange={setManagedLoading}
          onBrowserStateChange={handleManagedState}
          onNavigationRequest={handleManagedNavigationRequest}
          onAddVisualAnnotationToChat={onAddVisualAnnotationToChat}
          onToggleVisualAnnotationInChat={onToggleVisualAnnotationInChat}
        />
      ) : (
        // An empty Browser is ambiguous on its own: the user cannot tell whether
        // the agent never reported a dev server, or the panel is broken. Say which.
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-background px-6 text-center">
          <Globe2 className="h-7 w-7 text-muted-foreground/60" aria-hidden />
          <p className="max-w-xs text-xs text-muted-foreground">
            {suggestedAddress
              ? t('sessions.browser.emptyWithCandidate', 'Press Enter to open {{url}}', {
                  url: suggestedAddress,
                })
              : t(
                  'sessions.browser.emptyNoCandidate',
                  'No preview address reported yet. Enter a URL above, or ask the agent to report its dev server.'
                )}
          </p>
        </div>
      )}
    </div>
  );
}
