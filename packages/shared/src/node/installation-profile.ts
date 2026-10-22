import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePlatformKind, type PlatformKind } from '../platform-kind';

export type InstallationProfile = {
  channel: 'stable' | 'preview';
  platform: PlatformKind;
  namespace: 'lody' | 'molly' | 'molly-preview';
  dataDirectoryName: '.lody' | '.molly' | '.molly-preview';
  desktopProtocol: 'lody' | 'molly-design' | 'molly-preview';
  desktopProductName: 'Lody' | 'Molly' | 'Molly Preview';
  desktopAppId: 'ai.lody.desktop' | 'dev.molly-design.app' | 'dev.molly-design.preview';
  localCliHostPort: 17_788 | 17_792 | 17_794;
};

const CLOUD_PROFILE: InstallationProfile = {
  channel: 'stable',
  platform: 'cloud',
  namespace: 'lody',
  dataDirectoryName: '.lody',
  desktopProtocol: 'lody',
  desktopProductName: 'Lody',
  desktopAppId: 'ai.lody.desktop',
  localCliHostPort: 17_788,
};

const LOCAL_PROFILE: InstallationProfile = {
  channel: 'stable',
  platform: 'local',
  namespace: 'molly',
  dataDirectoryName: '.molly',
  desktopProtocol: 'molly-design',
  desktopProductName: 'Molly',
  desktopAppId: 'dev.molly-design.app',
  localCliHostPort: 17_792,
};

const PREVIEW_PROFILE: InstallationProfile = {
  channel: 'preview',
  platform: 'local',
  namespace: 'molly-preview',
  dataDirectoryName: '.molly-preview',
  desktopProtocol: 'molly-preview',
  desktopProductName: 'Molly Preview',
  desktopAppId: 'dev.molly-design.preview',
  localCliHostPort: 17_794,
};

/**
 * Returns the immutable installation profile selected at process assembly.
 * Invalid values fail before any state path or IPC endpoint is used.
 */
export function getInstallationProfile(
  platform: PlatformKind = resolvePlatformKind(
    process.env.MOLLY_PLATFORM ?? process.env.LODY_PLATFORM
  ),
  channel: string = process.env.MOLLY_INSTALLATION_CHANNEL ?? 'stable'
): InstallationProfile {
  if (channel !== 'stable' && channel !== 'preview') {
    throw new Error(`Unrecognized MOLLY_INSTALLATION_CHANNEL: ${JSON.stringify(channel)}`);
  }
  return platform === 'cloud'
    ? CLOUD_PROFILE
    : channel === 'preview'
      ? PREVIEW_PROFILE
      : LOCAL_PROFILE;
}

/** Root for process-owned durable state. Callers may inject a home in tests. */
export function getMollyDataDir(platform?: PlatformKind, homeDir: string = os.homedir()): string {
  const override = (process.env.MOLLY_DATA_DIR ?? process.env.LODY_DATA_DIR)?.trim();
  if (override) return path.resolve(override);
  return path.join(homeDir, getInstallationProfile(platform).dataDirectoryName);
}

export const MOLLY_DATA_DIR_UNAVAILABLE_CODE = 'molly_data_dir_unavailable' as const;

/**
 * The installation's data directory could not be created or written.
 *
 * Every session workspace hangs off this directory — worktrees under `repos/`, chat
 * sessions under `chats/` — so when it is absent the first symptom is whatever tool
 * gets handed a path inside it, typically `git` reporting
 * `fatal: Invalid path '<data dir>': No such file or directory`. That message names a
 * path the user never chose and gives no hint that a wrong or unreachable data root
 * is the cause, so callers raise this instead.
 */
export class MollyDataDirUnavailableError extends Error {
  readonly code = MOLLY_DATA_DIR_UNAVAILABLE_CODE;

  constructor(
    readonly dataDir: string,
    cause: unknown
  ) {
    super(
      `Molly's data directory is unavailable: ${dataDir}. ` +
        'Create it, or point MOLLY_DATA_DIR at a writable directory, then restart the daemon.',
      { cause }
    );
    this.name = 'MollyDataDirUnavailableError';
  }
}

/**
 * Resolve the data directory and make sure it exists before a caller hands a path
 * inside it to `git`, an ACP process cwd, or the filesystem.
 *
 * `MOLLY_DATA_DIR` and the OSS `.molly` profile both move this root, so deriving it
 * is the ONLY supported way to name it; a literal `~/.molly` join reaches a directory
 * that need not exist on the running installation.
 */
export function ensureMollyDataDir(platform?: PlatformKind, homeDir?: string): string {
  const dataDir =
    homeDir === undefined ? getMollyDataDir(platform) : getMollyDataDir(platform, homeDir);
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (error) {
    throw new MollyDataDirUnavailableError(dataDir, error);
  }
  return dataDir;
}
