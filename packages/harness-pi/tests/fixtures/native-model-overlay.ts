import { createHash } from 'node:crypto';
import { PI_ENGINE_VERSION } from '@molly/shared/embedded-harness';
import type { NativeModelOverlay } from '../../src/native-model-overlay';

export function syntheticKimiProModel(): NativeModelOverlay['entry']['models'][number] {
  return {
    id: 'k3.1-pro',
    name: 'Kimi K3.1 Pro',
    api: 'openai-completions',
    provider: 'kimi-coding',
    baseUrl: 'https://api.kimi.com/coding/v1',
    input: ['text', 'image'],
    inputLimits: {
      images: {
        resize: {
          maxWidth: 2000,
          maxHeight: 2000,
          maxBytes: 4_718_592,
          jpegQuality: 80,
        },
      },
    },
    cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 },
    type: 'chat',
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: 'low',
      medium: null,
      high: 'high',
      xhigh: null,
      max: 'max',
    },
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    compat: {
      supportsStrictMode: false,
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: 'max_tokens',
      thinkingFormat: 'openai',
      requiresReasoningContentOnAssistantMessages: true,
      supportsMidConvoSystemMessages: true,
      supportsMidConvoToolAdditions: true,
    },
  };
}

export function syntheticNativeModelOverlay(): NativeModelOverlay {
  return {
    version: 1,
    engineVersion: PI_ENGINE_VERSION,
    providerId: 'kimi-coding',
    source: 'pi.dev',
    entry: {
      models: [syntheticKimiProModel()],
      lastModified: Date.parse('2031-01-01T00:00:00.000Z'),
    },
  };
}

export function syntheticOverlayManifest(bytes: string) {
  return {
    files: [
      {
        path: 'native-model-overlay.json',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
  };
}
