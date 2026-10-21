import type { Meta, StoryObj } from '@storybook/react';
import { ModelConnectionSetting } from '@/components/settings/model-connection-setting';

function SnapshotPanel(props: NonNullable<Parameters<typeof ModelConnectionSetting>[0]>) {
  return <ModelConnectionSetting {...props} />;
}

const meta = {
  title: 'Settings/ModelConnectionSnapshot',
  component: SnapshotPanel,
  parameters: { layout: 'centered' },
  args: { variant: 'panel' },
  decorators: [
    (Story) => (
      <div className="h-[350px] w-[min(560px,calc(100vw-32px))] rounded-2xl border border-border/40 bg-card">
        <Story />
      </div>
    ),
  ],
  beforeEach: ({ name }) => {
    const previous = window.ipc;
    let failed = false;
    let recovered = false;
    window.ipc = {
      on: () => () => undefined,
      invoke: async (channel: string) => {
        switch (channel) {
          case 'modelConnections.getSnapshot':
            if (recovered) return { connections: [] };
            if (name === 'Unreadable Credentials' || name === 'Recovery Failed')
              throw new Error('credential_storage_unreadable');
            if (name === 'Loading') return new Promise(() => {});
            if (name === 'Read Failed' || !failed) {
              failed = true;
              throw new Error('Synthetic saved-connection read failure');
            }
            return {
              connections: [
                {
                  schemaVersion: 1,
                  id: '00000000-0000-4000-8000-000000000171',
                  revision: 1,
                  providerPresetId: 'openai',
                  displayName: 'Synthetic connection',
                  baseUrl: 'https://example.invalid/v1',
                  enabled: true,
                  credentialRef: 'synthetic-private-reference',
                },
              ],
            };
          case 'modelConnections.getModelCatalog':
            return { models: [] };
          case 'modelConnections.getModelMetadataSnapshot':
            return null;
          case 'modelConnections.prepareStorageRecovery':
            return { digest: 'a'.repeat(64) };
          case 'modelConnections.recoverUnreadableStorage':
            if (name === 'Recovery Failed') throw new Error('credential_storage_recovery_conflict');
            recovered = true;
            return { backupFileName: 'synthetic-backup.enc' };
          default:
            throw new Error(`Unexpected story IPC: ${channel}`);
        }
      },
    } as never;
    return () => {
      window.ipc = previous;
    };
  },
} satisfies Meta<typeof SnapshotPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Loading: Story = {};
export const ReadFailed: Story = {};
export const RetryRecovery: Story = {};
export const UnreadableCredentials: Story = {};
export const RecoveryFailed: Story = {};
