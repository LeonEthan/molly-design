import type { AgentConfigMeta, MachineId } from '@molly/shared';

/** UI eligibility only; the runtime independently validates the execution target. */
export function isOnboardingMollyConfig(
  config: AgentConfigMeta,
  machineId: MachineId | null
): boolean {
  return (
    machineId !== null &&
    config.machineId === machineId &&
    config.cliType === 'builtin' &&
    config.agentType === 'molly' &&
    config.customAcp == null &&
    config.runtimeOverrides == null
  );
}

/**
 * Eligible built-in Molly configs on this machine, sorted deterministically
 * (name, then id) so onboarding can auto-select `[0]` without a user pick.
 */
export function getOnboardingMollyConfigs(
  configs: readonly AgentConfigMeta[],
  machineId: MachineId | null
): AgentConfigMeta[] {
  return configs
    .filter((candidate) => isOnboardingMollyConfig(candidate, machineId))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}
