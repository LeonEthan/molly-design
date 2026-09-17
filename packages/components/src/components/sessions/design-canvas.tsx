import { useConversationIndexRows } from '@/hooks/use-conversation-view';
import type { DesignElementReference } from '@molly/shared/design-element-reference';
import type {
  DesignSelectionAction,
  DesignSelectionSummary,
} from '@molly/shared/design-selection-commands';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getSessionRoomId, type SessionId } from '@molly/shared';
import { activeWorkspaceRuntimeAtom } from '@/atoms/runtime';
import { localProbeResultAtom } from '@/atoms/local-probe';
import { userAtom, currentWorkspaceIdAtom } from '@/atoms';
import { getIpcServices, onIpcEvent, type IpcServices } from '@/lib/electron-ipc-client';
import { latestCommittedDesignReceipt, syncOpenDesignCanvas } from '@/lib/design-canvas-sync';
import { useSessionDoc } from '@/hooks/use-session-doc';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip';
import {
  Check,
  Copy,
  Download,
  History,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { sessionLiveStatusAtomFamily } from '@/atoms/presence';
import { writeStoredLastActiveTabState } from '@/lib/session-draft-tabs';

type Association = {
  sessionId: string;
  name: string;
  userId: string;
  machineId: string;
  createdAt: string;
};
/**
 * Modal overlays hide the native canvas view so they never render beneath it.
 * Legacy marked canvas overlays opt out; native property popups stay in Bento.
 * Blocking requires the overlay to actually intersect the canvas host: the
 * sidebar session hover card and similar surfaces portal to <body> far away
 * from the canvas, and hiding the canvas under them leaves a blank panel.
 */
const hasCanvasBlockingOverlay = (host: HTMLElement) => {
  const hostRect = host.getBoundingClientRect();
  const overlays = document.querySelectorAll(
    '[role="dialog"]:not([data-design-canvas-overlay]), [role="listbox"]:not([data-design-canvas-overlay]), [role="menu"]:not([data-design-canvas-overlay])'
  );
  for (const overlay of overlays) {
    const rect = overlay.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (
      rect.left < hostRect.right &&
      rect.right > hostRect.left &&
      rect.top < hostRect.bottom &&
      rect.bottom > hostRect.top
    )
      return true;
  }
  return false;
};
export function useDesignCreation(workspaceSlug: string) {
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const user = useAtomValue(userAtom);
  const machine = useAtomValue(localProbeResultAtom);
  const navigate = useNavigate();
  const pending = useRef<Association | null>(null);
  usePendingDesignRecovery();
  return async (
    name: string,
    width: number,
    height: number,
    source?: string,
    sourceHostId?: string
  ) => {
    const service = getIpcServices()?.design;
    if (!service || !runtime || !user || !machine?.machineId)
      throw Error('Local workspace is not ready');
    const association = pending.current ?? {
      sessionId: crypto.randomUUID(),
      name,
      userId: user.id,
      machineId: machine.machineId,
      createdAt: new Date().toISOString(),
    };
    pending.current = association;
    const saved = source
      ? await service.copy(source, association, sourceHostId)
      : await service.create({ association, width, height });
    await runtime.writer.upsertDocMeta(getSessionRoomId(association.sessionId as SessionId), {
      id: association.sessionId,
      machineId: association.machineId,
      userId: association.userId,
      title: saved.association.name,
      titleSource: 'user',
      createdAt: association.createdAt,
      isArchived: false,
      cliType: 'builtin',
      agentType: '',
      design: { artworkId: association.sessionId, path: 'design.json' },
    });
    writeStoredLastActiveTabState(association.sessionId as SessionId, {
      sessionTabId: association.sessionId,
      viewerTab: null,
      sidePanel: { open: true, tab: 'design', tabs: ['design'], sideSessionId: null },
    });
    await service.acknowledge(association.sessionId);
    pending.current = null;
    if (source) await service.finishCopy(source, association.sessionId, sourceHostId);
    await navigate({
      to: '/$workspaceName/sessions/$sessionId',
      params: { workspaceName: workspaceSlug, sessionId: association.sessionId },
    });
  };
}
export function DesignCanvas({
  sessionId,
  active,
  workspaceSlug,
  name,
  onReferenceSelection,
  onSyncSelection,
}: {
  sessionId: string;
  active: boolean;
  workspaceSlug: string;
  name: string;
  onReferenceSelection?: (reference: DesignElementReference, prompt?: string) => void;
  /** Passive mirror of the live canvas selection into the composer chip. */
  onSyncSelection?: (reference: DesignElementReference | null, label: string) => void;
}) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  // Native-view host key, stable per artwork (NOT per mount). The main process
  // keeps hidden canvas views alive keyed by this id, so a remount must reuse
  // the live view — a fresh random id spawns a second WebContentsView, reloads
  // the document (selection ring, zoom and toolbar all reset) and leaks the old
  // view, which hide only hides. Preview surfaces are namespaced separately in
  // the main process and reuse the same key without collision.
  const hostId = sessionId;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const create = useDesignCreation(workspaceSlug);
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState<DesignSelectionSummary | null>(null);
  const selectionCount = selection?.count ?? 0;
  const [preview, setPreview] = useState(false);
  const [historyVersion, setHistoryVersion] = useState<string>();
  const [historyReady, setHistoryReady] = useState(false);
  const [versions, setVersions] = useState<Awaited<ReturnType<IpcServices['design']['versions']>>>(
    []
  );
  const versionsGeneration = useRef(0);
  const liveStatus = useAtomValue(sessionLiveStatusAtomFamily(sessionId as SessionId));
  const previousLiveState = useRef({ sessionId, running: false });
  const readonlyView = preview || historyVersion !== undefined;
  useEffect(() => {
    const running = liveStatus != null;
    const previous = previousLiveState.current;
    const started = running && (previous.sessionId !== sessionId || !previous.running);
    previousLiveState.current = { sessionId, running };
    if (started && !preview && historyVersion === undefined) setPreview(true);
  }, [sessionId, liveStatus, preview, historyVersion]);
  const refreshVersions = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      const generation = ++versionsGeneration.current;
      const service = getIpcServices()?.design;
      if (!service) throw Error('Local workspace is not ready');
      const result = await service.versions(sessionId);
      if (isCurrent() && generation === versionsGeneration.current) setVersions(result);
    },
    [sessionId]
  );
  useEffect(() => {
    let cancelled = false;
    if (active)
      void refreshVersions(() => !cancelled).catch((cause) => {
        if (!cancelled) setError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [active, refreshVersions]);
  const [previewStatus, setPreviewStatus] = useState<'waiting' | 'ready' | 'refreshing'>('waiting');
  const [previewSource, setPreviewSource] = useState('');
  const [previewIdentity, setPreviewIdentity] = useState<string>();
  const [previewError, setPreviewError] = useState('');
  const [automaticError, setAutomaticError] = useState('');
  const previewGeneration = useRef(0);
  const viewChoiceGeneration = useRef(0);
  const observedReceipt = useRef<
    { value: string | undefined; pending: boolean; choice: number } | undefined
  >(undefined);
  const attachmentGeneration = useRef(0);
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const machine = useAtomValue(localProbeResultAtom);
  const refreshPreview = useCallback(async () => {
    const generation = ++previewGeneration.current;
    setPreviewStatus('refreshing');
    setPreviewError('');
    try {
      const service = getIpcServices()?.design;
      if (!service || !workspaceId || !machine?.machineId)
        throw Error('Local workspace is not ready');
      const result = await service.refreshPreview(sessionId, hostId, {
        machineId: machine.machineId,
        workspaceId,
        ownerSessionId: sessionId as SessionId,
        method: 'design/source-path',
        params: {},
      });
      if (generation !== previewGeneration.current || result.status === 'superseded') return;
      setPreviewSource(result.source);
      setPreviewIdentity(result.sourceIdentity);
      setPreviewStatus(result.status);
      if (result.status === 'waiting') setPreviewError(result.error ?? '');
      setAutomaticError(result.automaticError ?? '');
      if (host.current && !hasCanvasBlockingOverlay(host.current)) {
        const { x, y, width, height } = host.current.getBoundingClientRect();
        await service.attachPreview(hostId, { x, y, width, height });
      }
    } catch (cause) {
      if (generation !== previewGeneration.current) return;
      setPreviewStatus('waiting');
      setPreviewError(String(cause));
    }
  }, [workspaceId, machine?.machineId, sessionId, hostId]);
  const switchPreview = (value: boolean) => {
    if (value === preview && historyVersion === undefined) return;
    setHistoryVersion(undefined);
    ++viewChoiceGeneration.current;
    ++previewGeneration.current;
    setPreview(value);
    if (!value) void getIpcServices()?.design.hidePreview(hostId);
  };
  useEffect(() => {
    if (preview && active) void refreshPreview();
    else {
      ++previewGeneration.current;
      void getIpcServices()?.design.hidePreview(hostId);
    }
  }, [preview, active, sessionId, hostId, refreshPreview]);
  useEffect(
    () => () => {
      ++previewGeneration.current;
      void getIpcServices()?.design.closePreview(hostId);
    },
    [hostId, sessionId]
  );
  useEffect(() => {
    if (!historyVersion || !active) return undefined;
    let cancelled = false;
    const generation = ++previewGeneration.current;
    setHistoryReady(false);
    const service = getIpcServices()?.design;
    if (!service) return undefined;
    void service
      .viewVersion(sessionId, hostId, historyVersion)
      .then(async (result) => {
        if (cancelled || generation !== previewGeneration.current || result.status === 'superseded')
          return;
        if (result.status !== 'ready') throw Error(result.error ?? 'Version could not render');
        setHistoryReady(true);
        if (host.current && !hasCanvasBlockingOverlay(host.current)) {
          const { x, y, width, height } = host.current.getBoundingClientRect();
          await service.attachPreview(hostId, { x, y, width, height });
        }
      })
      .catch((cause) => {
        if (!cancelled && generation === previewGeneration.current) setError(String(cause));
      });
    return () => {
      cancelled = true;
      void service.hidePreview(hostId);
    };
  }, [historyVersion, active, sessionId, hostId]);
  const { history: conversationView, synced } = useSessionDoc(sessionId as SessionId, {
    enabled: sessionId.length > 0,
  });
  const designHistory = useConversationIndexRows(conversationView);
  const finalized = designHistory
    ?.filter(
      (entry) => entry.role === 'assistant' && (entry.finished || typeof entry.endedAt === 'number')
    )
    .map((entry) => `${entry.id}:${entry.endedAt}:${JSON.stringify(entry.designOutcome)}`)
    .join('|');
  useEffect(() => {
    if (!preview || !active) return undefined;
    const reconcile = () => {
      void refreshPreview();
    };
    const stop = onIpcEvent('design.preview', (result) => {
      if (result.hostId !== hostId) return;
      setPreviewSource(result.source);
      setPreviewIdentity(result.sourceIdentity);
      setPreviewStatus(result.status);
      setPreviewError(result.error ?? '');
      setAutomaticError(result.automaticError ?? '');
    });
    const reconnect = onIpcEvent('loro.status', (connected) => {
      if (connected) reconcile();
    });
    window.addEventListener('focus', reconcile);
    return () => {
      stop();
      reconnect();
      window.removeEventListener('focus', reconcile);
    };
  }, [preview, active, hostId, refreshPreview]);
  useEffect(() => {
    if (preview && active && finalized) void refreshPreview();
  }, [finalized, preview, active, refreshPreview]);
  const committedReceipt = latestCommittedDesignReceipt(designHistory, sessionId);
  useBlocker({
    enableBeforeUnload: false,
    shouldBlockFn: async ({ current, next }) => {
      if (current.pathname === next.pathname) return false;
      try {
        return !(await getIpcServices()?.design.leave(sessionId, hostId));
      } catch (e) {
        setError(String(e));
        return true;
      }
    },
  });
  useEffect(() => {
    let disposed = false;
    const generation = ++attachmentGeneration.current;
    const ownsAttachment = () => attachmentGeneration.current === generation;
    const service = getIpcServices()?.design;
    if (!service) return undefined;
    let work = Promise.resolve();
    const update = () => {
      work = work
        .catch(() => {})
        .then(async () => {
          if (attachmentGeneration.current !== generation) return;
          if (disposed || !active || !host.current || hasCanvasBlockingOverlay(host.current)) {
            await service.hide(sessionId, hostId);
            await service.hidePreview(hostId, false);
            return;
          }
          const { x, y, width, height } = host.current.getBoundingClientRect();
          if (width > 0 && height > 0) {
            if (readonlyView) {
              await service.hide(sessionId, hostId);
              await service.attachPreview(hostId, { x, y, width, height });
            } else {
              await service.attach(sessionId, { x, y, width, height }, hostId);
              await service.presentToolbar(sessionId, hostId, {
                dark: document.documentElement.classList.contains('dark'),
                actionsEnabled: !!onReferenceSelection,
                labels: Object.fromEntries(
                  [
                    'selectionCount',
                    'selectedElements',
                    'referenceSelection',
                    'generateSelectedImages',
                    'editSelectedImages',
                    'adjustSelectedStyle',
                    'regenerateSelection',
                    'textColor',
                    'fontFamily',
                    'fontSize',
                    'bold',
                    'italic',
                    'alignLeft',
                    'alignCenter',
                    'alignRight',
                    'alignJustify',
                    'fillColor',
                    'strokeColor',
                    'colorNone',
                    'customColor',
                    'elementWidth',
                    'elementHeight',
                    'imageFit',
                    'imageFitFill',
                    'imageFitContain',
                    'imageFitCover',
                    'crop',
                    'cropLeft',
                    'cropTop',
                    'cropRight',
                    'cropBottom',
                    'applyCrop',
                    'resetCrop',
                    'positionX',
                    'positionY',
                    'lineArrows',
                    'arrowsNone',
                    'arrowsEnd',
                    'arrowsBoth',
                  ].map((key) => [key, t(`design.${key}`)])
                ),
              });
            }
          }
        })
        .catch((e) => {
          if (!disposed) setError(String(e));
        });
    };
    const resize = new ResizeObserver(update);
    const dialogs = new MutationObserver(update);
    const appearance = new MutationObserver(update);
    appearance.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    if (host.current) resize.observe(host.current);
    dialogs.observe(document.body, { childList: true, subtree: true });
    update();
    return () => {
      disposed = true;
      resize.disconnect();
      dialogs.disconnect();
      appearance.disconnect();
      void work
        .then(async () => {
          if (ownsAttachment()) await service.hide(sessionId, hostId);
        })
        .catch((cause) => console.error(cause));
    };
  }, [sessionId, active, hostId, readonlyView, t, onReferenceSelection]);
  useEffect(() => {
    // Seed from hydrated history: opening an old session is not a new commit.
    if (!synced) return undefined;
    if (observedReceipt.current?.value !== committedReceipt || !observedReceipt.current) {
      observedReceipt.current = {
        value: committedReceipt,
        pending: observedReceipt.current !== undefined,
        choice: viewChoiceGeneration.current,
      };
    }
    const receipt = observedReceipt.current;
    if (committedReceipt === undefined) return undefined;
    let cancelled = false;
    const choice = receipt.choice;
    void syncOpenDesignCanvas(sessionId)
      .then(() => {
        if (cancelled) return;
        const shouldShowCanonical = receipt.pending;
        receipt.pending = false;
        if (!shouldShowCanonical || historyVersion || choice !== viewChoiceGeneration.current)
          return;
        // Only the guarded canonical reload succeeding changes the visible source.
        // Preview snapshots never enter this path's save or completion decisions.
        ++previewGeneration.current;
        setPreview(false);
        void getIpcServices()?.design.hidePreview(hostId);
      })
      .catch((cause) => {
        if (!cancelled) setError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, committedReceipt, synced, hostId, historyVersion]);
  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    void action()
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };
  const referenceSelection = (prompt?: string, kind?: 'image', captured?: DesignElementReference) =>
    run(async () => {
      const service = getIpcServices()?.design;
      if (!service) throw Error('Local workspace is not ready');
      const generation = attachmentGeneration.current;
      const reference = captured ?? (await service.selection(sessionId, hostId, kind));
      if (generation !== attachmentGeneration.current)
        throw Error(
          t('design.selectionChanged', 'Artwork view changed; select the current elements again')
        );
      setFocused(false);
      onReferenceSelection?.(reference, prompt);
    });
  const selectionAction = (action: DesignSelectionAction, reference: DesignElementReference) => {
    switch (action) {
      case 'reference':
        return referenceSelection(undefined, undefined, reference);
      case 'generate':
        return referenceSelection(
          t(
            'design.generateImagesPrompt',
            'Generate a new image for each selected image, using the current design as context. Replace only the selected images with the resulting assets.'
          ),
          'image',
          reference
        );
      case 'edit':
        return referenceSelection(
          t(
            'design.editImagesPrompt',
            'Edit each selected image using its current image as the source. Replace only the selected images with the resulting assets. Requested changes: '
          ),
          'image',
          reference
        );
      case 'style':
        return referenceSelection(
          t(
            'design.adjustStylePrompt',
            'Adjust the style of the selected elements while preserving their content. Requested style: '
          ),
          undefined,
          reference
        );
      case 'regenerate':
        return referenceSelection(
          t(
            'design.regenerateSelectionPrompt',
            'Regenerate the selected elements using the current design and our conversation as context. Preserve the rest of the artwork.'
          ),
          undefined,
          reference
        );
    }
  };
  const actionCallback = useRef(selectionAction);
  actionCallback.current = selectionAction;
  useEffect(
    () =>
      onIpcEvent('design.selectionAction', (event) => {
        if (
          event.hostId === hostId &&
          event.reference.artworkId === sessionId &&
          active &&
          !readonlyView
        )
          actionCallback.current(event.action, event.reference);
      }),
    [hostId, sessionId, active, readonlyView]
  );
  const chooseVersion = (value: string) => {
    setError('');
    if (value === 'current') {
      switchPreview(false);
      return;
    }
    ++viewChoiceGeneration.current;
    ++previewGeneration.current;
    setPreview(false);
    setHistoryVersion(value);
  };
  const saveVersion = () =>
    run(async () => {
      const service = getIpcServices()?.design;
      if (!service) throw Error('Local workspace is not ready');
      const version = await service.saveVersion(sessionId);
      await refreshVersions();
      toast.success(t('design.versionSaved', 'Saved as V{{number}}', { number: version.number }));
    });
  const restoreFromVersion = () =>
    run(async () => {
      const service = getIpcServices()?.design;
      if (!service || !historyVersion) throw Error('Local workspace is not ready');
      const saved = await service.restoreVersion(sessionId, historyVersion);
      await refreshVersions();
      if (saved.reloadError)
        throw Error(
          t('design.restoreReloadFailed', 'Restored and saved, but the canvas could not reload: ') +
            saved.reloadError
        );
      switchPreview(false);
    });
  const importPreview = () =>
    run(async () => {
      const service = getIpcServices()?.design;
      if (!service || !previewIdentity) throw Error('Preview is not available');
      const saved = await service.importPreview(sessionId, hostId, previewIdentity);
      if (saved.reloadError)
        throw Error(
          t(
            'design.importSavedReloadFailed',
            'Imported and saved, but the canvas could not reload: '
          ) + saved.reloadError
        );
      switchPreview(false);
    });
  const exportArtwork = (format: 'png' | 'jpeg') =>
    run(async () => getIpcServices()?.design.export(sessionId, format, name));
  // Live selection size pushed from the canvas drives the native toolbar and
  // the mirrored composer chip. Syncing stays passive: it captures through the
  // same validated path as an explicit click, but never surfaces errors, never
  // marks busy, and never leaves focus mode.
  const syncSelectionCallback = useRef(onSyncSelection);
  syncSelectionCallback.current = onSyncSelection;
  useEffect(
    () =>
      onIpcEvent('design.selection', (result) => {
        if (result.hostId === hostId) setSelection(result.count > 0 ? result : null);
      }),
    [hostId]
  );
  // Remounts (panel switches, session restore) reuse a still-alive native view
  // whose selection never re-fires design.selection, so reseed the composer selection from
  // the main process cache once the editable view is active again. A null or
  // absent cache means the view is fresh or holds no selection: leave the composer selection
  // empty. Readonly previews never report a selection.
  useEffect(() => {
    if (!active || readonlyView) return undefined;
    const service = getIpcServices()?.design;
    if (!service) return undefined;
    let cancelled = false;
    void service
      .selectionSummary(sessionId, hostId)
      .then((summary) => {
        if (!cancelled && summary && summary.count > 0) setSelection(summary);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId, active, readonlyView, hostId]);
  useEffect(() => {
    const sync = syncSelectionCallback.current;
    if (!sync) return undefined;
    if (readonlyView || selectionCount === 0) {
      // Entering a history/preview/readonly view or an empty selection retires
      // the mirrored chip explicitly; returning to the live canvas re-captures.
      sync(null, '');
      return undefined;
    }
    const timer = setTimeout(() => {
      void (async () => {
        const service = getIpcServices()?.design;
        if (!service) return;
        const generation = attachmentGeneration.current;
        try {
          const reference = await service.selection(sessionId, hostId, undefined, true);
          if (generation !== attachmentGeneration.current) return;
          syncSelectionCallback.current?.(
            reference,
            t('design.selectedElements', 'Selected elements ({{count}})', {
              count: reference.elementIds.length,
            })
          );
        } catch {
          // Read-only execution, a hidden canonical view, or an unfinished
          // composition must not surface from a passive mirror.
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
    // Key on the selection event itself, not the count: switching between
    // same-count selections or editing properties must re-capture so the
    // mirrored chip never keeps stale element ids or a stale revision.
  }, [selection, readonlyView, selectionCount, sessionId, hostId, t]);
  return (
    <div
      data-design-canvas-focus={active && focused}
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <style>
        {
          '[data-panel-group]:has([data-design-canvas-focus="true"]) > [data-panel-id="chat"], [data-panel-group]:has([data-design-canvas-focus="true"]) > [data-panel-resize-handle-id]{display:none}'
        }
      </style>
      <div className="flex flex-wrap items-center gap-2 border-b bg-card p-2">
        <div className="inline-flex items-center rounded-md bg-muted p-0.5" role="group">
          <button
            type="button"
            onClick={() => switchPreview(false)}
            className={cn(
              'rounded-[3px] px-3 py-1 text-sm transition-colors',
              !readonlyView
                ? 'bg-popover font-medium shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t('design.currentCanvas', 'Artwork')}
          </button>
          <button
            type="button"
            onClick={() => switchPreview(true)}
            className={cn(
              'rounded-[3px] px-3 py-1 text-sm transition-colors',
              preview
                ? 'bg-popover font-medium shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t('design.sourcePreview', 'Preview')}
          </button>
        </div>
        {preview && (
          <Button
            size="sm"
            variant="ghost"
            disabled={previewStatus === 'refreshing'}
            onClick={() => void refreshPreview()}
          >
            <RefreshCw className="size-3.5" />
            {t('design.refreshPreview', 'Refresh preview')}
          </Button>
        )}
        {preview && (
          <Button
            size="sm"
            disabled={busy || !previewIdentity || previewStatus === 'refreshing'}
            onClick={importPreview}
          >
            <Download className="size-3.5" />
            {t('design.importPreview', 'Import as current artwork')}
          </Button>
        )}
        <TooltipProvider>
          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu
              onOpenChange={(open) => {
                if (open) void refreshVersions().catch((cause) => setError(String(cause)));
              }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={busy}
                      aria-label={t('design.versions', 'Version history')}
                    >
                      <History className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('design.versions', 'Version history')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-72">
                {historyVersion ? (
                  <DropdownMenuItem
                    disabled={busy || !historyReady || liveStatus != null}
                    onClick={restoreFromVersion}
                  >
                    <Pencil className="size-4" />
                    {t('design.editFromVersion', 'Edit from here')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    disabled={busy || preview || liveStatus != null}
                    onClick={saveVersion}
                  >
                    <Check className="size-4" />
                    {t('design.saveVersion', 'Save version')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => chooseVersion('current')}>
                  {t('design.currentCanvas', 'Artwork')}
                  {!historyVersion && <Check className="ml-auto size-4" />}
                </DropdownMenuItem>
                {[...versions].reverse().map((version) => (
                  <DropdownMenuItem
                    key={version.commitId}
                    onClick={() => chooseVersion(version.commitId)}
                  >
                    V{version.number} · {new Date(version.createdAt).toLocaleString()}
                    {version.kind === 'before-restore'
                      ? ` · ${t('design.beforeRestore', 'Before restore')}`
                      : ''}
                    {historyVersion === version.commitId && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={busy || readonlyView}
                      aria-label={t('design.export', 'Export')}
                    >
                      <Download className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('design.export', 'Export')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportArtwork('png')}>PNG</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportArtwork('jpeg')}>JPEG</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t('design.more', 'More')}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('design.more', 'More')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={busy || readonlyView}
                  onClick={() =>
                    run(() =>
                      create(name + t('design.copySuffix', ' — copy'), 800, 600, sessionId, hostId)
                    )
                  }
                >
                  <Copy className="size-4" />
                  {t('design.saveCopy', 'Save as new design')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={
                    focused
                      ? t('design.showChat', 'Show conversation')
                      : t('design.focus', 'Focus canvas')
                  }
                  onClick={() => setFocused((value) => !value)}
                >
                  {focused ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {focused
                  ? t('design.showChat', 'Show conversation')
                  : t('design.focus', 'Focus canvas')}
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
      {historyVersion && (
        <p role="status" className="border-b p-2 text-xs text-muted-foreground">
          {historyReady
            ? t(
                'design.historyReadonly',
                'Read-only version. Edit from here to restore it as the current artwork.'
              )
            : t('design.historyLoading', 'Loading version…')}
        </p>
      )}
      {preview && (
        <div role="status" className="border-b p-2 text-xs text-muted-foreground">
          <p>
            {t(
              'design.previewReadonly',
              'Read-only authoring files · not submitted. Valid drafts may still be unfinished.'
            )}
          </p>
          {previewSource && <p className="break-all">{previewSource}</p>}
          <p>
            {previewStatus === 'ready'
              ? t('design.previewReady', 'Showing the observed document and assets.')
              : previewStatus === 'refreshing'
                ? t('design.previewRefreshing', 'Reading files…')
                : t(
                    'design.previewWaiting',
                    'Waiting for valid files. The last valid preview, if any, is retained.'
                  )}
          </p>
          {automaticError && (
            <p>
              {t(
                'design.previewAutomaticUnavailable',
                'Automatic updates unavailable. Use Refresh preview.'
              )}{' '}
              {automaticError}
            </p>
          )}
          {previewError && <p>{previewError}</p>}
        </div>
      )}
      {error && (
        <p role="alert" className="p-2 text-destructive">
          {error}
        </p>
      )}
      <div ref={host} className="min-h-0 flex-1" aria-label={t('design.canvas', 'Design canvas')} />
    </div>
  );
}

export function usePendingDesignRecovery() {
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const user = useAtomValue(userAtom);
  useEffect(() => {
    const service = getIpcServices()?.design;
    if (!runtime || !user || !service) return;
    void service
      .pending()
      .then(async (designs) => {
        for (const { association } of designs) {
          if (association.userId !== user.id) continue;
          const roomId = getSessionRoomId(association.sessionId as SessionId);
          const existing = await runtime.repo.getDocMeta(roomId);
          await runtime.writer.upsertDocMeta(roomId, {
            ...(!existing?.meta
              ? {
                  id: association.sessionId,
                  ...association,
                  title: association.name,
                  titleSource: 'draft',
                  isArchived: false,
                  cliType: 'builtin',
                  agentType: '',
                }
              : {}),
            design: { artworkId: association.sessionId, path: 'design.json' },
          });
          await service.acknowledge(association.sessionId);
        }
      })
      .catch((error) => toast.error(String(error)));
  }, [runtime, user]);
}
