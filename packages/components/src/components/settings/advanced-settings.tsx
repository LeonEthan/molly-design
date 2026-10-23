import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { settingsActiveTabAtom } from '@/atoms';
import { isElectronRenderer } from '@/lib/electron';
import { SegmentedControl } from '@/components/shared/segmented-control';
import { cn } from '@/lib/utils';
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
    <div className="flex h-full min-h-0 flex-col">
      <SegmentedControl
        ariaLabel={t('settings.tabs.advanced')}
        size="sm"
        className="self-start"
        value={view}
        onChange={setActiveTab}
        options={[
          { value: 'advanced', label: t('settings.advanced.system') },
          { value: 'mcp', label: t('settings.advanced.mcp') },
          { value: 'projects', label: t('settings.tabs.projects') },
        ]}
      />
      <div className={cn('mt-5', view === 'projects' && 'min-h-0 flex-1')}>
        {view === 'advanced' ? <AdvancedSystemSettings /> : null}
        {view === 'mcp' ? <McpSetting /> : null}
        {view === 'projects' ? <ProjectSettingsComponent /> : null}
      </div>
    </div>
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
