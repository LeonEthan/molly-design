import { describe, expect, it } from 'vitest';

import {
  AGENT_ROLE_VERSION,
  canManageAgentRole,
  canReadAgentRole,
  isAgentRoleContentEqual,
  isSensitiveAgentRoleConfigOptionKey,
  DEFAULT_AGENT_ROLE_EMOJI,
  getAgentRoleEmoji,
  getAgentRoleMentionSlug,
  listAccessibleAgentRoles,
  normalizeAgentRole,
  normalizeAgentRoleEmoji,
  normalizeAgentRoleMentionSlug,
  normalizeAgentRoleRunConfig,
  resolveAgentRoleAvailability,
  selectMentionableAgentRoles,
  type AgentRole,
  type AgentRoleAvailabilityContext,
} from '../src/agent-role';
import type { AgentConfigId, AgentRoleId, MachineId } from '../src/ids';
import { ACP_CAPABILITY_CACHE_VERSION } from '../src/ai';
import { encodeMollyModelOption } from '../src/embedded-harness';

const modelId = encodeMollyModelOption('synthetic-connection', 'k3-256k');
const target = (machineId = 'machine-1' as MachineId) => ({
  machineId,
  cliType: 'builtin' as const,
  agentType: 'molly',
});
const capability = {
  cliType: 'builtin' as const,
  agentType: 'molly',
  cacheVersion: ACP_CAPABILITY_CACHE_VERSION,
  provenance: 'runtime' as const,
  fetchedAt: 1,
  modes: [],
  models: [{ modelId, name: 'Synthetic Kimi' }],
  modelReasoningEfforts: { [modelId]: ['off', 'high'] },
};

const role = (overrides: Partial<AgentRole> = {}): AgentRole => ({
  v: AGENT_ROLE_VERSION,
  id: 'role-1' as AgentRoleId,
  ownerUserId: 'user-1',
  visibility: 'private',
  name: 'Reviewer',
  machineId: 'machine-1' as MachineId,
  agentConfigId: 'config-1' as AgentConfigId,
  runConfig: { modelId },
  revision: 1,
  createdAt: 10,
  updatedAt: 10,
  ...overrides,
});

const context = (
  overrides: Partial<AgentRoleAvailabilityContext> = {}
): AgentRoleAvailabilityContext => ({
  authorizedMachineIds: new Set(['machine-1' as MachineId]),
  onlineMachineIds: new Set(['machine-1' as MachineId]),
  agentConfigs: new Map([['config-1' as AgentConfigId, target()]]),
  capabilitiesByMachineId: new Map([['machine-1' as MachineId, { 'config-1': capability }]]),
  loadedAgentConfigMachineIds: new Set(['machine-1' as MachineId]),
  ...overrides,
});

describe('agent role mention slug', () => {
  it('keeps non-ASCII text but removes what an `@` token cannot carry', () => {
    expect(normalizeAgentRoleMentionSlug('  @Code Reviewer  ')).toBe('Code-Reviewer');
    expect(normalizeAgentRoleMentionSlug('代码 审阅')).toBe('代码-审阅');
    // A control character is invisible in the composer but still part of the
    // token, so a slug carrying one could never be typed back.
    expect(normalizeAgentRoleMentionSlug('a\u0007b')).toBe('ab');
    expect(normalizeAgentRoleMentionSlug('--x--')).toBe('x');
  });

  it('caps the slug by code point, not code unit', () => {
    const slug = normalizeAgentRoleMentionSlug('😀'.repeat(60));
    expect(Array.from(slug)).toHaveLength(40);
  });

  it('derives the mention token from the one authored name', () => {
    expect(getAgentRoleMentionSlug({ name: 'Code Reviewer' })).toBe('Code-Reviewer');
    // Renaming the Role renames its mention; the range still carries the id.
    expect(getAgentRoleMentionSlug({ name: 'Deep Reviewer' })).toBe('Deep-Reviewer');
  });
});

