import { promises as fs } from 'node:fs'
import { resolvePlatformKind, type PlatformKind } from '@molly/shared/platform-kind'
import { getLocalWorkspaceCatalogPath } from '@molly/shared/node/local-workspace-catalog'
import { getInstallationProfile } from '@molly/shared/node/installation-profile'
import type { ElectronLocalPlatformSnapshot } from '@molly/shared/electron-ipc'
import { parseLocalPlatformSnapshot } from './local-platform-snapshot'

/**
 * Build-time platform selection for the desktop shell
 * (specs/platform-providers.md): the public build is local by default and also
 * injects VITE_MOLLY_PLATFORM=local. A cloud value fails at startup.
 */
const configuredPlatformKind = resolvePlatformKind(import.meta.env.VITE_MOLLY_PLATFORM)
if (configuredPlatformKind !== 'local') {
  throw new Error('Molly desktop supports only the local platform')
}
export const mainPlatformKind: PlatformKind = configuredPlatformKind
export const desktopInstallationProfile = getInstallationProfile(mainPlatformKind)

export function isLocalPlatform(): boolean {
  return mainPlatformKind === 'local'
}

/**
 * Parses the one atomic local identity/workspace snapshot. A present malformed
 * catalog is a broken installation invariant and must fail; only a missing
 * catalog means the CLI has not provisioned it yet.
 */
export async function readLocalPlatformSnapshot(): Promise<ElectronLocalPlatformSnapshot | null> {
  let raw: string
  try {
    raw = await fs.readFile(getLocalWorkspaceCatalogPath(mainPlatformKind), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch (error) {
    throw new Error('Local platform catalog is not valid JSON', { cause: error })
  }
  return parseLocalPlatformSnapshot(decoded)
}
