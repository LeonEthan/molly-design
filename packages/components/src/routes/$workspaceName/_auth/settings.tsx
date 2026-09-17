import { useEffect } from 'react';
import { createFileRoute, useLocation, useNavigate } from '@tanstack/react-router';
import { useSetAtom } from 'jotai';
import type { MachineId } from '@molly/shared';
import {
  settingsActiveTabAtom,
  settingsDialogOpenAtom,
  settingsSelectedMachineIdAtom,
  settingsSelectedProjectKeyAtom,
} from '@/atoms';
import { resolveSettingsCloseTo } from '@/lib/settings-navigation';
import {
  getActiveSettingsTabId,
  SETTINGS_DEFAULT_TAB,
} from '@/components/settings/settings-tabs';

type SettingsSearch = { from?: string };

export const Route = createFileRoute('/$workspaceName/_auth/settings')({
  component: SettingsLayoutComponent,
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({
    from: typeof search.from === 'string' ? search.from : undefined,
  }),
});

export function SettingsLayoutComponent() {
  const location = useLocation();
  const navigate = useNavigate();
  const { workspaceName } = Route.useParams();
  const search = location.search as Record<string, unknown>;
  const activeTabId = getActiveSettingsTabId(location.pathname) ?? SETTINGS_DEFAULT_TAB;
  const setOpen = useSetAtom(settingsDialogOpenAtom);
  const setTab = useSetAtom(settingsActiveTabAtom);
  const setMachine = useSetAtom(settingsSelectedMachineIdAtom);
  const setProject = useSetAtom(settingsSelectedProjectKeyAtom);

  useEffect(() => {
    setTab(activeTabId);
    setMachine(typeof search.machine === 'string' ? (search.machine as MachineId) : null);
    setProject(typeof search.project === 'string' ? search.project : null);
    setOpen(true);
    const closeTo = resolveSettingsCloseTo(typeof search.from === 'string' ? search.from : undefined);
    if (closeTo) {
      void navigate({ to: closeTo, replace: true });
    } else {
      void navigate({ to: '/$workspaceName/chat', params: { workspaceName }, replace: true });
    }
  }, [activeTabId, navigate, search.from, search.machine, search.project, setMachine, setOpen, setProject, setTab, workspaceName]);

  return null;
}
