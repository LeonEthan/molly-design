import { describe, expect, test } from 'vitest';

import { computeSessionDiffInputsFingerprint } from '../src/components/sessions/use-session-diff-summary';

describe('useSessionDiffSummary helpers', () => {
  test('ignores streaming history item changes when fingerprinting diff inputs', () => {
    const before = computeSessionDiffInputsFingerprint([
      {
        id: 'assistant-1',
        role: 'assistant',
        items: [{ type: 'text', text: 'hello' }],
        fileDiff: [],
      },
    ]);
    const after = computeSessionDiffInputsFingerprint([
      {
        id: 'assistant-1',
        role: 'assistant',
        items: [{ type: 'text', text: 'hello world streamed token' }],
        fileDiff: [],
      },
    ]);

    expect(after).toBe(before);
  });

  test('tracks fileDiff checkpoints when fingerprinting diff inputs', () => {
    const before = computeSessionDiffInputsFingerprint([
      {
        id: 'assistant-1',
        role: 'assistant',
        fileDiff: [{ filePath: 'README.md', add: 1, del: 0 }],
      },
    ]);
    const after = computeSessionDiffInputsFingerprint([
      {
        id: 'assistant-1',
        role: 'assistant',
        fileDiff: [
          {
            filePath: 'README.md',
            add: 1,
            del: 0,
            cc: { v: 1, fileId: 't:readme', baseOpId: '1:1', opId: '1:2' },
          },
        ],
      },
    ]);

    expect(after).not.toBe(before);
  });
});
