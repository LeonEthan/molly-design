import { z } from 'zod';
import claudeRuntimeManifest from '../agent/claude-runtime-manifest.json';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import spawn from 'cross-spawn';
import { getLocalControlSocketPath } from '@molly/shared/node/local-ipc';

export function prepareClaudeDesignLaunch(
  env: NodeJS.ProcessEnv,
  identity: { machineId: string; workspaceId: string }
) {
  const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), 'claude-design-hook.js');
  if (!existsSync(hook)) throw Error('Molly Claude design hook is missing from the CLI bundle');
  const command = env.CLAUDE_CODE_EXECUTABLE;
  if (!command) throw Error('Claude executable is required for design hooks');
  const version = spawn.sync(command, ['--version'], {
    env,
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  const runtimeVersion = version.status === 0 ? version.stdout.trim().split(' ')[0] : 'unknown';
  if (runtimeVersion !== claudeRuntimeManifest.version)
    throw Error(
      `Molly design hooks require verified Claude Code ${claudeRuntimeManifest.version}; selected runtime reports ${runtimeVersion}`
    );
  // Claude command hooks use the platform shell. Quote executable paths, never
  // interpolate a model/user command or credentials into hook configuration.
  const quote = (value: string) =>
    process.platform === 'win32'
      ? `"${value.replaceAll('"', '""')}"`
      : `'${value.replaceAll("'", "'\\''")}'`;
  return {
    settings: claudeDesignSettings(
      `${quote(process.execPath)} ${quote(hook)}`,
      env.CLAUDE_MODEL_CONFIG
    ),
    env: {
      ...env,
      MOLLY_DESIGN_CLAUDE_VERSION: runtimeVersion,
      MOLLY_DESIGN_MACHINE_ID: identity.machineId,
      MOLLY_DESIGN_WORKSPACE_ID: identity.workspaceId,
      MOLLY_DESIGN_CONTROL_SOCKET: getLocalControlSocketPath(),
    },
  };
}

export function claudeDesignSettings(command: string, modelConfig?: string) {
  // ACP's explicit settings replace its CLAUDE_MODEL_CONFIG fallback. Preserve
  // those two existing SDK settings; never forward arbitrary environment data.
  const modelSettings = modelConfig
    ? z
        .object({
          modelOverrides: z.record(z.string(), z.string()).optional(),
          availableModels: z.array(z.string()).optional(),
        })
        .parse(JSON.parse(modelConfig))
    : {};
  return {
    ...modelSettings,
    hooks: Object.fromEntries(
      ['UserPromptSubmit'].map((event) => [
        event,
        [{ hooks: [{ type: 'command', command, timeout: 35 }] }],
      ])
    ),
  };
}
