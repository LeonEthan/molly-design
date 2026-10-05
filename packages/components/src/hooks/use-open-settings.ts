import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { MachineId } from '@molly/shared';
import {
  currentWorkspaceSlugAtom,
  settingsActiveTabAtom,
  settingsDialogOpenAtom,
  settingsSelectedMachineIdAtom,
  settingsSelectedProjectKeyAtom,
} from '@/atoms';
import { SETTINGS_DEFAULT_TAB, type SettingsTabId } from '@/components/settings/settings-tabs';

type OpenSettingsOptions = {
  machineId?: MachineId;
  projectKey?: string;
};

export function useOpenSettings() {
  const workspaceSlug = useAtomValue(currentWorkspaceSlugAtom);
  const setOpen = useSetAtom(settingsDialogOpenAtom);
  const setActiveTab = useSetAtom(settingsActiveTabAtom);
  const setSelectedMachineId = useSetAtom(settingsSelectedMachineIdAtom);
  const setSelectedProjectKey = useSetAtom(settingsSelectedProjectKeyAtom);

  const openSettings = useCallback(
    (tab?: SettingsTabId, options?: OpenSettingsOptions) => {
      if (!workspaceSlug) return;

      const resolvedTab = tab ?? SETTINGS_DEFAULT_TAB;
      if (options) {
        setSelectedMachineId(options.machineId ?? null);
        setSelectedProjectKey(options.projectKey ?? null);
      }

      setActiveTab(resolvedTab);
      setOpen(true);
      return;
    },
    [setActiveTab, setOpen, setSelectedMachineId, setSelectedProjectKey, workspaceSlug]
  );

  const closeSettings = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  return { openSettings, closeSettings };
}
