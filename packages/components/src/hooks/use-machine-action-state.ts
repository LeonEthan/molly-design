import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { MachineId, MachineViewMeta } from '@molly/shared';

export type MachineActionCallbacks = {
  onRename: (machineId: MachineId, newName: string) => Promise<void>;
  onDelete: (machine: MachineViewMeta) => Promise<void>;
  onPing?: (machineId: MachineId) => Promise<number>;
  onRestartDaemon?: (machineId: MachineId) => Promise<void>;
};

/**
 * Rename/delete/ping/restart state and handlers for the local machine.
 */
export function useMachineActionState({
  machine,
  onRename,
  onDelete,
  onPing,
  onRestartDaemon,
}: MachineActionCallbacks & {
  machine: MachineViewMeta;
}) {
  const { t } = useTranslation();

  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(machine.name);
  const [renameSaving, setRenameSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [pingLatencyMs, setPingLatencyMs] = useState<number | null>(null);
  const [restartingDaemon, setRestartingDaemon] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitRename = useCallback(async () => {
    const nextName = renameDraft.trim();
    setRenaming(false);
    if (!nextName || nextName === machine.name) {
      setRenameDraft(machine.name);
      return;
    }
    try {
      setRenameSaving(true);
      await onRename(machine.id, nextName);
    } catch (error) {
      setRenameDraft(machine.name);
      toast.error(t('workspace.machines.renameFailed', 'Failed to rename machine'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRenameSaving(false);
    }
  }, [renameDraft, machine.name, machine.id, onRename, t]);

  const handleDelete = useCallback(async () => {
    try {
      setDeleting(true);
      await onDelete(machine);
      setDeleteOpen(false);
    } catch (error) {
      toast.error(t('workspace.machines.deleteFailed', 'Failed to delete machine'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDeleting(false);
    }
  }, [machine, onDelete, t]);

  const handlePing = useCallback(async () => {
    if (!onPing || pinging) return;
    try {
      setPinging(true);
      const latencyMs = await onPing(machine.id);
      setPingLatencyMs(latencyMs);
    } catch (error) {
      toast.error(t('settings.agent.machinePing.failed', 'Ping failed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPinging(false);
    }
  }, [machine.id, onPing, pinging, t]);

  const handleRestartDaemon = useCallback(async () => {
    if (!onRestartDaemon || restartingDaemon) return;
    try {
      setRestartingDaemon(true);
      await onRestartDaemon(machine.id);
      toast.success(
        t('settings.agent.machineLifecycle.restartAccepted', 'Restart request accepted')
      );
    } catch (error) {
      toast.error(t('settings.agent.machineLifecycle.restartFailed', 'Restart request failed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRestartingDaemon(false);
    }
  }, [machine.id, onRestartDaemon, restartingDaemon, t]);

  return {
    renaming,
    setRenaming,
    renameDraft,
    setRenameDraft,
    renameSaving,
    inputRef,
    commitRename,
    deleteOpen,
    setDeleteOpen,
    deleting,
    handleDelete,
    pinging,
    pingLatencyMs,
    handlePing,
    restartingDaemon,
    handleRestartDaemon,
  };
}
