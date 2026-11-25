import { lstatSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  canonicalDataDirectory,
  resolveIsolatedDataPath,
} from '@molly/shared/node/installation-profile';

function containsDirectory(parent: string, child: string): boolean {
  const parentStat = statSync(parent, { bigint: true, throwIfNoEntry: false });
  for (let current = child; ; current = path.dirname(current)) {
    if (current === parent) return true;
    const stat = statSync(current, { bigint: true, throwIfNoEntry: false });
    if (
      parentStat &&
      stat &&
      stat.ino !== 0n &&
      stat.ino === parentStat.ino &&
      stat.dev === parentStat.dev
    )
      return true;
    if (current === path.dirname(current)) return false;
  }
}

export const STRICT_STDIO_ARGUMENT = '--conditions=molly-strict-isolated-profile';

export function stdioProfileEnvironment(): Record<string, string> {
  const { MOLLY_PROFILE, MOLLY_ISOLATED_DATA_ROOT_STRICT, MOLLY_SUPERVISOR_RUN_ID } = process.env;
  const directory = process.env.MOLLY_DATA_DIR?.trim();
  const env: Record<string, string> = {};
  if (MOLLY_PROFILE) env.MOLLY_PROFILE = MOLLY_PROFILE;
  if (MOLLY_SUPERVISOR_RUN_ID) env.MOLLY_SUPERVISOR_RUN_ID = MOLLY_SUPERVISOR_RUN_ID;
  if (directory) env.MOLLY_DATA_DIR = path.resolve(directory);
  if (
    MOLLY_PROFILE !== 'experimental' &&
    MOLLY_ISOLATED_DATA_ROOT_STRICT === undefined &&
    MOLLY_SUPERVISOR_RUN_ID === undefined &&
    !process.execArgv.includes(STRICT_STDIO_ARGUMENT)
  )
    return env;
  if (MOLLY_ISOLATED_DATA_ROOT_STRICT !== '1' || !directory || !path.isAbsolute(directory))
    throw Error('invalid_isolated_data_root');
  const absolute = path.resolve(directory);
  const root = canonicalDataDirectory(absolute);
  if (
    !lstatSync(absolute, { throwIfNoEntry: false })?.isDirectory() ||
    !lstatSync(path.join(root, '.molly-mygo-experimental'), { throwIfNoEntry: false })?.isFile() ||
    ['.molly', '.molly-preview', '.lody'].some((name) => {
      const production = canonicalDataDirectory(path.join(homedir(), name));
      return containsDirectory(production, root) || containsDirectory(root, production);
    })
  )
    throw Error('invalid_isolated_data_root');
  for (const name of readdirSync(root)) resolveIsolatedDataPath(root, name);
  return {
    ...env,
    MOLLY_PROFILE: 'experimental',
    MOLLY_DATA_DIR: root,
    MOLLY_ISOLATED_DATA_ROOT_STRICT,
  };
}
