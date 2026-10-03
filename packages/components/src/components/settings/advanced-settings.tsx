import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { settingsActiveTabAtom } from '@/atoms';
import { isElectronRenderer } from '@/lib/electron';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';
import { settingContainerClass } from '.';
import { BundledCapabilitiesSetting } from './bundled-capabilities-setting';
import { CliDaemonSetting } from './cli-daemon-setting';
import { CompactSection } from './compact-layout';
import { McpSetting } from './mcp-setting';
import { ProjectSettingsComponent } from './project-settings';
import type { SettingsTabId } from './settings-tabs';

const ADVANCED_VIEWS = ['advanced', 'mcp', 'projects'] as const;
type AdvancedView = (typeof ADVANCED_VIEWS)[number];

const isAdvancedView = (tab: SettingsTabId): tab is AdvancedView =>
  (ADVANCED_VIEWS as readonly SettingsTabId[]).includes(tab);

export function AdvancedSettings() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useAtom(settingsActiveTabAtom);
  const view: AdvancedView = isAdvancedView(activeTab) ? activeTab : 'advanced';

  return (
    <Tabs
      value={view}
      onValueChange={(next) => setActiveTab(next as AdvancedView)}
      className="flex h-full min-h-0 flex-col"
    >
      <TabsList className="h-8 self-start">
        <TabsTrigger value="advanced" className="px-2.5 text-xs">
          {t('settings.advanced.system')}
        </TabsTrigger>
        <TabsTrigger value="mcp" className="px-2.5 text-xs">
          {t('settings.advanced.mcp')}
        </TabsTrigger>
        <TabsTrigger value="projects" className="px-2.5 text-xs">
          {t('settings.tabs.projects')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="advanced" className="mt-5">
        <AdvancedSystemSettings />
      </TabsContent>
      <TabsContent value="mcp" className="mt-5">
        <McpSetting />
      </TabsContent>
      <TabsContent value="projects" className="mt-5 min-h-0 flex-1">
        <ProjectSettingsComponent />
      </TabsContent>
    </Tabs>
  );
}

function AdvancedSystemSettings() {
  return (
    <div className={settingContainerClass}>
      {isElectronRenderer() ? (
        <CompactSection>
          <CliDaemonSetting />
        </CompactSection>
      ) : null}
      <BundledCapabilitiesSetting />
    </div>
  );
}
