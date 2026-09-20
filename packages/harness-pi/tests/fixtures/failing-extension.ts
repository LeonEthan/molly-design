import {
  createExtensionRuntime,
  type Extension,
  type ExtensionEvent,
  type LoadExtensionsResult,
} from '@earendil-works/pi-coding-agent';

export function failingExtension(
  hook: ExtensionEvent['type'],
  events: string[]
): LoadExtensionsResult {
  const path = '<synthetic-failing-extension>';
  const extension: Extension = {
    path,
    resolvedPath: path,
    sourceInfo: { path, source: 'synthetic', scope: 'temporary', origin: 'package' },
    handlers: new Map([
      [
        hook,
        [
          async () => {
            events.push(hook);
            throw new Error('SYNTHETIC_PRIVATE_EXTENSION_DIAGNOSTIC');
          },
        ],
      ],
    ]),
    tools: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
    messageRenderers: new Map(),
  };
  return { extensions: [extension], errors: [], runtime: createExtensionRuntime() };
}
