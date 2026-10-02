import type { SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { describeToolCall } from './tool-presentation';

export function toolCallMeta(toolName: string, parentToolCallId?: string) {
  return {
    lody: {
      toolName,
      ...(parentToolCallId ? { parentToolCallId } : {}),
    },
  };
}

export function replayNestedToolCalls(
  message: ToolResultMessage,
  cwd: string,
  seen: Set<string>
): { updates: SessionUpdate[]; notices: ToolCallContent[] } {
  const nested = message.nestedCalls;
  if (!nested) return { updates: [], notices: [] };
  const calls = nested.calls.slice(0, 256);
  const known = new Set([message.toolCallId, ...calls.map((call) => call.id)]);
  const updates: SessionUpdate[] = [];
  const unfinished: string[] = [];
  let incomplete = !nested.complete || nested.calls.length > calls.length;

  for (const call of calls) {
    if (seen.has(call.id)) continue;
    const suffix = call.id.startsWith(`${message.toolCallId}/`)
      ? call.id.slice(message.toolCallId.length + 1)
      : '';
    const parentToolCallId = call.id.slice(0, call.id.lastIndexOf('/'));
    if (!/^[1-9]\d*(?:\/[1-9]\d*)*$/.test(suffix) || !known.has(parentToolCallId)) {
      incomplete = true;
      continue;
    }
    seen.add(call.id);
    if (call.status === 'unfinished') {
      incomplete = true;
      if (unfinished.length < 8)
        unfinished.push(`${call.name.slice(0, 120)} (${call.id.slice(0, 120)})`);
      continue;
    }
    const { rawInput: _rawInput, ...presentation } = describeToolCall(
      call.name,
      call.arguments,
      cwd
    );
    const content: ToolCallContent[] = [
      {
        type: 'content',
        content: {
          type: 'text',
          text:
            'Recovered nested-tool summary. The original result is not recorded.' +
            (call.status === 'error' && call.error ? `\n${call.error.slice(0, 500)}` : ''),
        },
      },
    ];
    updates.push({
      sessionUpdate: 'tool_call',
      toolCallId: call.id,
      ...presentation,
      status: call.status === 'error' ? 'failed' : 'completed',
      content,
      _meta: toolCallMeta(call.name, parentToolCallId),
    });
  }

  return {
    updates,
    notices: incomplete
      ? [
          {
            type: 'content',
            content: {
              type: 'text',
              text:
                'The native nested-tool record is incomplete; missing results remain unknown.' +
                (unfinished.length ? `\nUnfinished calls: ${unfinished.join(', ')}` : ''),
            },
          },
        ]
      : [],
  };
}
