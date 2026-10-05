import { describe, expect, test } from 'vitest';

import {
  areSessionDiffSummariesEqual,
  buildSessionDiffSummary,
} from '../src/components/sessions/session-diff-summary';

describe('buildSessionDiffSummary', () => {
  test('deduplicates per-turn file paths without synthesizing All Changes entries', () => {
    const summary = buildSessionDiffSummary([
      {
        id: 'turn-1',
        fileDiff: [
          { filePath: 'src/a.ts', add: 2, del: 1 },
          { filePath: 'src/b.ts', add: 4, del: 0 },
          { filePath: 'src/a.ts', add: 1, del: 3 },
        ],
      },
      {
        id: 'turn-2',
        fileDiff: [{ filePath: 'src/a.ts', add: 5, del: 2 }],
      },
    ]);

    expect(summary.changeEntries).toEqual([]);
    expect(summary.changeFilePaths).toEqual([]);
    expect(summary.diffFilePathsByTurn).toEqual({
      'turn-1': ['src/a.ts', 'src/b.ts'],
      'turn-2': ['src/a.ts'],
    });
    expect(summary.diffEntriesByTurn).toEqual({
      'turn-1': [
        { filePath: 'src/a.ts', add: 3, del: 4 },
        { filePath: 'src/b.ts', add: 4, del: 0 },
      ],
      'turn-2': [{ filePath: 'src/a.ts', add: 5, del: 2 }],
    });
  });

  test('treats non-diff conversation updates as unchanged', () => {
    const baseSummary = buildSessionDiffSummary([
      {
        id: 'turn-1',
        fileDiff: [{ filePath: 'src/a.ts', add: 2, del: 1 }],
      },
    ]);

    const updatedSummary = buildSessionDiffSummary([
      {
        id: 'turn-1',
        fileDiff: [{ filePath: 'src/a.ts', add: 2, del: 1 }],
      },
      {
        id: 'turn-2',
      },
      {
        id: 'turn-3',
        fileDiff: [],
      },
    ]);

    expect(areSessionDiffSummariesEqual(baseSummary, updatedSummary)).toBe(true);
  });

  test('detects per-turn diff updates', () => {
    const baseSummary = buildSessionDiffSummary([
      {
        id: 'turn-1',
        fileDiff: [{ filePath: 'src/a.ts', add: 2, del: 1 }],
      },
    ]);

    const updatedSummary = buildSessionDiffSummary([
      {
        id: 'turn-1',
        fileDiff: [{ filePath: 'src/a.ts', add: 2, del: 1 }],
      },
      {
        id: 'turn-2',
        fileDiff: [{ filePath: 'src/a.ts', add: 1, del: 0 }],
      },
    ]);

    expect(areSessionDiffSummariesEqual(baseSummary, updatedSummary)).toBe(false);
  });

  test('does not synthesize All Changes entries when history is empty', () => {
    const summary = buildSessionDiffSummary(undefined);

    expect(summary.changeEntries).toEqual([]);
    expect(summary.changeFilePaths).toEqual([]);
    expect(summary.diffFilePathsByTurn).toEqual({});
  });
});
