import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type ProviderConfig = ReturnType<ModelRuntime['getRegisteredProviderConfig']>;

/**
 * Sub-agent children, including detached background runners, read the application profile
 * from disk. The selected connection's key goes through Pi's own login into `auth.json`; its
 * endpoint and declared models become the native `models.json` provider entry.
 * Connections sharing a provider ID share these entries: the last started worker wins.
 */
export async function persistConnection(
  runtime: Pick<ModelRuntime, 'login'>,
  agentDir: string,
  providerId: string,
  config: ProviderConfig,
  apiKey: string
): Promise<void> {
  await runtime.login(providerId, 'api_key', {
    prompt: async () => apiKey,
    notify: () => {},
  });
  if (!config) return;
  const path = join(agentDir, 'models.json');
  let current: { providers?: Record<string, unknown> } = {};
  try {
    current = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const next = { ...current, providers: { ...current.providers, [providerId]: config } };
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
