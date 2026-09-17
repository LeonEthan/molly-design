import { useCallback } from 'react';
import { parseTaskImageMarkdownUrl } from '@molly/shared';

/** Hosted task-image references in old markdown have no local attachment. */
export const useTaskImageUrl = (_markdownUrl: string | undefined): string | undefined => undefined;

export const useTaskImageResolver = (
  _markdown: string
): { resolveImageUrl: (src: string) => string | undefined; cacheVersion: number } => {
  const resolveImageUrl = useCallback((src: string): string | undefined => {
    if (parseTaskImageMarkdownUrl(src)) return undefined;
    return /^https?:\/\//iu.test(src) ? src : undefined;
  }, []);
  return { resolveImageUrl, cacheVersion: 0 };
};
