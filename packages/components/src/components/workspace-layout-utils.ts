/** Check if current path is a settings route. */
export function isSettingsRoute(pathname: string): boolean {
  return /^\/[^/]+\/settings(\/|$)/.test(pathname);
}

/** The desktop workspace fills its window; Settings owns a drag strip. */
export function getWebWorkspaceLayoutRootClassName({
  settingsRoute,
}: { settingsRoute?: boolean } = {}): string {
  return [settingsRoute ? 'relative' : undefined, 'flex h-svh w-full overflow-hidden bg-background']
    .filter(Boolean)
    .join(' ');
}
