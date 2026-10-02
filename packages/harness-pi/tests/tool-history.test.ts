import { describe, expect, it } from 'vitest';
import type { NestedToolCallRecord, ToolResultMessage } from '@earendil-works/pi-ai';
import { replayNestedToolCalls } from '../src/tool-history';

const result = (calls: NestedToolCallRecord[], complete = true): ToolResultMessage => ({
  role: 'toolResult',
  toolCallId: 'native/parent',
  toolName: 'codemode',
  content: [],
  isError: false,
  timestamp: 0,
  nestedCalls: { calls, complete },
});

describe('native nested-tool history', () => {
  it('recovers original IDs, parent associations and terminal outcomes without copying arguments', () => {
    const summary = replayNestedToolCalls(
      result([
        {
          id: 'native/parent/1',
          name: 'read',
          arguments: { path: 'media/synthetic.png', privatePayload: 'UNSTORED_ARGUMENT' },
          status: 'ok',
        },
        {
          id: 'native/parent/1/1',
          name: 'mcp__synthetic__fail',
          status: 'error',
          error: 'SYNTHETIC_FAILURE',
        },
      ]),
      '/synthetic',
      new Set()
    );
    expect(summary.updates).toMatchObject([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'native/parent/1',
        status: 'completed',
        locations: [{ path: '/synthetic/media/synthetic.png' }],
        _meta: { lody: { toolName: 'read', parentToolCallId: 'native/parent' } },
      },
      {
        toolCallId: 'native/parent/1/1',
        status: 'failed',
        _meta: {
          lody: { toolName: 'mcp__synthetic__fail', parentToolCallId: 'native/parent/1' },
        },
      },
    ]);
    expect(JSON.stringify(summary)).toContain('SYNTHETIC_FAILURE');
    expect(JSON.stringify(summary)).toContain('original result is not recorded');
    expect(JSON.stringify(summary)).not.toContain('UNSTORED_ARGUMENT');
    expect(summary.updates.every((update) => !('rawInput' in update))).toBe(true);
    expect(summary.notices).toEqual([]);
  });

  it('does not duplicate native records or invent results for incomplete calls', () => {
    const seen = new Set(['native/parent/1']);
    const message = result(
      [
        { id: 'native/parent/1', name: 'read', status: 'ok' },
        { id: 'native/parent/2', name: 'image', status: 'unfinished' },
        { id: 'native/parent/3', name: 'fail', status: 'error', error: 'x'.repeat(2000) },
        { id: 'native/parent/3', name: 'fail', status: 'error' },
        { id: 'another-parent/1', name: 'foreign', status: 'ok' },
        { id: 'native/parent/0', name: 'invalid', status: 'ok' },
        { id: 'native/parent/99/1', name: 'orphan', status: 'ok' },
      ],
      false
    );
    const summary = replayNestedToolCalls(message, '/synthetic', seen);
    expect(summary.updates.map((update) => 'toolCallId' in update && update.toolCallId)).toEqual([
      'native/parent/3',
    ]);
    expect(JSON.stringify(summary)).toContain('missing results remain unknown');
    expect(JSON.stringify(summary)).toContain('Unfinished calls: image');
    expect(JSON.stringify(summary)).not.toContain('x'.repeat(501));
    expect(replayNestedToolCalls(message, '/synthetic', seen).updates).toEqual([]);
  });

  it('keeps legacy native results without nested records unchanged', () => {
    const message = result([]);
    delete message.nestedCalls;
    expect(replayNestedToolCalls(message, '/synthetic', new Set())).toEqual({
      updates: [],
      notices: [],
    });
  });
});
