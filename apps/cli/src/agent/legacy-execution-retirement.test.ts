import { afterEach, describe, expect, it, vi } from 'vitest';
import { REGISTRY_ACP_AGENTS, type AgentConfigCliType } from '@molly/shared';
import { assertEmbeddedHarnessTarget } from './embedded-harness-runtime';
import {
  resolveACPProcessLaunch,
  resolveACPProcessLaunchAsync,
  resolveBuiltinAuthenticationProcessLaunch,
} from './setting';
import { spawnAcpProcess, startLocalAcpAgent } from './acp-runner';
import { Session } from '../session/session';

const targets: { cliType: AgentConfigCliType; agentType: string }[] = [
  ...['claude', 'codex', 'kimi', 'grok', 'pi', 'deepseek'].map((agentType) => ({
    cliType: 'builtin' as const,
    agentType,
  })),
  ...REGISTRY_ACP_AGENTS.map((agent) => ({ cliType: 'registry' as const, agentType: agent.id })),
  { cliType: 'custom', agentType: 'synthetic-custom' },
  { cliType: 'registry', agentType: 'molly' },
];
afterEach(() => vi.unstubAllEnvs());
describe('Molly-only process execution boundary', () => {
  it.each(targets)(
    'rejects $cliType/$agentType before resolution, spawn or Session environment preparation',
    async (target) => {
      vi.stubEnv('MOLLY_LOCAL_CODEX_ACP', '1');
      vi.stubEnv('MOLLY_LOCAL_CODEX_ACP_PATH', '/synthetic/forbidden');
      const input = {
        ...target,
        customAcp: { command: '/synthetic/forbidden' },
        runtimeOverrides: { kimiPath: '/synthetic/forbidden' },
      };
      expect(() => resolveACPProcessLaunch(input)).toThrow('legacy_harness_execution_disabled');
      await expect(resolveACPProcessLaunchAsync(input)).rejects.toThrow(
        'legacy_harness_execution_disabled'
      );
      await expect(startLocalAcpAgent(input as never)).rejects.toThrow(
        'legacy_harness_execution_disabled'
      );
      expect(() =>
        spawnAcpProcess({
          ...input,
          command: '/synthetic/forbidden',
          args: [],
          workdir: '/synthetic',
          env: {},
          spawnImpl: () => {
            throw new Error('must not spawn');
          },
        } as never)
      ).toThrow('legacy_harness_execution_disabled');
      await expect(
        Session.prototype.createAgent.call(
          { config: { agentCliType: target.cliType, agentType: target.agentType } } as Session,
          {} as never
        )
      ).rejects.toThrow('legacy_harness_execution_disabled');
      for (const action of ['login', 'status'] as const)
        await expect(
          resolveBuiltinAuthenticationProcessLaunch({ ...input, action })
        ).rejects.toThrow('legacy_harness_authentication_disabled');
    }
  );
  it('allows only the exact Molly target and refuses launch overrides or the generic spawn bypass', async () => {
    const target = { cliType: 'builtin' as const, agentType: 'molly' };
    expect(() => assertEmbeddedHarnessTarget(target)).not.toThrow();
    for (const override of [
      { customAcp: { command: 'pi' } },
      { runtimeOverrides: {} },
      { extraArgs: ['--extension', 'unreviewed'] },
    ]) {
      await expect(resolveACPProcessLaunchAsync({ ...target, ...override })).rejects.toThrow(
        'harness_launch_override_forbidden'
      );
    }
    expect(() =>
      spawnAcpProcess({ ...target, command: 'pi', args: [], workdir: '/synthetic', env: {} })
    ).toThrow('harness_session_launch_required');
  });
});
