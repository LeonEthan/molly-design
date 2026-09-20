import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import type { AgentConfigId, AgentConfigMeta, MachineId } from '@molly/shared';
import { Button } from '@/ui/button';
import { getAllAgentConfigAtom } from '@/atoms/agents';
import { localMachineIdAtom } from '@/atoms/local-probe';
import type { DesktopOnboardingProviderSelection } from '@/atoms/onboarding';
import { useMachineFlockAgentConfigsForMachineIds } from '@/hooks/use-machine-flock-agent-configs';
import { ModelConnectionSetting } from '@/components/settings/model-connection-setting';
import { OnboardingShell, OnboardingBackButton, OnboardingNextButton } from '../onboarding-shell';
import { isOnboardingMollyConfig } from '../onboarding-agent';

type ProvidersScreenProps = {
  onBack: () => void;
  onSkip: () => void;
  onNext: (selection: DesktopOnboardingProviderSelection) => void;
};

export type ProvidersScreenViewProps = ProvidersScreenProps & {
  configs: readonly AgentConfigMeta[];
  localMachineId: MachineId | null;
  connections?: ReactNode;
};

export function ProvidersScreenView({
  configs,
  localMachineId,
  connections,
  onBack,
  onSkip,
  onNext,
}: ProvidersScreenViewProps) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<{ id: AgentConfigId; machineId: MachineId } | null>(
    null
  );
  const available = configs.filter((config) => isOnboardingMollyConfig(config, localMachineId));
  const selected = available.find(
    (config) => config.id === selection?.id && config.machineId === selection.machineId
  );
  return (
    <OnboardingShell
      stepKey="providers"
      title={t('onboarding.models.title')}
      description={t('onboarding.models.description')}
      secondaryAction={<OnboardingBackButton onClick={onBack} />}
      primaryAction={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onSkip}>
            {t('onboarding.firstTask.skip')}
          </Button>
          <OnboardingNextButton
            disabled={!selected}
            onClick={() => {
              if (selected)
                onNext({
                  kind: 'agentConfig',
                  agentConfigId: selected.id,
                  agentName: selected.name,
                });
            }}
          />
        </div>
      }
    >
      <div className="space-y-4">
        {connections}
        <p className="text-sm text-muted-foreground">{t('onboarding.models.selectionHint')}</p>
        {available.length === 0 ? (
          <p role="status" className="text-sm">
            {t('onboarding.models.unavailable')}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {available.map((config) => (
              <Button
                key={config.id}
                variant={selected === config ? 'default' : 'outline'}
                aria-pressed={selected === config}
                onClick={() => setSelection({ id: config.id, machineId: config.machineId })}
              >
                {config.name}
              </Button>
            ))}
          </div>
        )}
      </div>
    </OnboardingShell>
  );
}

export function ProvidersScreen(props: ProvidersScreenProps) {
  const localMachineId = useAtomValue(localMachineIdAtom);
  const machineIds = useMemo(
    () => (localMachineId === null ? [] : [localMachineId]),
    [localMachineId]
  );
  useMachineFlockAgentConfigsForMachineIds(machineIds, { syncRemote: false });
  const configs = useAtomValue(getAllAgentConfigAtom);
  return (
    <ProvidersScreenView
      {...props}
      configs={configs}
      localMachineId={localMachineId}
      connections={<ModelConnectionSetting />}
    />
  );
}
