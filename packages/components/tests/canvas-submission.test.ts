import { describe, expect, it } from 'vitest';
import {
  buildPendingUserHistoryEntry,
  buildSessionTurnInputConfig,
  historyItemsToInputBlocks,
  type SessionInputBlock,
} from '@molly/shared';
import { buildCanvasSubmission } from '../src/components/chat/canvas-submission';

const instruction = ({ width, height }: { width: number; height: number }) =>
  `Canvas size: ${width} × ${height} px. Design at exactly this width and height.`;
const draft: SessionInputBlock[] = [
  { type: 'text', text: 'Make a poster' },
  {
    type: 'image',
    imageId: 'reference',
    mimeType: 'image/png',
    width: 10,
    height: 10,
    sizeBytes: 100,
  },
];

describe('landing canvas submission through durable turn input', () => {
  it.each([
    [1200, 628],
    [628, 1200],
    [800, 600],
    [1, 4096],
  ])('delivers custom %i × %i with the same dimensions as artwork creation', (width, height) => {
    const submit = () =>
      buildCanvasSubmission(draft, { mode: 'custom', width, height }, instruction);
    const submission = submit();
    expect(submission.dimensions).toEqual({ width, height });
    const config = buildSessionTurnInputConfig({
      inputBlocks: submission.inputBlocks,
      cliType: 'codex',
      agentType: 'codex',
    });
    const entry = buildPendingUserHistoryEntry({
      userId: 'local:test',
      inputBlocks: submission.inputBlocks,
      timestamp: '2026-09-19T00:00:00Z',
      inputConfig: config,
    });
    expect(config.prompt).toContain(instruction({ width, height }));
    expect(historyItemsToInputBlocks(entry!.items)).toEqual(submission.inputBlocks);
    expect(submission.inputBlocks.slice(0, draft.length)).toEqual(draft);
    expect(submit()).toEqual(submission); // Retrying rebuilds from the untouched draft.
    expect(draft).toHaveLength(2);
  });
  it.each([undefined, { mode: 'auto' as const, width: 800, height: 600 }])(
    'keeps Auto and non-desktop submissions unconstrained',
    (size) => {
      expect(buildCanvasSubmission(draft, size, instruction)).toEqual({
        inputBlocks: draft,
        dimensions: undefined,
      });
    }
  );
  it.each([0, 4097, 1.5, NaN])('rejects invalid dimensions %s before create/send', (width) => {
    expect(() =>
      buildCanvasSubmission(draft, { mode: 'custom', width, height: 600 }, instruction)
    ).toThrow(RangeError);
  });
});
