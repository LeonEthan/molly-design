import { useTranslation } from 'react-i18next';
import type { AgentConfigMeta, ProviderSetupTask } from '@molly/shared';
import { CompactSection } from './compact-layout';

/** Read-only migration inventory; never mount retired provider runtime controls. */
export function AgentEngineCatalog({
  configs,
  setups = [],
}: {
  configs: readonly AgentConfigMeta[];
  setups?: readonly ProviderSetupTask[];
}) {
  const { t } = useTranslation();
  const legacy = configs.filter(
    (config) => config.cliType !== 'builtin' || config.agentType !== 'molly'
  );
  return (
    <CompactSection
      title={t('settings.models.engineTitle')}
      description={t('settings.models.engineHint')}
    >
      <div className="space-y-4 px-5 pb-5 pt-1 text-sm leading-relaxed">
        <p>{t('settings.models.engineSelectionHint')}</p>
        {(legacy.length > 0 || setups.length > 0) && (
          <div className="space-y-2 border-t pt-3">
            <h3 className="font-medium">{t('settings.models.legacyTitle')}</h3>
            <p className="text-xs text-muted-foreground">{t('settings.models.legacyHint')}</p>
            <ul className="space-y-1">
              {legacy.map((config) => (
                <li key={config.id} className="break-words">
                  {config.name} · {t('settings.models.legacyReadOnly')}
                </li>
              ))}
              {setups.map((setup) => (
                <li key={`setup-${setup.id}`} className="break-words">
                  {setup.config.name} · {t('settings.models.legacySetupRetired')}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </CompactSection>
  );
}
