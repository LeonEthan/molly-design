import { describe, expect, it } from 'vitest';
import {
  IMAGE_CONNECTION_GENERATIONS_PATH,
  IMAGE_CONNECTION_MAX_API_KEY_LENGTH,
  IMAGE_CONNECTION_MODELS_PATH,
  IMAGE_CONNECTION_VERSION,
  imageConnectionUrl,
  isImageConnectionReady,
  normalizeImageConnectionBaseUrl,
  normalizeImageConnectionSettings,
  toPublicImageConnection,
  type ImageConnectionSettings,
} from '../src/image-connection';
import { isSensitiveAgentRoleConfigOptionKey } from '../src/agent-role';
import { isSensitiveAcpConfigOptionId } from '../src/session-preparation';

const stored = (overrides: Partial<ImageConnectionSettings> = {}): ImageConnectionSettings => ({
  v: IMAGE_CONNECTION_VERSION,
  enabled: true,
  baseUrl: 'https://images.example.com/v1',
  apiKey: 'sk-test-secret',
  model: 'saved-custom-model',
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

describe('normalizeImageConnectionBaseUrl', () => {
  it('keeps an https origin and path, and drops a trailing slash', () => {
    expect(normalizeImageConnectionBaseUrl('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1'
    );
    expect(normalizeImageConnectionBaseUrl('https://api.openai.com')).toBe(
      'https://api.openai.com'
    );
  });

  it('accepts http for a local gateway', () => {
    expect(normalizeImageConnectionBaseUrl('http://127.0.0.1:8080/v1')).toBe(
      'http://127.0.0.1:8080/v1'
    );
  });

  it('refuses schemes, embedded credentials, and query strings', () => {
    expect(normalizeImageConnectionBaseUrl('file:///etc/passwd')).toBeUndefined();
    expect(normalizeImageConnectionBaseUrl('ftp://host/v1')).toBeUndefined();
    expect(normalizeImageConnectionBaseUrl('https://user:pass@host/v1')).toBeUndefined();
    expect(normalizeImageConnectionBaseUrl('https://host/v1?key=abc')).toBeUndefined();
    expect(normalizeImageConnectionBaseUrl('not a url')).toBeUndefined();
    expect(normalizeImageConnectionBaseUrl('   ')).toBeUndefined();
    expect(normalizeImageConnectionBaseUrl(undefined)).toBeUndefined();
  });
});

describe('normalizeImageConnectionSettings', () => {
  it('reads a complete row', () => {
    const settings = normalizeImageConnectionSettings(stored());
    expect(settings).toEqual(stored());
  });

  it('refuses a row this build cannot use instead of defaulting it', () => {
    expect(normalizeImageConnectionSettings({ ...stored(), v: 2 })).toBeUndefined();
    expect(normalizeImageConnectionSettings({ ...stored(), baseUrl: 'nope' })).toBeUndefined();
    expect(normalizeImageConnectionSettings({ ...stored(), model: '  ' })).toBeUndefined();
    expect(normalizeImageConnectionSettings({ ...stored(), updatedAt: -1 })).toBeUndefined();
    expect(normalizeImageConnectionSettings({ ...stored(), updatedAt: 'now' })).toBeUndefined();
    expect(normalizeImageConnectionSettings({ ...stored(), apiKey: undefined })).toBeUndefined();
    expect(
      normalizeImageConnectionSettings({
        ...stored(),
        apiKey: 'x'.repeat(IMAGE_CONNECTION_MAX_API_KEY_LENGTH + 1),
      })
    ).toBeUndefined();
    expect(normalizeImageConnectionSettings(null)).toBeUndefined();
    expect(normalizeImageConnectionSettings([])).toBeUndefined();
    expect(normalizeImageConnectionSettings('stored')).toBeUndefined();
  });

  it('keeps an empty key as a stored-but-unready state', () => {
    const settings = normalizeImageConnectionSettings({ ...stored(), apiKey: '  ' });
    expect(settings?.apiKey).toBe('');
    expect(isImageConnectionReady(settings)).toBe(false);
  });
});

describe('isImageConnectionReady', () => {
  it('requires enabled, a base URL, a model, and a key', () => {
    expect(isImageConnectionReady(stored())).toBe(true);
    expect(isImageConnectionReady(stored({ enabled: false }))).toBe(false);
    expect(isImageConnectionReady(stored({ apiKey: '' }))).toBe(false);
    expect(isImageConnectionReady(stored({ model: ' ' }))).toBe(false);
    expect(isImageConnectionReady(stored({ baseUrl: 'nope' }))).toBe(false);
    expect(isImageConnectionReady(undefined)).toBe(false);
    expect(isImageConnectionReady(null)).toBe(false);
  });
});

describe('toPublicImageConnection', () => {
  it('never carries the key, only whether one is stored', () => {
    const publicValue = toPublicImageConnection(stored());
    expect(publicValue).toEqual({
      enabled: true,
      baseUrl: 'https://images.example.com/v1',
      model: 'saved-custom-model',
      hasApiKey: true,
      updatedAt: 1_700_000_000_000,
    });
    expect(JSON.stringify(publicValue)).not.toContain('sk-test-secret');
    expect(toPublicImageConnection(undefined)).toBeNull();
  });
});

describe('imageConnectionUrl', () => {
  it('joins the configured root with the API path', () => {
    const settings = stored();
    expect(imageConnectionUrl(settings, IMAGE_CONNECTION_MODELS_PATH)).toBe(
      'https://images.example.com/v1/models'
    );
    expect(imageConnectionUrl(settings, IMAGE_CONNECTION_GENERATIONS_PATH)).toBe(
      'https://images.example.com/v1/images/generations'
    );
    expect(imageConnectionUrl(settings, 'models')).toBe('https://images.example.com/v1/models');
  });
});

describe('credential key naming', () => {
  it('is covered by the shared sensitive-key filters', () => {
    // The image connection persists an `apiKey`; both filters must refuse it so a
    // future surface cannot copy the secret into a Role or a preparation request.
    expect(isSensitiveAcpConfigOptionId('apiKey')).toBe(true);
    expect(isSensitiveAgentRoleConfigOptionKey('apiKey')).toBe(true);
    expect(isSensitiveAgentRoleConfigOptionKey('imageApiKey')).toBe(true);
    expect(isSensitiveAgentRoleConfigOptionKey('imageConnection.apiKey')).toBe(true);
  });
});
