import type { AgentMessage, AgentToolCall } from '@earendil-works/pi-agent-core';
import type { ImageContent, ToolResultMessage } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { retainRecentToolImages } from '../src/image-retention';

function png(): ImageContent {
  const header = Buffer.from('89504e470d0a1a0a0000000d494844520000043800000546', 'hex');
  return { type: 'image', mimeType: 'image/png', data: header.toString('base64') };
}

function history(count: number): AgentMessage[] {
  return [
    {
      role: 'assistant',
      api: 'openai-completions',
      provider: 'synthetic',
      model: 'synthetic',
      content: Array.from(
        { length: count },
        (_, index): AgentToolCall => ({
          type: 'toolCall',
          id: `call-${index}`,
          name: index === 1 ? 'codemode' : 'read',
          arguments: index === 1 ? {} : { path: `/synthetic/preview-${index}.png` },
        })
      ),
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'toolUse',
      timestamp: 0,
    },
    ...Array.from(
      { length: count },
      (_, index): ToolResultMessage => ({
        role: 'toolResult',
        toolCallId: `call-${index}`,
        toolName: index === 1 ? 'codemode' : 'read',
        content: [{ type: 'text', text: `Image note ${index}` }, png()],
        isError: false,
        timestamp: index,
      })
    ),
  ];
}

function toolBlocks(messages: AgentMessage[]) {
  return messages.flatMap((message) =>
    message.role === 'toolResult' ? message.content.slice(1) : []
  );
}

describe('request-level tool image retention', () => {
  it('leaves up to eight tool images unchanged', () => {
    for (let count = 0; count <= 8; count++) {
      expect(retainRecentToolImages(history(count))).toBeUndefined();
    }
  });

  it('replaces the oldest four of nine and oldest eight of twelve images', () => {
    for (const [count, collapsed] of [
      [9, 4],
      [12, 8],
    ]) {
      const messages = history(count!);
      const output = retainRecentToolImages(messages)!;
      expect(toolBlocks(output).map((block) => block.type)).toEqual([
        ...Array<string>(collapsed!).fill('text'),
        ...Array<string>(count! - collapsed!).fill('image'),
      ]);
      expect(output.slice(collapsed! + 1)).toEqual(messages.slice(collapsed! + 1));
      for (const [index, message] of output.entries()) {
        if (message.role === 'toolResult') {
          expect(message.content[0]).toEqual({ type: 'text', text: `Image note ${index - 1}` });
        }
      }
    }
    const combined = history(9);
    const results = combined.filter((message) => message.role === 'toolResult');
    const first = results[0]!;
    const packed = [
      combined[0]!,
      { ...first, content: results.flatMap((result) => result.content) },
    ];
    expect(
      retainRecentToolImages(packed)!.flatMap((message) =>
        message.role === 'toolResult'
          ? message.content.filter((block) => block.type === 'image')
          : []
      )
    ).toHaveLength(5);
  });

  it('never replaces or counts user images', () => {
    const user: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'Reference' }, ...Array.from({ length: 12 }, png)],
      timestamp: 0,
    };
    expect(retainRecentToolImages([user, ...history(8)])).toBeUndefined();
    expect(retainRecentToolImages([user, ...history(12)])![0]).toEqual(user);
  });

  it('includes matching read paths and header dimensions, omitting unknown metadata', () => {
    const messages = history(9);
    const jpeg = messages[2]!;
    const unknown = messages[3]!;
    if (jpeg.role !== 'toolResult' || unknown.role !== 'toolResult') throw new Error('fixture');
    jpeg.content[1] = {
      type: 'image',
      mimeType: 'image/jpeg',
      data: Buffer.from('ffd8ffe000040000ffc000080800c8014000', 'hex').toString('base64'),
    };
    unknown.content[1] = { type: 'image', mimeType: 'image/webp', data: 'c3ludGhldGlj' };
    expect(toolBlocks(retainRecentToolImages(messages)!).slice(0, 3)).toEqual([
      {
        type: 'text',
        text: '[Image omitted from this request to save context: image/png, 1080×1350, from tool read; path /synthetic/preview-0.png. Read the file again if you need to look at it.]',
      },
      {
        type: 'text',
        text: '[Image omitted from this request to save context: image/jpeg, 320×200, from tool codemode. Read the file again if you need to look at it.]',
      },
      {
        type: 'text',
        text: '[Image omitted from this request to save context: image/webp, from tool read; path /synthetic/preview-2.png. Read the file again if you need to look at it.]',
      },
    ]);
  });

  it('keeps placeholders byte-stable and advances the boundary every four appended images', () => {
    let previous: ReturnType<typeof toolBlocks> = [];
    for (let count = 9; count <= 20; count++) {
      const blocks = toolBlocks(retainRecentToolImages(history(count))!);
      const collapsed = Math.floor((count - 4) / 4) * 4;
      expect(blocks.map((block) => block.type)).toEqual([
        ...Array<string>(collapsed).fill('text'),
        ...Array<string>(count - collapsed).fill('image'),
      ]);
      for (const [index, block] of previous.entries()) {
        if (block.type === 'text') expect(blocks[index]).toEqual(block);
      }
      previous = blocks;
    }
  });

  it('does not mutate input messages', () => {
    const messages = history(12);
    const before = structuredClone(messages);
    expect(retainRecentToolImages(messages)).not.toEqual(before);
    expect(messages).toEqual(before);
  });
});
