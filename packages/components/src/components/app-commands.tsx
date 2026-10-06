import { useRouter } from '@tanstack/react-router';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { currentWorkspaceSlugAtom, settingsDialogOpenAtom, toggleZenLayoutModeAtom } from '@/atoms';
import { taskQuickAddOpenAtom } from '@/atoms/tasks';
import { tasksFeatureEnabledAtom } from '@/atoms/settings';
import { getCommandKeybindings, useCommand } from '@/lib/commands';

import { useOpenSettings } from '@/hooks/use-open-settings';
import { nextCycledTheme, useTheme } from '../theme-provider';

/**
 * App-shell commands that aren't tied to a single session: browser-style history
 * back/forward (⌘[ / ⌘] on desktop) and Open Settings (⌘, on web; desktop uses the
 * native menu's own ⌘, accelerator). Mounted once inside the authed layout so the
 * bindings are live app-wide. The Electron menu→command IPC bridge stays in
 * `ElectronMenuHandler`; this component just owns the command definitions.
 */
export function AppCommands() {
  const { t } = useTranslation();
  const router = useRouter();
  const workspaceSlug = useAtomValue(currentWorkspaceSlugAtom);

  const settingsModalOpen = useAtomValue(settingsDialogOpenAtom);
  const { openSettings, closeSettings } = useOpenSettings();
  const { theme, setTheme } = useTheme();
  const toggleZenLayoutMode = useSetAtom(toggleZenLayoutModeAtom);

  // window.history.back()/forward() (not router.history — TanStack doesn't expose it);
  // both are safe no-ops at the history boundaries, so no `when` gating is needed.
  useCommand({
    id: 'nav.back',
    title: t('commands.nav.back', 'Back'),
    category: 'Navigation',
    keybindings: getCommandKeybindings('nav.back'),
    run: () => window.history.back(),
  });

  useCommand({
    id: 'nav.forward',
    title: t('commands.nav.forward', 'Forward'),
    category: 'Navigation',
    keybindings: getCommandKeybindings('nav.forward'),
    run: () => window.history.forward(),
  });

  useCommand({
    id: 'app.cycleTheme',
    title: t('commands.app.cycleTheme', 'Switch theme'),
    category: 'View',
    keybindings: getCommandKeybindings('app.cycleTheme'),
    run: () => {
      setTheme(nextCycledTheme(theme));
    },
  });

  useCommand({
    id: 'layout.toggleZenMode',
    title: t('commands.layout.toggleZenMode', 'Toggle Zen Layout'),
    category: 'View',
    keybindings: getCommandKeybindings('layout.toggleZenMode'),
    when: () => true,
    run: () => toggleZenLayoutMode(),
  });

  // ⌘, toggles settings: open from anywhere (remembering where we came from so the
  // close can return there), or — when already on a settings page — close back to it.
  const openTaskQuickAdd = useSetAtom(taskQuickAddOpenAtom);
  const tasksEnabled = useAtomValue(tasksFeatureEnabledAtom);

  // Registered only while the Tasks beta is on, so the palette and the keyboard
  // settings list stay free of commands the user has no feature for.
  useCommand(
    {
      id: 'tasks.quickAdd',
      title: t('commands.tasks.quickAdd', 'New Task'),
      category: 'Workspace',
      keybindings: getCommandKeybindings('tasks.quickAdd'),
      when: () => Boolean(workspaceSlug),
      run: () => {
        openTaskQuickAdd(true);
      },
    },
    tasksEnabled
  );

  useCommand(
    {
      id: 'tasks.open',
      title: t('commands.tasks.open', 'Open Tasks'),
      category: 'Workspace',
      keybindings: getCommandKeybindings('tasks.open'),
      when: () => Boolean(workspaceSlug),
      run: () => {
        if (!workspaceSlug) return;
        void router.navigate({
          to: '/$workspaceName/tasks',
          params: { workspaceName: workspaceSlug },
        });
      },
    },
    tasksEnabled
  );

  useCommand({
    id: 'workspace.openSettings',
    title: t('commands.workspace.openSettings', 'Open Settings'),
    category: 'Workspace',
    keybindings: getCommandKeybindings('workspace.openSettings'),
    when: () => Boolean(workspaceSlug),
    run: () => {
      if (!workspaceSlug) return;
      // Desktop: settings is a modal overlay — toggle it without leaving the page.

      if (settingsModalOpen) {
        closeSettings();
      } else {
        openSettings();
      }
      return;
    },
  });

  return null;
}
