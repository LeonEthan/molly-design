import { describe, expect, it } from 'vitest';
import type { AgentConfigId, AgentConfigMeta, MachineId } from '@molly/shared';

import {
  canSwitchDesignAgent,
  selectDesignAgentConfigsForMachine,
} from '../src/lib/design-agent-switch';

const config = (
  id: string,
  cliType: AgentConfigMeta['cliType'],
  agentType: string,
  machineId = 'machine-1'
): AgentConfigMeta => ({
  id: id as AgentConfigId,
  machineId: machineId as MachineId,
  name: id,
  cliType,
  agentType,
  env: {},
});

describe('selectDesignAgentConfigsForMachine', () => {
  it('keeps every available config on the design session machine without an Agent-type list', () => {
    const configs = [
      config('codex', 'builtin', 'codex'),
      config('kimi', 'builtin', 'kimi'),
      config('grok', 'builtin', 'grok'),
      config('pi', 'registry', 'pi-acp'),
      config('claude', 'builtin', 'claude'),
      config('custom', 'custom', 'custom'),
      config('elsewhere', 'builtin', 'codex', 'machine-2'),
    ];

    expect(
      selectDesignAgentConfigsForMachine(configs, 'machine-1' as MachineId).map(
        (candidate) => candidate.id
      )
    ).toEqual(['codex', 'kimi', 'grok', 'pi', 'claude', 'custom']);
  });
});

describe('canSwitchDesignAgent', () => {
  const codex = config('codex', 'builtin', 'codex');
  const selection = { agentId: codex.id, machineId: codex.machineId };
  const allowed = {
    selection,
    config: codex,
    sessionMachineId: codex.machineId,
    isSessionWorking: false,
    activeAssistantTurnId: null,
  };

  it('allows an available same-machine config while the design session is idle', () => {
    expect(canSwitchDesignAgent(allowed)).toBe(true);
  });

  it('blocks switching while work or an assistant turn remains active', () => {
    expect(canSwitchDesignAgent({ ...allowed, isSessionWorking: true })).toBe(false);
    expect(canSwitchDesignAgent({ ...allowed, activeAssistantTurnId: 'turn-1' })).toBe(false);
  });

  it('blocks a config or selection from another machine', () => {
    expect(canSwitchDesignAgent({ ...allowed, sessionMachineId: 'machine-2' as MachineId })).toBe(
      false
    );
    expect(
      canSwitchDesignAgent({
        ...allowed,
        selection: { ...selection, machineId: 'machine-2' as MachineId },
      })
    ).toBe(false);
  });
});
