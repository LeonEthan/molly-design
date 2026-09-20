import { describe, expect, it } from 'vitest';
import {
  AcpAuthenticationManager,
  probeBuiltinAuthentication,
  type AcpAuthenticationProgressEvent,
} from './acp-authentication';
import type { Logger } from '@/utils/logger';

const logger = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error('must not log authentication input');
    },
  }
) as Logger;
describe('retired external CLI authentication', () => {
  it.each([
    { cliType: 'builtin', agentType: 'claude' },
    { cliType: 'builtin', agentType: 'codex' },
    { cliType: 'builtin', agentType: 'kimi' },
    { cliType: 'builtin', agentType: 'grok' },
    { cliType: 'registry', agentType: 'auggie' },
    { cliType: 'custom', agentType: 'synthetic' },
  ] as const)(
    'refuses $cliType/$agentType without reading credentials or publishing authorization UI',
    async (target) => {
      const manager = new AcpAuthenticationManager(logger);
      const progress: AcpAuthenticationProgressEvent[] = [];
      expect(
        await manager.authenticate({
          ...target,
          requestId: 'request',
          env: { PRIVATE: 'synthetic-private' },
          onProgress: (event) => progress.push(event),
        })
      ).toEqual({
        success: false,
        disposition: 'error',
        error: 'legacy_harness_authentication_disabled',
      });
      expect(progress).toEqual([
        { status: 'error', error: 'legacy_harness_authentication_disabled' },
      ]);
      expect(manager.getAgentType('request')).toBeUndefined();
      expect(manager.cancel('request')).toEqual({ success: true, disposition: 'not-running' });
      expect(manager.submitAuthorizationCode('request', 'synthetic-private')).toMatchObject({
        success: false,
      });
      expect(
        manager.submitAuthenticationInput('request', 'interaction', 'synthetic-private')
      ).toMatchObject({ success: false });
      await expect(probeBuiltinAuthentication({ ...target, logger })).rejects.toThrow(
        'legacy_harness_execution_disabled'
      );
    }
  );
  it('directs Molly to protected model connections without CLI login', async () => {
    const manager = new AcpAuthenticationManager(logger);
    expect(
      await manager.authenticate({ requestId: 'request', cliType: 'builtin', agentType: 'molly' })
    ).toMatchObject({ success: false, error: 'harness_model_connection_required' });
    await expect(
      probeBuiltinAuthentication({ cliType: 'builtin', agentType: 'molly', logger })
    ).resolves.toEqual({ status: 'unknown' });
  });
});
