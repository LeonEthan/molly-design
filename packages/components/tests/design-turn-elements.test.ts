import { describe, expect, it } from 'vitest';
import { formatDesignElementReference } from '@molly/shared/design-element-reference';
import {
  designElementIdsInTurn,
  readDesignTurnElementIds,
  splitDesignChanges,
} from '../src/lib/design-turn-elements';
import type { ConversationView } from '../src/lib/conversation-view/types';

const marker = (elementIds: string[]) =>
  formatDesignElementReference({
    artworkId: 'artwork',
    baselineRevisionId: 'a'.repeat(64),
    elementIds,
  });

describe('design turn element references', () => {
  it('collects referenced ids from every text item and skips malformed markers', () => {
    expect(
      designElementIdsInTurn({
        items: [
          { type: 'text', text: `Warmer ${marker(['title', 'leaf'])}` },
          { type: 'text', text: `${marker(['title'])} and <molly-elements>{broken` },
          { type: 'image', url: 'x' },
        ],
      })
    ).toEqual(['title', 'leaf']);
    expect(designElementIdsInTurn({ items: [{ type: 'text', text: 'No reference' }] })).toEqual(
      []
    );
    expect(designElementIdsInTurn(undefined)).toEqual([]);
  });

  it('hydrates only the user turn that owns an assistant turn id, then releases it', async () => {
    const rows = [
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
    ];
    const turns: Record<number, unknown> = {
      0: { items: [{ type: 'text', text: marker(['title']) }] },
    };
    const released: number[] = [];
    const view = {
      indexOf: (id: string) => rows.findIndex((row) => row.id === id),
      index: (i: number) => rows[i],
      turn: (i: number) => turns[i],
      acquireRange: (from: number) => ({
        ready: Promise.resolve(),
        release: () => released.push(from),
      }),
    } as unknown as ConversationView;
    expect(await readDesignTurnElementIds(view, 'a1')).toEqual(['title']);
    expect(await readDesignTurnElementIds(view, 'u1')).toEqual(['title']);
    expect(await readDesignTurnElementIds(view, 'missing')).toEqual([]);
    expect(await readDesignTurnElementIds(null, 'u1')).toEqual([]);
    expect(released).toEqual([0, 0]);
  });

  it('separates changes outside the referenced elements', () => {
    const changes = { changed: ['title', 'leaf', 'badge'], removed: ['logo', 'title-old'] };
    expect(splitDesignChanges(changes, ['title', 'title-old'])).toEqual({
      inside: ['title'],
      outside: ['leaf', 'badge'],
      removedOutside: 1,
    });
    expect(splitDesignChanges(changes, [])).toEqual({
      inside: ['title', 'leaf', 'badge'],
      outside: [],
      removedOutside: 0,
    });
  });
});
