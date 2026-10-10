import { shell } from 'electron'
import type { OpenSystemNotificationSettingsResult } from '@molly/shared/electron-ipc'
import { formatUnknownError } from '../utils'

export function browserDataPrivacySettingsUrls(platform: NodeJS.Platform): string[] {
  if (platform !== 'darwin') return []
  return [
    'x-apple.systempreferences:com.apple.Settings.PrivacySecurity.extension?Privacy_FilesAndFolders',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders'
  ]
}

export async function openBrowserDataPrivacySettings(options?: {
  platform?: NodeJS.Platform
  openExternal?: (url: string) => Promise<void>
}): Promise<OpenSystemNotificationSettingsResult> {
  const platform = options?.platform ?? process.platform
  const openExternal = options?.openExternal ?? ((url: string) => shell.openExternal(url))
  const urls = browserDataPrivacySettingsUrls(platform)
  if (urls.length === 0) {
    return {
      opened: false,
      platform,
      error: 'Browser data privacy settings are available only on macOS.'
    }
  }

  let lastError: string | undefined
  for (const target of urls) {
    try {
      await openExternal(target)
      return { opened: true, platform, target }
    } catch (error) {
      lastError = formatUnknownError(error)
    }
  }

  return {
    opened: false,
    platform,
    error: lastError ?? 'Failed to open macOS Files and Folders settings'
  }
}
