import type { ImageConnectionProtocol } from '@molly/shared';
import type { ProviderPresetId } from '@molly/shared/embedded-harness';

export type OnboardingSignInEntry = {
  preset: 'openai' | 'kimi-coding';
  labelKey: string;
  metaKey: string;
};

export type OnboardingApiKeyEntry = {
  preset: ProviderPresetId;
  metaKey: string;
};

export function isChineseLocale(language: string | undefined): boolean {
  return Boolean(language && /^zh(?:[-_]|$)/i.test(language));
}

const ALL_KEY_PRESETS: readonly ProviderPresetId[] = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'moonshot',
  'zai',
  'xai',
  'minimax',
  'openrouter',
  'kimi-coding',
  'openai-compatible',
];

const SIGN_IN_ENTRIES: Record<'openai' | 'kimi-coding', OnboardingSignInEntry> = {
  'kimi-coding': {
    preset: 'kimi-coding',
    labelKey: 'settings.models.kimiCodePlan',
    metaKey: 'onboarding.models.providerMeta.kimiCode',
  },
  openai: {
    preset: 'openai',
    labelKey: 'settings.models.chatgpt',
    metaKey: 'onboarding.models.providerMeta.chatgpt',
  },
};

export function getOnboardingLanguageProviders(language: string | undefined): {
  signIn: readonly OnboardingSignInEntry[];
  apiKey: readonly OnboardingApiKeyEntry[];
  more: readonly ProviderPresetId[];
} {
  const zh = isChineseLocale(language);
  const signIn = zh
    ? [SIGN_IN_ENTRIES['kimi-coding'], SIGN_IN_ENTRIES.openai]
    : [SIGN_IN_ENTRIES.openai, SIGN_IN_ENTRIES['kimi-coding']];
  const apiKey: readonly OnboardingApiKeyEntry[] = zh
    ? [
        { preset: 'deepseek', metaKey: 'onboarding.models.providerMeta.cnDirect' },
        { preset: 'openai', metaKey: 'onboarding.models.providerMeta.reuseImage' },
      ]
    : [
        { preset: 'openai', metaKey: 'onboarding.models.providerMeta.reuseImage' },
        { preset: 'anthropic', metaKey: 'onboarding.models.providerMeta.apiKey' },
      ];
  const primarySet = new Set<ProviderPresetId>(apiKey.map((entry) => entry.preset));
  const more = ALL_KEY_PRESETS.filter((preset) => !primarySet.has(preset));
  return { signIn, apiKey, more };
}

export const PROVIDER_KEY_CONSOLE_URLS: Partial<Record<ProviderPresetId, string>> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  google: 'https://aistudio.google.com/apikey',
  deepseek: 'https://platform.deepseek.com/api_keys',
  moonshot: 'https://platform.moonshot.cn/console/api-keys',
  'kimi-coding': 'https://www.kimi.com/code',
  zai: 'https://open.bigmodel.cn/usercenter/apikeys',
  xai: 'https://console.x.ai/',
  minimax: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  openrouter: 'https://openrouter.ai/keys',
};

export function getOnboardingImageProtocols(
  language: string | undefined
): readonly ImageConnectionProtocol[] {
  return isChineseLocale(language)
    ? ['dashscope', 'openai-images']
    : ['openai-images', 'dashscope'];
}

export const IMAGE_PROTOCOL_KEY_URLS: Record<ImageConnectionProtocol, string> = {
  'openai-images': 'https://platform.openai.com/api-keys',
  dashscope: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
};

export const IMAGE_PROTOCOL_ONBOARDING_COPY: Record<
  ImageConnectionProtocol,
  { mark: string; nameKey: string; metaKey: string }
> = {
  dashscope: {
    mark: 'QW',
    nameKey: 'onboarding.models.image.dashscopeName',
    metaKey: 'onboarding.models.image.dashscopeMeta',
  },
  'openai-images': {
    mark: 'OA',
    nameKey: 'onboarding.models.image.openaiName',
    metaKey: 'onboarding.models.image.openaiMeta',
  },
};

export const IMAGE_MODEL_ONBOARDING_CARDS: Record<
  string,
  { labelKey: string; recommended?: boolean }
> = {
  'qwen-image-2.1': {
    labelKey: 'onboarding.models.image.models.qwen-image-2.1',
    recommended: true,
  },
  'qwen-image-2.0': {
    labelKey: 'onboarding.models.image.models.qwen-image-2.0',
  },
  'gpt-image-2': {
    labelKey: 'onboarding.models.image.models.gpt-image-2',
    recommended: true,
  },
  'gpt-image-1': {
    labelKey: 'onboarding.models.image.models.gpt-image-1',
  },
};
