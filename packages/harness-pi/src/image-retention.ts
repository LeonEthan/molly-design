import type { AgentMessage, AgentToolCall } from '@earendil-works/pi-agent-core';
import type { ImageContent } from '@earendil-works/pi-ai';

export const KEEP_RECENT_TOOL_IMAGES = 4;
export const COLLAPSE_THRESHOLD = 8;

function imageDimensions(image: ImageContent): string | undefined {
  const bytes = Buffer.from(image.data, 'base64');
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  )
    return `${bytes.readUInt32BE(16)}×${bytes.readUInt32BE(20)}`;
  if (bytes.length < 2 || bytes.readUInt16BE(0) !== 0xffd8) return undefined;
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset++] !== 0xff) return undefined;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xda || marker === 0xd9) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) return undefined;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return undefined;
    if (
      length >= 7 &&
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    )
      return `${bytes.readUInt16BE(offset + 5)}×${bytes.readUInt16BE(offset + 3)}`;
    offset += length;
  }
  return undefined;
}

export function retainRecentToolImages(messages: AgentMessage[]): AgentMessage[] | undefined {
  const total = messages.reduce(
    (count, message) =>
      count +
      (message.role === 'toolResult'
        ? message.content.filter((block) => block.type === 'image').length
        : 0),
    0
  );
  if (total <= COLLAPSE_THRESHOLD) return undefined;
  const batch = COLLAPSE_THRESHOLD - KEEP_RECENT_TOOL_IMAGES;
  const collapseBefore = Math.floor((total - KEEP_RECENT_TOOL_IMAGES) / batch) * batch;
  const toolCalls = new Map<string, AgentToolCall>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const block of message.content) {
      if (block.type === 'toolCall') toolCalls.set(block.id, block);
    }
  }
  let index = 0;
  return messages.map((message) => {
    if (message.role !== 'toolResult') return message;
    return {
      ...message,
      content: message.content.map((block) => {
        if (block.type !== 'image' || index++ >= collapseBefore) return block;
        const call = toolCalls.get(message.toolCallId);
        const dimensions = imageDimensions(block);
        const path = call?.arguments.path;
        return {
          type: 'text',
          text: `[Image omitted from this request to save context: ${block.mimeType}, ${dimensions ? `${dimensions}, ` : ''}from tool ${call?.name ?? message.toolName}${typeof path === 'string' ? `; path ${path}` : ''}. Read the file again if you need to look at it.]`,
        };
      }),
    };
  });
}
