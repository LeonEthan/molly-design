import { Flock } from '@loro-dev/flock-wasm';
import {
  ACP_CAPABILITY_CACHE_VERSION,
  getMachineRoomId,
  getSessionRoomId,
  type AcpCapabilityCacheEntry,
  type AgentConfigMeta,
  type MachineId,
  type SessionId,
  type SessionMeta,
} from '@molly/shared';
import { encodeMollyModelOption } from '@molly/shared/embedded-harness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoroDocumentManager } from '@/lib/loro/doc';
import {
  selectDefaultAgentConfigForCreate,
  buildCliHistoryInputConfig,
  resolveTurnDispatchConfigFromInputConfig,
  sendSessionChatResult,
  validateSessionChatTarget,
  validateSessionCreateOptions,
  type ResolvedTurnDispatchConfig,
} from './session';

const machineId = 'synthetic-machine' as MachineId;
const modelId = encodeMollyModelOption('synthetic-connection', 'synthetic-model');
const modelSelection = {
  connectionId: 'synthetic-connection',
  modelId: 'synthetic-model',
  thinking: 'high' as const,
};
const config: AgentConfigMeta = {
  id: 'synthetic-molly',
  machineId,
  name: 'Molly',
  cliType: 'builtin',
  agentType: 'molly',
  env: {},
};
const capability: AcpCapabilityCacheEntry = {
  cliType: 'builtin',
  agentType: 'molly',
  cacheVersion: ACP_CAPABILITY_CACHE_VERSION,
  provenance: 'runtime',
  fetchedAt: 1,
  modes: [],
  models: [{ modelId, name: 'Synthetic model' }],
  modelReasoningEfforts: { [modelId]: ['off', 'high'] },
  configOptions: [
    {
      id: 'reasoning_effort',
      name: 'Thinking',
      category: 'thought_level',
      type: 'select',
      currentValue: 'off',
      options: [
        { value: 'off', name: 'Off' },
        { value: 'high', name: 'High' },
      ],
    },
  ],
};
const dispatch: ResolvedTurnDispatchConfig = {
  modelId,
  configOptionValues: { reasoning_effort: 'high' },
};
const auth = {
  token: 'synthetic-unused',
  userId: 'synthetic-user',
  userName: 'Synthetic',
  userEmail: 'synthetic@example.invalid',
  machineId,
  machineName: 'Synthetic machine',
};
const workspace = { id: 'synthetic-workspace', name: 'Synthetic', slug: null, role: 'owner' };

// Real catalog projection, with read-only storage/transport boundaries. Any
// accidental materialization fails instead of silently passing a mock assertion.
function fixture(
  target: AgentConfigMeta = config,
  catalog: AcpCapabilityCacheEntry | null = capability,
  history?: unknown[]
) {
  const flock = new Flock('synthetic-machine');
  flock.set(['agentConfig', target.id], target);
  if (catalog) flock.set(['acpCapability', target.id], catalog);
  flock.commit();
  const session: SessionMeta = {
    id: 'synthetic-session' as SessionId,
    machineId,
    cliType: 'builtin',
    agentType: 'codex',
    agentConfigId: target.id,
    userId: auth.userId,
    createdAt: '2026-09-19T00:00:00.000Z',
  };
  const manager = {
    syncMetaOrThrow: async () => {},
    syncFlockDocOrThrow: async () => {},
    syncDocOrThrow: async () => {
      if (!history) throw new Error('must not read mutable history');
    },
    repo: {
      getMeta: () => ({
        scan: async ({ prefix }: { prefix: string[] }) =>
          prefix[0] === 'e' ? [{ key: ['e', getMachineRoomId(machineId)], value: true }] : [],
      }),
      getDocMeta: async (id: string) => {
        if (id === getMachineRoomId(machineId))
          return { meta: { id: machineId, name: 'Synthetic machine' } };
        if (id === getSessionRoomId(session.id)) return { meta: session };
        return null;
      },
      openFlockDoc: async (id: string) => {
        if (id !== 'synthetic-workspace:mf:synthetic-machine')
          throw new Error('unexpected catalog');
        return { flock };
      },
      upsertDocMeta: async () => {
        throw new Error('must not write metadata');
      },
    },
    getOrCreateSessionDoc: async () => {
      if (history) return { sessionData: { history: { readAll: () => history } } };
      throw new Error('must not materialize a session');
    },
  } as unknown as LoroDocumentManager;
  return {
    manager,
    session,
    flock,
    validateChat: (selection: ResolvedTurnDispatchConfig = {}) =>
      validateSessionChatTarget({
        auth,
        workspace,
        manager,
        sessionId: session.id,
        dispatchConfig: selection,
        skipMachineAvailabilityCheck: true,
      }),
    validate: (selection = dispatch, options = {}) =>
      validateSessionCreateOptions({
        auth,
        workspace,
        manager,
        options: { agentConfig: target.id, ...options },
        skipMachineAvailabilityCheck: true,
        dispatchConfig: selection,
      }),
  };
}

