import { useEffect, useState } from 'react';
import { takeBrowserImportIntent, type BrowserImportIntent } from '@/lib/browser-import-resume';
import { BrowserAccountImportDialog } from './browser-account-import-dialog';

export function BrowserImportResume() {
  const [intent, setIntent] = useState<BrowserImportIntent | null>(null);
  useEffect(() => {
    const pending = takeBrowserImportIntent();
    if (pending) setIntent(pending);
  }, []);
  if (!intent) return null;
  return (
    <BrowserAccountImportDialog
      open
      resume={intent}
      onOpenChange={(open) => {
        if (!open) setIntent(null);
      }}
    />
  );
}
