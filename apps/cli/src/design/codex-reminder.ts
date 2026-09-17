import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const record = z.record(z.string(), z.unknown());

/** Native per-session hook config. Trust only the application-owned command. */
export function codexDesignReminderConfig(command: string, rawConfig?: string) {
  const config = rawConfig ? record.parse(JSON.parse(rawConfig)) : {};
  if (Object.keys(config).some((key) => key.startsWith('hooks.')))
    throw Error(
      'Molly Codex reminders require CODEX_CONFIG hook overrides under one nested hooks object; dotted hook overrides were preserved without launching'
    );
  const hooks = config.hooks === undefined ? {} : record.parse(config.hooks);
  const groups =
    hooks.UserPromptSubmit === undefined ? [] : z.array(z.unknown()).parse(hooks.UserPromptSubmit);
  const state = hooks.state === undefined ? {} : record.parse(hooks.state);
  // Codex 0.153.4 hashes this normalized hook identity as sorted compact JSON.
  // Optional TOML fields are omitted, timeout is explicit, and only our appended
  // command is trusted. Never enable a user's unknown or modified hooks.
  const handler = { async: false, command, timeout: 5, type: 'command' };
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        event_name: 'user_prompt_submit',
        hooks: [handler],
      })
    )
    .digest('hex');
  const source =
    process.platform === 'win32'
      ? 'C:\\<session-flags>\\config.toml'
      : '/<session-flags>/config.toml';
  return {
    ...config,
    hooks: {
      ...hooks,
      UserPromptSubmit: [...groups, { hooks: [handler] }],
      state: {
        ...state,
        [`${source}:user_prompt_submit:${groups.length}:0`]: {
          enabled: true,
          trusted_hash: `sha256:${hash}`,
        },
      },
    },
  };
}

export function withCodexDesignReminder(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), 'codex-design-reminder.js');
  if (!existsSync(hook)) throw Error('Molly Codex design reminder is missing from the CLI bundle');
  const quote = (value: string) =>
    process.platform === 'win32'
      ? `"${value.replaceAll('"', '""')}"`
      : `'${value.replaceAll("'", "'\\''")}'`;
  return {
    ...env,
    CODEX_CONFIG: JSON.stringify(
      codexDesignReminderConfig(`${quote(process.execPath)} ${quote(hook)}`, env.CODEX_CONFIG)
    ),
  };
}
