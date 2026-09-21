/** Public invite for the Molly Discord server (sidebar + About → Join community). */
export const MOLLY_DISCORD_URL = 'https://discord.gg/E8mZtMu38s';

export const MOLLY_REPOSITORY_URL = 'https://github.com/LeonEthan/molly-design';
export const MOLLY_ISSUES_URL = `${MOLLY_REPOSITORY_URL}/issues`;

export function getMollyDocumentationUrl(language: string | undefined): string {
  return language?.startsWith('zh')
    ? `${MOLLY_REPOSITORY_URL}/blob/main/README.zh-CN.md`
    : `${MOLLY_REPOSITORY_URL}#readme`;
}

/**
 * Molly has no marketing/download site of its own yet; the GitHub Releases page
 * is the canonical public download destination.
 */
export function getDownloadPageUrl(_language: string | undefined): string {
  return `${MOLLY_REPOSITORY_URL}/releases`;
}

export function getChangelogUrl(_language: string | undefined): string {
  return `${MOLLY_REPOSITORY_URL}/releases`;
}