beforeEach(() => {
  for (const name of [
    'MOLLY_SESSION_ID',
    'LODY_SESSION_ID',
    'MOLLY_AGENT_CONFIG_ID',
    'LODY_AGENT_CONFIG_ID',
  ])
    vi.stubEnv(name, '');
});
afterEach(() => vi.unstubAllEnvs());

describe('embedded Session pre-accept validation through the real catalog', () => {
  it('retains a structured-only model selection through acceptance and history conversion', async () => {
    const selected = { ...modelSelection };
    const accepted = await fixture().validate({ modelSelection: selected });
    expect(accepted.modelSelection).toEqual(modelSelection);
    const history = buildCliHistoryInputConfig({
      ...accepted,
      prompt: 'Synthetic',
      cliType: 'builtin',
      agentType: 'molly',
    });
    const inherited = resolveTurnDispatchConfigFromInputConfig(history, config);
    selected.connectionId = 'later-caller-change';
    expect(history.modelSelection).toEqual(modelSelection);
    expect(inherited?.modelSelection).toEqual(modelSelection);
  });

  it('rejects conflicting structured and projected input before acceptance', async () => {
    await expect(fixture().validate({ modelSelection, modelId: 'conflicting' })).rejects.toThrow(
      'harness_model_selection_conflict'
    );
  });

  it('freezes an explicitly selected supported model without materialization', async () => {
    await expect(fixture().validate()).resolves.toMatchObject({
      ...dispatch,
      inheritSessionDefaults: false,
    });
  });

  it.each(['codex', 'claude', 'kimi'])(
    'rejects retired %s targets before acceptance',
    async (agentType) => {
      await expect(fixture({ ...config, agentType }).validate()).rejects.toThrow(
        'legacy_harness_execution_disabled'
      );
    }
  );

  it('rejects launch overrides even on a Molly config', async () => {
    await expect(fixture({ ...config, runtimeOverrides: {} }).validate()).rejects.toThrow(
      'harness_launch_override_forbidden'
    );
  });

  it.each([
    null,
    { ...capability, provenance: undefined },
    { ...capability, cacheVersion: ACP_CAPABILITY_CACHE_VERSION - 1 },
    { ...capability, agentType: 'codex' },
  ])('rejects missing, stale or non-Molly catalog authority %#', async (catalog) => {
    await expect(fixture(config, catalog).validate()).rejects.toThrow(
      'harness_model_catalog_unavailable'
    );
  });

  it('does not choose the catalog default when no model was selected', async () => {
    await expect(fixture().validate({})).rejects.toThrow();
  });

  it('validates effort against the chosen model, not the displayed option snapshot', async () => {
    await expect(
      fixture(config, { ...capability, modelReasoningEfforts: { [modelId]: ['off'] } }).validate()
    ).rejects.toThrow('harness_model_selection_unavailable');
  });

  it('accepts target-specific effort even when absent from another model option snapshot', async () => {
    await expect(
      fixture(config, { ...capability, configOptions: [] }).validate()
    ).resolves.toMatchObject(dispatch);
  });

  it.each([
    { modeId: 'legacy-mode' },
    { configOptionValues: { fast: true } },
    { modelId: encodeMollyModelOption('removed-connection', 'removed-model') },
  ])(
    'rejects unsupported inherited controls instead of silently dropping them %#',
    async (inherited) => {
      await expect(
        fixture().validate({
          frozenInheritedInputConfig: {
            cliType: 'builtin',
            agentType: 'molly',
            ...dispatch,
            ...inherited,
          },
        })
      ).rejects.toThrow();
    }
  );

  it('does not resolve a Role target id as another config name', async () => {
    await expect(
      fixture({ ...config, name: 'missing-role-target' }).validate(dispatch, {
        agentRoleId: 'synthetic-role',
        agentConfig: 'missing-role-target',
      })
    ).rejects.toThrow('agent_role_target_unavailable');
  });

  it('rejects a catalog row from another machine', async () => {
    await expect(
      fixture({ ...config, machineId: 'other-machine' as MachineId }).validate()
    ).rejects.toThrow('No agent config exists');
  });

  it('rejects chatting with a legacy Session before history writes or daemon contact', async () => {
    const { manager, session } = fixture();
    await expect(
      sendSessionChatResult(auth, workspace, manager, session.id, 'Synthetic prompt', dispatch)
    ).rejects.toThrow('legacy_harness_execution_disabled');
  });

  it.each([
    ['missing', 'harness_target_unavailable'],
    ['retired', 'legacy_harness_execution_disabled'],
    ['override', 'harness_launch_override_forbidden'],
  ])('rejects a Molly Session whose current target is %s before dispatch', async (kind, error) => {
    const { manager, session, flock } = fixture();
    session.agentType = 'molly';
    if (kind === 'missing') session.agentConfigId = 'missing';
    else
      flock.set(['agentConfig', config.id], {
        ...config,
        ...(kind === 'retired' ? { agentType: 'codex' } : { runtimeOverrides: {} }),
      });
    flock.commit();
    await expect(
      sendSessionChatResult(auth, workspace, manager, session.id, 'Synthetic prompt', dispatch)
    ).rejects.toThrow(error);
  });
});

