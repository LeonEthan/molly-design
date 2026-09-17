import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Only this process-owned plugin receives native session-plugin trust. */
export async function prepareGrokDesignReminder(
  entry = path.join(path.dirname(fileURLToPath(import.meta.url)), 'grok-design-reminder.js')
) {
  if (!existsSync(entry)) throw Error('Molly Grok design reminder is missing from the CLI bundle');
  const quote = (value: string) =>
    process.platform === 'win32'
      ? `"${value.replaceAll('"', '""')}"`
      : `'${value.replaceAll("'", "'\\''")}'`;
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'molly-grok-reminder-')));
  try {
    await mkdir(path.join(directory, 'hooks'));
    await writeFile(
      path.join(directory, 'plugin.json'),
      JSON.stringify({ name: 'molly-read-before-edit', version: '1.0.0' }),
      { flag: 'wx' }
    );
    await writeFile(
      path.join(directory, 'hooks', 'hooks.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              hooks: [
                {
                  type: 'command',
                  command: `${quote(process.execPath)} ${quote(entry)}`,
                  timeout: 5,
                },
              ],
            },
          ],
        },
      }),
      { flag: 'wx' }
    );
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

const hookList = z.object({
  result: z.object({
    hooks: z.array(z.object({ sourceDir: z.string(), event: z.string(), disabled: z.boolean() })),
  }),
});

/** Grok 1.0.13 discovers session plugins before it appends their hooks. */
export async function reloadGrokDesignReminder(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  sessionId: string,
  directory: string
) {
  await request('x.ai/hooks/action', { sessionId, action: { type: 'reload' } });
  const loaded = hookList.parse(await request('x.ai/hooks/list', { sessionId }));
  if (
    !loaded.result.hooks.some(
      (hook) =>
        hook.sourceDir === path.join(directory, 'hooks') &&
        hook.event === 'pre_tool_use' &&
        !hook.disabled
    )
  )
    throw Error(
      'Molly Grok read-before-edit reminder was not loaded; native plugin policy and user configuration were preserved'
    );
}
