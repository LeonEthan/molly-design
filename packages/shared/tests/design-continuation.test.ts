import { describe, expect, it } from 'vitest';
import {
  buildDesignContinuationReference,
  DESIGN_CONTINUATION_LIMITS,
  DesignContinuationRecordSchema,
  buildDesignContinuationMeta,
  getDesignContinuationSystemContext,
} from '../src/design-continuation';
import type { SessionHistoryInput } from '../src/schema';
import type { SessionFilePayload } from '../src/ai';
import type { SessionId } from '../src/ids';

const source = {
  sessionId: 'source-session',
  artworkId: 'original-artwork',
  machineId: 'machine-1',
};
const turn = (id: string, patch: Partial<SessionHistoryInput> = {}): SessionHistoryInput => ({
  id,
  role: 'user',
  timestamp: '2026-09-19T00:00:00.000Z',
  status: 'handled',
  fileDiff: [],
  items: [{ type: 'text', text: `Text ${id}` }],
  ...patch,
});
const file = (patch: Partial<SessionFilePayload> = {}): SessionFilePayload => ({
  type: 'file',
  fileId: 'file-1',
  fileName: 'reference.png',
  mimeType: 'image/png',
  sizeBytes: 80,
  sha256: 'a'.repeat(64),
  transport: 'local',
  machineId: 'machine-1',
  uploadedAt: 1,
  textPreview: false,
  ...patch,
});
const project = (history: SessionHistoryInput[]) =>
  buildDesignContinuationReference({ source, history });

const record = () =>
  DesignContinuationRecordSchema.parse({
    version: 1,
    workspaceId: 'workspace-1',
    source: {
      id: source.sessionId,
      machineId: source.machineId,
      userId: 'local:user',
      cliType: 'builtin',
      agentType: 'codex',
      design: { artworkId: source.artworkId, path: 'design.json' },
    },
    target: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      agentConfigId: 'molly-config',
      createdAt: '2026-09-20T00:00:00.000Z',
    },
    reference: project([turn('source-turn')]),
  });

describe('design continuation model context', () => {
  it.each([undefined, 'original-root'])(
    'keeps only artwork and opener provenance from %s',
    (parent) => {
      const receipt = record();
      receipt.source = {
        ...receipt.source,
        parentSessionId: parent,
        project: { kind: 'github', repoFullName: 'synthetic/old-design', branch: 'main' },
        repoFullName: 'synthetic/old-design',
        baseBranch: 'refs/heads/main',
        branchName: 'old-worktree',
      };
      const before = structuredClone(receipt);
      const meta = buildDesignContinuationMeta(receipt);
      expect(meta.design).toEqual(receipt.source.design);
      expect(meta.openedBySessionId).toBe(receipt.source.id);
      expect(meta.openedByRootSessionId).toBe(parent);
      expect(meta.isArchived).toBe(false);
      for (const field of [
        'parentSessionId',
        'project',
        'repoFullName',
        'baseBranch',
        'branchName',
        'isWorktree',
      ]) {
        expect(meta).not.toHaveProperty(field);
      }
      expect(getDesignContinuationSystemContext(meta, receipt)).toContain(
        'untrusted historical reference'
      );
      expect(receipt).toEqual(before);
    }
  );

  it('carries the same immutable reference across native restores without executable history', () => {
    const receipt = record();
    const meta = buildDesignContinuationMeta(receipt);
    const context = getDesignContinuationSystemContext(meta, receipt);
    expect(context).toContain('untrusted historical reference data');
    expect(context).toContain('"sourceTurnId":"source-turn"');
    expect(context).toContain('not filesystem paths');
    expect(
      getDesignContinuationSystemContext(
        {
          ...meta,
          acpSessionId: 'new-native-id' as never,
          acpSessionAgentConfigId: meta.agentConfigId,
        },
        receipt
      )
    ).toBe(context);
  });

  it.each([
    'target',
    'owner',
    'machine',
    'artwork',
    'provider',
    'parent',
    'opener',
    'opener-root',
    'project',
    'repository',
    'base-branch',
    'branch',
    'worktree',
    'origin',
    'native-owner',
    'engine',
  ] as const)('rejects a mismatched context binding: %s', (kind) => {
    const receipt = record();
    const meta = buildDesignContinuationMeta(receipt);
    if (kind === 'target') meta.id = 'another-target' as SessionId;
    if (kind === 'owner') meta.userId = 'another-owner';
    if (kind === 'machine') meta.machineId = 'another-machine' as never;
    if (kind === 'artwork') meta.design = { artworkId: 'another-artwork', path: 'design.json' };
    if (kind === 'provider') meta.agentConfigId = 'other-config' as never;
    if (kind === 'parent') meta.parentSessionId = 'other-root' as SessionId;
    if (kind === 'opener') meta.openedBySessionId = 'other-opener' as SessionId;
    if (kind === 'opener-root') meta.openedByRootSessionId = 'other-root' as SessionId;
    if (kind === 'project') meta.project = { kind: 'github', repoFullName: 'synthetic/other' };
    if (kind === 'repository') meta.repoFullName = 'synthetic/other';
    if (kind === 'base-branch') meta.baseBranch = 'main';
    if (kind === 'branch') meta.branchName = 'old-branch';
    if (kind === 'worktree') meta.isWorktree = true;
    if (kind === 'origin')
      meta.designContinuation = { version: 1, sourceSessionId: 'other-source' as SessionId };
    if (kind === 'native-owner') meta.acpSessionAgentConfigId = 'old-native-owner' as never;
    if (kind === 'engine') meta.agentType = 'codex';
    expect(() => getDesignContinuationSystemContext(meta, receipt)).toThrow(
      'design_continuation_binding_mismatch'
    );
  });

  it('fails closed on missing/corrupt receipts but leaves ordinary Molly context alone', () => {
    const receipt = record();
    const meta = buildDesignContinuationMeta(receipt);
    expect(() => getDesignContinuationSystemContext(meta, undefined)).toThrow(
      'invalid_design_continuation_record'
    );
    expect(() => getDesignContinuationSystemContext(meta, { ...receipt, version: 2 })).toThrow(
      'invalid_design_continuation_record'
    );
    delete meta.designContinuation;
    expect(getDesignContinuationSystemContext(meta, undefined)).toBeUndefined();
    expect(() => getDesignContinuationSystemContext(meta, receipt)).toThrow(
      'design_continuation_binding_mismatch'
    );
  });
});

