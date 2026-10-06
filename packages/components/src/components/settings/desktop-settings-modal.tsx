import { useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useSetAtom } from 'jotai';
import {
  settingsActiveTabAtom,
  settingsDialogOpenAtom,
  settingsSelectedMachineIdAtom,
  settingsSelectedProjectKeyAtom,
} from '@/atoms';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/ui';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';

import {
  useVisibleSettingsTabs,
  type SettingsSectionId,
  type SettingsTabId,
} from './settings-tabs';
import { GeneralSettingsComponent } from './general-setting';
import { AppearanceSettingsComponent } from './appearance-setting';
import { MachineAgentSettings } from './machine-agent-settings';
import { KeyboardShortcutsSetting } from './keyboard-shortcuts-setting';
import { AboutSettingsComponent } from './about-setting';
import { BrowserAccountsSetting } from './browser-accounts-setting';
import { AdvancedSettings } from './advanced-settings';
import { FocusScope, useListKeyboardNavigation } from '@/ui/focus-scope';

export function DesktopSettingsModal() {
  const [open, setOpen] = useAtom(settingsDialogOpenAtom);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
    >
      <DialogContent
        noAnimation
        overlayClassName="bg-black/25 dark:bg-black/45"
        className="flex h-[min(90vh,950px)] w-[min(1100px,calc(100vw-48px))] max-w-[1100px] flex-col gap-0 overflow-hidden rounded-2xl border-border/50 bg-background p-0 sm:rounded-2xl sm:p-0"
      >
        <SettingsModalBody />
      </DialogContent>
    </Dialog>
  );
}

function SettingsModalBody() {
  const { t } = useTranslation();
  const navigationScopeId = useId();
  const contentScopeId = useId();
  const [activeTab, setActiveTab] = useAtom(settingsActiveTabAtom);
  const setSelectedMachineId = useSetAtom(settingsSelectedMachineIdAtom);
  const setSelectedProjectKey = useSetAtom(settingsSelectedProjectKeyAtom);
  const visibleTabs = useVisibleSettingsTabs({ includeMultiMemberOnly: false });
  const navigationTabs = visibleTabs.filter((tab) => !tab.parent);

  const activeTabConfig = visibleTabs.find((tab) => tab.id === activeTab) ?? visibleTabs[0];
  const resolvedActiveTab = activeTabConfig.id;
  const navigationTabConfig =
    navigationTabs.find((tab) => tab.id === activeTabConfig.parent) ?? activeTabConfig;
  const selectTab = useCallback(
    (tabId: SettingsTabId) => {
      setSelectedMachineId(null);
      setSelectedProjectKey(null);
      setActiveTab(tabId);
    },
    [setActiveTab, setSelectedMachineId, setSelectedProjectKey]
  );
  const handleNavigationItemFocus = useCallback(
    (item: HTMLElement) => {
      const tabId = item.dataset.settingsTabId?.trim();
      if (tabId) selectTab(tabId as SettingsTabId);
    },
    [selectTab]
  );
  useListKeyboardNavigation({
    onItemFocus: handleNavigationItemFocus,
    scopeId: navigationScopeId,
  });
  const sectionOrder: SettingsSectionId[] = ['main', 'other'];
  const selfTitledTab = resolvedActiveTab === 'machines';
  const usesInternalScrolling = resolvedActiveTab === 'projects';

  return (
    <>
      <DialogDescription className="sr-only">{t('settings.title')}</DialogDescription>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <FocusScope
          id={navigationScopeId}
          role="navigation"
          aria-label={t('settings.title')}
          className="flex w-52 shrink-0 flex-col border-e border-border/40 bg-card/65"
        >
          <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-6">
            <div className="space-y-3">
              {sectionOrder.map((sectionId, index) => {
                const tabs = navigationTabs.filter((tab) => tab.section === sectionId);
                if (tabs.length === 0) return null;
                return (
                  <div
                    key={sectionId}
                    className={cn(index > 0 && 'border-t border-border/40 pt-3')}
                  >
                    <div className="space-y-1">
                      {tabs.map((tab) => {
                        const Icon = tab.icon;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            aria-current={navigationTabConfig.id === tab.id ? 'page' : undefined}
                            data-id={`settings:${tab.id}`}
                            data-scope-item="row"
                            data-settings-tab-id={tab.id}
                            className={cn(
                              'flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-sm font-normal transition-colors',
                              navigationTabConfig.id === tab.id
                                ? 'bg-foreground/[0.06] font-medium text-foreground'
                                : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
                            )}
                            onClick={() => selectTab(tab.id)}
                          >
                            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                            <span className="min-w-0 truncate">{t(tab.labelKey)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </nav>
        </FocusScope>

        <FocusScope
          id={contentScopeId}
          role="main"
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {selfTitledTab ? (
            <DialogTitle className="sr-only">{t(activeTabConfig.labelKey)}</DialogTitle>
          ) : (
            <header className="flex min-h-20 shrink-0 items-center px-7 pr-14">
              <DialogTitle className="text-xl font-medium leading-tight">
                {t(navigationTabConfig.labelKey)}
              </DialogTitle>
            </header>
          )}
          <div className="min-h-0 flex-1">
            {usesInternalScrolling ? (
              <div className={cn('h-full px-7 pb-7', selfTitledTab ? 'pt-7' : 'pt-0')}>
                <div className="mx-auto h-full max-w-5xl">
                  <SettingsTabContent tabId={resolvedActiveTab} />
                </div>
              </div>
            ) : (
              <ScrollArea className="h-full">
                <div className={cn('px-7 pb-7', selfTitledTab ? 'pt-7' : 'pt-0')}>
                  <div className="mx-auto max-w-5xl">
                    <SettingsTabContent tabId={resolvedActiveTab} />
                  </div>
                </div>
              </ScrollArea>
            )}
          </div>
        </FocusScope>
      </div>
    </>
  );
}

function SettingsTabContent({ tabId }: { tabId: SettingsTabId }) {
  // so Account shortcuts can select a machine before switching tabs.
  const [selectedMachineId, setSelectedMachineId] = useAtom(settingsSelectedMachineIdAtom);

  switch (tabId) {
    case 'preferences':
      return <GeneralSettingsComponent />;
    case 'appearance':
      return <AppearanceSettingsComponent />;
    case 'account':
    case 'workspace':
    case 'people':
    case 'billing':
    case 'ai-usage':
      return <GeneralSettingsComponent />;
    case 'advanced':
    case 'mcp':
    case 'projects':
      return <AdvancedSettings />;
    case 'agents':
      return (
        <MachineAgentSettings
          mode="agents"
          selectedMachineId={selectedMachineId}
          onSelectedMachineChange={setSelectedMachineId}
        />
      );
    case 'browser-accounts':
      return <BrowserAccountsSetting />;
    case 'machines':
      return (
        <MachineAgentSettings
          mode="machines"
          selectedMachineId={selectedMachineId}
          onSelectedMachineChange={setSelectedMachineId}
        />
      );
    case 'keyboard-shortcuts':
      return <KeyboardShortcutsSetting />;
    case 'about':
      return <AboutSettingsComponent />;
  }

  const exhaustive: never = tabId;
  return exhaustive;
}
