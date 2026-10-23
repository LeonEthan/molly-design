import { beforeAll, describe, expect, it } from 'vitest';
import i18next from 'i18next';

import { activityGroupSummaryParts } from '../src/components/ai-gui/view';
import { initI18n } from '../src/i18n';

const empty = {
  hasThought: false,
  commandCount: 0,
  readFileCount: 0,
  editFileCount: 0,
  searchCount: 0,
  fetchCount: 0,
  otherCount: 0,
};

describe('activity group summary', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  it('folds every tool kind into one step count after the thought', () => {
    const parts = activityGroupSummaryParts(
      {
        ...empty,
        hasThought: true,
        commandCount: 26,
        readFileCount: 7,
        editFileCount: 1,
        otherCount: 7,
      },
      false,
      i18next.t
    );
    expect(parts).toEqual(['Thought', '41 steps']);
  });

  it('uses the singular for one step and omits an empty count', () => {
    expect(activityGroupSummaryParts({ ...empty, searchCount: 1 }, false, i18next.t)).toEqual([
      '1 step',
    ]);
    expect(activityGroupSummaryParts({ ...empty, hasThought: true }, true, i18next.t)).toEqual([
      'Thinking…',
    ]);
  });
});
