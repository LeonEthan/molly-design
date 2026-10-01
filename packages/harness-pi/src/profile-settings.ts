import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** Unmodified published Pi packages, loaded from the harness's own installed closure. */
export const MOLLY_PI_PACKAGES = [
  'pi-subagents',
  'pi-skillful',
  '@juicesharp/rpiv-ask-user-question',
  '@zigai/pi-mention-skill',
  '@ff-labs/pi-fff',
  'cc-safety-net',
] as const;

/** Sub-agent children load only `subagents.defaultExtensions`, so the safety floor is listed there. */
export const SUBAGENT_DEFAULT_PACKAGES = ['cc-safety-net'] as const;

export function resolvePiPackageRoot(name: string): string {
  for (const directory of createRequire(import.meta.url).resolve.paths(name) ?? []) {
    const root = join(directory, name);
    if (existsSync(join(root, 'package.json'))) return root;
  }
  throw new Error('harness_pi_package_missing');
}

function packageExtensions(name: string): string[] {
  const root = resolvePiPackageRoot(name);
  const declared: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).pi
    ?.extensions;
  if (!Array.isArray(declared) || declared.length === 0)
    throw new Error('harness_pi_package_extensions');
  return declared.map((entry) => resolve(root, String(entry)));
}

/**
 * `pi-subagents` built-ins that run another installed CLI with its own account and without
 * `subagents.defaultExtensions`; only native Pi children use the selected connection.
 */
export function externalCliSubagents(): string[] {
  const directory = join(resolvePiPackageRoot('pi-subagents'), 'agents');
  return readdirSync(directory)
    .filter((name) => name.endsWith('.md'))
    .filter((name) =>
      /^\s+type:\s*external-cli\s*$/m.test(readFileSync(join(directory, name), 'utf8'))
    )
    .map((name) => name.slice(0, -'.md'.length))
    .sort();
}

/**
 * Molly owns this agent-directory settings file. Main sessions and every sub-agent child
 * (in-process or detached) read the same native settings, so it is the only package list.
 */
export function createProfileSettings() {
  return {
    packages: MOLLY_PI_PACKAGES.map(resolvePiPackageRoot),
    defaultProjectTrust: 'never',
    enableAnalytics: false,
    enableInstallTelemetry: false,
    subagents: {
      defaultExtensions: SUBAGENT_DEFAULT_PACKAGES.flatMap(packageExtensions),
      agentOverrides: Object.fromEntries(
        externalCliSubagents().map((name) => [name, { disabled: true }])
      ),
    },
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