describe('embedded chat config acceptance', () => {
  const historyTurn = (selection: ResolvedTurnDispatchConfig = dispatch) => ({
    id: 'synthetic-prior-turn',
    role: 'user',
    items: [],
    inputConfig: { cliType: 'builtin', agentType: 'molly', ...selection },
  });

  it.each(['inherit', 'thinking', 'replace'] as const)(
    'handles structured-only history without losing selection: %s',
    async (kind) => {
      const previous = { ...modelSelection };
      const replacement = { ...modelSelection, connectionId: 'replacement-connection' };
      const replacementId = encodeMollyModelOption(replacement.connectionId, replacement.modelId);
      const history = [historyTurn({ modelSelection: previous })];
      const target = fixture(
        config,
        {
          ...capability,
          models: [...capability.models, { modelId: replacementId, name: 'Replacement' }],
          modelReasoningEfforts: { ...capability.modelReasoningEfforts, [replacementId]: ['high'] },
        },
        history
      );
      target.session.agentType = 'molly';
      const explicit =
        kind === 'thinking'
          ? { configOptionValues: { reasoning_effort: 'off' } }
          : kind === 'replace'
            ? { modelSelection: replacement }
            : {};
      const accepted = await target.validateChat(explicit);
      const expected =
        kind === 'replace'
          ? replacement
          : {
              ...modelSelection,
              thinking: kind === 'thinking' ? 'off' : 'high',
            };
      expect(accepted.dispatchConfig.modelSelection).toEqual(expected);
      previous.connectionId = 'changed-after-acceptance';
      await expect(target.validateChat(accepted.dispatchConfig)).resolves.toEqual(accepted);
    }
  );

  it.each([
    { mcpServerIds: undefined },
    { mcpServerIds: [] },
    { mcpServerIds: ['synthetic-replacement'] },
  ])(
    'freezes target MCP selection and preserves explicit empty replacement %#',
    async ({ mcpServerIds }) => {
      const previousIds = ['synthetic-target-mcp'];
      const history = [historyTurn({ ...dispatch, mcpServerIds: previousIds })];
      const target = fixture(config, capability, history);
      target.session.agentType = 'molly';
      const expected = [...(mcpServerIds ?? previousIds)];
      const accepted = await target.validateChat({ mcpServerIds });
      expect(accepted.dispatchConfig.mcpServerIds).toEqual(expected);
      previousIds.push('late-history-mcp');
      mcpServerIds?.push('late-caller-mcp');
      const replay = await target.validateChat(accepted.dispatchConfig);
      expect(replay.dispatchConfig.mcpServerIds).toEqual(expected);
    }
  );

  it('freezes the target history model, thinking, exact config and invoking tool gate', async () => {
    const history = [historyTurn({ ...dispatch, taskToolsEnabled: true })];
    const target = fixture(config, capability, history);
    target.session.agentType = 'molly';
    const accepted = await target.validateChat({ taskToolsEnabled: false });
    expect(accepted.dispatchConfig).toEqual({
      ...dispatch,
      modelSelection,
      modeId: undefined,
      agentConfigId: config.id,
      taskToolsEnabled: false,
      inheritSessionDefaults: false,
    });
    history[0] = historyTurn({ modelId: 'changed-after-acceptance' });
    await expect(target.validateChat(accepted.dispatchConfig)).resolves.toEqual(accepted);
  });

  it('revalidates a frozen selection without reopening mutable target history', async () => {
    const target = fixture();
    target.session.agentType = 'molly';
    await expect(
      target.validateChat({ ...dispatch, inheritSessionDefaults: false })
    ).resolves.toMatchObject({
      dispatchConfig: { ...dispatch, agentConfigId: config.id, inheritSessionDefaults: false },
    });
  });

  it('rejects rebinding of an accepted target', async () => {
    const target = fixture();
    target.session.agentType = 'molly';
    await expect(
      target.validateChat({
        ...dispatch,
        agentConfigId: 'previous-target',
        inheritSessionDefaults: false,
      })
    ).rejects.toThrow('harness_target_unavailable');
  });

  it.each([
    null,
    { ...capability, provenance: undefined },
    { ...capability, cacheVersion: ACP_CAPABILITY_CACHE_VERSION - 1 },
    { ...capability, agentType: 'codex' },
  ])('rejects an unavailable chat catalog before history writes %#', async (catalog) => {
    const target = fixture(config, catalog);
    target.session.agentType = 'molly';
    await expect(
      sendSessionChatResult(
        auth,
        workspace,
        target.manager,
        target.session.id,
        'Synthetic follow-up',
        { ...dispatch, inheritSessionDefaults: false }
      )
    ).rejects.toThrow('harness_model_catalog_unavailable');
  });

  it.each([
    {},
    { ...dispatch, modeId: 'legacy-mode' },
    { ...dispatch, configOptionValues: { fast: true } },
    { ...dispatch, configOptionValues: { reasoning_effort: 'xhigh' } },
    { ...dispatch, modelId: encodeMollyModelOption('removed', 'model') },
  ])(
    'rejects missing or unsupported target history settings without a default %#',
    async (selection) => {
      const target = fixture(config, capability, [historyTurn(selection)]);
      target.session.agentType = 'molly';
      await expect(target.validateChat()).rejects.toThrow();
    }
  );

  it('validates explicit replacements against the selected model effort ladder', async () => {
    const target = fixture(config, { ...capability, configOptions: [] }, [
      historyTurn({ modelId: 'removed' }),
    ]);
    target.session.agentType = 'molly';
    await expect(target.validateChat(dispatch)).resolves.toMatchObject({
      dispatchConfig: dispatch,
    });
  });
});

describe('embedded create target defaults', () => {
  const legacy = { ...config, id: 'legacy', agentType: 'codex' };
  it('allows only the unique eligible engine, never a legacy target', () => {
    expect(selectDefaultAgentConfigForCreate([legacy, config], machineId)).toEqual(config);
    expect(selectDefaultAgentConfigForCreate([legacy], machineId)).toBeUndefined();
    expect(
      selectDefaultAgentConfigForCreate([config, { ...config, id: 'second' }], machineId)
    ).toBeUndefined();
  });

  it('requires the exact current target, even if another Molly config exists', () => {
    const { session } = fixture();
    expect(
      selectDefaultAgentConfigForCreate([config], machineId, {
        ...session,
        agentConfigId: config.id,
      })
    ).toEqual(config);
    expect(
      selectDefaultAgentConfigForCreate([config], machineId, {
        ...session,
        agentConfigId: 'missing',
      })
    ).toBeUndefined();
    expect(
      selectDefaultAgentConfigForCreate([config], machineId, {
        ...session,
        machineId: 'other' as MachineId,
      })
    ).toBeUndefined();
  });
});
