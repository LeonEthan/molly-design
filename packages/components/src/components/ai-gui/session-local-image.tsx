import { useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  machineSupportsLocalSessionAttachments,
  type SessionFilePayload,
  type SessionId,
} from '@molly/shared';
import { currentWorkspaceIdAtom } from '@/atoms';
import { localMachineIdAtom } from '@/atoms/local-probe';
import { useResolvedMachineMeta } from '@/hooks/use-resolved-machine-meta';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { ZoomableImageViewer } from '../shared/zoomable-image-viewer';

/** Read a sent attachment by durable identity through the existing local resource channel. */
export function SessionLocalImage({
  file,
  sessionId,
}: {
  file: SessionFilePayload;
  sessionId: SessionId;
}) {
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const machineId = useAtomValue(localMachineIdAtom);
  const { machine } = useResolvedMachineMeta(machineId);
  const supported = machineSupportsLocalSessionAttachments(machine);
  const [src, setSrc] = useState<string>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    setSrc(undefined);
    setError(undefined);
    const ipc = getIpcServices();
    if (
      !workspaceId ||
      !machineId ||
      (file.transport === 'local' && machineId !== file.machineId) ||
      !ipc ||
      !supported
    ) {
      setError('Local image is unavailable on this machine');
      return undefined;
    }
    void ipc.machineRpc
      .previewFile({
        machineId,
        workspaceId,
        method: 'file/resolve-local',
        params: { v: 3, sessionId, attachment: { fileId: file.fileId, sha256: file.sha256 } },
      })
      .then((result) => {
        if (!active) return;
        if (result.status !== 'resource' || result.kind !== 'binary')
          throw new Error('Image preview unavailable');
        setSrc(result.url);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Image preview unavailable');
      });
    return () => {
      active = false;
    };
  }, [
    workspaceId,
    machineId,
    sessionId,
    file.fileId,
    file.sha256,
    file.machineId,
    file.transport,
    supported,
  ]);
  const images = useMemo(
    () => [{ key: file.sha256, src, fileName: file.fileName }],
    [file.sha256, file.fileName, src]
  );
  return (
    <div className="max-w-sm overflow-hidden rounded-xl border border-border/70">
      <button
        type="button"
        disabled={!src}
        onClick={() => setOpen(true)}
        aria-label={file.fileName}
      >
        {src ? (
          <img src={src} alt={file.fileName} className="max-h-64 max-w-full object-contain" />
        ) : (
          <span className="p-3 text-sm">{error ?? file.fileName}</span>
        )}
      </button>
      <ZoomableImageViewer
        open={open}
        onClose={() => setOpen(false)}
        images={images}
        index={0}
        onIndexChange={() => {}}
      />
    </div>
  );
}
