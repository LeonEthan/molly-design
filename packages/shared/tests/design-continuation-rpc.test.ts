import { describe, expect, it } from 'vitest';
import {
  LocalMachineRpcRequestSchema,
  LocalMachineRpcResponseSchema,
} from '../src/local-machine-rpc';
import { buildDesignContinuationReference } from '../src/design-continuation';
import {
  CURRENT_MACHINE_PROTOCOL_CAPABILITIES,
  DESIGN_CONTINUATION_PREPARATION_PROTOCOL_VERSION,
  MACHINE_PROTOCOL_CAPABILITIES,
  machineSupportsDesignContinuationPreparation,
} from '../src/machine-protocol-capabilities';

const request = {
  method: 'session/design-continuation-prepare',
  machineId: 'machine-1',
  workspaceId: 'workspace-1',
  params: {
    version: 1,
    sourceSessionId: 'source-1',
    targetAgentConfigId: 'molly-config',
    requestedByUserId: 'user-1',
  },
};

function response() {
  const reference = buildDesignContinuationReference({
    source: { sessionId: 'source-1', machineId: 'machine-1', artworkId: 'artwork-1' },
    history: [
      {
        id: 'turn-1',
        role: 'user',
        status: 'handled',
        timestamp: '2026-09-20T00:00:00.000Z',
        fileDiff: [],
        items: [
          {
            type: 'file',
            fileId: 'file-1',
            fileName: 'reference.png',
            mimeType: 'image/png',
            sizeBytes: 10,
            sha256: 'a'.repeat(64),
            transport: 'local',
            machineId: 'machine-1',
            uploadedAt: 1,
            textPreview: false,
          },
        ],
      },
    ],
  });
  return {
    ok: true,
    result: {
      type: request.method,
      record: {
        version: 1,
        workspaceId: request.workspaceId,
        source: {
          id: 'source-1',
          machineId: 'machine-1',
          userId: 'user-1',
          cliType: 'builtin',
          agentType: 'codex',
          design: { artworkId: 'artwork-1', path: 'design.json' },
        },
        target: {
          sessionId: '10000000-0000-4000-8000-000000000001',
          agentConfigId: 'molly-config',
          createdAt: '2026-09-20T00:00:00.000Z',
        },
        reference,
      },
      attachments: [{ sourceTurnId: 'turn-1', fileId: 'file-1', status: 'available' }],
    },
  };
}

describe('design continuation preparation RPC contract', () => {
  it('accepts the versioned bounded request and exact receipt statuses', () => {
    expect(LocalMachineRpcRequestSchema.parse(request)).toEqual(request);
    expect(LocalMachineRpcResponseSchema.parse(response())).toEqual(response());
  });
  it.each([
    { version: 2 },
    { sourceSessionId: '../source' },
    { targetAgentConfigId: '' },
    { requestedByUserId: '' },
    { execute: true },
    { targetSessionId: 'caller-target' },
  ])('rejects an unsupported request patch: %j', (patch) => {
    expect(
      LocalMachineRpcRequestSchema.safeParse({
        ...request,
        params: { ...request.params, ...patch },
      }).success
    ).toBe(false);
  });
  it.each(['missing', 'wrong-turn', 'wrong-file', 'duplicate', 'path', 'reason'] as const)(
    'rejects a mismatched or excessive response: %s',
    (kind) => {
      const value = response();
      const item = value.result.attachments[0];
      if (!item) throw Error('fixture missing');
      if (kind === 'missing') value.result.attachments = [];
      if (kind === 'wrong-turn') item.sourceTurnId = 'other-turn';
      if (kind === 'wrong-file') item.fileId = 'other-file';
      if (kind === 'duplicate') value.result.attachments.push(item);
      if (kind === 'path') Object.assign(item, { absolutePath: '/private/blob' });
      if (kind === 'reason')
        Object.assign(item, { status: 'unavailable', reason: 'raw disk error' });
      expect(LocalMachineRpcResponseSchema.safeParse(value).success).toBe(false);
    }
  );
  it('accepts explicit missing-file status without implying execution or automatic recovery', () => {
    const value = response();
    Object.assign(value.result.attachments[0] ?? {}, { status: 'unavailable', reason: 'missing' });
    expect(LocalMachineRpcResponseSchema.parse(value)).toEqual(value);
  });
  it('negotiates preparation only, without inferring from the build or claiming publication', () => {
    expect(machineSupportsDesignContinuationPreparation(undefined)).toBe(false);
    expect(
      machineSupportsDesignContinuationPreparation({
        protocolCapabilities: { designContinuationPreparation: 0 },
      })
    ).toBe(false);
    expect(
      CURRENT_MACHINE_PROTOCOL_CAPABILITIES[
        MACHINE_PROTOCOL_CAPABILITIES.designContinuationPreparation
      ]
    ).toBe(DESIGN_CONTINUATION_PREPARATION_PROTOCOL_VERSION);
    expect(
      machineSupportsDesignContinuationPreparation({
        protocolCapabilities: CURRENT_MACHINE_PROTOCOL_CAPABILITIES,
      })
    ).toBe(true);
  });
});