describe('agent role emoji', () => {
  it('keeps one short glyph and drops what would smuggle in a second line', () => {
    expect(normalizeAgentRoleEmoji('🔍')).toBe('🔍');
    expect(normalizeAgentRoleEmoji('  🧑\u200d💻  ')).toBe('🧑\u200d💻');
    expect(normalizeAgentRoleEmoji('a b')).toBe('ab');
    expect(normalizeAgentRoleEmoji('😀'.repeat(20))).toBe('😀'.repeat(8));
    expect(normalizeAgentRoleEmoji('   ')).toBeUndefined();
    expect(normalizeAgentRoleEmoji(42)).toBeUndefined();
  });

  it('falls back to one shared default so every Role reads the same', () => {
    expect(getAgentRoleEmoji({ emoji: '🔍' })).toBe('🔍');
    expect(getAgentRoleEmoji({})).toBe(DEFAULT_AGENT_ROLE_EMOJI);
    expect(getAgentRoleEmoji({ emoji: '' })).toBe(DEFAULT_AGENT_ROLE_EMOJI);
  });
});

describe('agent role run config', () => {
  it('refuses secret-shaped option keys on write and on read', () => {
    expect(isSensitiveAgentRoleConfigOptionKey('api_key')).toBe(true);
    expect(isSensitiveAgentRoleConfigOptionKey('bearer')).toBe(true);
    expect(isSensitiveAgentRoleConfigOptionKey('thought_level')).toBe(false);

    expect(
      normalizeAgentRoleRunConfig({
        modelId: 'gpt-5.6',
        configOptionValues: {
          thought_level: 'high',
          fast: true,
          openai_api_key: 'sk-live-value',
          nested: { leaked: true },
        },
      })
    ).toEqual({
      modelId: 'gpt-5.6',
      configOptionValues: { thought_level: 'high', fast: true },
    });
  });

  it('omits an empty option map rather than persisting one', () => {
    expect(normalizeAgentRoleRunConfig({ configOptionValues: {} })).toEqual({});
    expect(normalizeAgentRoleRunConfig(null)).toEqual({});
  });
});

describe('agent role rows', () => {
  it('normalizes a stored row and drops malformed ones', () => {
    const stored = {
      ...role({ name: '  Reviewer  ', emoji: ' 🔍 ', promptPrefix: '  Be strict.  ' }),
      runConfig: { modelId: 'gpt-5.6', configOptionValues: { auth_token: 'x' } },
    };
    expect(normalizeAgentRole(stored)).toEqual(
      role({
        name: 'Reviewer',
        emoji: '🔍',
        promptPrefix: 'Be strict.',
        runConfig: { modelId: 'gpt-5.6' },
      })
    );

    expect(normalizeAgentRole({ ...role(), v: 2 })).toBeUndefined();
    // A name with no mention token left is a Role that could never be used.
    expect(normalizeAgentRole({ ...role(), name: '---' })).toBeUndefined();
    expect(normalizeAgentRole({ ...role(), machineId: '  ' })).toBeUndefined();
    expect(normalizeAgentRole(null)).toBeUndefined();
  });

  it('treats option-key ordering as unchanged content', () => {
    const left = role({ runConfig: { configOptionValues: { a: '1', b: '2' } } });
    const right = role({ runConfig: { configOptionValues: { b: '2', a: '1' } } });
    expect(isAgentRoleContentEqual(left, right)).toBe(true);
    expect(isAgentRoleContentEqual(left, role({ ...left, promptPrefix: 'x' }))).toBe(false);
    expect(isAgentRoleContentEqual(left, role({ ...left, emoji: '🔍' }))).toBe(false);
  });
});

