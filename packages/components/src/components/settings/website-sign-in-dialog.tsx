import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ElectronBrowserAccountSiteInput } from '@molly/shared/electron-ipc';
import { PublicBrowserSurface } from '@/components/sessions/public-browser-surface';
import { getPublicBrowserBridge } from '@/lib/electron-ipc-client';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';

type Site = ElectronBrowserAccountSiteInput['site'];

const siteDetails: Record<Site, { name: string; signInUrl: string }> = {
  'pinterest.com': { name: 'Pinterest', signInUrl: 'https://www.pinterest.com/login/' },
};

export const websiteSignInUrl = (site: Site): string => siteDetails[site].signInUrl;
export const websiteName = (site: Site): string => siteDetails[site].name;

const signInBrowserId = (site: Site) => `website-sign-in-${site}`;

type WebsiteSignInDialogProps = {
  site: Site;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Signs in on Molly's own website profile, shared with Agent browser pages. Reading no
 * other browser's data keeps this path free of Keychain and Files and Folders prompts.
 */
export function WebsiteSignInDialog({ site, open, onOpenChange }: WebsiteSignInDialogProps) {
  const { t } = useTranslation();
  const name = websiteName(site);
  const ignoreState = useCallback(() => {}, []);
  const changeOpen = (next: boolean) => {
    if (!next)
      void getPublicBrowserBridge()
        ?.destroy(signInBrowserId(site))
        .catch((error: unknown) => console.error('Failed to close the sign-in page', error));
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="flex h-[min(820px,calc(100vh-4rem))] max-w-[min(960px,calc(100vw-4rem))] flex-col">
        <DialogHeader>
          <DialogTitle>{t('settings.browserAccounts.signInTitle', { site: name })}</DialogTitle>
          <DialogDescription>
            {t('settings.browserAccounts.signInDescription', { site: name })}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <PublicBrowserSurface
            browserId={signInBrowserId(site)}
            url={websiteSignInUrl(site)}
            navigationRequestId={0}
            active
            className="rounded-md border border-border/40"
            onStateChange={ignoreState}
          />
        ) : null}
        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {t('settings.browserAccounts.signInGoogleHint', { site: name })}
          </p>
          <Button type="button" size="sm" onClick={() => changeOpen(false)}>
            {t('settings.browserAccounts.signInDone')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
