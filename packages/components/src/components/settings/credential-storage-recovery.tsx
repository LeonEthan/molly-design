import { useState } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { Button } from '@/ui/button';

const recoveryRevisionAtom = atom(0);

export function useCredentialStorageRecoveryRevision(): number {
  return useAtomValue(recoveryRevisionAtom);
}

export function isUnreadableCredentialStorage(error: unknown): boolean {
  return error instanceof Error && /\bcredential_storage_unreadable\b/.test(error.message);
}

export function CredentialStorageRecovery() {
  const { t } = useTranslation();
  const advanceRevision = useSetAtom(recoveryRevisionAtom);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const recover = async () => {
    const ipc = getIpcServices();
    if (!ipc || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const candidate = await ipc.modelConnections.prepareStorageRecovery();
      if (!window.confirm(t('settings.credentials.recoveryConfirm'))) return;
      const { backupFileName } = await ipc.modelConnections.recoverUnreadableStorage(candidate);
      toast.success(t('settings.credentials.recovered', { backupFileName }));
      advanceRevision((revision) => revision + 1);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void recover()}>
        {t(busy ? 'settings.credentials.recovering' : 'settings.credentials.recover')}
      </Button>
      {failed ? (
        <p role="alert" className="text-xs text-destructive">
          {t('settings.credentials.recoveryFailed')}
        </p>
      ) : null}
    </div>
  );
}
