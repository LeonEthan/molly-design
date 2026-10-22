export async function openBrowserImportSettings(
  openExternal: (url: string) => Promise<void>,
  platform: NodeJS.Platform
): Promise<{ opened: boolean }> {
  if (platform !== 'darwin') return { opened: false }
  try {
    await openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders'
    )
    return { opened: true }
  } catch {
    return { opened: false }
  }
}
