import { createMcpAdapter } from 'pi-mcp-adapter';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function registerMcpFactory(pi: ExtensionAPI) {
  pi.events.on('molly:mcp-factory', (request: unknown) => {
    if (typeof request === 'function') request(createMcpAdapter);
  });
}
