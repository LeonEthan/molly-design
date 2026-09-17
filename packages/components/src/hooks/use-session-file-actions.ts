import { useCallback, useMemo, type ComponentType, type SVGProps } from 'react';
import { useAtomValue } from 'jotai';
import { Copy, Download, ExternalLink, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  getMachineFlockLocalProjects,
  type CodeCollabContentUnavailableReason,
  type SessionMeta,
} from '@molly/shared';
import { getMachineMetaByIdAtomFamily } from '@/atoms';
import { localHomeDirAtom, localMachineIdAtom } from '@/atoms/local-probe';
import { useMachineFlockRows } from '@/hooks/use-machine-flock-rows';
import { writeTextToClipboard } from '@/lib/clipboard';
import { downloadBytesAsFile } from '@/lib/download-file';
import { getIpcServices } from '@/lib/electron-ipc-client';
import type { FileWorkspaceOpenResult } from '@/lib/file-workspace-provider';
import {
  normalizeSessionFileActionPlatform,
  resolveOpenFileLabel,
  resolveOpenFileTarget,
  resolveRevealFileLabel,
  resolveSessionFileActionAvailability,
  type SessionFileErrorActions,
} from '@/lib/session-file-actions';
import { resolveLocalWorkspaceFilePath } from '@/lib/session-local-file-path';
import {
  resolveSessionLocalProjectRootPath,
  resolveSessionRepoFullName,
} from '@/lib/session-local-file-source';

import {
  resolveMachineDotlodyPath,
  resolveSessionWorkspacePath,
} from '@/lib/session-workspace-path';

export type SessionFileLocalHostActionSet = {
  readonly revealLabel: string;
  readonly reveal: (filePath: string) => void;
  readonly openLabel: (filePath: string) => string;
  readonly openInDefaultApp: (filePath: string) => void;
};

export type SessionFileMenuItemId = 'copy-path' | 'open-in-default-app' | 'reveal' | 'download';

export type SessionFileMenuItem = {
  readonly id: SessionFileMenuItemId;
  readonly label: string;
  readonly icon: ComponentType<SVGProps<SVGSVGElement> & { size?: string | number }>;
  readonly run: (filePath: string) => void;
};

export type SessionFileActions = {
  /** Absolute path on the machine that owns the file, when it resolves. */
  readonly resolveHostPath: (filePath: string) => string | null;
  readonly copyPath: (filePath: string) => void;
  /** Non-null only in the desktop app with the file on this machine. */
  readonly localHost: SessionFileLocalHostActionSet | null;
  /** The remote stand-in for the local-host actions. */
  readonly download: ((filePath: string) => void) | null;
  /** The subset the file-error card renders, or undefined with nothing to offer. */
  readonly buildErrorActions: (filePath: string) => SessionFileErrorActions | undefined;
  /**
   * The same actions as a menu, for the file tree's context menu and the side
   * panel's ⋯ menu. Stable across renders so a memoized tree row can take it.
   */
  readonly menuItems: readonly SessionFileMenuItem[];
};

/**
 * One resolver for "what can this client do with this session's files", shared
 * by the file tree context menu, the side panel ⋯ menu, and the file error
 * card. See `lib/session-file-actions.ts` for the local-host / remote split it
 * enforces; every surface renders what this returns and never re-derives it.
 */
