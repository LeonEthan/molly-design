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
  Save,
} from 'lucide-react';
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
  artworkId: artworkIdProp,
  active,
  workspaceSlug,
  name,
  onReferenceSelection,
  onSyncSelection,
}: {
  sessionId: string;
  /**
   * The artwork this canvas opens. Defaults to sessionId — the common
   * session-created case. Differs for continuation sessions, which edit the
   * source session's artwork (meta.design.artworkId). All design channel
   * calls key documents by artwork id, so they must use this value, while
   * conversation reads (useSessionDoc, ownerSessionId) stay session-keyed.
   */
  artworkId?: string;
  active: boolean;
  workspaceSlug: string;
  name: string;
  onReferenceSelection?: (reference: DesignElementReference, prompt?: string) => void;
  /** Passive mirror of the live canvas selection into the composer chip. */
  onSyncSelection?: (reference: DesignElementReference | null, label: string) => void;
}) {
  const artworkId = artworkIdProp ?? sessionId;
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  // Native-view host key, stable per session consumer (NOT per mount). The main process
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
  const [canvasState, setCanvasState] =
    useState<Awaited<ReturnType<IpcServices['design']['state']>>>();
  const [previewReady, setPreviewReady] = useState(false);
  const [versions, setVersions] = useState<Awaited<ReturnType<IpcServices['design']['versions']>>>(
    []
  );
  const versionsGeneration = useRef(0);
  const preview = !!canvasState?.turnId;
  const readonlyView = canvasState?.readonly ?? true;
  const currentVersion = versions.find((v) => v.commitId === canvasState?.baseVersionId);
  const visiblePreview = preview && previewReady;
  const refreshVersions = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      const generation = ++versionsGeneration.current;
      const service = getIpcServices()?.design;
      if (!service) throw Error('Local workspace is not ready');
      const [result, state] = await Promise.all([
        service.versions(artworkId),
        service.state(artworkId),
      ]);
      if (isCurrent() && generation === versionsGeneration.current) {
        setVersions(result);
        setCanvasState(state);
      }
    },
    [artworkId]
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
  const [previewError, setPreviewError] = useState('');
  const [automaticError, setAutomaticError] = useState('');
  const previewGeneration = useRef(0);
  const attachmentGeneration = useRef(0);
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const machine = useAtomValue(localProbeResultAtom);
  const refreshPreview = useCallback(async () => {
    const generation = ++previewGeneration.current;
    try {
      const service = getIpcServices()?.design;
      if (!service || !workspaceId || !machine?.machineId)
        throw Error('Local workspace is not ready');
      const result = await service.refreshPreview(artworkId, hostId, {
        machineId: machine.machineId,
        workspaceId,
        ownerSessionId: sessionId as SessionId,
        method: 'design/source-path',
        params: {},
      });
      if (generation !== previewGeneration.current || result.status === 'superseded') return;
      setPreviewReady(result.status === 'ready' || !!result.retained);
      setPreviewError(result.status === 'waiting' ? (result.error ?? '') : '');
      setAutomaticError(result.automaticError ?? '');
      if (
        (result.status === 'ready' || result.retained) &&
        host.current &&
        !hasCanvasBlockingOverlay(host.current)
      ) {
        const { x, y, width, height } = host.current.getBoundingClientRect();
        await service.attachPreview(hostId, { x, y, width, height });
      }
    } catch (cause) {
      if (generation !== previewGeneration.current) return;
      setPreviewError(String(cause));
    }
  }, [workspaceId, machine?.machineId, sessionId, artworkId, hostId]);
  useEffect(() => {
    const generationRef = previewGeneration;
    setPreviewReady(false);
    setPreviewError('');
    if (preview && active && !canvasState?.preparing) void refreshPreview();
    else if (!active) void getIpcServices()?.design.closePreview(hostId);
    return () => {
      ++generationRef.current;
    };
  }, [preview, active, canvasState?.turnId, canvasState?.preparing, hostId, refreshPreview]);
  useEffect(
    () => () => {
      void getIpcServices()?.design.closePreview(hostId);
    },
    [hostId]
  );
  useEffect(() => {
    if (!active) return undefined;
    const refresh = () => {
      void refreshVersions().catch((cause) => setError(String(cause)));
    };
    const stop = onIpcEvent('design.state', (event) => {
      if (!event.artworkId || event.artworkId === artworkId) refresh();
    });
    const reconnect = onIpcEvent('loro.status', () => refresh());
    window.addEventListener('focus', refresh);
    return () => {
      stop();
      reconnect();
      window.removeEventListener('focus', refresh);
    };
  }, [active, artworkId, refreshVersions]);
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
      setPreviewReady(result.status === 'ready' || !!result.retained);
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
  const committedReceipt = latestCommittedDesignReceipt(designHistory, artworkId);
  useBlocker({
    enableBeforeUnload: false,
    shouldBlockFn: async ({ current, next }) => {
      if (current.pathname === next.pathname) return false;
      try {
        return !(await getIpcServices()?.design.leave(artworkId, hostId));
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
            await service.hide(artworkId, hostId);
            await service.hidePreview(hostId, false);
            return;
          }
          const { x, y, width, height } = host.current.getBoundingClientRect();
          if (width > 0 && height > 0) {
            if (visiblePreview) {
              await service.attachPreview(hostId, { x, y, width, height });
            } else {
              await service.attach(artworkId, { x, y, width, height }, hostId);
              await service.presentToolbar(artworkId, hostId, {
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
          if (ownsAttachment()) await service.hide(artworkId, hostId);
        })
        .catch((cause) => console.error(cause));
    };
  }, [sessionId, artworkId, active, hostId, preview, visiblePreview, t, onReferenceSelection]);
  useEffect(() => {
    if (!synced || !committedReceipt) return undefined;
    let cancelled = false;
    void syncOpenDesignCanvas(artworkId)
      .then(() => (cancelled ? undefined : refreshVersions()))
      .catch((cause) => {
        if (!cancelled) setError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [artworkId, committedReceipt, synced, refreshVersions]);
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
      const reference = captured ?? (await service.selection(artworkId, hostId, kind));
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
          event.reference.artworkId === artworkId &&
          active &&
          !readonlyView
        )
          actionCallback.current(event.action, event.reference);
      }),
    [hostId, artworkId, active, readonlyView]
  );
  const chooseVersion = (commitId: string) =>
    run(async () => {
      const service = getIpcServices()?.design;
      if (!service) throw Error('Local workspace is not ready');
      const saved = await service.restoreVersion(artworkId, commitId);
      setSelection(null);
      onSyncSelection?.(null, '');
      await refreshVersions();
      if (saved.reloadError)
        throw Error(
          t('design.restoreReloadFailed', 'Restored and saved, but the canvas could not reload: ') +
            saved.reloadError
        );
    });
  const saveVersion = () =>
    run(async () => {
      const service = getIpcServices()?.design;
      if (!service) throw Error('Local workspace is not ready');
      const version = await service.saveVersion(artworkId);
      await refreshVersions();
      toast.success(t('design.versionSaved', 'Saved as V{{number}}', { number: version.number }));
    });
  const exportArtwork = (format: 'png' | 'jpeg') =>
    run(async () => getIpcServices()?.design.export(artworkId, format, name));
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
      .selectionSummary(artworkId, hostId)
      .then((summary) => {
        if (!cancelled && summary && summary.count > 0) setSelection(summary);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId, artworkId, active, readonlyView, hostId]);
  useEffect(() => {
    const sync = syncSelectionCallback.current;
    if (!sync) return undefined;
    if (readonlyView || selectionCount === 0) {
      // Entering a preview/readonly view or an empty selection retires
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
          const reference = await service.selection(artworkId, hostId, undefined, true);
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
  }, [selection, readonlyView, selectionCount, sessionId, artworkId, hostId, t]);
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
      <div className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border/40 bg-background px-3 py-2">
        <span
          className="max-w-full rounded-full bg-foreground/[0.04] px-3 py-1 text-xs leading-5 text-muted-foreground"
          role="status"
        >
          {currentVersion
            ? canvasState?.changed
              ? t('design.basedOnVersion', 'Based on V{{number}} · New changes', {
                  number: currentVersion.number,
                })
              : `V${currentVersion.number}`
            : t('design.currentCanvas', 'Current draft')}
        </span>
        <TooltipProvider>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 rounded-full"
                    disabled={busy || readonlyView || !canvasState?.changed}
                    onClick={saveVersion}
                    aria-label={t('design.saveVersion', 'Save version')}
                  >
                    <Save className="size-[18px]" aria-hidden="true" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('design.saveVersion', 'Save version')}</TooltipContent>
            </Tooltip>
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
                      className="size-9 rounded-full"
                      disabled={busy}
                      aria-label={t('design.versions', 'Version history')}
                    >
                      <History className="size-[18px]" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('design.versions', 'Version history')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                align="end"
                className="max-h-[60vh] w-80 max-w-[calc(100vw-32px)] overflow-y-auto rounded-xl border-border/50 p-1.5"
              >
                {[...versions].reverse().map((version) => (
                  <DropdownMenuItem
                    key={version.commitId}
                    className="min-h-9 rounded-md px-3 py-2 text-xs leading-relaxed"
                    disabled={busy || readonlyView}
                    onClick={() => chooseVersion(version.commitId)}
                  >
                    V{version.number} · {new Date(version.createdAt).toLocaleString()}
                    {version.kind === 'before-restore'
                      ? ` · ${t('design.beforeRestore', 'Before restore')}`
                      : ''}
                    {version.baseVersionId &&
                      versions.find((v) => v.commitId === version.baseVersionId) &&
                      ` · ${t('design.versionOrigin', 'Based on V{{number}}', {
                        number: versions.find((v) => v.commitId === version.baseVersionId)?.number,
                      })}`}
                    {canvasState?.baseVersionId === version.commitId && (
                      <Check className="ml-auto size-4" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-9 rounded-full bg-foreground/[0.08] px-3 font-medium text-foreground hover:bg-foreground/[0.12]"
                      disabled={busy || readonlyView}
                      aria-label={t('design.export', 'Export')}
                    >
                      <Download className="size-[18px]" />
                      {t('design.export', 'Export')}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('design.export', 'Export')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                align="end"
                className="min-w-40 rounded-xl border-border/50 p-1.5"
              >
                <DropdownMenuItem
                  className="min-h-9 rounded-md px-3"
                  onClick={() => exportArtwork('png')}
                >
                  PNG
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="min-h-9 rounded-md px-3"
                  onClick={() => exportArtwork('jpeg')}
                >
                  JPEG
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 rounded-full"
                      aria-label={t('design.more', 'More')}
                    >
                      <MoreHorizontal className="size-[18px]" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('design.more', 'More')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                align="end"
                className="min-w-40 rounded-xl border-border/50 p-1.5"
              >
                <DropdownMenuItem
                  className="min-h-9 rounded-md px-3"
                  disabled={busy || readonlyView}
                  onClick={() =>
                    run(() =>
                      create(name + t('design.copySuffix', ' — copy'), 800, 600, artworkId, hostId)
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
                  className="size-9 rounded-full"
                  aria-label={
                    focused
                      ? t('design.showChat', 'Show conversation')
                      : t('design.focus', 'Focus canvas')
                  }
                  onClick={() => setFocused((value) => !value)}
                >
                  {focused ? (
                    <Minimize2 className="size-[18px]" />
                  ) : (
                    <Maximize2 className="size-[18px]" />
                  )}
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
      {preview && previewError && (
        <details className="mx-3 mt-3 rounded-xl border border-border/40 bg-foreground/[0.03] px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <summary className="cursor-pointer">
            {t('design.previewWaiting', 'Waiting for a valid draft. Keeping the current canvas.')}
          </summary>
          <p className="mt-1 whitespace-pre-wrap">{previewError}</p>
        </details>
      )}
      {preview && automaticError && (
        <p
          role="alert"
          className="mx-3 mt-3 rounded-xl bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive"
        >
          {t('design.previewAutomaticUnavailable', 'Automatic preview updates unavailable.')}{' '}
          {automaticError}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mx-3 mt-3 rounded-xl bg-destructive/5 px-3 py-2 text-sm leading-relaxed text-destructive"
        >
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
