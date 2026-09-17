import { expect, it } from 'vitest';
import { clearManagedGhTokenEnv, getGhTokenFingerprint } from './gh-token-injector';

it('drops legacy managed GitHub tokens while preserving explicit user credentials', () => {
  const env: Record<string, string | undefined> = {
    GH_TOKEN: 'legacy-managed',
    GITHUB_TOKEN: 'user-provided',
    MOLLY_MANAGED_GH_TOKEN_SHA256: getGhTokenFingerprint('legacy-managed'),
  };
  clearManagedGhTokenEnv(env);
  expect(env).toEqual({ GITHUB_TOKEN: 'user-provided' });
});
