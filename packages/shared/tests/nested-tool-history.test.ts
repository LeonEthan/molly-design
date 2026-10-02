import { describe, expect, it } from 'vitest';
import { LoroDoc } from 'loro-crdt';
import { applyNotificationOnHistory } from '../src/acp/history-apply';
import { parseSessionNotification } from '../src/acp/schema';
import { createHistoryWriter } from '../src/history-writer';

const notification = (update: unknown) =>
  parseSessionNotification({ sessionId: 'synthetic-session', update });

describe('provider-neutral nested tool history', () => {
  it('keeps live result paths and parent identity through partial updates, replay and Loro reopen', () => {
    const start = notification({
      sessionUpdate: 'tool_call',
      toolCallId: 'parent/1',
      title: 'Generate image',
      kind: 'other',
      status: 'in_progress',
      rawInput: { script: 'UNSTORED_SCRIPT', image: 'UNSTORED_IMAGE_BYTES' },
      _meta: { lody: { toolName: 'mcp__molly__molly_generate_image', parentToolCallId: 'parent' } },
    });
    const finish = notification({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'parent/1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: '{"path":"media/asset.png"}' } }],
      rawOutput: { bytes: 'UNSTORED_IMAGE_BYTES' },
    });
    const history = applyNotificationOnHistory([], [start, finish, start], undefined, {
      targetAssistantEntryId: 'turn',
      now: () => '2026-01-01T00:00:00Z',
    });
    expect(history[0]?.items).toMatchObject([
      {
        toolCallId: 'parent/1',
        parentToolCallId: 'parent',
        toolName: 'mcp__molly__molly_generate_image',
        status: 'completed',
        content: [
          { type: 'content', content: { type: 'text', text: '{"path":"media/asset.png"}' } },
        ],
      },
    ]);
    expect(history[0]?.items).toHaveLength(1);
    const doc = new LoroDoc();
    const writer = createHistoryWriter(doc);
    for (const entry of history) writer.append(entry);
    const restored = new LoroDoc();
    restored.import(doc.export({ mode: 'snapshot' }));
    const entry = createHistoryWriter(restored).read('turn');
    expect(entry?.items).toEqual(history[0]?.items);
    expect(JSON.stringify(entry)).toContain('media/asset.png');
    expect(JSON.stringify(entry)).not.toContain('UNSTORED_');
  });

  it('rejects malformed/self parent metadata and does not rewrite an established parent', () => {
    for (const parentToolCallId of ['', 5, 'call']) {
      const history = applyNotificationOnHistory(
        [],
        [
          notification({
            sessionUpdate: 'tool_call',
            toolCallId: 'call',
            title: 'Probe',
            _meta: { lody: { parentToolCallId } },
          }),
        ]
      );
      expect(history[0]?.items?.[0]).not.toHaveProperty('parentToolCallId', parentToolCallId);
    }
    const history = applyNotificationOnHistory(
      [],
      [
        notification({
          sessionUpdate: 'tool_call',
          toolCallId: 'call',
          title: 'Probe',
          _meta: { lody: { parentToolCallId: 'original' } },
        }),
        notification({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call',
          status: 'failed',
          _meta: { lody: { parentToolCallId: 'replacement' } },
        }),
      ]
    );
    expect(history[0]?.items?.[0]).toMatchObject({
      parentToolCallId: 'original',
      status: 'failed',
    });
  });
});
