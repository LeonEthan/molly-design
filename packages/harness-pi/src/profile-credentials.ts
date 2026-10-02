import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireProcessLock } from './process-lock';

type ProviderConfig = ReturnType<ModelRuntime['getRegisteredProviderConfig']>;
const PROFILE_UPDATE_LOCK_RETRIES = 1200;
export async function persistConnection(
  runtime: Pick<ModelRuntime, 'login'>,
  agentDir: string,
  providerId: string,
  config: ProviderConfig,
  apiKey: string
): Promise<void> {
  const path = join(agentDir, 'models.json');
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const release = await acquireProcessLock(`${path}.acp-lock`, PROFILE_UPDATE_LOCK_RETRIES);
  try {
    await runtime.login(providerId, 'api_key', {
      prompt: async () => apiKey,
      notify: () => {},
    });
    if (!config) return;
    let current: { providers?: Record<string, unknown> } = {};
    try {
      current = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const next = { ...current, providers: { ...current.providers, [providerId]: config } };
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  } finally {
    await release();
  }
}
