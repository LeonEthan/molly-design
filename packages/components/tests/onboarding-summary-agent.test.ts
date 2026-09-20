import { describe, expect, it } from 'vitest';
import type { AgentConfigId, AgentConfigMeta, MachineId } from '@molly/shared';
import { resolveDesktopOnboardingSummaryAgent } from '../src/components/onboarding/onboarding-overlay';
import { isOnboardingMollyConfig } from '../src/components/onboarding/onboarding-agent';

const machineId = 'synthetic-machine' as MachineId;
const config: AgentConfigMeta = {
  id: 'synthetic-molly' as AgentConfigId,
  machineId,
  name: 'Molly',
  description: undefined,
  cliType: 'builtin',
  agentType: 'molly',
  env: {},
};
const provider = { kind: 'agentConfig' as const, agentConfigId: config.id, agentName: config.name };

describe('embedded onboarding eligibility and summary', () => {
  it('requires the exact selected local Molly to remain published', () => {
    expect(resolveDesktopOnboardingSummaryAgent(provider, [config], machineId)).toEqual({
      state: 'ready',
      name: 'Molly',
    });
    expect(resolveDesktopOnboardingSummaryAgent(provider, [], machineId)).toEqual({
      state: 'missing',
      name: 'Molly',
    });
    expect(resolveDesktopOnboardingSummaryAgent(null, [config], machineId)).toEqual({
      state: 'missing',
      name: undefined,
    });
    expect(resolveDesktopOnboardingSummaryAgent(provider, [config], null).state).not.toBe('ready');
  });
  it.each(['claude', 'codex', 'kimi', 'grok', 'deepseek', 'pi'])(
    'retires old %s even when it has the selected id',
    (agentType) => {
      const legacy = { ...config, agentType };
      expect(isOnboardingMollyConfig(legacy, machineId)).toBe(false);
      expect(resolveDesktopOnboardingSummaryAgent(provider, [legacy], machineId).state).toBe(
        'retired'
      );
    }
  );
  it.each<Partial<AgentConfigMeta>>([
    { cliType: 'registry' },
    { cliType: 'custom' },
    { runtimeOverrides: {} },
    { machineId: 'other-machine' as MachineId },
  ])('rejects alternate target or launcher %j', (override) => {
    const target = { ...config, ...override };
    expect(isOnboardingMollyConfig(target, machineId)).toBe(false);
    expect(resolveDesktopOnboardingSummaryAgent(provider, [target], machineId).state).toBe(
      'retired'
    );
  });
  it('never promotes a persisted installation task into an executable config', () => {
    const pending = {
      kind: 'providerSetup' as const,
      providerSetupId: config.id,
      agentName: 'Previous setup',
    };
    expect(resolveDesktopOnboardingSummaryAgent(pending, [config], machineId)).toEqual({
      state: 'retired',
      name: 'Previous setup',
    });
  });
});
