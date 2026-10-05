import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MOLLY_PI_PACKAGES } from '@molly/shared/embedded-harness';

export { MOLLY_PI_PACKAGES };

export function resolvePiPackageRoot(name: string): string {
  for (const directory of createRequire(import.meta.url).resolve.paths(name) ?? []) {
    const root = join(directory, name);
    if (existsSync(join(root, 'package.json'))) return root;
  }
  throw new Error('harness_pi_package_missing');
}

export function createProfileSettings() {
  return {
    packages: MOLLY_PI_PACKAGES.map(resolvePiPackageRoot),
    defaultTools: ['+codemode'],
    codemode: { mode: 'on' },
    defaultProjectTrust: 'never',
    enableAnalytics: false,
    enableInstallTelemetry: false,
    retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
  };
}

export async function writeProfileSettings(agentDir: string): Promise<void> {
  const path = join(agentDir, 'settings.json');
  const content = `${JSON.stringify(createProfileSettings(), null, 2)}\n`;
  if ((await readFile(path, 'utf8').catch(() => undefined)) === content) return;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}
