import { useCallback, useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  PersonalMemoryOperationSchema,
  PersonalMemorySnapshotSchema,
  type PersonalMemorySnapshot,
} from '@molly/shared/personal-memory';
import {
  MACHINE_PROTOCOL_CAPABILITIES,
  PERSONAL_PREFERENCES_PROTOCOL_VERSION,
  machineSupportsProtocolCapability,
} from '@molly/shared';
import { getMachineMetaByIdAtomFamily } from '@/atoms';
import { localMachineIdAtom, localCliStartingAtom } from '@/atoms/local-probe';
import { currentWorkspaceIdAtom } from '@/atoms/workspace-context';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Switch } from '@/ui/switch';
import { CompactSection, CompactRow } from './compact-layout';
import { WithInfo } from './info-tip';

type Operation = z.infer<typeof PersonalMemoryOperationSchema>;

export function PersonalMemorySetting() {
  const machineId = useAtomValue(localMachineIdAtom);
  const machine = useAtomValue(getMachineMetaByIdAtomFamily(machineId ?? undefined));
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const starting = useAtomValue(localCliStartingAtom);
  const supported = machineSupportsProtocolCapability(
    machine,
    MACHINE_PROTOCOL_CAPABILITIES.personalPreferences,
    PERSONAL_PREFERENCES_PROTOCOL_VERSION
  );
  const request = useCallback(
    async (operation: Operation) => {
      const ipc = getIpcServices();
      if (!ipc || !machineId || !workspaceId || starting || !supported)
        throw new Error('memory_unavailable');
      const response = await ipc.machineRpc.send({
        machineId,
        workspaceId,
        method: 'memory/preferences',
        params: operation,
      });
      if (
        !response.ok ||
        !('type' in response.result) ||
        response.result.type !== 'memory/preferences'
      )
        throw new Error('memory_unavailable');
      return PersonalMemorySnapshotSchema.parse(response.result.snapshot);
    },
    [machineId, workspaceId, starting, supported]
  );
  if (!supported || starting || !machineId || !workspaceId) return null;
  return <PersonalMemoryPanel request={request} />;
}

export function PersonalMemoryPanel({
  request,
}: {
  request: (operation: Operation) => Promise<PersonalMemorySnapshot>;
}) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<PersonalMemorySnapshot>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void request({ action: 'read' })
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [request]);
  const run = async (operation: Operation) => {
    setBusy(true);
    setFailed(false);
    try {
      setSnapshot(await request(operation));
      setDrafts({});
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <CompactSection title={t('settings.memory.title', 'Personal memory')}>
      <CompactRow
        label={t('settings.memory.automatic', 'Remember preferences automatically')}
        helper={
          <WithInfo
            text={t(
              'settings.memory.description',
              'Learns your taste across designs. Stored on this computer; your messages and preferences may be sent to your chosen model to learn and apply them.'
            )}
            info={t(
              'settings.memory.scope',
              'Keeps up to 32 preferences. Project and brand facts are excluded. Turning this off stops learning and recall. Deleting a preference removes it from future recall but does not erase past conversations.'
            )}
          />
        }
      >
        <Switch
          aria-label={t('settings.memory.automatic', 'Remember preferences automatically')}
          checked={snapshot?.enabled ?? false}
          disabled={!snapshot || busy}
          onCheckedChange={(enabled) =>
            snapshot && void run({ action: 'configure', enabled, revision: snapshot.revision })
          }
        />
      </CompactRow>
      <div className="flex flex-col gap-3 px-5 py-4">
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {t(
              'settings.memory.failed',
              'Memory could not be updated or loaded. Refresh and try again; another session may have changed it.'
            )}
          </p>
        )}
        {snapshot?.entries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t('settings.memory.empty', 'No remembered preferences yet.')}
          </p>
        )}
        {snapshot?.entries.map((entry) => {
          const draft = drafts[entry.id];
          const edited = draft !== undefined && draft !== entry.text;
          const savable = edited && draft.trim() !== '' && !busy;
          const save = () =>
            savable &&
            void run({ action: 'edit', id: entry.id, text: draft, revision: snapshot.revision });
          return (
            <div key={entry.id} className="flex items-center gap-2">
              <Input
                aria-label={t('settings.memory.preference', 'Remembered preference')}
                maxLength={300}
                value={draft ?? entry.text}
                disabled={busy}
                onChange={(event) => setDrafts({ ...drafts, [entry.id]: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') save();
                }}
              />
              {edited ? (
                <>
                  <Button variant="outline" size="sm" disabled={!savable} onClick={save}>
                    {t('settings.memory.save', 'Save')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      const { [entry.id]: _discarded, ...rest } = drafts;
                      setDrafts(rest);
                    }}
                  >
                    {t('common.cancel', 'Cancel')}
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run({ action: 'delete', id: entry.id, revision: snapshot.revision })
                  }
                >
                  {t('settings.memory.delete', 'Delete')}
                </Button>
              )}
            </div>
          );
        })}
        <Button
          variant="outline"
          className="self-start"
          size="sm"
          disabled={busy}
          onClick={() => void run({ action: 'read' })}
        >
          {t('settings.memory.refresh', 'Refresh memories')}
        </Button>
      </div>
    </CompactSection>
  );
}