export function useSessionFileActions({
  session,
  fileProvider,
}: {
  /** Null while the surface has no session yet; every action is then absent. */
  readonly session: SessionMeta | null | undefined;
  /**
   * Only `openFile` is used (for the remote download), so both the file
   * workspace and session provider shapes fit.
   */
  readonly fileProvider?: {
    openFile(pathOrFileId: string): Promise<FileWorkspaceOpenResult>;
  } | null;
}): SessionFileActions {
  const { t } = useTranslation();
  const localMachineId = useAtomValue(localMachineIdAtom);
  const localHomeDir = useAtomValue(localHomeDirAtom);
  const sessionMachine = useAtomValue(
    getMachineMetaByIdAtomFamily(session?.machineId ?? undefined)
  );
  const machineFlockRows = useMachineFlockRows(session?.machineId ?? null, {
    // `dotlodyPath` is what turns a worktree session into an absolute path.
    families: ['localProject', 'dotlodyPath'],
  });

  const isElectronRenderer = typeof window !== 'undefined' && window.__MOLLY_ELECTRON__ === true;
  const isLocalMachine = Boolean(localMachineId) && session?.machineId === localMachineId;
  const platform = normalizeSessionFileActionPlatform(
    typeof window === 'undefined' ? undefined : window.__MOLLY_PLATFORM__?.os
  );

  const localProjectRootPath = useMemo(
    () =>
      session
        ? resolveSessionLocalProjectRootPath(session, {
            ...(sessionMachine?.localProjects ?? {}),
            ...getMachineFlockLocalProjects(machineFlockRows),
          })
        : null,
    [machineFlockRows, session, sessionMachine?.localProjects]
  );
  const machineDotlodyPath = useMemo(
    () => resolveMachineDotlodyPath(machineFlockRows, isLocalMachine ? localHomeDir : null),
    [isLocalMachine, localHomeDir, machineFlockRows]
  );
  const workspacePath = useMemo(
    () =>
      !session
        ? null
        : resolveSessionWorkspacePath({
            sessionId: session.id,
            ownerSessionId: session.parentSessionId,
            isWorktree: session.isWorktree,
            dotlodyPath: machineDotlodyPath,
            localProjectRootPath,
            repoFullName: resolveSessionRepoFullName(session),
            legacyWorkspacePath: sessionMachine?.workspacePaths?.[session.id],
          }),
    [localProjectRootPath, machineDotlodyPath, session, sessionMachine?.workspacePaths]
  );

  const resolveHostPath = useCallback(
    (filePath: string) => resolveLocalWorkspaceFilePath(workspacePath, filePath, isLocalMachine),
    [isLocalMachine, workspacePath]
  );

  const reportLocalActionFailure = useCallback(
    (action: 'reveal' | 'open', filePath: string, resolvedPath: string | null, error: unknown) => {
      const errorText =
        error instanceof Error
          ? error.message
          : error && typeof error === 'object' && 'error' in error
            ? String(error.error)
            : String(error);
      const details = {
        action,
        filePath,
        resolvedPath,
        workspacePath,
        sessionId: session?.id,
        machineId: session?.machineId,
        localMachineId,
        error: errorText,
        ...(error && typeof error === 'object' && !(error instanceof Error)
          ? { result: error }
          : {}),
        ...(error instanceof Error ? { stack: error.stack } : {}),
      };
      console.error('[session-file-actions] Local file action failed', details, error);
      const description =
        errorText === 'path_unresolved' || errorText === 'invalid_path'
          ? t(
              'sessions.fileActions.pathUnresolved',
              'The file path could not be resolved. Copy the details to check the requested path and workspace folder.'
            )
          : errorText === 'ipc_unavailable'
            ? t(
                'sessions.fileActions.bridgeUnavailable',
                'The desktop connection is unavailable. Restart Molly and try again.'
              )
            : errorText === 'not_found' || errorText === 'ENOENT' || errorText === 'ENOTDIR'
              ? t(
                  'sessions.fileActions.missingHelp',
                  'The file may have moved or been deleted. Refresh the preview and check its location.'
                )
              : errorText === 'EACCES' || errorText === 'EPERM'
                ? t(
                    'sessions.fileActions.permissionHelp',
                    'Molly cannot access this file. Check file permissions and system privacy settings.'
                  )
                : t(
                    'sessions.fileActions.systemOpenHelp',
                    'Try opening the file from your file manager. Copy the details below to inspect the system error.'
                  );
      const title =
        action === 'reveal'
          ? t('sessions.fileActions.revealFailed', 'Could not reveal that file.')
          : t('sessions.fileActions.openFailed', 'Could not open that file.');
      toast.error(title, {
        description,
        duration: 10_000,
        action: {
          label: t('sessions.fileActions.copyErrorDetails', 'Copy error details'),
          onClick: () => {
            void writeTextToClipboard(JSON.stringify(details, null, 2)).then((copied) => {
              if (!copied)
                toast.error(t('sessions.fileViewer.pathCopyFailed', 'Failed to copy file path'));
            });
          },
        },
      });
    },
    [localMachineId, session?.id, session?.machineId, t, workspacePath]
  );

  const copyPath = useCallback(
    (filePath: string) => {
      // The machine path is what the user asked for; the workspace-relative
      // path is what remains when that machine's rows have not synced.
      const target = resolveHostPath(filePath) ?? filePath.trim();
      if (!target) return;
      void (async () => {
        const copied = await writeTextToClipboard(target);
        if (copied) {
          toast.success(t('sessions.fileViewer.pathCopied', 'File path copied'));
        } else {
          toast.error(t('sessions.fileViewer.pathCopyFailed', 'Failed to copy file path'));
        }
      })();
    },
    [resolveHostPath, t]
  );

  // ONE decision for both halves, and `hasHostPath` is the real thing: an
  // Electron renderer on the owning machine still cannot reach a shell until
  // that machine's path metadata resolves. Deriving it from `localHost` was
  // circular — it offered open/reveal actions that could only fail while the
  // rows loaded, and hid the download that would have worked.
  const availability = useMemo(
    () =>
      resolveSessionFileActionAvailability({
        isElectronRenderer,
        isLocalMachine,
        hasHostPath: workspacePath !== null,
        hasFileProvider: Boolean(fileProvider),
      }),
    [fileProvider, isElectronRenderer, isLocalMachine, workspacePath]
  );

  const localHost = useMemo<SessionFileLocalHostActionSet | null>(() => {
    if (!session || !availability.localHost) return null;

    const runLocalAction = (
      action: 'reveal' | 'open',
      filePath: string,
      run: (
        services: NonNullable<ReturnType<typeof getIpcServices>>,
        path: string
      ) => Promise<unknown | null>
    ) => {
      const path = resolveHostPath(filePath);
      if (!path) {
        reportLocalActionFailure(action, filePath, null, 'path_unresolved');
        return;
      }
      void (async () => {
        try {
          const services = getIpcServices();
          if (!services) {
            reportLocalActionFailure(action, filePath, path, 'ipc_unavailable');
            return;
          }
          const failure = await run(services, path);
          if (failure !== null) reportLocalActionFailure(action, filePath, path, failure);
        } catch (error) {
          reportLocalActionFailure(action, filePath, path, error);
        }
      })();
    };

    return {
      revealLabel: resolveRevealFileLabel(platform, t),
      openLabel: (filePath: string) => resolveOpenFileLabel(filePath, t),
      reveal: (filePath) =>
        runLocalAction('reveal', filePath, async (services, path) => {
          const result = await services.app.revealLocalPath(path);
          return result.revealed ? null : result;
        }),
      openInDefaultApp: (filePath) =>
        runLocalAction('open', filePath, async (services, path) => {
          const result = await services.app.openLocalPath(path);
          return result.opened ? null : result;
        }),
    };
  }, [availability.localHost, platform, reportLocalActionFailure, resolveHostPath, session, t]);

  const download = useMemo(() => {
    if (!session || !availability.download || !fileProvider) return null;

    // KNOWN CEILING: this reads through the preview API, which answers in ONE
    // bounded response (10 MiB text / 5 MiB binary remotely). So the download
    // covers ordinary files and cannot cover the oversized ones — the very
    // files whose error card sent the user looking for a way out. Saying that
    // is the point of `downloadTooLarge`: a generic "could not download" reads
    // as a glitch worth retrying. A real answer for those needs a ranged or
    // streamed transfer, which is a Machine RPC protocol change (new method
    // plus a negotiated `protocolCapabilities` key, never inferred from the CLI
    // version) rather than a client-side fix.
    const reportUnavailable = (reason: CodeCollabContentUnavailableReason | 'no-bytes') => {
      if (reason === 'deleted') {
        toast.error(t('sessions.fileActions.fileMissing', 'That file no longer exists.'));
        return;
      }
      if (reason === 'text-too-large' || reason === 'blob-too-large' || reason === 'no-bytes') {
        toast.error(
          t(
            'sessions.fileActions.downloadTooLarge',
            'This file is too large to download from here. Open it on the machine that owns it.'
          )
        );
        return;
      }
      toast.error(t('sessions.fileActions.downloadFailed', 'Could not download that file.'));
    };

    return (filePath: string) => {
      void (async () => {
        try {
          const result = await fileProvider.openFile(filePath);
          if (result.status !== 'ready') {
            reportUnavailable(result.reason);
            return;
          }
          const snapshot = result.snapshot;
          if (snapshot.kind === 'text') {
            downloadBytesAsFile(filePath, new TextEncoder().encode(snapshot.text));
            return;
          }
          if (snapshot.kind === 'binary' && snapshot.bytes) {
            downloadBytesAsFile(filePath, snapshot.bytes);
            return;
          }
          // A `binary` snapshot with no bytes is the machine declining to send
          // them, which is the same "too big for one response" situation.
          reportUnavailable('no-bytes');
        } catch {
          toast.error(t('sessions.fileActions.downloadFailed', 'Could not download that file.'));
        }
      })();
    };
  }, [availability.download, fileProvider, session, t]);

  const buildErrorActions = useCallback(
    (filePath: string): SessionFileErrorActions | undefined => {
      const trimmed = filePath.trim();
      if (!session || !trimmed) return undefined;
      const onCopyPath = () => copyPath(trimmed);
      if (!localHost || !resolveHostPath(trimmed)) return { onCopyPath };
      return {
        onCopyPath,
        localHost: {
          openTarget: resolveOpenFileTarget(trimmed),
          revealLabel: localHost.revealLabel,
          onOpen: () => localHost.openInDefaultApp(trimmed),
          onReveal: () => localHost.reveal(trimmed),
        },
      };
    },
    [copyPath, localHost, resolveHostPath, session]
  );

  const menuItems = useMemo<readonly SessionFileMenuItem[]>(() => {
    if (!session) return [];
    const items: SessionFileMenuItem[] = [
      {
        id: 'copy-path',
        label: t('sessions.fileViewer.copyPath', 'Copy file path'),
        icon: Copy,
        run: copyPath,
      },
    ];
    if (localHost) {
      items.push({
        id: 'open-in-default-app',
        label: t('sessions.fileActions.openInDefaultApp', 'Open in default app'),
        icon: ExternalLink,
        run: localHost.openInDefaultApp,
      });
      items.push({
        id: 'reveal',
        label: localHost.revealLabel,
        icon: FolderOpen,
        run: localHost.reveal,
      });
    }
    if (download) {
      items.push({
        id: 'download',
        label: t('sessions.fileActions.download', 'Download file'),
        icon: Download,
        run: download,
      });
    }
    return items;
  }, [copyPath, download, localHost, session, t]);

  return { resolveHostPath, copyPath, localHost, download, buildErrorActions, menuItems };
}
