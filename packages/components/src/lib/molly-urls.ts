import { isNativeAppShell } from './native-platform';

const MOLLY_FALLBACK_ORIGIN = 'https://lody.ai';

/** Public invite for the Molly Discord server (sidebar + About → Join community). */
export const MOLLY_DISCORD_URL = 'https://discord.gg/E8mZtMu38s';

/**
 * Resolve the origin to use for Molly marketing/site links (download page,
 * website, etc.). Borrows the current web origin when there is a real one so
 * staging/preview builds link to themselves, and falls back to the canonical
 * production origin when there isn't (native shells, `file://` Electron
 * bundles, SSR).
 */
export function getMollyOrigin(): string {
  if (typeof window === 'undefined' || isNativeAppShell()) {
    return MOLLY_FALLBACK_ORIGIN;
  }
  if (window.location.protocol === 'file:' || window.location.origin === 'null') {
    return MOLLY_FALLBACK_ORIGIN;
  }
  return window.location.origin;
}

export function getDownloadPageUrl(language: string | undefined): string {
  const isChinese = language?.startsWith('zh') ?? false;
  const path = isChinese ? '/zh/download' : '/download';
  return new URL(path, getMollyOrigin()).toString();
}

export function getChangelogUrl(_language: string | undefined): string {
  return 'https://github.com/LeonEthan/molly-design/releases';
}

export function getWebsiteUrl(language: string | undefined): string {
  const isChinese = language?.startsWith('zh') ?? false;
  const path = isChinese ? '/zh/' : '/home';
  return new URL(path, getMollyOrigin()).toString();
}

/** Molly public help; upstream Molly URLs above retain their original attribution. */
export const MOLLY_REPOSITORY_URL = 'https://github.com/LeonEthan/molly-design';
export const MOLLY_ISSUES_URL = `${MOLLY_REPOSITORY_URL}/issues`;
export function getMollyDocumentationUrl(language: string | undefined): string {
  return language?.startsWith('zh')
    ? `${MOLLY_REPOSITORY_URL}/blob/main/README.zh-CN.md`
    : `${MOLLY_REPOSITORY_URL}#readme`;
}
