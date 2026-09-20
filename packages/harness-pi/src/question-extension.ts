import {
  createExtensionRuntime,
  defineTool,
  type Extension,
  type LoadExtensionsResult,
} from '@earendil-works/pi-coding-agent';
import askQuestion from '../vendor/pi-ask-question/ask-question';
import manifest from '../vendor/pi-ask-question/manifest.json';

export const QUESTION_EXTENSION_IDENTITY = {
  name: manifest.name,
  version: manifest.version,
  commit: manifest.commit,
  sha256: manifest.adaptedSha256,
};

/** Fixed, reviewed factory; no package loader, path discovery or runtime install. */
export function createQuestionExtensions(): LoadExtensionsResult {
  const path = '<molly-pi-ask-question-0.4.0>';
  const sourceInfo = {
    path,
    source: 'molly-bundled',
    scope: 'temporary',
    origin: 'package',
  } as const;
  const extension: Extension = {
    path,
    resolvedPath: path,
    sourceInfo,
    handlers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
    messageRenderers: new Map(),
    tools: new Map(),
  };
  askQuestion({
    registerTool(definition) {
      if (extension.tools.has(definition.name)) throw new Error('harness_extension_tool_collision');
      extension.tools.set(definition.name, { definition: defineTool(definition), sourceInfo });
    },
  });
  return { extensions: [extension], errors: [], runtime: createExtensionRuntime() };
}
