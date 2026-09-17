import { createFileRoute } from '@tanstack/react-router';
import { ImageConnectionSetting } from '@/components/settings/image-connection-setting';

export const Route = createFileRoute('/$workspaceName/_auth/settings/image-connection')({
  component: ImageConnectionSetting,
});
