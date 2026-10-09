import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import {
  machineFlockKeys,
  serializeMachineFlockKey,
  type AgentConfigId,
  type AgentConfigMeta,
  type MachineId,
  type WorkspaceId,
} from '@molly/shared';

import { getAllAgentConfigAtom } from '../src/atoms/agents';
import { setMachineFlockRowsForMachineAtom } from '../src/atoms/machine-flock';
import { runtimeAtom, type WorkspaceRuntime } from '../src/atoms/runtime';
import { currentWorkspaceIdAtom, currentWorkspaceSlugAtom } from '../src/atoms/workspace-context';

/**
 * Regression for the v0.1.0 onboarding blocker: Connect-a-model showed
 * "built-in Molly catalog is not available" even after a valid key check
 * because `/onboarding` never bound the implicit local workspace, so
 * RuntimeProvider stayed idle and flock-published Molly configs were invisible.
 */
describe('onboarding catalog workspace binding', () => {
  const workspaceId = 'lw_onboarding_catalog' as WorkspaceId;
  const workspaceSlug = 'local';
  const machineId = 'machine-onboarding-catalog' as MachineId;
  const configId = 'molly-onboarding' as AgentConfigId;
  const molly: AgentConfigMeta = {
    id: configId,
    machineId,
    name: 'Molly',
    description: undefined,
    cliType: 'builtin',
    agentType: 'molly',
    env: {},
  };

  function seedPublishedMolly(store: ReturnType<typeof createStore>) {
    const key = machineFlockKeys.agentConfig(configId);
    store.set(setMachineFlockRowsForMachineAtom, {
      workspaceId,
      machineId,
      rows: {
        [serializeMachineFlockKey(key)]: { key, value: molly },
      },
      mode: 'replace',
    });
  }

  it('hides a flock-published Molly while no workspace runtime is bound', () => {
    const store = createStore();
    seedPublishedMolly(store);
    expect(store.get(getAllAgentConfigAtom)).toEqual([]);
  });

  it('surfaces the flock-published Molly once the local workspace runtime is bound', () => {
    const store = createStore();
    store.set(runtimeAtom, {
      workspaceId,
      workspaceSlug,
    } as unknown as WorkspaceRuntime);
    store.set(currentWorkspaceIdAtom, workspaceId);
    store.set(currentWorkspaceSlugAtom, workspaceSlug);
    seedPublishedMolly(store);
    expect(store.get(getAllAgentConfigAtom)).toEqual([molly]);
  });
});
