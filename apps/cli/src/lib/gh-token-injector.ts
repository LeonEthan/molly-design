import { createHash } from 'node:crypto';

// Legacy managed credentials may survive in a restored Session environment.
// Strip only values whose old marker matches; retain user-provided credentials.
export const MOLLY_MANAGED_GH_TOKEN_SHA256_ENV = 'MOLLY_MANAGED_GH_TOKEN_SHA256';

export const getGhTokenFingerprint = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export function clearManagedGhTokenEnv(env: Record<string, string | undefined>): void {
  const marker = env[MOLLY_MANAGED_GH_TOKEN_SHA256_ENV] ?? env.LODY_MANAGED_GH_TOKEN_SHA256;
  if (!marker) return;
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN'] as const) {
    const token = env[key];
    if (token && getGhTokenFingerprint(token) === marker) delete env[key];
  }
  delete env[MOLLY_MANAGED_GH_TOKEN_SHA256_ENV];
  delete env.LODY_MANAGED_GH_TOKEN_SHA256;
}
