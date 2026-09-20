import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Logger } from '@/utils/logger';
import { AcpAuthenticationManager } from './acp-authentication';

describe('custom authentication process retirement', () => {
  it('never runs an explicitly supplied executable or writes its marker', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'molly-retired-auth-'));
    try {
      const marker = join(scratch, 'executed');
      const manager = new AcpAuthenticationManager({} as Logger);
      expect(
        await manager.authenticate({
          requestId: 'synthetic',
          cliType: 'custom',
          agentType: 'synthetic',
          customAcp: {
            command: process.execPath,
            args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
          },
        })
      ).toEqual({
        success: false,
        disposition: 'error',
        error: 'legacy_harness_authentication_disabled',
      });
      expect(await readdir(scratch)).toEqual([]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
