import type { Meta, StoryObj } from '@storybook/react';
import { DesignContinuationPreparationResultSchema } from '@molly/shared';
import { DesignContinuationDialogView } from '@/components/sessions/design-continuation-dialog';

const preview = DesignContinuationPreparationResultSchema.parse({
  type: 'session/design-continuation-prepare',
  record: {
    version: 1,
    workspaceId: 'synthetic-workspace',
    source: {
      id: 'source',
      machineId: 'machine-1',
      userId: 'local:user',
      cliType: 'builtin',
      agentType: 'codex',
      design: { artworkId: 'artwork', path: 'design.json' },
    },
    target: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      agentConfigId: 'molly-config',
      createdAt: '2026-09-20T00:00:00.000Z',
    },
    reference: {
      version: 1,
      source: { sessionId: 'source', artworkId: 'artwork', machineId: 'machine-1' },
      messages: [
        {
          sourceTurnId: 'old-turn',
          role: 'user',
          text: 'Synthetic brief: preserve the headline and use a pale blue background.',
          truncated: true,
        },
      ],
      attachmentCandidates: [
        {
          sourceTurnId: 'old-turn',
          storageSessionId: 'source',
          fileId: 'reference',
          fileName: 'reference.png',
          mimeType: 'image/png',
          sizeBytes: 80,
          sha256: 'a'.repeat(64),
          machineId: 'machine-1',
        },
      ],
      omitted: { turns: 8, items: 4, attachments: 2 },
    },
  },
  attachments: [
    { sourceTurnId: 'old-turn', fileId: 'reference', status: 'unavailable', reason: 'missing' },
  ],
});
const meta = {
  title: 'Sessions/DesignContinuationDialog',
  component: DesignContinuationDialogView,
  args: {
    configs: [
      {
        id: 'molly-config' as never,
        machineId: 'machine-1' as never,
        name: 'Molly',
        description: 'Synthetic built-in Agent',
        cliType: 'builtin',
        agentType: 'molly',
        env: {},
      },
    ],
    selectedConfigId: '',
    busy: false,
    onSelect: () => {},
    onPreview: () => {},
    onConfirm: () => {},
    onClose: () => {},
  },
} satisfies Meta<typeof DesignContinuationDialogView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SelectAgent: Story = {};
export const Unavailable: Story = { args: { configs: [] } };
export const Preview: Story = { args: { selectedConfigId: 'molly-config', preview } };
export const Confirming: Story = { args: { ...Preview.args, busy: true } };
