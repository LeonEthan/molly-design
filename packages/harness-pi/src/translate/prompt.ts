/**
 * Convert ACP prompt ContentBlocks to a pi-compatible message string and image array.
 */

import type { ContentBlock } from '@agentclientprotocol/sdk';
import { fileURLToPath } from 'node:url';

export interface PiImage {
  type: 'image';
  mimeType: string;
  data: string;
}

export function acpPromptToPiMessage(blocks: ContentBlock[]): {
  message: string;
  images: PiImage[];
} {
  let message = '';
  const images: PiImage[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        message += block.text;
        break;

      case 'resource_link':
        // Host attachments are materialized local files; give native tools their path.
        message += block.uri.startsWith('file:')
          ? `\nUser attachment: ${JSON.stringify({ name: block.name, path: fileURLToPath(block.uri), mimeType: block.mimeType, size: block.size })}`
          : `\n[Context] ${block.uri}`;
        break;

      case 'image':
        images.push({
          type: 'image',
          mimeType: block.mimeType,
          data: block.data,
        });
        break;

      case 'resource': {
        const resource = block.resource;
        const uri = resource.uri;
        const mime = resource.mimeType ?? null;

        if ('text' in resource) {
          message += `\n[Embedded Context] ${uri} (${mime ?? 'text/plain'})\n${resource.text}`;
        } else if ('blob' in resource) {
          if (!mime?.startsWith('image/')) throw new Error('pi_acp_binary_context_unsupported');
          images.push({ type: 'image', mimeType: mime, data: resource.blob });
        } else {
          message += `\n[Embedded Context] ${uri}`;
        }
        break;
      }

      case 'audio': {
        throw new Error('pi_acp_audio_unsupported');
      }

      default:
        throw new Error('pi_acp_prompt_content_unsupported');
    }
  }

  return { message, images };
}
