/** Prepare a reviewable native Kimi plugin; never install or change Kimi settings. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DESIGN_READ_BEFORE_EDIT_REMINDER } from '../src/design/read-before-edit-reminder';

const destination = process.argv[2];
if (!destination || !path.isAbsolute(destination))
  throw Error('Pass a new absolute output directory; this command only prepares plugin files');

// Refuse an existing directory rather than replacing a reviewed or installed plugin.
await mkdir(destination);
const quote = (value: string) =>
  process.platform === 'win32'
    ? `"${value.replaceAll('"', '""')}"`
    : `'${value.replaceAll("'", "'\\''")}'`;
const manifest = {
  name: 'molly-read-before-edit',
  version: '0.1.0',
  description: 'Read-before-edit reminders in Molly design launches only.',
  hooks: [
    {
      event: 'UserPromptSubmit',
      command: `${quote(process.execPath)} reminder.mjs`,
      timeout: 5,
    },
  ],
};
await writeFile(
  path.join(destination, 'kimi.plugin.json'),
  JSON.stringify(manifest, null, 2) + '\n',
  { flag: 'wx' }
);
await writeFile(
  path.join(destination, 'reminder.mjs'),
  '// Generated from Molly DESIGN_READ_BEFORE_EDIT_REMINDER. No installation side effects.\n' +
    `if (process.env.MOLLY_DESIGN_LAUNCH_ID?.trim()) {\n` +
    `  process.stdout.write(${JSON.stringify(DESIGN_READ_BEFORE_EDIT_REMINDER + '\n')});\n` +
    '}\n',
  { flag: 'wx' }
);
console.log(`Prepared plugin for review: ${destination}\nNot installed.`);
