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