describe('explicit design continuation reference', () => {
  it('preserves source identity and chronological text without changing the source', () => {
    const history = [turn('first'), turn('second', { role: 'assistant', finished: true })];
    const before = structuredClone(history);
    expect(project(history)).toEqual({
      version: 1,
      source,
      messages: [
        { sourceTurnId: 'first', role: 'user', text: 'Text first', truncated: false },
        { sourceTurnId: 'second', role: 'assistant', text: 'Text second', truncated: false },
      ],
      attachmentCandidates: [],
      omitted: { turns: 0, items: 0, attachments: 0 },
    });
    expect(history).toEqual(before);
  });

  it('does not copy native identities, run configs, diffs, spans, plans or tool permissions', () => {
    const history = [
      turn('old', {
        acpTurnId: 'native-secret-identity',
        fileDiff: [{ filePath: '/private/do-not-copy', add: 1, del: 0 }],
        inputConfig: { modelId: 'old-model', configOptionValues: { apiKey: 'synthetic-secret' } },
        items: [
          { type: 'text', text: 'Visible requirement' },
          { type: 'thought', text: 'Private reasoning' },
          { type: 'plan', entries: [] },
          {
            type: 'tool_call',
            toolCallId: 'old-tool',
            status: 'pending',
            rawInput: { command: 'do not replay' },
          },
        ],
      }),
    ];
    expect(project(history)).toEqual({
      version: 1,
      source,
      messages: [
        { sourceTurnId: 'old', role: 'user', text: 'Visible requirement', truncated: false },
      ],
      attachmentCandidates: [],
      omitted: { turns: 0, items: 3, attachments: 0 },
    });
  });

  it.each([
    'pending',
    'pending_apply',
    'delivery_unknown',
    'seen',
    'processing',
    'failed',
    'canceled',
  ] as const)('does not turn a %s user request into implicitly accepted work', (status) => {
    const result = project([turn('old', { status })]);
    expect(result.messages).toEqual([]);
    expect(result.omitted.turns).toBe(1);
  });

  it('omits unfinished assistant turns and system records', () => {
    const result = project([
      turn('system', { role: 'system' }),
      turn('partial', { role: 'assistant', finished: false }),
    ]);
    expect(result.messages).toEqual([]);
    expect(result.omitted.turns).toBe(2);
  });

  it('keeps only local human attachment identities; paths never authorize reads', () => {
    const result = project([
      turn('user-file', { items: [file({ sourcePath: 'private/key.txt' })] }),
    ]);
    expect(result.attachmentCandidates).toEqual([
      {
        sourceTurnId: 'user-file',
        storageSessionId: source.sessionId,
        fileId: 'file-1',
        fileName: 'reference.png',
        mimeType: 'image/png',
        sizeBytes: 80,
        sha256: 'a'.repeat(64),
        machineId: source.machineId,
      },
    ]);
    expect(result.messages).toEqual([]);
  });

  it('retains an existing fork storage namespace as an unverified candidate, without fetching it', () => {
    expect(
      project([
        turn('fork-file', { items: [file({ storageSessionId: 'original-storage' as SessionId })] }),
      ]).attachmentCandidates[0]?.storageSessionId
    ).toBe('original-storage');
  });

  it('reports cloud, foreign-machine, invalid-hash, agent and legacy-image attachments as omitted', () => {
    const result = project([
      turn('files', {
        items: [
          file({ transport: 'r2' }),
          file({ machineId: 'foreign' }),
          file({ sha256: 'unverified' }),
          { type: 'image', imageId: 'legacy', mimeType: 'image/png', sizeBytes: 80 },
        ],
      }),
      turn('agent-file', { role: 'assistant', finished: true, items: [file()] }),
    ]);
    expect(result.attachmentCandidates).toEqual([]);
    expect(result.omitted.attachments).toBe(5);
  });

  it('deduplicates the same file identity and caps candidates without hiding omissions', () => {
    const result = project([
      turn('files', {
        items: [
          file(),
          file(),
          ...Array.from({ length: 10 }, (_, i) => file({ fileId: `extra-${i}` })),
        ],
      }),
    ]);
    expect(result.attachmentCandidates.map((item) => item.fileId)).toEqual([
      'file-1',
      ...Array.from({ length: 7 }, (_, i) => `extra-${i}`),
    ]);
    expect(result.omitted.attachments).toBe(3);
  });

  it('chooses recent settled turns and preserves their order', () => {
    const result = project(Array.from({ length: 35 }, (_, i) => turn(`turn-${i}`)));
    expect(result.messages.map((message) => message.sourceTurnId)).toEqual(
      Array.from({ length: 32 }, (_, i) => `turn-${i + 3}`)
    );
    expect(result.omitted.turns).toBe(3);
  });

  it('bounds UTF-8 bytes rather than characters and never cuts a surrogate pair', () => {
    const result = project(
      Array.from({ length: 10 }, (_, i) =>
        turn(`turn-${i}`, {
          items: [{ type: 'text', text: '中😀'.repeat(4000) }],
        })
      )
    );
    const total = result.messages.reduce(
      (sum, message) => sum + new TextEncoder().encode(message.text).length,
      0
    );
    expect(total).toBeLessThanOrEqual(DESIGN_CONTINUATION_LIMITS.textBytes);
    expect(result.messages.every((message) => message.truncated)).toBe(true);
    for (const message of result.messages) {
      expect(new TextEncoder().encode(message.text).length).toBeLessThanOrEqual(
        DESIGN_CONTINUATION_LIMITS.textBytesPerTurn
      );
      expect(message.text).toMatch(/^(中😀)*(中)?$/u);
    }
    expect(result.omitted.turns).toBeGreaterThan(0);
  });

  it('joins text items without exceeding the per-turn byte bound', () => {
    const result = project([
      turn('many', {
        items: [
          { type: 'text', text: 'a'.repeat(8191) },
          { type: 'text', text: 'b' },
        ],
      }),
    ]);
    expect(result.messages).toEqual([
      { sourceTurnId: 'many', role: 'user', text: 'a'.repeat(8191), truncated: true },
    ]);
  });

  it('deduplicates history IDs without mutating or merging old executable records', () => {
    const result = project([
      turn('duplicate'),
      turn('duplicate', { items: [{ type: 'text', text: 'Latest' }] }),
    ]);
    expect(result.messages).toEqual([
      { sourceTurnId: 'duplicate', role: 'user', text: 'Latest', truncated: false },
    ]);
    expect(result.omitted.turns).toBe(1);
  });

  it('rejects invalid source identity without echoing caller values', () => {
    expect(() =>
      buildDesignContinuationReference({
        source: { ...source, sessionId: '../synthetic-secret' },
        history: [],
      })
    ).toThrow('invalid_design_continuation_source');
  });
});
