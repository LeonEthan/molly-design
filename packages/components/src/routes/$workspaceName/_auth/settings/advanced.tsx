import { createFileRoute } from '@tanstack/react-router';
import { AdvancedSettings } from '@/components/settings/advanced-settings';

export const Route = createFileRoute('/$workspaceName/_auth/settings/advanced')({
  component: AdvancedSettings,
});
