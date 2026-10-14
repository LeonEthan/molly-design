import { z } from 'zod';
import { ElectronBrowserAccountImportInputSchema } from '@molly/shared/electron-ipc';
import { mollyStorage } from '@/lib/product-storage';

export const BROWSER_IMPORT_RESUME_KEY = 'molly:browserImportResume';

const browserImportResumeSchema = ElectronBrowserAccountImportInputSchema.pick({
  browserId: true,
  profileId: true,
  siteIds: true,
}).extend({ v: z.literal(1) });

export type BrowserImportIntent = Omit<z.infer<typeof browserImportResumeSchema>, 'v'>;

export function saveBrowserImportIntent(intent: BrowserImportIntent): void {
  mollyStorage.setItem(BROWSER_IMPORT_RESUME_KEY, JSON.stringify({ v: 1, ...intent }));
}

export function clearBrowserImportIntent(): void {
  mollyStorage.removeItem(BROWSER_IMPORT_RESUME_KEY);
}

export function takeBrowserImportIntent(): BrowserImportIntent | null {
  const raw = mollyStorage.getItem(BROWSER_IMPORT_RESUME_KEY);
  clearBrowserImportIntent();
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = browserImportResumeSchema.safeParse(json);
  if (!parsed.success) return null;
  const { browserId, profileId, siteIds } = parsed.data;
  return { browserId, ...(profileId !== undefined ? { profileId } : {}), siteIds };
}