describe('agent role visibility', () => {
  const mine = role({ id: 'mine' as AgentRoleId, ownerUserId: 'user-1' });
  const theirsPrivate = role({ id: 'theirs' as AgentRoleId, ownerUserId: 'user-2' });
  const theirsShared = role({
    id: 'shared' as AgentRoleId,
    ownerUserId: 'user-2',
    visibility: 'workspace',
  });

  it('hides another member private role and exposes a shared one', () => {
    expect(canReadAgentRole(mine, 'user-1')).toBe(true);
    expect(canReadAgentRole(theirsPrivate, 'user-1')).toBe(false);
    expect(canReadAgentRole(theirsShared, 'user-1')).toBe(true);
    expect(listAccessibleAgentRoles([mine, theirsPrivate, theirsShared], 'user-1')).toEqual([
      mine,
      theirsShared,
    ]);
  });

  it('lets only the owner manage a shared role', () => {
    expect(canManageAgentRole(theirsShared, 'user-1')).toBe(false);
    expect(canManageAgentRole(theirsShared, 'user-2')).toBe(true);
    expect(canManageAgentRole(mine, null)).toBe(false);
  });
});

describe('agent role availability', () => {
  it.each(['claude', 'codex', 'kimi', 'grok', 'gemini', 'opencode'])(
    'keeps a retired %s Role readable but not mentionable',
    (agentType) => {
      const current = role();
      const snapshot = structuredClone(current);
      const ctx = context({
        agentConfigs: new Map([[current.agentConfigId, { ...target(), agentType }]]),
      });
      expect(resolveAgentRoleAvailability(current, ctx)).toEqual({
        kind: 'unavailable',
        reason: 'agent_config_retired',
      });
      expect(
        selectMentionableAgentRoles([current], {
          currentUserId: current.ownerUserId,
          scope: { kind: 'machine', machineId: current.machineId },
          getAvailability: (candidate) => resolveAgentRoleAvailability(candidate, ctx),
        })
      ).toEqual([]);
      expect(current).toEqual(snapshot);
    }
  );

  it.each([
    { cliType: 'registry' as const },
    { cliType: 'custom' as const },
    { runtimeOverrides: {} },
    { customAcp: { command: 'external', args: [] } },
  ])('rejects non-embedded launch identity %j', (override) => {
    expect(
      resolveAgentRoleAvailability(
        role(),
        context({
          agentConfigs: new Map([['config-1' as AgentConfigId, { ...target(), ...override }]]),
        })
      )
    ).toEqual({ kind: 'unavailable', reason: 'agent_config_retired' });
  });

  it.each([
    undefined,
    { ...capability, provenance: 'static' as const },
    { ...capability, cacheVersion: 0 },
    { ...capability, agentType: 'codex' },
  ])('does not call an absent, provisional or mismatched catalog available', (entry) => {
    expect(
      resolveAgentRoleAvailability(
        role(),
        context({
          capabilitiesByMachineId: new Map([
            ['machine-1' as MachineId, entry ? { 'config-1': entry } : undefined],
          ]),
        })
      )
    ).toEqual({ kind: 'unavailable', reason: 'capabilities_unavailable' });
  });

  it.each([
    {},
    { modelId: 'legacy-model' },
    { modelId: encodeMollyModelOption('deleted', 'k3-256k') },
    { modelId, modeId: 'skip-permissions' },
    { modelId, configOptionValues: { reasoning_effort: 'xhigh' } },
    { modelId, configOptionValues: { unsupported: true } },
  ])('does not substitute an incompatible run config %j', (runConfig) => {
    expect(resolveAgentRoleAvailability(role({ runConfig }), context())).toEqual({
      kind: 'unavailable',
      reason: 'run_config_unsupported',
    });
  });

  it('accepts the exact published connection/model and supported thinking', () => {
    expect(
      resolveAgentRoleAvailability(
        role({ runConfig: { modelId, configOptionValues: { reasoning_effort: 'high' } } }),
        context()
      )
    ).toEqual({ kind: 'available' });
    expect(
      resolveAgentRoleAvailability(
        role(),
        context({
          capabilitiesByMachineId: new Map([
            [
              'machine-1' as MachineId,
              { 'config-1': { ...capability, modelReasoningEfforts: undefined } },
            ],
          ]),
        })
      )
    ).toEqual({ kind: 'unavailable', reason: 'run_config_unsupported' });
  });

  it('reports the precise reason instead of falling back', () => {
    expect(resolveAgentRoleAvailability(role(), context())).toEqual({ kind: 'available' });
    expect(
      resolveAgentRoleAvailability(role(), context({ authorizedMachineIds: new Set() }))
    ).toEqual({ kind: 'unavailable', reason: 'machine_unknown' });
    expect(resolveAgentRoleAvailability(role(), context({ onlineMachineIds: new Set() }))).toEqual({
      kind: 'unavailable',
      reason: 'machine_offline',
    });
    expect(resolveAgentRoleAvailability(role(), context({ agentConfigs: new Map() }))).toEqual({
      kind: 'unavailable',
      reason: 'agent_config_missing',
    });
    expect(
      resolveAgentRoleAvailability(
        role(),
        context({
          agentConfigs: new Map([['config-1' as AgentConfigId, target('machine-2' as MachineId)]]),
        })
      )
    ).toEqual({ kind: 'unavailable', reason: 'agent_config_machine_mismatch' });
  });

  it('stays unknown while that machine configs are unread', () => {
    expect(
      resolveAgentRoleAvailability(role(), context({ loadedAgentConfigMachineIds: new Set() }))
    ).toEqual({ kind: 'unknown' });
  });
});

