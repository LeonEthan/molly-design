import { createInterface } from 'node:readline';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2];

function signal(name, value) {
  const target = join(directory, `${name}.json`);
  writeFileSync(`${target}.tmp`, JSON.stringify(value));
  renameSync(`${target}.tmp`, target);
}

process.on('exit', (code) => signal('exited', { code }));
createInterface({ input: process.stdin }).on('line', (line) => {
  if (JSON.parse(line).method === 'initialize') signal('initializing', {});
});
