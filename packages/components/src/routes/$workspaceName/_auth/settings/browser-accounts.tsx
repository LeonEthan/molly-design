import { createFileRoute } from '@tanstack/react-router';
import { BrowserAccountsSetting } from '@/components/settings/browser-accounts-setting';

export const Route = createFileRoute('/$workspaceName/_auth/settings/browser-accounts')({
  component: BrowserAccountsSetting,
});
