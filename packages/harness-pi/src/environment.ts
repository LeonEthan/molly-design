import { isAbsolute, join } from 'node:path';

const INHERITED_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'ELECTRON_RUN_AS_NODE',
] as const;

/** Called before importing the SDK in the owned worker. Never changes the parent. */
export function createWorkerEnvironment(
  inherited: NodeJS.ProcessEnv,
  privateRoot: string
): Record<string, string> {
  if (!isAbsolute(privateRoot)) throw new Error('harness_private_root_must_be_absolute');
  const environment: Record<string, string> = {};
  for (const key of INHERITED_KEYS) {
    const value = inherited[key];
    if (value !== undefined) environment[key] = value;
  }
  return {
    ...environment,
    PI_CODING_AGENT_DIR: join(privateRoot, 'config'),
    PI_OFFLINE: '1',
    DO_NOT_TRACK: '1',
    NO_PROXY: 'localhost,127.0.0.1,::1',
    no_proxy: 'localhost,127.0.0.1,::1',
    TMPDIR: join(privateRoot, 'tmp'),
    TMP: join(privateRoot, 'tmp'),
    TEMP: join(privateRoot, 'tmp'),
  };
}

/** Credentials and private control channels are never inherited by tool children. */
export function createToolEnvironment(inherited: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    INHERITED_KEYS.flatMap((key) => {
      const value = inherited[key];
      return value === undefined ? [] : [[key, value]];
    })
  );
}
