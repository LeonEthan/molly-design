import { expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { createWorkerEnvironment } from './environment';

it('preserves the owned worker profile without inheriting control credentials', () => {
  const profile = {
    MOLLY_MCP_LORO_SOCKET_PATH: 'owned-endpoint',
    MOLLY_PROFILE: 'experimental',
    MOLLY_DATA_DIR: tmpdir(),
    MOLLY_ISOLATED_DATA_ROOT_STRICT: '1',
    MOLLY_SUPERVISOR_RUN_ID: 'test-run',
  };
  const env = createWorkerEnvironment(
    { ...profile, MOLLY_CORE_IPC_TOKEN: 'private' },
    {
      privateRoot: tmpdir(),
      runtimeEpoch: 'epoch',
    }
  );
  expect(env).toMatchObject(profile);
  expect(env).not.toHaveProperty('MOLLY_CORE_IPC_TOKEN');
});
