import type { AgentConfigId, AgentConfigMeta, MachineId } from '@molly/shared';

export function selectDesignAgentConfigsForMachine(
  configs: readonly AgentConfigMeta[],
  machineId: MachineId
): AgentConfigMeta[] {
  return configs.filter((config) => config.machineId === machineId);
}

export function canSwitchDesignAgent({
  selection,
  config,
  sessionMachineId,
  isSessionWorking,
  activeAssistantTurnId,
}: {
  selection: { agentId: AgentConfigId; machineId: MachineId };
  config: AgentConfigMeta;
  sessionMachineId: MachineId;
  isSessionWorking: boolean;
  activeAssistantTurnId: string | null | undefined;
}): boolean {
  return (
    !isSessionWorking &&
    activeAssistantTurnId == null &&
    config.id === selection.agentId &&
    config.machineId === selection.machineId &&
    config.machineId === sessionMachineId
  );
}