describe('agent role mention scope', () => {
  const local = role({ id: 'local' as AgentRoleId });
  const remote = role({
    id: 'remote' as AgentRoleId,
    machineId: 'machine-2' as MachineId,
    agentConfigId: 'config-2' as AgentConfigId,
    name: 'Remote',
  });
  const bothMachines = context({
    authorizedMachineIds: new Set(['machine-1', 'machine-2'] as MachineId[]),
    onlineMachineIds: new Set(['machine-1', 'machine-2'] as MachineId[]),
    agentConfigs: new Map([
      ['config-1' as AgentConfigId, target()],
      ['config-2' as AgentConfigId, target('machine-2' as MachineId)],
    ]),
    capabilitiesByMachineId: new Map([
      ['machine-1' as MachineId, { 'config-1': capability }],
      ['machine-2' as MachineId, { 'config-2': capability }],
    ]),
    loadedAgentConfigMachineIds: new Set(['machine-1', 'machine-2'] as MachineId[]),
  });
  const getAvailability = (candidate: AgentRole) =>
    resolveAgentRoleAvailability(candidate, bothMachines);

  it('pins a local project to its own machine', () => {
    expect(
      selectMentionableAgentRoles([local, remote], {
        currentUserId: 'user-1',
        scope: { kind: 'machine', machineId: 'machine-1' as MachineId },
        getAvailability,
      })
    ).toEqual([local]);
  });

  it('lets a github project reach every authorized machine', () => {
    expect(
      selectMentionableAgentRoles([local, remote], {
        currentUserId: 'user-1',
        scope: {
          kind: 'authorized_machines',
          machineIds: new Set(['machine-1', 'machine-2'] as MachineId[]),
        },
        getAvailability,
        // Ordered by name, so a cross-machine role does not sort below every
        // local one: "Remote" precedes "Reviewer".
      })
    ).toEqual([remote, local]);
  });

  it('never offers an unavailable role as a candidate', () => {
    expect(
      selectMentionableAgentRoles([local], {
        currentUserId: 'user-1',
        scope: { kind: 'machine', machineId: 'machine-1' as MachineId },
        getAvailability: () => ({ kind: 'unavailable', reason: 'machine_offline' }),
      })
    ).toEqual([]);
  });
});
